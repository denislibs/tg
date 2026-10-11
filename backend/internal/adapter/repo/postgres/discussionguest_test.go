package postgres

import (
	"context"
	"slices"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Ф-5 БЭК-3: группа обсуждения — обычный чат списка, гость обсуждения
// упоминается и пушится, join_to_send, зеркало непрочитано у автора поста.

type discussionSeed struct {
	ch, disc       int64
	owner, member  int64
	guest, outside int64
}

func newDiscussionSeed(t *testing.T) (discussionSeed, *GroupRepo, *ChatsRepo, *MessagesRepo, *PushRepo) {
	t.Helper()
	pool := storepostgres.NewTestDB(t)
	groups, chats, msgs := NewGroupRepo(pool), NewChatsRepo(pool), NewMessagesRepo(pool)
	ctx := context.Background()
	var s discussionSeed
	s.owner = seedUser(t, pool, "+7950")
	s.member = seedUser(t, pool, "+7951")
	s.guest = seedUser(t, pool, "+7952")
	s.outside = seedUser(t, pool, "+7953")
	for uid, name := range map[int64]string{s.member: "memb", s.guest: "guesty", s.outside: "outsider"} {
		if _, err := pool.Exec(ctx, `UPDATE users SET username=$2 WHERE id=$1`, uid, name); err != nil {
			t.Fatal(err)
		}
	}
	s.ch, _ = groups.CreateMultiMember(ctx, "channel", "Chan", "", "", true, s.owner)
	_ = groups.AddMember(ctx, s.ch, s.owner, domain.RoleCreator, domain.AllRights)
	s.disc, _ = groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, s.owner)
	_ = groups.AddMember(ctx, s.disc, s.owner, domain.RoleCreator, domain.AllRights)
	_ = groups.AddMember(ctx, s.disc, s.member, domain.RoleMember, 0)
	if err := groups.SetDiscussion(ctx, s.ch, s.disc); err != nil {
		t.Fatal(err)
	}
	return s, groups, chats, msgs, NewPushRepo(pool)
}

// Участник группы обсуждения видит её в списке и в общем счётчике (tweb
// dialogs.ts:1502-1520: скрытых групп обсуждения нет). Гость — нет: строки
// участника у него нет.
func TestDiscussionGroup_InDialogListOfMember(t *testing.T) {
	s, _, chats, msgs, push := newDiscussionSeed(t)
	ctx := context.Background()
	seq, _ := msgs.NextSeq(ctx, s.disc)
	if _, err := msgs.Insert(ctx, domain.Message{ChatID: s.disc, Seq: seq, SenderID: s.owner, Type: "text", Text: "hi"}); err != nil {
		t.Fatal(err)
	}
	if _, err := chats.IncUnreadBulk(ctx, s.disc, []int64{s.member}); err != nil {
		t.Fatal(err)
	}
	ds, err := chats.ListDialogs(ctx, s.member)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(ds, func(d domain.DialogRecord) bool { return d.ChatID == s.disc }) {
		t.Fatalf("группы обсуждения нет в списке участника: %+v", ds)
	}
	if n, err := chats.UnreadTotal(ctx, s.member); err != nil || n != 1 {
		t.Fatalf("UnreadTotal = %d, %v; want 1", n, err)
	}
	if n, err := push.UnreadBadge(ctx, s.member); err != nil || n != 1 {
		t.Fatalf("UnreadBadge = %d, %v; want 1", n, err)
	}
	ds, _ = chats.ListDialogs(ctx, s.guest)
	if slices.ContainsFunc(ds, func(d domain.DialogRecord) bool { return d.ChatID == s.disc }) {
		t.Fatal("группа обсуждения в списке у не участника")
	}
}

// @username резолвится в участников И авторов чата (гость обсуждения), но
// не в посторонних.
func TestParticipantIDsByUsernames_IncludesGuestAuthors(t *testing.T) {
	s, _, chats, msgs, _ := newDiscussionSeed(t)
	ctx := context.Background()
	seq, _ := msgs.NextSeq(ctx, s.disc)
	if _, err := msgs.Insert(ctx, domain.Message{ChatID: s.disc, Seq: seq, SenderID: s.guest, Type: "text", Text: "comment"}); err != nil {
		t.Fatal(err)
	}
	ids, err := chats.ParticipantIDsByUsernames(ctx, s.disc, []string{"Memb", "guesty", "outsider"})
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(ids)
	want := []int64{s.member, s.guest}
	slices.Sort(want)
	if !slices.Equal(ids, want) {
		t.Fatalf("ParticipantIDsByUsernames = %v, want %v", ids, want)
	}
}

// join_to_send: колонка, Settings, карточка и строка списка (channel.pFlags).
func TestJoinToSend_RoundTrip(t *testing.T) {
	s, groups, chats, _, _ := newDiscussionSeed(t)
	ctx := context.Background()
	if err := groups.SetJoinToSend(ctx, s.disc, true); err != nil {
		t.Fatal(err)
	}
	st, err := groups.Settings(ctx, s.disc)
	if err != nil || !st.JoinToSend {
		t.Fatalf("Settings.JoinToSend = %v, %v", st.JoinToSend, err)
	}
	card, err := groups.Card(ctx, s.disc, s.guest)
	if err != nil || !card.ToChannel().JoinToSend() {
		t.Fatalf("карточка без join_to_send: %+v, %v", card.Settings, err)
	}
	ds, _ := chats.ListDialogs(ctx, s.member)
	i := slices.IndexFunc(ds, func(d domain.DialogRecord) bool { return d.ChatID == s.disc })
	if i < 0 || !ds[i].ToChannel().JoinToSend() {
		t.Fatal("строка списка без join_to_send")
	}
	if err := groups.SetJoinToSend(ctx, -1, true); err == nil {
		t.Fatal("SetJoinToSend несуществующего чата без ошибки")
	}
}

// A1-13: зеркало ничьё — непрочитано и у опубликовавшего пост админа, во всех
// формулах (пересчёт при прочтении, пересчёт счётчиков, «удалить у себя»).
func TestMirror_UnreadForPostAuthor(t *testing.T) {
	s, _, chats, msgs, _ := newDiscussionSeed(t)
	ctx := context.Background()
	seq, _ := msgs.NextSeq(ctx, s.disc)
	m, err := msgs.Insert(ctx, domain.Message{ChatID: s.disc, Seq: seq, SenderID: s.owner, Type: "text", Text: "post",
		SendAsChatID: &s.ch, FwdFromChatID: &s.ch, IsDiscussionMirror: true})
	if err != nil {
		t.Fatal(err)
	}
	if n, err := msgs.CountUnread(ctx, s.disc, s.owner, 0); err != nil || n != 1 {
		t.Fatalf("CountUnread автора поста = %d, %v; want 1", n, err)
	}
	if err := chats.RecountCounters(ctx, s.disc, []int64{s.owner}); err != nil {
		t.Fatal(err)
	}
	if n, _ := chats.UnreadTotal(ctx, s.owner); n != 1 {
		t.Fatalf("после пересчёта у автора поста %d непрочитанных, want 1", n)
	}
	if err := msgs.HideForUser(ctx, s.owner, m.ID); err != nil {
		t.Fatal(err)
	}
	if n, _ := chats.UnreadTotal(ctx, s.owner); n != 0 {
		t.Fatalf("после «удалить у себя» %d непрочитанных, want 0", n)
	}
}

// Пуш гостю обсуждения (не участнику): только ответ и упоминание.
func TestShouldNotify_DiscussionGuest(t *testing.T) {
	s, _, _, _, push := newDiscussionSeed(t)
	ctx := context.Background()
	if ok, _, err := push.ShouldNotify(ctx, s.disc, s.guest, 0, false); err != nil || ok {
		t.Fatalf("гость без упоминания: %v, %v; want false", ok, err)
	}
	ok, preview, err := push.ShouldNotify(ctx, s.disc, s.guest, 0, true)
	if err != nil || !ok || !preview {
		t.Fatalf("гость с ответом: %v,%v,%v; want true,true", ok, preview, err)
	}
	if ok, _, _ := push.ShouldNotify(ctx, -1, s.guest, 0, true); ok {
		t.Fatal("пуш о несуществующем чате")
	}
}
