package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ф-5 БЭК-3: комментатор без вступления (A3-19), join_to_send, зеркало поста
// (A2-20/A3-18 правка, В-1 удаление, A1-13 out).

// discussionFixture — публичный канал 7 с группой обсуждения, пост и его
// зеркало. Веер по участникам группы (MemberIDs) и журнал — настоящие фейки
// store, чтобы видно было, кому что легло.
type discussionFixture struct {
	i      *Interactor
	s      *store
	fg     *fakeGroupRepo
	pub    *fakePublisher
	notif  *fakeNotifier
	ch     int64
	disc   int64
	post   domain.Message
	mirror domain.Message
}

func newDiscussionFixture(t *testing.T) discussionFixture {
	t.Helper()
	s := newStore()
	fg := newFakeGroupRepo()
	i := New(fakeTx{}, groupMembershipChatsFanout{groupMembershipChats{fg, s}}, fakeMsgs{s},
		fakeUpdates{s}, nil, fakeMedia{s}, fg, nil, newFakeChannelRepo(), newFakeSearchRepo(), nil)
	i.SetChannelPublisher(&fakeChannelPublisher{})
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.chatSeq[id] = 0
		s.mu.Unlock()
	}
	fg.onSetDiscussion = s.seedDiscussion
	pub := &fakePublisher{}
	i.SetPublisher(pub)
	notif := &fakeNotifier{}
	i.SetNotifier(notif)

	ctx := context.Background()
	ch, err := i.CreateChannel(ctx, 7, "News", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	disc, err := i.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatal(err)
	}
	// 9 — обычный участник группы обсуждения.
	if err := fg.AddMember(ctx, disc, 9, domain.RoleMember, 0); err != nil {
		t.Fatal(err)
	}
	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	mid, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil || mid == 0 {
		t.Fatalf("зеркало: id=%d err=%v", mid, err)
	}
	mirror, err := i.msgs.GetByID(ctx, mid)
	if err != nil {
		t.Fatal(err)
	}
	return discussionFixture{i: i, s: s, fg: fg, pub: pub, notif: notif, ch: ch, disc: disc, post: post, mirror: mirror}
}

// journal — записи журнала пользователя данного вида.
func (f discussionFixture) journal(uid int64, typ string) []map[string]any {
	f.s.mu.Lock()
	defer f.s.mu.Unlock()
	var out []map[string]any
	for _, u := range f.s.updates[uid] {
		if u.Type != typ {
			continue
		}
		var body map[string]any
		_ = json.Unmarshal(u.Payload, &body)
		out = append(out, body)
	}
	return out
}

func journalMsgID(body map[string]any) int64 {
	m, _ := body["message"].(map[string]any)
	id, _ := m["id"].(float64)
	return int64(id)
}

func journalOut(body map[string]any) bool {
	m, _ := body["message"].(map[string]any)
	pf, _ := m["pFlags"].(map[string]any)
	out, _ := pf["out"].(bool)
	return out
}

// A3-19: читатель публичного канала комментирует пост, НЕ вступая в группу
// обсуждения (tweb input.ts:2044 — кнопки «Вступить» в треде без
// join_to_send нет). Автор получает свой комментарий в журнал, участники
// группы — тоже; строки участника у гостя нет.
func TestPostComment_GuestCommentsWithoutJoining(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()

	msg, err := f.i.PostComment(ctx, f.ch, f.post.ID, 8, "first", "c1")
	if err != nil {
		t.Fatalf("PostComment гостя: %v", err)
	}
	if msg.ChatID != f.disc || msg.ThreadRootID == nil || *msg.ThreadRootID != f.mirror.ID {
		t.Fatalf("комментарий не в треде зеркала: %+v", msg)
	}
	if _, err := f.fg.GetMember(ctx, f.disc, 8); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("гость вступил в группу обсуждения: %v", err)
	}
	if got := f.journal(8, "new_message"); len(got) != 1 || journalMsgID(got[0]) != msg.Seq || !journalOut(got[0]) {
		t.Fatalf("журнал гостя: %+v, want свой new_message %d с out", got, msg.Seq)
	}
	if f.pub.countFor(8) == 0 {
		t.Fatal("гостю не ушёл живой кадр своего комментария")
	}
	found := false
	for _, b := range f.journal(9, "new_message") {
		if journalMsgID(b) == msg.Seq {
			found = true
		}
	}
	if !found {
		t.Fatal("участник группы не получил комментарий гостя")
	}
}

// Тот же путь у общей отправки (sendMessage в тред с reply_to на зеркало).
func TestSend_GuestInMirrorThread_NoJoin(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	root := f.mirror.ID
	if _, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 8, Text: "hi", ThreadRootID: &root}); err != nil {
		t.Fatalf("Send гостя в тред: %v", err)
	}
	if ok, _ := f.i.chats.IsMember(ctx, f.disc, 8); ok {
		t.Fatal("Send вступил гостя в группу обсуждения")
	}
}

// Гость пишет только в тред ЗЕРКАЛА: вне треда и в тред обычного сообщения
// группы — как в чат, где он не состоит.
func TestSend_GuestOutsideMirrorThread_Rejected(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	if _, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 8, Text: "x"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("гость вне треда = %v, want ErrNotFound", err)
	}
	plain, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 9, Text: "member msg"})
	if err != nil {
		t.Fatal(err)
	}
	root := plain.ID
	if _, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 8, Text: "x", ThreadRootID: &root}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("гость в тред не-зеркала = %v, want ErrNotFound", err)
	}
}

// Забаненный в группе обсуждения и не читающий канал — не гость.
func TestSend_GuestBannedOrUnreadable_Rejected(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	root := f.mirror.ID
	_ = f.fg.Ban(ctx, f.disc, 8, 7)
	if _, err := f.i.PostComment(ctx, f.ch, f.post.ID, 8, "x", ""); err == nil {
		t.Fatal("забаненный в группе прокомментировал")
	}
	if _, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 8, Text: "x", ThreadRootID: &root}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("забаненный Send = %v, want ErrNotFound", err)
	}
	// Приватный канал: посторонний его не читает.
	f.fg.mu.Lock()
	f.fg.public[f.ch] = false
	f.fg.mu.Unlock()
	if _, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 10, Text: "x", ThreadRootID: &root}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("не читающий канал Send = %v, want ErrNotFound", err)
	}
}

// Права группы по умолчанию действуют и на гостя (tweb hasRights у left —
// default_banned_rights, hasRights.ts:29-34, 70-73).
func TestSend_GuestRespectsDefaultPerms(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	f.fg.mu.Lock()
	c := f.fg.cards[f.disc]
	c.Settings.DefaultPerms &^= domain.PermSendMessages
	f.fg.cards[f.disc] = c
	f.fg.mu.Unlock()
	root := f.mirror.ID
	if _, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 8, Text: "x", ThreadRootID: &root}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("гость при запрете отправки = %v, want ErrForbidden", err)
	}
}

// join_to_send: гостю — «вступите, чтобы писать» (403); участнику — как
// раньше. Переключает создатель группы (tweb chatType.tsx:246, вход — change_type).
func TestJoinToSend_GatesGuest(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	if err := f.i.ToggleJoinToSend(ctx, f.disc, 9, true); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("toggleJoinToSend не создателем = %v, want ErrForbidden", err)
	}
	if err := f.i.ToggleJoinToSend(ctx, f.ch, 7, true); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("toggleJoinToSend у канала = %v, want ErrForbidden", err)
	}
	if err := f.i.ToggleJoinToSend(ctx, f.disc, 7, true); err != nil {
		t.Fatalf("toggleJoinToSend создателем: %v", err)
	}
	if s, _ := f.fg.Settings(ctx, f.disc); !s.JoinToSend {
		t.Fatal("флаг join_to_send не записан")
	}
	if _, err := f.i.PostComment(ctx, f.ch, f.post.ID, 8, "x", ""); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("гость при join_to_send = %v, want ErrForbidden", err)
	}
	if _, err := f.i.PostComment(ctx, f.ch, f.post.ID, 9, "member", ""); err != nil {
		t.Fatalf("участник при join_to_send: %v", err)
	}
	if err := f.i.ToggleJoinToSend(ctx, f.disc, 7, false); err != nil {
		t.Fatal(err)
	}
	if _, err := f.i.PostComment(ctx, f.ch, f.post.ID, 8, "x", ""); err != nil {
		t.Fatalf("гость после снятия join_to_send: %v", err)
	}
}

// Вместо членства — пуш об ответе на свой комментарий и об упоминании
// (решение пользователя к В-2). Обычные комментарии гостю не пушатся.
func TestGuest_PushOnReplyAndMention(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	c, err := f.i.PostComment(ctx, f.ch, f.post.ID, 8, "guest comment", "")
	if err != nil {
		t.Fatal(err)
	}
	root := f.mirror.ID
	if _, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 9, Text: "plain", ThreadRootID: &root}); err != nil {
		t.Fatal(err)
	}
	if f.notif.mentioned[8] || contains(f.notif.recipients, 8) {
		t.Fatalf("гостю пуш об обычном комментарии: %+v", f.notif.recipients)
	}
	replyTo := c.Seq
	if _, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 9, Text: "reply", ThreadRootID: &root, ReplyToID: &replyTo}); err != nil {
		t.Fatal(err)
	}
	if !f.notif.mentioned[8] {
		t.Fatalf("гостю нет пуша об ответе на его комментарий: %+v", f.notif.recipients)
	}
	// Упоминание text_mention — тоже пуш.
	f.notif.mentioned, f.notif.recipients = nil, nil
	ents := domain.MessageEntities{domain.NewMessageEntityMentionName(0, 4, 8)}
	if _, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 9, Text: "@you", Entities: ents, ThreadRootID: &root}); err != nil {
		t.Fatal(err)
	}
	if !f.notif.mentioned[8] {
		t.Fatal("гостю нет пуша об упоминании")
	}
	// Тихая отправка не пушит никого.
	f.notif.mentioned, f.notif.recipients = nil, nil
	if _, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 9, Text: "@you", Entities: ents, ThreadRootID: &root, Silent: true}); err != nil {
		t.Fatal(err)
	}
	if contains(f.notif.recipients, 8) {
		t.Fatal("тихая отправка запушила гостя")
	}
}

func contains(ids []int64, id int64) bool {
	for _, v := range ids {
		if v == id {
			return true
		}
	}
	return false
}

// Гость правит и удаляет свой комментарий (canEditMessage группы — своё и
// право писать; членства tweb не требует).
func TestGuest_EditsAndDeletesOwnComment(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	c, err := f.i.PostComment(ctx, f.ch, f.post.ID, 8, "typo", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.i.EditMessage(ctx, f.disc, c.ID, 8, "fixed", nil); err != nil {
		t.Fatalf("гость правит свой комментарий: %v", err)
	}
	if len(f.journal(8, "edit_message")) != 1 {
		t.Fatal("гостю не ушла своя правка")
	}
	other, err := f.i.PostComment(ctx, f.ch, f.post.ID, 9, "member", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.i.EditMessage(ctx, f.disc, other.ID, 8, "hack", nil); err == nil {
		t.Fatal("гость правит чужой комментарий")
	}
	if err := f.i.DeleteMessage(ctx, f.disc, other.ID, 8, true); err == nil {
		t.Fatal("гость удалил чужой комментарий")
	}
	if err := f.i.DeleteMessage(ctx, f.disc, c.ID, 8, true); err != nil {
		t.Fatalf("гость удаляет свой комментарий: %v", err)
	}
	if len(f.journal(8, "delete_message")) != 1 {
		t.Fatal("гостю не ушло своё удаление")
	}
}

// A2-20/A3-18: правка поста канала доходит до зеркала — у зеркала новый
// текст и edited_at, участникам группы ушёл edit_message с номером зеркала
// (updateEditChannelMessage группы — иначе шапка треда у tweb старая).
func TestEditPost_SyncsMirror(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	ents := domain.MessageEntities{domain.NewMessageEntityBold(0, 3)}
	if _, err := f.i.EditMessage(ctx, f.ch, f.post.ID, 7, "new text", ents); err != nil {
		t.Fatalf("правка поста: %v", err)
	}
	m, err := f.i.msgs.GetByID(ctx, f.mirror.ID)
	if err != nil {
		t.Fatal(err)
	}
	if m.Text != "new text" || len(m.Entities) != 1 || m.EditedAt == nil {
		t.Fatalf("зеркало после правки: text=%q ents=%v edited=%v", m.Text, m.Entities, m.EditedAt)
	}
	for _, uid := range []int64{7, 9} {
		got := f.journal(uid, "edit_message")
		if len(got) != 1 || journalMsgID(got[0]) != f.mirror.Seq {
			t.Fatalf("журнал %d: %+v, want edit_message зеркала %d", uid, got, f.mirror.Seq)
		}
		if journalOut(got[0]) {
			t.Fatalf("правка зеркала у %d с out", uid)
		}
	}
}

// В-1: удаление поста «у всех» удаляет его зеркало (кадр группе),
// комментарии остаются.
func TestDeletePost_DeletesMirror_KeepsComments(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	c, err := f.i.PostComment(ctx, f.ch, f.post.ID, 9, "comment", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.i.DeleteMessage(ctx, f.ch, f.post.ID, 7, true); err != nil {
		t.Fatalf("удаление поста: %v", err)
	}
	m, _ := f.i.msgs.GetByID(ctx, f.mirror.ID)
	if !m.Deleted {
		t.Fatal("зеркало не удалено вместе с постом")
	}
	cm, _ := f.i.msgs.GetByID(ctx, c.ID)
	if cm.Deleted {
		t.Fatal("комментарий удалён вместе с постом")
	}
	got := f.journal(9, "delete_message")
	if len(got) != 1 {
		t.Fatalf("участник группы: %+v, want delete_message зеркала", got)
	}
	if ids, _ := got[0]["messages"].([]any); len(ids) != 1 || int64(ids[0].(float64)) != f.mirror.Seq {
		t.Fatalf("delete_message несёт %v, want [%d]", got[0]["messages"], f.mirror.Seq)
	}
	// «Удалить у себя» в канале зеркало не трогает (у broadcast его нет, но
	// и пост у себя — не повод).
}

// A1-13: зеркало создаёт сервер, а не админ: out нет ни у кого, в том числе
// у опубликовавшего пост (tweb решает сторону бабла по pFlags.out с сервера,
// chat.ts:1411-1412).
func TestMirror_NoOutForPostAuthor(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	for _, b := range f.journal(7, "new_message") {
		if journalMsgID(b) == f.mirror.Seq && journalOut(b) {
			t.Fatal("зеркало в журнале автора поста с out")
		}
	}
	wire, err := f.i.MessagesWire(ctx, 7, []domain.Message{f.mirror})
	if err != nil {
		t.Fatal(err)
	}
	if wire[0].(domain.MessageReal).PFlags["out"] {
		t.Fatal("зеркало в истории автора поста с out")
	}
	own, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 7, Text: "mine"})
	if err != nil {
		t.Fatal(err)
	}
	wire, err = f.i.MessagesWire(ctx, 7, []domain.Message{own})
	if err != nil {
		t.Fatal(err)
	}
	if !wire[0].(domain.MessageReal).PFlags["out"] {
		t.Fatal("своё сообщение без out")
	}
}

// Пост удалён — зеркала нет, но своё гость в треде по-прежнему правит и
// удаляет; писать туда больше нельзя.
func TestGuest_OwnCommentUnderDeletedPost(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	c, err := f.i.PostComment(ctx, f.ch, f.post.ID, 8, "mine", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.i.DeleteMessage(ctx, f.ch, f.post.ID, 7, true); err != nil {
		t.Fatal(err)
	}
	root := f.mirror.ID
	if _, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 8, Text: "x", ThreadRootID: &root}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("гость пишет в тред удалённого поста = %v, want ErrNotFound", err)
	}
	if _, err := f.i.EditMessage(ctx, f.disc, c.ID, 8, "edited", nil); err != nil {
		t.Fatalf("гость правит своё под удалённым постом: %v", err)
	}
	if err := f.i.DeleteMessage(ctx, f.disc, c.ID, 8, true); err != nil {
		t.Fatalf("гость удаляет своё под удалённым постом: %v", err)
	}
}
