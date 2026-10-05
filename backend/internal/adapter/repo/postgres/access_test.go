package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// Регрессии пачки Ф-1а «Доступ и видимость» на настоящей схеме: единые
// предикаты (visibility.go) в каждой выборке.

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

// ChatsRepo.Access — один снимок: вид, публичность, роль, бан.
func TestChatsRepo_Access(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7600")
	bob := seedUser(t, pool, "+7601")
	ch := createGroupLike(t, pool, "channel", owner)
	chats := NewChatsRepo(pool)

	a, err := chats.Access(ctx, ch, owner)
	if err != nil || !a.Member || a.Role != domain.RoleCreator || a.Type != domain.ChatTypeChannel || a.Public || !a.CanRead() {
		t.Fatalf("владелец: %+v %v", a, err)
	}
	if a, _ = chats.Access(ctx, ch, bob); a.Member || a.CanRead() {
		t.Fatalf("посторонний читает приватный канал: %+v", a)
	}
	mustExec(t, pool, `UPDATE chats SET is_public = true WHERE id = $1`, ch)
	if a, _ = chats.Access(ctx, ch, bob); !a.Public || !a.CanRead() {
		t.Fatalf("публичный канал не читается: %+v", a)
	}
	if err := NewGroupRepo(pool).Ban(ctx, ch, bob, owner); err != nil {
		t.Fatal(err)
	}
	if a, _ = chats.Access(ctx, ch, bob); !a.Banned || a.CanRead() {
		t.Fatalf("забаненный читает публичный канал: %+v", a)
	}
	if _, err := chats.Access(ctx, 999999, bob); err != domain.ErrNotFound {
		t.Fatalf("нет чата: %v", err)
	}
}

// A3-03 / A5-05 / A3-14: скрытая предыстория и очищенное не находятся ни в
// одной выборке — история, по номерам, поиск в чате, глобальный поиск,
// вкладки медиа, их счётчики, календарь.
func TestMessagesRepo_VisibilityInEverySelection(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7610")
	bob := seedUser(t, pool, "+7611")
	g := createGroupLike(t, pool, "group", owner)
	msgs := NewMessagesRepo(pool)
	groups := NewGroupRepo(pool)
	if err := groups.SetHistoryForNew(ctx, g, false); err != nil {
		t.Fatal(err)
	}
	before := insertMsg(t, msgs, g, owner, "photo", "секрет https://a.example")
	mustExec(t, pool, `UPDATE messages SET created_at = now() - interval '1 hour' WHERE id = $1`, before.ID)
	if err := groups.AddMember(ctx, g, bob, domain.RoleMember, 0); err != nil {
		t.Fatal(err)
	}
	after := insertMsg(t, msgs, g, owner, "photo", "секрет после")
	for i, id := range []int64{before.ID, after.ID} {
		mustExec(t, pool, `UPDATE messages SET media_id = $1 WHERE id = $2`, seedMedia(t, pool, owner, "v"+string(rune('a'+i))), id)
	}

	check := func(who string, viewer int64, want ...int64) {
		t.Helper()
		hist, err := msgs.GetHistory(ctx, g, viewer, 0, 0, 20, nil, "")
		if err != nil || !sameIDs(msgSeqs(hist), reverse(want)...) {
			t.Fatalf("%s: история %v %v, ждали %v", who, msgSeqs(hist), err, want)
		}
		if n, _ := msgs.CountMessages(ctx, g, viewer); n != len(want) {
			t.Fatalf("%s: счётчик истории %d, ждали %d", who, n, len(want))
		}
		got, count := chatSearch(t, msgs, g, viewer, "секрет", usecasechat.SearchFilter{}, usecasechat.MediaPage{Limit: 10})
		if count != len(want) || !sameIDs(msgSeqs(got), reverse(want)...) {
			t.Fatalf("%s: поиск в чате %v (%d), ждали %v", who, msgSeqs(got), count, want)
		}
		res := globalSearch(t, msgs, viewer, usecasechat.GlobalSearchQuery{Q: "секрет", Limit: 10})
		if res.Count != len(want) {
			t.Fatalf("%s: глобальный поиск %d, ждали %d", who, res.Count, len(want))
		}
		media, mcount, err := msgs.MediaHistory(ctx, g, viewer, "media", usecasechat.MediaPage{Limit: 10})
		if err != nil || mcount != len(want) || len(media) != len(want) {
			t.Fatalf("%s: вкладка медиа %v (%d) %v", who, msgSeqs(media), mcount, err)
		}
		counters, _ := msgs.SearchCounters(ctx, g, viewer, []string{"media"}, nil)
		if counters["media"] != len(want) {
			t.Fatalf("%s: счётчик вкладки %v", who, counters)
		}
		days, _ := msgs.CalendarMonth(ctx, g, viewer, time.Now().Add(-48*time.Hour), time.Now().Add(time.Hour))
		n := 0
		for _, d := range days {
			n += d.Count
		}
		if n != len(want) {
			t.Fatalf("%s: календарь %d, ждали %d", who, n, len(want))
		}
		vis, _ := msgs.VisibleIDs(ctx, viewer, []int64{before.ID, after.ID})
		if len(vis) != len(want) {
			t.Fatalf("%s: VisibleIDs %v, ждали %v", who, vis, want)
		}
	}
	check("владелец", owner, before.Seq, after.Seq)
	check("новичок при скрытой предыстории", bob, after.Seq)

	// Очистка истории у себя (A3-14) — то же правило.
	if err := NewChatsRepo(pool).SetClearedSeq(ctx, g, owner, before.Seq); err != nil {
		t.Fatal(err)
	}
	check("владелец после очистки", owner, after.Seq)
}

func reverse(s []int64) []int64 {
	out := make([]int64, len(s))
	for i, v := range s {
		out[len(s)-1-i] = v
	}
	return out
}

// A3-30: удаление старого сообщения не вычитает непрочитанное у того, кому
// оно не засчитывалось (скрытая предыстория).
func TestChatsRepo_ForgetUnreadSkipsInvisible(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7620")
	bob := seedUser(t, pool, "+7621")
	carol := seedUser(t, pool, "+7622")
	g := createGroupLike(t, pool, "group", owner)
	msgs := NewMessagesRepo(pool)
	groups := NewGroupRepo(pool)
	_ = groups.SetHistoryForNew(ctx, g, false)
	if err := groups.AddMember(ctx, g, carol, domain.RoleMember, 0); err != nil {
		t.Fatal(err)
	}
	old := insertMsg(t, msgs, g, owner, "text", "старое")
	mustExec(t, pool, `UPDATE messages SET created_at = now() - interval '1 hour' WHERE id = $1`, old.ID)
	mustExec(t, pool, `UPDATE chat_members SET joined_at = now() - interval '2 hour' WHERE chat_id = $1 AND user_id = $2`, g, carol)
	if err := groups.AddMember(ctx, g, bob, domain.RoleMember, 0); err != nil {
		t.Fatal(err)
	}
	// У обоих по одному непрочитанному (у Боба — от более нового сообщения).
	mustExec(t, pool, `UPDATE chat_members SET unread_count = 1 WHERE chat_id = $1 AND user_id IN ($2, $3)`, g, bob, carol)

	if err := NewChatsRepo(pool).ForgetUnread(ctx, g, owner, old.Seq); err != nil {
		t.Fatal(err)
	}
	unread := func(u int64) (n int) {
		_ = pool.QueryRow(ctx, `SELECT unread_count FROM chat_members WHERE chat_id=$1 AND user_id=$2`, g, u).Scan(&n)
		return n
	}
	if unread(carol) != 0 {
		t.Fatalf("у участницы до сообщения не снялось: %d", unread(carol))
	}
	if unread(bob) != 1 {
		t.Fatalf("у новичка вычли невидимое ему сообщение: %d", unread(bob))
	}
}

// A5-39 / A5-06 / VA5b-01: скачивание медиа = видимость источника.
func TestMediaAccessRepo_CanAccessFollowsSource(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7630")
	bob := seedUser(t, pool, "+7631")
	stranger := seedUser(t, pool, "+7632")
	chatID := createPrivate(t, pool, owner, bob)
	msgs := NewMessagesRepo(pool)
	access := NewMediaAccessRepo(pool)

	photo := seedMedia(t, pool, owner, "p1")
	m := insertMsg(t, msgs, chatID, owner, "photo", "")
	mustExec(t, pool, `UPDATE messages SET media_id = $1 WHERE id = $2`, photo, m.ID)
	if ok, _ := access.CanAccess(ctx, bob, photo); !ok {
		t.Fatal("собеседник не качает фото сообщения")
	}
	if ok, _ := access.CanAccess(ctx, stranger, photo); ok {
		t.Fatal("посторонний качает фото из чужой лички")
	}
	if err := msgs.SoftDelete(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if ok, _ := access.CanAccess(ctx, bob, photo); ok {
		t.Fatal("медиа удалённого у всех сообщения скачивается (A5-39)")
	}

	// Публичный канал: медиа поста качает и не вступивший.
	ch := createGroupLike(t, pool, "channel", owner)
	mustExec(t, pool, `UPDATE chats SET is_public = true WHERE id = $1`, ch)
	pic := seedMedia(t, pool, owner, "p2")
	post := insertMsg(t, msgs, ch, owner, "photo", "")
	mustExec(t, pool, `UPDATE messages SET media_id = $1 WHERE id = $2`, pic, post.ID)
	if ok, _ := access.CanAccess(ctx, stranger, pic); !ok {
		t.Fatal("медиа поста публичного канала не качается без вступления")
	}

	// Истории «близкие друзья» — близкому другу качаются (VA5b-01).
	if err := NewStoryRepo(pool).SetCloseFriends(ctx, owner, []int64{stranger}); err != nil {
		t.Fatal(err)
	}
	storyMedia := seedMedia(t, pool, owner, "s1")
	sid := createStory(t, pool, owner, "close", time.Now().Add(time.Hour), nil)
	mustExec(t, pool, `UPDATE stories SET media_id = $1 WHERE id = $2`, storyMedia, sid)
	if ok, _ := access.CanAccess(ctx, stranger, storyMedia); !ok {
		t.Fatal("близкий друг не качает медиа истории close")
	}
	if ok, _ := access.CanAccess(ctx, bob, storyMedia); ok {
		t.Fatal("не близкий друг качает медиа истории close")
	}

	// Аватарка больше не открыта всем — владельцы ищутся для правила приватности.
	avatar := seedMedia(t, pool, owner, "a1")
	mustExec(t, pool, `UPDATE users SET avatar_media_id = $1 WHERE id = $2`, avatar, owner)
	if ok, _ := access.CanAccess(ctx, stranger, avatar); ok {
		t.Fatal("аватарка открыта мимо правила profile_photo (A5-06)")
	}
	owners, err := access.AvatarOwners(ctx, avatar)
	if err != nil || len(owners) != 1 || owners[0] != owner {
		t.Fatalf("AvatarOwners = %v %v", owners, err)
	}
}

// A5-18: история «контакты» — только контактам автора; блок закрывает всё.
func TestStoryRepo_VisibleContactsAndBlock(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	repo := NewStoryRepo(pool)
	author := seedUser(t, pool, "+7640")
	contact := seedUser(t, pool, "+7641")
	stranger := seedUser(t, pool, "+7642")
	mustExec(t, pool, `INSERT INTO contacts (owner_id, user_id, first_name) VALUES ($1,$2,'K')`, author, contact)

	sid := createStory(t, pool, author, "contacts", time.Now().Add(time.Hour), nil)
	if ok, _ := repo.Visible(ctx, sid, contact); !ok {
		t.Fatal("контакт автора не видит историю «контакты»")
	}
	if ok, _ := repo.Visible(ctx, sid, stranger); ok {
		t.Fatal("посторонний видит историю «контакты»")
	}

	open := createStory(t, pool, author, "everyone", time.Now().Add(time.Hour), nil)
	mustExec(t, pool, `UPDATE stories SET pinned = true WHERE id = $1`, open)
	mustExec(t, pool, `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1,$2)`, author, stranger)
	if ok, _ := repo.Visible(ctx, open, stranger); ok {
		t.Fatal("заблокированный видит историю «все»")
	}
	if pinned, _ := repo.Pinned(ctx, author, stranger); len(pinned) != 0 {
		t.Fatalf("заблокированный видит закреплённые: %d", len(pinned))
	}
	if pinned, _ := repo.Pinned(ctx, author, contact); len(pinned) != 1 {
		t.Fatalf("контакт не видит закреплённую «все»: %d", len(pinned))
	}
}

// A5-40: /users?ids= — только известные зрителю.
func TestGroupRepo_KnownUserIDs(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	me := seedUser(t, pool, "+7650")
	partner := seedUser(t, pool, "+7651")
	stranger := seedUser(t, pool, "+7652")
	named := seedUser(t, pool, "+7653")
	forwarded := seedUser(t, pool, "+7654")
	mustExec(t, pool, `UPDATE users SET username = 'known_by_name' WHERE id = $1`, named)
	chatID := createPrivate(t, pool, me, partner)
	m := insertMsg(t, NewMessagesRepo(pool), chatID, partner, "text", "переслано")
	mustExec(t, pool, `UPDATE messages SET fwd_from_user_id = $1 WHERE id = $2`, forwarded, m.ID)

	known, err := NewGroupRepo(pool).KnownUserIDs(ctx, me, []int64{me, partner, stranger, named, forwarded})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []int64{me, partner, named, forwarded} {
		if !known[id] {
			t.Fatalf("известный %d не отдан: %v", id, known)
		}
	}
	if known[stranger] {
		t.Fatal("посторонний по голому id отдан")
	}
}
