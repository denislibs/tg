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
	if _, err := msgs.SoftDelete(ctx, m2.ID); err != nil {
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
	if p, _ := chats.PinnedIDs(ctx, a, []int64{m1.ID, m2.ID}); !p[m1.ID] || !p[m2.ID] {
		t.Fatalf("PinnedIDs = %v", p)
	}
	_, _ = msgs.SoftDelete(ctx, m2.ID)
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
	_, _ = msgs.HideForUser(ctx, a, m2.ID)
	if n, _ := msgs.CountUnread(ctx, chatID, a, 0); n != 1 {
		t.Fatalf("CountUnread со скрытым у себя = %d, want 1", n)
	}
	seqs, _ := chats.VisibleSeqsUpTo(ctx, chatID, a, m2.Seq)
	if len(seqs) != 1 || seqs[0] != m1.Seq {
		t.Fatalf("VisibleSeqsUpTo = %v, want [%d]", seqs, m1.Seq)
	}

	// удаление у всех m1: упоминание снимается, пересчёт счётчиков.
	_, _ = msgs.SoftDelete(ctx, m1.ID)
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
	if err := msgs.SoftDeleteUpTo(ctx, chatID, m3.Seq); err != nil {
		t.Fatalf("SoftDeleteUpTo: %v", err)
	}
	if seqs, _ := chats.VisibleSeqsUpTo(ctx, chatID, b, m3.Seq); len(seqs) != 0 {
		t.Fatalf("после удаления пачкой видно %v", seqs)
	}
}

// A2-12 / A3-10 / A3-22: удаление у всех (SoftDelete — общий путь удаления и
// автоудаления) снимает упоминания адресатов и ❤ автора; A3-29: скрытие у себя
// снимает непрочитанное и упоминание скрывшего.
func TestCounters_SoftDeleteAndHideBookkeeping(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	msgs := NewMessagesRepo(pool)
	reacts := NewReactionsRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7650")
	b := seedUser(t, pool, "+7651")
	chatID := createPrivate(t, pool, a, b)
	m1 := insertMsg(t, msgs, chatID, b, "text", "@a раз")
	m2 := insertMsg(t, msgs, chatID, b, "text", "@a два")
	_ = chats.AddMention(ctx, chatID, m1.ID, m1.Seq, a)
	_ = chats.AddMention(ctx, chatID, m2.ID, m2.Seq, a)
	_, _ = chats.IncUnreadBulk(ctx, chatID, []int64{a})
	_, _ = chats.IncUnreadBulk(ctx, chatID, []int64{a})
	_ = reacts.Add(ctx, m1.ID, a, "👍", true)
	_, _ = chats.RecountUnreadReactions(ctx, chatID, b)

	if _, err := msgs.SoftDelete(ctx, m1.ID); err != nil {
		t.Fatal(err)
	}
	if _, mn, _ := memberCounters(t, pool, chatID, a); mn != 1 {
		t.Fatalf("после удаления у всех «@» = %d, want 1", mn)
	}
	if _, _, r := memberCounters(t, pool, chatID, b); r != 0 {
		t.Fatalf("❤ автора удалённого = %d, want 0", r)
	}
	if next, _ := chats.NextMention(ctx, chatID, a, 0); next != m2.Seq {
		t.Fatalf("к следующему @ = %d, want %d", next, m2.Seq)
	}
	if _, err := msgs.HideForUser(ctx, a, m2.ID); err != nil {
		t.Fatal(err)
	}
	_, _ = msgs.HideForUser(ctx, a, m2.ID) // повтор — no-op
	if u, mn, _ := memberCounters(t, pool, chatID, a); u != 1 || mn != 0 {
		t.Fatalf("после удаления у себя unread=%d «@»=%d, want 1/0", u, mn)
	}
}

// F6 (9.1): повтор удаления отвечает «ничего не изменилось» — вызывающий не
// вычитает непрочитанное и не пишет журнал второй раз.
func TestSoftDeleteAndHide_RepeatReportsNoChange(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7652")
	b := seedUser(t, pool, "+7653")
	chatID := createPrivate(t, pool, a, b)
	m1 := insertMsg(t, msgs, chatID, b, "text", "раз")
	m2 := insertMsg(t, msgs, chatID, b, "text", "два")

	for i, want := range []bool{true, false, false} {
		got, err := msgs.SoftDelete(ctx, m1.ID)
		if err != nil || got != want {
			t.Fatalf("SoftDelete #%d = %v %v, want %v", i+1, got, err, want)
		}
	}
	for i, want := range []bool{true, false} {
		got, err := msgs.HideForUser(ctx, a, m2.ID)
		if err != nil || got != want {
			t.Fatalf("HideForUser #%d = %v %v, want %v", i+1, got, err, want)
		}
	}
}

// F6 (Р-13): «удалить у себя» невидимого зрителю сообщения — (false, nil), без
// строки скрытия и без вычета непрочитанного: удалённое у всех и лежащее под
// горизонтом очистки в unread_count уже не входят.
func TestHideForUser_InvisibleMessageIsNoop(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7654")
	b := seedUser(t, pool, "+7655")
	chatID := createPrivate(t, pool, a, b)
	old := insertMsg(t, msgs, chatID, b, "text", "старое")
	gone := insertMsg(t, msgs, chatID, b, "text", "удалённое")
	live := insertMsg(t, msgs, chatID, b, "text", "живое")
	for range 3 {
		_, _ = chats.IncUnreadBulk(ctx, chatID, []int64{a})
	}
	if _, err := msgs.SoftDelete(ctx, gone.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chat_members SET cleared_max_seq = $3 WHERE chat_id = $1 AND user_id = $2`, chatID, a, old.Seq); err != nil {
		t.Fatal(err)
	}
	before, _, _ := memberCounters(t, pool, chatID, a)

	for _, id := range []int64{gone.ID, old.ID} {
		if ok, err := msgs.HideForUser(ctx, a, id); err != nil || ok {
			t.Fatalf("HideForUser(невидимое %d) = %v %v, want false nil", id, ok, err)
		}
	}
	var hides int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM message_hides WHERE user_id = $1`, a).Scan(&hides); err != nil || hides != 0 {
		t.Fatalf("строк скрытия %d (%v), want 0", hides, err)
	}
	if after, _, _ := memberCounters(t, pool, chatID, a); after != before {
		t.Fatalf("unread %d -> %d: невидимое списало счётчик", before, after)
	}
	if ok, err := msgs.HideForUser(ctx, a, live.ID); err != nil || !ok {
		t.Fatalf("HideForUser(видимое) = %v %v, want true nil", ok, err)
	}
}

// F6 (Р-13, скрытая предыстория): сообщение до вступления участника при
// history_for_new=false ему не видно — «удалить у себя» его не скрывает и не
// вычитает unread_count (вступивший получает last_read_seq = 0, и вычет списал
// бы то, что никогда не считалось).
func TestHideForUser_HiddenPrehistoryIsNoop(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7658")
	late := seedUser(t, pool, "+7659")
	var chatID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, title, creator_id, history_for_new) VALUES ('group','Г',$1,false) RETURNING id`, owner).Scan(&chatID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES ($1,$2,'creator', now() - interval '2 hours')`, chatID, owner); err != nil {
		t.Fatal(err)
	}
	before := insertMsg(t, msgs, chatID, owner, "text", "до вступления")
	if _, err := pool.Exec(ctx, `UPDATE messages SET created_at = now() - interval '1 hour' WHERE id = $1`, before.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES ($1,$2,'member', now())`, chatID, late); err != nil {
		t.Fatal(err)
	}
	after := insertMsg(t, msgs, chatID, owner, "text", "после вступления")
	_, _ = chats.IncUnreadBulk(ctx, chatID, []int64{late})
	unread, _, _ := memberCounters(t, pool, chatID, late)

	if ok, err := msgs.HideForUser(ctx, late, before.ID); err != nil || ok {
		t.Fatalf("HideForUser(предыстория) = %v %v, want false nil", ok, err)
	}
	if now, _, _ := memberCounters(t, pool, chatID, late); now != unread {
		t.Fatalf("unread %d -> %d: предыстория списала счётчик", unread, now)
	}
	if ok, err := msgs.HideForUser(ctx, late, after.ID); err != nil || !ok {
		t.Fatalf("HideForUser(после вступления) = %v %v, want true nil", ok, err)
	}
}

// F6 (Р-11): скрытие строки снимает закреп и архив только у скрываемого; строка,
// вернувшаяся новым сообщением (ShowDialogs), не закреплена и не в архиве даже
// если закреп пришёл с другого устройства уже после удаления; скрытая строка
// не ест лимит закрепов.
func TestDialogHidden_DropsAndResetsPinAndArchive(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7660")
	b := seedUser(t, pool, "+7661")
	chatID := createPrivate(t, pool, a, b)
	state := func(uid int64) (pinned, archived bool) {
		if err := pool.QueryRow(ctx, `SELECT pinned_at IS NOT NULL, archived FROM chat_members WHERE chat_id=$1 AND user_id=$2`, chatID, uid).Scan(&pinned, &archived); err != nil {
			t.Fatal(err)
		}
		return
	}
	if _, err := pool.Exec(ctx, `UPDATE chat_members SET pinned_at = now(), archived = true WHERE chat_id = $1`, chatID); err != nil {
		t.Fatal(err)
	}

	if err := chats.SetDialogHidden(ctx, chatID, a, true); err != nil {
		t.Fatal(err)
	}
	if p, ar := state(a); p || ar {
		t.Fatalf("у скрывшего pinned=%v archived=%v, want false/false", p, ar)
	}
	if p, ar := state(b); !p || !ar {
		t.Fatalf("у собеседника pinned=%v archived=%v: чужой диалог тронут", p, ar)
	}

	// Закреп с другого устройства уже после удаления: строка скрыта, лимит не ест.
	if err := groups.SetPinned(ctx, chatID, a, true); err != nil {
		t.Fatal(err)
	}
	if n, err := groups.CountPinned(ctx, a); err != nil || n != 0 {
		t.Fatalf("CountPinned = %d %v, want 0: скрытая строка ест лимит", n, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chat_members SET archived = true WHERE chat_id = $1 AND user_id = $2`, chatID, a); err != nil {
		t.Fatal(err)
	}
	if err := chats.ShowDialogs(ctx, chatID); err != nil {
		t.Fatal(err)
	}
	if p, ar := state(a); p || ar {
		t.Fatalf("после возврата строки pinned=%v archived=%v, want false/false", p, ar)
	}
	if p, ar := state(b); !p || !ar {
		t.Fatalf("ShowDialogs тронул видимую строку собеседника: pinned=%v archived=%v", p, ar)
	}
}
