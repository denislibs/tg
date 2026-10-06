package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// A2-08 / A3-15: очистка истории пишет в журнал своих устройств кадры удаления
// пропавших номеров и прочтение (still_unread_count=0); чужим — ничего.
func TestClearHistory_FramesToOwnDevices(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	m1, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: b, Text: "one"})
	m2, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: b, Text: "two"})

	before := len(s.updates[a])
	pub.reset()
	if err := in.ClearHistory(ctx, chatID, a); err != nil {
		t.Fatalf("ClearHistory: %v", err)
	}
	if got := len(s.updates[a]) - before; got != 2 {
		t.Fatalf("журнал: +%d записей, want 2 (удаление + прочтение)", got)
	}
	del := lastFrameOfType(t, pub, a, "delete_message")
	ids, _ := del["messages"].([]any)
	if len(ids) != 2 || ids[0] != float64(m1.Seq) || ids[1] != float64(m2.Seq) {
		t.Fatalf("кадр удаления = %#v, want [%d %d]", del, m1.Seq, m2.Seq)
	}
	rd := lastFrameOfType(t, pub, a, "read")
	if rd["_"] != domain.UpdateReadHistoryInboxTag || rd["still_unread_count"] != float64(0) {
		t.Fatalf("кадр прочтения = %#v", rd)
	}
	if pub.countFor(b) != 0 {
		t.Fatal("очистка у себя ушла собеседнику")
	}
	if d, _ := in.ListDialogs(ctx, a); len(d) != 1 || d[0].UnreadCount != 0 {
		t.Fatalf("строка после очистки = %#v", d)
	}
}

// A3-02: «удалить чат» в личке — не выход: собеседник служебки не получает,
// строка пропадает только у удалившего, следующее сообщение идёт в тот же чат
// и возвращает строку.
func TestDeleteDialog_PrivateIsNotLeave(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: b, Text: "hi"})

	if err := in.RemoveMember(ctx, chatID, a, a); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("RemoveMember в личке = %v, want ErrInvalid", err)
	}
	pub.reset()
	if err := in.DeleteDialog(ctx, chatID, a, false); err != nil {
		t.Fatalf("DeleteDialog: %v", err)
	}
	if pub.countFor(b) != 0 {
		t.Fatal("собеседнику ушёл кадр")
	}
	if len(s.members[chatID]) != 2 {
		t.Fatalf("участников %d, want 2", len(s.members[chatID]))
	}
	if d, _ := in.ListDialogs(ctx, a); len(d) != 0 {
		t.Fatalf("строка удалённого диалога осталась: %#v", d)
	}
	if d, _ := in.ListDialogs(ctx, b); len(d) != 1 {
		t.Fatalf("у собеседника строки %d, want 1", len(d))
	}
	_ = lastFrameOfType(t, pub, a, "chat_removed")

	again, err := in.CreatePrivateChat(ctx, a, b)
	if err != nil || again != chatID {
		t.Fatalf("CreatePrivateChat после удаления = %d, %v; want тот же %d", again, err, chatID)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: b, Text: "снова"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	d, _ := in.ListDialogs(ctx, a)
	if len(d) != 1 || d[0].UnreadCount != 1 {
		t.Fatalf("после нового сообщения строка = %#v, want одна с unread 1", d)
	}
}

// revoke: история удаляется и у собеседника — кадры удаления его устройствам,
// его непрочитанное пересчитано.
func TestDeleteDialog_RevokeDeletesForPeer(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	m, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	pub.reset()
	if err := in.DeleteDialog(ctx, chatID, a, true); err != nil {
		t.Fatalf("DeleteDialog revoke: %v", err)
	}
	del := lastFrameOfType(t, pub, b, "delete_message")
	if ids, _ := del["messages"].([]any); len(ids) != 1 || ids[0] != float64(m.Seq) {
		t.Fatalf("кадр удаления собеседнику = %#v", del)
	}
	if s.members[chatID][b].unread != 0 {
		t.Fatalf("unread собеседника = %d, want 0", s.members[chatID][b].unread)
	}
	if d, _ := in.ListDialogs(ctx, b); len(d) != 1 {
		t.Fatal("строка собеседника пропала при revoke")
	}
}

// Группа так не удаляется.
func TestDeleteDialog_GroupInvalid(t *testing.T) {
	in, s := newInteractor()
	s.seedChat(60, domain.ChatTypeGroup, 1, 2)
	if err := in.DeleteDialog(context.Background(), 60, 1, false); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("DeleteDialog группы = %v, want ErrInvalid", err)
	}
}

// A3-39: выход из группы снимает упоминания выбывшего — при повторном
// вступлении старые «@» не возвращаются.
func TestRemoveMember_DropsMentions(t *testing.T) {
	s := newStore()
	fg := newFakeGroupRepo()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	ctx := context.Background()
	const chatID, a, b int64 = 61, 1, 2
	s.seedChat(chatID, domain.ChatTypeGroup, a, b)
	fg.members[chatID] = map[int64]domain.Member{
		a: {ChatID: chatID, UserID: a, Role: domain.RoleCreator},
		b: {ChatID: chatID, UserID: b, Role: domain.RoleMember},
	}
	s.mentions = append(s.mentions, mentionRow{chatID: chatID, msgID: 900, seq: 3, userID: b})
	if err := in.RemoveMember(ctx, chatID, b, b); err != nil {
		t.Fatalf("RemoveMember: %v", err)
	}
	for _, m := range s.mentions {
		if m.userID == b {
			t.Fatalf("упоминание выбывшего осталось: %#v", m)
		}
	}
}

// A2-12 / A3-10: удаление у всех сообщения с упоминанием снимает «@» у
// адресата и «к следующему @» не ведёт на удалённое; A3-29: «удалить у себя»
// снимает непрочитанное и упоминание у скрывшего.
func TestDelete_DropsMentionsAndUnread(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const chatID, a, b int64 = 62, 1, 2
	s.seedChat(chatID, domain.ChatTypeGroup, a, b)
	s.seedUsername(b, "bob_petrov")
	m1, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "@bob_petrov раз"})
	m2, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "@bob_petrov два"})
	if s.members[chatID][b].mentions != 2 || s.members[chatID][b].unread != 2 {
		t.Fatalf("до удаления: mentions=%d unread=%d", s.members[chatID][b].mentions, s.members[chatID][b].unread)
	}
	if err := in.DeleteMessage(ctx, chatID, m1.ID, a, true); err != nil {
		t.Fatalf("DeleteMessage revoke: %v", err)
	}
	if s.members[chatID][b].mentions != 1 {
		t.Fatalf("после удаления у всех mentions=%d, want 1", s.members[chatID][b].mentions)
	}
	if next, err := in.NextMention(ctx, chatID, b, 0); err != nil || next != m2.Seq {
		t.Fatalf("к следующему @ = %d, %v; want %d", next, err, m2.Seq)
	}
	if err := in.DeleteMessage(ctx, chatID, m2.ID, b, false); err != nil {
		t.Fatalf("DeleteMessage у себя: %v", err)
	}
	if m := s.members[chatID][b]; m.mentions != 0 || m.unread != 0 {
		t.Fatalf("после удаления у себя mentions=%d unread=%d, want 0/0", m.mentions, m.unread)
	}
}
