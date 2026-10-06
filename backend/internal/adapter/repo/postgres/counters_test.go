package postgres

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Ф-4: счётчики, удаление, закреп — интеграционные проверки хранилища.

func memberCounters(t *testing.T, pool *pgxpool.Pool, chatID, userID int64) (unread, mentions, reactions int) {
	t.Helper()
	if err := pool.QueryRow(context.Background(),
		`SELECT unread_count, unread_mentions_count, unread_reactions FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID).Scan(&unread, &mentions, &reactions); err != nil {
		t.Fatalf("counters: %v", err)
	}
	return
}

// A3-09 / A3-27: unread_reactions — число сообщений с непрочитанной реакцией;
// ReadReactions гасит только до горизонта; удалённое не в счёт; ReactionsFor
// отдаёт непрочитанность только автору.
func TestCounters_UnreadReactionsByMessages(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	reacts := NewReactionsRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7600")
	b := seedUser(t, pool, "+7601")
	chatID := createPrivate(t, pool, a, b)
	m1 := insertMsg(t, NewMessagesRepo(pool), chatID, a, "text", "one")
	m2 := insertMsg(t, NewMessagesRepo(pool), chatID, a, "text", "two")

	_ = reacts.Add(ctx, m1.ID, b, "👍", true)
	_ = reacts.Add(ctx, m1.ID, b, "❤", true)
	_ = reacts.Add(ctx, m2.ID, b, "👍", true)
	if n, err := chats.RecountUnreadReactions(ctx, chatID, a); err != nil || n != 2 {
		t.Fatalf("Recount = %d, %v; want 2 (сообщения, не события)", n, err)
	}
	byMsg, _ := reacts.ReactionsFor(ctx, []int64{m1.ID}, a)
	if rc := byMsg[m1.ID]; len(rc) == 0 || len(rc[0].RecentUnread) == 0 || !rc[0].RecentUnread[0] {
		t.Fatalf("автору непрочитанность не доехала: %+v", rc)
	}
	byMsg, _ = reacts.ReactionsFor(ctx, []int64{m1.ID}, b)
	if rc := byMsg[m1.ID]; len(rc) == 0 || rc[0].RecentUnread != nil {
		t.Fatalf("не автору ушла непрочитанность: %+v", rc)
	}

	read, err := chats.ReadReactions(ctx, chatID, a, m1.Seq)
	if err != nil || len(read) != 1 || read[0].ID != m1.ID {
		t.Fatalf("ReadReactions до m1 = %+v, %v", read, err)
	}
	if _, _, r := memberCounters(t, pool, chatID, a); r != 1 {
		t.Fatalf("после прочтения до m1 unread_reactions = %d, want 1", r)
	}
	if err := msgs.SoftDelete(ctx, m2.ID); err != nil {
		t.Fatal(err)
	}
	if n, _ := chats.RecountUnreadReactions(ctx, chatID, a); n != 0 {
		t.Fatalf("реакция на удалённом в счёте: %d", n)
	}
}

// A1-07 / A3-11: ✓✓ группы — MAX горизонта остальных (прочитал хоть один).
func TestCounters_GroupOutboxHorizonIsMax(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7610")
	b := seedUser(t, pool, "+7611")
	c := seedUser(t, pool, "+7612")
	chatID := createGroupLike(t, pool, "group", a)
	_ = groups.AddMember(ctx, chatID, b, domain.RoleMember, 0)
	_ = groups.AddMember(ctx, chatID, c, domain.RoleMember, 0)
	for k := 0; k < 3; k++ {
		insertMsg(t, NewMessagesRepo(pool), chatID, a, "text", "m")
	}
	if err := chats.SetRead(ctx, chatID, b, 3, 0); err != nil {
		t.Fatal(err)
	}
	ds, _ := chats.ListDialogs(ctx, a)
	if len(ds) != 1 || ds[0].PeerReadSeq != 3 {
		t.Fatalf("read_outbox группы в списке = %+v, want 3", ds)
	}
	card, err := groups.Card(ctx, chatID, a)
	if err != nil || card.ReadOutboxMaxID != 3 {
		t.Fatalf("read_outbox группы в карточке = %d, %v; want 3", card.ReadOutboxMaxID, err)
	}
}

// A3-23: pinned_msg_id карточки не указывает на удалённое; A1-04: PinnedIDs.
func TestCounters_PinnedSkipsDeleted(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	groups := NewGroupRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7620")
	chatID := createGroupLike(t, pool, "group", a)
	m1 := insertMsg(t, NewMessagesRepo(pool), chatID, a, "text", "старый закреп")
	m2 := insertMsg(t, NewMessagesRepo(pool), chatID, a, "text", "новый закреп")
	_ = chats.PinMessage(ctx, chatID, m1.ID, a)
	_ = chats.PinMessage(ctx, chatID, m2.ID, a)
	if p, _ := chats.PinnedIDs(ctx, []int64{m1.ID, m2.ID}); !p[m1.ID] || !p[m2.ID] {
		t.Fatalf("PinnedIDs = %v", p)
	}
	_ = msgs.SoftDelete(ctx, m2.ID)
	card, err := groups.Card(ctx, chatID, a)
	if err != nil || card.PinnedMsgID != m1.Seq {
		t.Fatalf("pinned_msg_id = %d, %v; want %d (предыдущий живой)", card.PinnedMsgID, err, m1.Seq)
	}
}

// A2-26: новое сообщение возвращает из архива только незаглушённых.
func TestCounters_UnarchiveUnmuted(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7630")
	b := seedUser(t, pool, "+7631")
	c := seedUser(t, pool, "+7632")
	chatID := createGroupLike(t, pool, "group", a)
	_ = groups.AddMember(ctx, chatID, b, domain.RoleMember, 0)
	_ = groups.AddMember(ctx, chatID, c, domain.RoleMember, 0)
	if _, err := pool.Exec(ctx, `UPDATE chat_members SET archived = true WHERE chat_id=$1`, chatID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chat_members SET muted_until = now() + interval '1 day' WHERE chat_id=$1 AND user_id=$2`, chatID, c); err != nil {
		t.Fatal(err)
	}
	back, err := chats.UnarchiveUnmuted(ctx, chatID, []int64{b, c})
	if err != nil || len(back) != 1 || back[0] != b {
		t.Fatalf("UnarchiveUnmuted = %v, %v; want [%d]", back, err, b)
	}
}

// A3-02 / A3-10 / A3-29 / A3-39: скрытая строка диалога, видимые номера,
// пересчёт счётчиков после массового удаления, снятие упоминаний сообщения и
// выбывшего, CountUnread без скрытого у себя.
func TestCounters_DialogHiddenAndRecount(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7640")
	b := seedUser(t, pool, "+7641")
	chatID := createPrivate(t, pool, a, b)
	m1 := insertMsg(t, NewMessagesRepo(pool), chatID, b, "text", "one")
	m2 := insertMsg(t, NewMessagesRepo(pool), chatID, b, "text", "two")
	_ = chats.AddMention(ctx, chatID, m1.ID, m1.Seq, a)
	if _, err := chats.IncUnreadBulk(ctx, chatID, []int64{a}); err != nil {
		t.Fatal(err)
	}
	_, _ = chats.IncUnreadBulk(ctx, chatID, []int64{a})

	// «удалить у себя» m2: CountUnread его не считает.
	_ = msgs.HideForUser(ctx, a, m2.ID)
	if n, _ := msgs.CountUnread(ctx, chatID, a, 0); n != 1 {
		t.Fatalf("CountUnread со скрытым у себя = %d, want 1", n)
	}
	seqs, _ := chats.VisibleSeqsUpTo(ctx, chatID, a, m2.Seq)
	if len(seqs) != 1 || seqs[0] != m1.Seq {
		t.Fatalf("VisibleSeqsUpTo = %v, want [%d]", seqs, m1.Seq)
	}

	// удаление у всех m1: упоминание снимается, пересчёт счётчиков.
	_ = msgs.SoftDelete(ctx, m1.ID)
	if err := chats.DropMessageMentions(ctx, chatID, m1.ID); err != nil {
		t.Fatal(err)
	}
	if err := chats.RecountCounters(ctx, chatID, []int64{a, b}); err != nil {
		t.Fatal(err)
	}
	if u, mn, _ := memberCounters(t, pool, chatID, a); u != 0 || mn != 0 {
		t.Fatalf("после удаления unread=%d mentions=%d, want 0/0", u, mn)
	}
	if _, err := chats.NextMention(ctx, chatID, a, 0); err == nil {
		t.Fatal("«к следующему @» ведёт на удалённое")
	}

	// скрытая строка диалога и возврат новым сообщением.
	_ = chats.SetDialogHidden(ctx, chatID, a, true)
	if ds, _ := chats.ListDialogs(ctx, a); len(ds) != 0 {
		t.Fatalf("скрытый диалог в списке: %d", len(ds))
	}
	_ = chats.ShowDialogs(ctx, chatID)
	if ds, _ := chats.ListDialogs(ctx, a); len(ds) != 1 {
		t.Fatalf("диалог не вернулся: %d", len(ds))
	}

	// выход: упоминания выбывшего снимаются.
	m3 := insertMsg(t, NewMessagesRepo(pool), chatID, b, "text", "three")
	_ = chats.AddMention(ctx, chatID, m3.ID, m3.Seq, a)
	_ = chats.DropUserMentions(ctx, chatID, a)
	if got, _ := chats.MessageMentions(ctx, m3.ID); len(got) != 0 {
		t.Fatalf("упоминания выбывшего остались: %v", got)
	}

	// revoke: удаление пачкой.
	gone, err := msgs.SoftDeleteUpTo(ctx, chatID, m3.Seq)
	if err != nil || len(gone) != 2 {
		t.Fatalf("SoftDeleteUpTo = %d, %v; want 2 (m2, m3 — m1 уже удалено)", len(gone), err)
	}
}
