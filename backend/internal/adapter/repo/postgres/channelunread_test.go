package postgres

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Ф-2: непрочитанное broadcast-канала считается на чтении (пост не делает
// веера по подписчикам), и по одной формуле в списке, в карточке и в бейдже
// пуша.

func postTo(t *testing.T, msgs *MessagesRepo, chatID, sender int64, text string) domain.Message {
	t.Helper()
	ctx := context.Background()
	seq, err := msgs.NextSeq(ctx, chatID)
	if err != nil {
		t.Fatal(err)
	}
	m, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: sender, Type: "text", Text: text})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func dialogUnread(t *testing.T, repo *ChatsRepo, userID, chatID int64) (unread int, readSeq int64) {
	t.Helper()
	ds, err := repo.ListDialogs(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range ds {
		if d.ChatID == chatID {
			return d.UnreadCount, d.LastReadSeq
		}
	}
	t.Fatalf("у %d нет диалога %d", userID, chatID)
	return 0, 0
}

// A1-03/A3-01: посты канала дают подписчику непрочитанное — без единой записи
// в его строку членства; своё и удалённое не считаются.
func TestChannelUnread_ComputedOnRead(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats, groups, msgs, push := NewChatsRepo(pool), NewGroupRepo(pool), NewMessagesRepo(pool), NewPushRepo(pool)
	ctx := context.Background()
	author := seedUser(t, pool, "+79101")
	sub := seedUser(t, pool, "+79102")
	ch, _ := groups.CreateMultiMember(ctx, "channel", "News", "", "", true, author)
	_ = groups.AddMember(ctx, ch, author, domain.RoleCreator, domain.AllRights)
	_ = groups.AddMember(ctx, ch, sub, domain.RoleSubscriber, 0)

	postTo(t, msgs, ch, author, "первый")
	gone := postTo(t, msgs, ch, author, "удалят")
	postTo(t, msgs, ch, author, "третий")
	if err := msgs.SoftDelete(ctx, gone.ID); err != nil {
		t.Fatal(err)
	}

	if n, _ := dialogUnread(t, chats, sub, ch); n != 2 {
		t.Fatalf("непрочитанное подписчика = %d, want 2 (удалённый не в счёт)", n)
	}
	if n, _ := dialogUnread(t, chats, author, ch); n != 0 {
		t.Fatalf("у автора свои посты непрочитанными: %d", n)
	}
	card, err := groups.Card(ctx, ch, sub)
	if err != nil {
		t.Fatal(err)
	}
	if card.UnreadCount != 2 {
		t.Fatalf("карточка канала: unread = %d, want 2", card.UnreadCount)
	}
	if badge, _ := push.UnreadBadge(ctx, sub); badge != 2 {
		t.Fatalf("бейдж пуша = %d, want 2", badge)
	}
	// Прочитал до первого — осталось 1.
	if err := chats.SetRead(ctx, ch, sub, 1, 0); err != nil {
		t.Fatal(err)
	}
	if n, _ := dialogUnread(t, chats, sub, ch); n != 1 {
		t.Fatalf("после прочтения до 1: unread = %d, want 1", n)
	}

	// У группы — хранимый счётчик веера, формула канала её не трогает.
	grp, _ := groups.CreateMultiMember(ctx, "group", "G", "", "", false, author)
	_ = groups.AddMember(ctx, grp, author, domain.RoleCreator, domain.AllRights)
	_ = groups.AddMember(ctx, grp, sub, domain.RoleMember, 0)
	postTo(t, msgs, grp, author, "в группу")
	if n, _ := dialogUnread(t, chats, sub, grp); n != 0 {
		t.Fatalf("группа: unread = %d, want хранимый 0", n)
	}
}

// Вступивший в канал не получает бейджем всю его историю: горизонт чтения —
// последний пост на момент вступления.
func TestAddMember_ChannelJoinReadHorizon(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats, groups, msgs := NewChatsRepo(pool), NewGroupRepo(pool), NewMessagesRepo(pool)
	ctx := context.Background()
	author := seedUser(t, pool, "+79111")
	late := seedUser(t, pool, "+79112")
	ch, _ := groups.CreateMultiMember(ctx, "channel", "News", "", "", true, author)
	_ = groups.AddMember(ctx, ch, author, domain.RoleCreator, domain.AllRights)
	for range 3 {
		postTo(t, msgs, ch, author, "до вступления")
	}
	if err := groups.AddMember(ctx, ch, late, domain.RoleSubscriber, 0); err != nil {
		t.Fatal(err)
	}
	n, readSeq := dialogUnread(t, chats, late, ch)
	if n != 0 || readSeq != 3 {
		t.Fatalf("после вступления unread=%d read=%d, want 0 и 3", n, readSeq)
	}
	postTo(t, msgs, ch, author, "после")
	if n, _ := dialogUnread(t, chats, late, ch); n != 1 {
		t.Fatalf("пост после вступления: unread = %d, want 1", n)
	}
}

// Миграция 0141: у уже вступивших с нулевым горизонтом он поднимается до
// последнего поста, написанного раньше вступления; повторный прогон безопасен.
func TestMigration0141_ChannelJoinReadHorizon(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	chats, groups, msgs := NewChatsRepo(pool), NewGroupRepo(pool), NewMessagesRepo(pool)
	ctx := context.Background()
	author := seedUser(t, pool, "+79121")
	old := seedUser(t, pool, "+79122")
	ch, _ := groups.CreateMultiMember(ctx, "channel", "News", "", "", true, author)
	_ = groups.AddMember(ctx, ch, author, domain.RoleCreator, domain.AllRights)
	postTo(t, msgs, ch, author, "a")
	postTo(t, msgs, ch, author, "b")
	_ = groups.AddMember(ctx, ch, old, domain.RoleSubscriber, 0)
	postTo(t, msgs, ch, author, "c")
	// Состояние до Ф-2: горизонт нулевой, вступил после двух постов.
	mustExec(t, pool, `UPDATE chat_members SET last_read_seq = 0 WHERE chat_id=$1 AND user_id=$2`, ch, old)
	mustExec(t, pool, `UPDATE messages SET created_at = now() - interval '1 hour' WHERE chat_id=$1 AND seq <= 2`, ch)
	mustExec(t, pool, `UPDATE chat_members SET joined_at = now() - interval '30 minutes' WHERE chat_id=$1 AND user_id=$2`, ch, old)

	for range 2 {
		if err := storepostgres.MigrateDownTo(url, 140); err != nil {
			t.Fatalf("откат до 140: %v", err)
		}
		if err := storepostgres.Migrate(url); err != nil {
			t.Fatalf("накат: %v", err)
		}
	}
	n, readSeq := dialogUnread(t, chats, old, ch)
	if readSeq != 2 || n != 1 {
		t.Fatalf("после миграции read=%d unread=%d, want 2 и 1", readSeq, n)
	}
}

// Топики соединения — broadcast-каналы, которые пользователь читает как
// участник (бан — нет), с pts журналов; одним запросом.
func TestChatsRepo_ChannelCursors(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats, groups, channels := NewChatsRepo(pool), NewGroupRepo(pool), NewChannelRepo(pool)
	ctx := context.Background()
	u := seedUser(t, pool, "+79131")
	ch1, _ := groups.CreateMultiMember(ctx, "channel", "A", "", "", true, u)
	_ = groups.AddMember(ctx, ch1, u, domain.RoleCreator, domain.AllRights)
	ch2, _ := groups.CreateMultiMember(ctx, "channel", "B", "", "", false, u)
	_ = groups.AddMember(ctx, ch2, u, domain.RoleSubscriber, 0)
	ch3, _ := groups.CreateMultiMember(ctx, "channel", "C", "", "", false, u)
	_ = groups.AddMember(ctx, ch3, u, domain.RoleSubscriber, 0)
	mustExec(t, pool, `INSERT INTO chat_bans (chat_id, user_id) VALUES ($1,$2)`, ch3, u)
	grp, _ := groups.CreateMultiMember(ctx, "group", "G", "", "", false, u)
	_ = groups.AddMember(ctx, grp, u, domain.RoleMember, 0)
	for range 2 {
		if _, err := channels.AppendUpdate(ctx, ch1, "new_message", []byte(`{}`)); err != nil {
			t.Fatal(err)
		}
	}

	got, err := chats.ChannelCursors(ctx, u, 1000)
	if err != nil {
		t.Fatal(err)
	}
	want := []domain.ChannelCursor{{ChatID: ch2, Pts: 0}, {ChatID: ch1, Pts: 2}}
	if !slices.Equal(got, want) {
		t.Fatalf("каналы = %+v, want %+v (забаненный и группа — нет)", got, want)
	}
	if got, _ := chats.ChannelCursors(ctx, u, 1); len(got) != 1 {
		t.Fatalf("лимит не соблюдён: %v", got)
	}
	if title, _ := chats.ChatTitle(ctx, ch1); title != "A" {
		t.Fatalf("ChatTitle = %q", title)
	}
}

// Ревью #407: подсчёт ограничен сверху — и в строке списка, и в пересчёте при
// прочтении (одна формула).
func TestChannelUnread_Capped(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats, groups, msgs := NewChatsRepo(pool), NewGroupRepo(pool), NewMessagesRepo(pool)
	ctx := context.Background()
	author := seedUser(t, pool, "+79161")
	sub := seedUser(t, pool, "+79162")
	ch, _ := groups.CreateMultiMember(ctx, "channel", "News", "", "", true, author)
	_ = groups.AddMember(ctx, ch, author, domain.RoleCreator, domain.AllRights)
	_ = groups.AddMember(ctx, ch, sub, domain.RoleSubscriber, 0)
	mustExec(t, pool, `INSERT INTO messages (chat_id, seq, sender_id, type, text)
	   SELECT $1, g, $2, 'text', 'p' FROM generate_series(1, $3::int) g`, ch, author, UnreadCountCap+5)
	if n, _ := dialogUnread(t, chats, sub, ch); n != UnreadCountCap {
		t.Fatalf("непрочитанное = %d, want потолок %d", n, UnreadCountCap)
	}
	if n, err := msgs.CountUnread(ctx, ch, sub, 0); err != nil || n != UnreadCountCap {
		t.Fatalf("CountUnread = %d %v, want %d", n, err, UnreadCountCap)
	}
}

// A2-23: партнёры для присутствия и профиля — не соподписчики канала, а
// собеседники по не-broadcast чатам и контакты в обе стороны.
func TestChatsRepo_ChatPartners_NoChannelCosubscribersPlusContacts(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats, groups := NewChatsRepo(pool), NewGroupRepo(pool)
	ctx := context.Background()
	me := seedUser(t, pool, "+79141")
	cosub := seedUser(t, pool, "+79142")
	groupmate := seedUser(t, pool, "+79143")
	mine := seedUser(t, pool, "+79144")
	theirs := seedUser(t, pool, "+79145")

	ch, _ := groups.CreateMultiMember(ctx, "channel", "News", "", "", true, cosub)
	_ = groups.AddMember(ctx, ch, cosub, domain.RoleCreator, domain.AllRights)
	_ = groups.AddMember(ctx, ch, me, domain.RoleSubscriber, 0)
	grp, _ := groups.CreateMultiMember(ctx, "group", "G", "", "", false, me)
	_ = groups.AddMember(ctx, grp, me, domain.RoleCreator, domain.AllRights)
	_ = groups.AddMember(ctx, grp, groupmate, domain.RoleMember, 0)
	mustExec(t, pool, `INSERT INTO contacts (owner_id, user_id, first_name) VALUES ($1,$2,'K')`, me, mine)
	mustExec(t, pool, `INSERT INTO contacts (owner_id, user_id, first_name) VALUES ($1,$2,'K')`, theirs, me)

	got, err := chats.ChatPartners(ctx, me)
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(got)
	want := []int64{groupmate, mine, theirs}
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("партнёры = %v, want %v (соподписчик канала %d — не партнёр)", got, want, cosub)
	}
}

// A3-06: решение «пушить ли» пачкой — мьют чата и не-участник отсекаются.
func TestPushRepo_NotifyTargets(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	groups, push := NewGroupRepo(pool), NewPushRepo(pool)
	ctx := context.Background()
	author := seedUser(t, pool, "+79151")
	a := seedUser(t, pool, "+79152")
	muted := seedUser(t, pool, "+79153")
	stranger := seedUser(t, pool, "+79154")
	ch, _ := groups.CreateMultiMember(ctx, "channel", "News", "", "", true, author)
	_ = groups.AddMember(ctx, ch, author, domain.RoleCreator, domain.AllRights)
	_ = groups.AddMember(ctx, ch, a, domain.RoleSubscriber, 0)
	_ = groups.AddMember(ctx, ch, muted, domain.RoleSubscriber, 0)
	mustExec(t, pool, `UPDATE chat_members SET muted_until = now() + interval '1 day' WHERE chat_id=$1 AND user_id=$2`, ch, muted)

	got, err := push.NotifyTargets(ctx, ch, []int64{a, muted, stranger})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !got[a] {
		t.Fatalf("кому пушить = %v, want только %d с превью", got, a)
	}
	ok, preview, _ := push.ShouldNotify(ctx, ch, a)
	if !ok || !preview {
		t.Fatalf("ShouldNotify(a) = %v %v", ok, preview)
	}
	if ok, _, _ := push.ShouldNotify(ctx, ch, muted); ok {
		t.Fatal("ShouldNotify пушит замьюченному")
	}
}

// Ревью #407 (приватность): круг историй — только свои контакты и чаты, без
// тех, кто записал пользователя к себе; рассылка «контактной» истории
// фильтруется правилом storyVisibleTo.
func TestStoryAudience_NoReverseContacts(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats, stories := NewChatsRepo(pool), NewStoryRepo(pool)
	ctx := context.Background()
	me := seedUser(t, pool, "+79171")
	mine := seedUser(t, pool, "+79172")
	stranger := seedUser(t, pool, "+79173")
	mustExec(t, pool, `INSERT INTO contacts (owner_id, user_id, first_name) VALUES ($1,$2,'K')`, me, mine)
	mustExec(t, pool, `INSERT INTO contacts (owner_id, user_id, first_name) VALUES ($1,$2,'K')`, stranger, me)

	partners, err := chats.StoryPartners(ctx, me)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(partners, []int64{mine}) {
		t.Fatalf("круг историй = %v, want только свой контакт %d", partners, mine)
	}
	id := createStory(t, pool, me, "contacts", time.Now().Add(time.Hour), nil)
	vis, err := stories.VisibleAmong(ctx, id, []int64{me, mine, stranger})
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(vis)
	want := []int64{me, mine}
	slices.Sort(want)
	if !slices.Equal(vis, want) {
		t.Fatalf("видят историю «контакты» = %v, want %v", vis, want)
	}
}
