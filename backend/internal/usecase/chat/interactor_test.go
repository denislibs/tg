package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestCreatePrivateChat_Idempotent(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2

	id1, err := in.CreatePrivateChat(ctx, a, b)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id2, err := in.CreatePrivateChat(ctx, b, a)
	if err != nil || id1 != id2 {
		t.Fatalf("expected same chat, got %d and %d (err %v)", id1, id2, err)
	}
	dialogs, _ := in.ListDialogs(ctx, a)
	if len(dialogs) != 1 {
		t.Fatalf("expected 1 dialog, got %d", len(dialogs))
	}
}

func TestChatPartners(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b, c int64 = 1, 2, 3
	_, _ = in.CreatePrivateChat(ctx, a, b)
	_, _ = in.CreatePrivateChat(ctx, a, c)

	partners, err := in.ChatPartners(ctx, a)
	if err != nil {
		t.Fatalf("ChatPartners: %v", err)
	}
	if len(partners) != 2 {
		t.Fatalf("expected 2 partners, got %v", partners)
	}
	bp, _ := in.ChatPartners(ctx, b)
	if len(bp) != 1 || bp[0] != a {
		t.Fatalf("b partners = %v; want [%d]", bp, a)
	}
}

func TestSend_FanoutAndUnread(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hello", ClientMsgID: "c1"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if msg.Seq != 1 || msg.Text != "hello" {
		t.Fatalf("unexpected message: %+v", msg)
	}

	// Both members got a new_message update (pts=1 each).
	for _, uid := range []int64{a, b} {
		st, _ := in.updates.GetUserState(ctx, uid)
		if st.Pts != 1 {
			t.Fatalf("user %d pts = %d, want 1", uid, st.Pts)
		}
	}

	dialogsB, _ := in.ListDialogs(ctx, b)
	if dialogsB[0].UnreadCount != 1 {
		t.Fatalf("b unread = %d, want 1", dialogsB[0].UnreadCount)
	}
	dialogsA, _ := in.ListDialogs(ctx, a)
	if dialogsA[0].UnreadCount != 0 {
		t.Fatalf("a unread = %d, want 0", dialogsA[0].UnreadCount)
	}
}

func TestSend_IdempotentClientMsgID(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	m1, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "x", ClientMsgID: "dup"})
	m2, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "x", ClientMsgID: "dup"})
	if err != nil {
		t.Fatalf("second Send: %v", err)
	}
	if m1.ID != m2.ID || m1.Seq != m2.Seq {
		t.Fatalf("idempotency broken: %+v vs %+v", m1, m2)
	}
	n := len(s.messages[chatID])
	if n != 1 {
		t.Fatalf("expected 1 message after duplicate send, got %d", n)
	}
}

func TestSend_NonMemberRejected(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 999, Text: "x"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-member sender, got %v", err)
	}
}

func TestSend_WithMedia(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	const mediaID int64 = 100
	s.seedMedia(mediaID, a)
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "photo", Text: "look", MediaID: ptr(mediaID)})
	if err != nil {
		t.Fatalf("Send with media: %v", err)
	}
	if msg.MediaID == nil || *msg.MediaID != mediaID {
		t.Fatalf("message media_id = %v; want %d", msg.MediaID, mediaID)
	}

	// Media owned by someone else is rejected.
	const otherMedia int64 = 200
	s.seedMedia(otherMedia, b)
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "photo", MediaID: ptr(otherMedia)}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for foreign media, got %v", err)
	}
	// Absent media rejected.
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "photo", MediaID: ptr(int64(999))}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for absent media, got %v", err)
	}
}

func TestMarkRead(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "1"})
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "2"})

	if d, _ := in.ListDialogs(ctx, b); d[0].UnreadCount != 2 {
		t.Fatalf("b unread before read = %d, want 2", d[0].UnreadCount)
	}
	if err := in.MarkRead(ctx, chatID, b, 2); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	d, _ := in.ListDialogs(ctx, b)
	if d[0].UnreadCount != 0 || d[0].LastReadSeq != 2 {
		t.Fatalf("after read: unread=%d lastRead=%d", d[0].UnreadCount, d[0].LastReadSeq)
	}
}

func TestMarkRead_OutOfOrderDoesNotRegress(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	for i := 0; i < 3; i++ {
		_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "m"})
	}
	if err := in.MarkRead(ctx, chatID, b, 3); err != nil {
		t.Fatalf("MarkRead(3): %v", err)
	}
	if err := in.MarkRead(ctx, chatID, b, 1); err != nil {
		t.Fatalf("MarkRead(1): %v", err)
	}
	d, _ := in.ListDialogs(ctx, b)
	if d[0].LastReadSeq != 3 || d[0].UnreadCount != 0 {
		t.Fatalf("after stale read: lastRead=%d unread=%d, want 3/0", d[0].LastReadSeq, d[0].UnreadCount)
	}
}

func TestGetHistory_Window(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	for i := 0; i < 5; i++ {
		_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "m"})
	}
	res, err := in.GetHistory(ctx, chatID, a, 0, 0, 3, nil)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if res.Count != 5 {
		t.Fatalf("count = %d, want 5", res.Count)
	}
	if len(res.Messages) != 3 || res.Messages[0].Seq != 5 {
		t.Fatalf("window = %+v", res.Messages)
	}

	// Non-member cannot read.
	if _, err := in.GetHistory(ctx, chatID, 999, 0, 0, 10, nil); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-member, got %v", err)
	}
}

func TestGetDifference(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "1"})
	_ = in.MarkRead(ctx, chatID, b, 1)

	d, err := in.GetDifference(ctx, b, 0)
	if err != nil {
		t.Fatalf("GetDifference: %v", err)
	}
	if len(d.NewMessages) != 1 || len(d.OtherUpdates) != 1 {
		t.Fatalf("diff = %d new, %d other", len(d.NewMessages), len(d.OtherUpdates))
	}
	if d.State.Pts != 2 || d.TooLong || d.Slice {
		t.Fatalf("state = %+v slice=%v tooLong=%v", d.State, d.Slice, d.TooLong)
	}

	d2, _ := in.GetDifference(ctx, b, 1)
	if len(d2.NewMessages) != 0 || len(d2.OtherUpdates) != 1 {
		t.Fatalf("tail diff = %d new, %d other", len(d2.NewMessages), len(d2.OtherUpdates))
	}
}

func TestGetDifference_ClampsNegativePts(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "1"})

	d, err := in.GetDifference(ctx, b, -5)
	if err != nil {
		t.Fatalf("GetDifference: %v", err)
	}
	if len(d.NewMessages) != 1 {
		t.Fatalf("expected 1 new message from clamped pts, got %d", len(d.NewMessages))
	}
}

func ptr[T any](v T) *T { return &v }

func TestEditMessage(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "orig"})

	// Author edits.
	upd, err := in.EditMessage(ctx, chatID, msg.ID, a, "edited", nil)
	if err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	if upd.Text != "edited" || upd.EditedAt == nil {
		t.Fatalf("edit result = %+v", upd)
	}
	res, _ := in.GetHistory(ctx, chatID, a, 0, 0, 10, nil)
	if res.Messages[0].Text != "edited" || res.Messages[0].EditedAt == nil {
		t.Fatalf("history not edited: %+v", res.Messages[0])
	}

	// Non-author cannot edit.
	if _, err := in.EditMessage(ctx, chatID, msg.ID, b, "hack", nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-author edit: want ErrForbidden, got %v", err)
	}
}

func TestDeleteMessage_ForEveryone(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "bye"})

	// In a private 1:1 the non-author (b) may delete for everyone (Telegram).
	if err := in.DeleteMessage(ctx, chatID, msg.ID, b, true); err != nil {
		t.Fatalf("private non-author revoke: %v", err)
	}
	// Deleted messages are never shown — gone from history for both sides.
	res, _ := in.GetHistory(ctx, chatID, a, 0, 0, 10, nil)
	if len(res.Messages) != 0 {
		t.Fatalf("after revoke (a view) should be empty: %+v", res.Messages)
	}
}

func TestDeleteMessage_ForMe(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})

	// b deletes for themselves only.
	if err := in.DeleteMessage(ctx, chatID, msg.ID, b, false); err != nil {
		t.Fatalf("DeleteMessage forMe: %v", err)
	}
	// b no longer sees it; a still does.
	resB, _ := in.GetHistory(ctx, chatID, b, 0, 0, 10, nil)
	if len(resB.Messages) != 0 {
		t.Fatalf("b should not see hidden msg: %+v", resB.Messages)
	}
	resA, _ := in.GetHistory(ctx, chatID, a, 0, 0, 10, nil)
	if len(resA.Messages) != 1 {
		t.Fatalf("a should still see msg: %+v", resA.Messages)
	}
}

func TestForwardMessages(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b, c int64 = 1, 2, 3
	src, _ := in.CreatePrivateChat(ctx, a, b)
	dst, _ := in.CreatePrivateChat(ctx, a, c)
	orig, _ := in.Send(ctx, SendInput{ChatID: src, SenderID: b, Text: "hello"})

	fwd, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: dst, MsgIDs: []int64{orig.ID}, SenderID: a})
	if err != nil {
		t.Fatalf("ForwardMessages: %v", err)
	}
	if len(fwd) != 1 {
		t.Fatalf("forwarded %d, want 1", len(fwd))
	}
	m := fwd[0]
	if m.ChatID != dst || m.SenderID != a || m.Text != "hello" {
		t.Fatalf("copy = %+v", m)
	}
	if m.FwdFromUserID == nil || *m.FwdFromUserID != b || m.FwdFromMsgID == nil || *m.FwdFromMsgID != orig.ID {
		t.Fatalf("forward origin = %+v", m)
	}
	// It lands in the destination history.
	res, _ := in.GetHistory(ctx, dst, c, 0, 0, 10, nil)
	if len(res.Messages) != 1 || res.Messages[0].FwdFromUserID == nil {
		t.Fatalf("dst history = %+v", res.Messages)
	}

	// Non-member of source cannot forward.
	if _, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: dst, MsgIDs: []int64{orig.ID}, SenderID: c}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("non-member forward: want ErrNotFound, got %v", err)
	}
}

func TestPinAndViewers(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "pin me"})

	// Pin → appears in ListPins; unpin → gone.
	if err := in.SetPin(ctx, chatID, msg.ID, a, true); err != nil {
		t.Fatalf("SetPin: %v", err)
	}
	pins, _ := in.ListPins(ctx, chatID, b)
	if len(pins) != 1 || pins[0].ID != msg.ID {
		t.Fatalf("pins = %+v", pins)
	}
	if err := in.SetPin(ctx, chatID, msg.ID, a, false); err != nil {
		t.Fatalf("Unpin: %v", err)
	}
	if pins, _ := in.ListPins(ctx, chatID, b); len(pins) != 0 {
		t.Fatalf("after unpin: %+v", pins)
	}

	// Viewers: nobody has read a's message yet → empty; after b reads, b appears.
	if v, _ := in.MessageViewers(ctx, chatID, msg.ID, a); len(v) != 0 {
		t.Fatalf("viewers before read = %v", v)
	}
	_ = in.MarkRead(ctx, chatID, b, msg.Seq)
	v, _ := in.MessageViewers(ctx, chatID, msg.ID, a)
	if len(v) != 1 || v[0] != b {
		t.Fatalf("viewers after read = %v, want [%d]", v, b)
	}
}

func TestGetHistory_HydratesReply(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	orig, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "original"})
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: b, Text: "reply", ReplyToID: &orig.ID})

	res, _ := in.GetHistory(ctx, chatID, a, 0, 0, 10, nil)
	var replyMsg *domain.Message
	for i := range res.Messages {
		if res.Messages[i].Text == "reply" {
			replyMsg = &res.Messages[i]
		}
	}
	if replyMsg == nil || replyMsg.ReplyTo == nil {
		t.Fatalf("reply not hydrated: %+v", res.Messages)
	}
	if replyMsg.ReplyTo.SenderID != a || replyMsg.ReplyTo.Text != "original" {
		t.Fatalf("reply preview = %+v", replyMsg.ReplyTo)
	}
}

func TestSearchMessages(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "привет мир"})
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: b, Text: "пока"})
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "ПРИВЕТ снова"})

	res, err := in.SearchMessages(ctx, chatID, a, "привет", 0, 20)
	if err != nil {
		t.Fatalf("SearchMessages: %v", err)
	}
	if res.Count != 2 || len(res.Messages) != 2 {
		t.Fatalf("search count=%d msgs=%d, want 2/2", res.Count, len(res.Messages))
	}
	// Non-member rejected.
	if _, err := in.SearchMessages(ctx, chatID, 999, "привет", 0, 20); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("non-member search: want ErrNotFound, got %v", err)
	}
}

func TestGetHistoryAround(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	for i := 0; i < 20; i++ {
		_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "m"})
	}
	res, err := in.GetHistoryAround(ctx, chatID, a, 10, 6, nil)
	if err != nil {
		t.Fatalf("GetHistoryAround: %v", err)
	}
	// window around seq 10 should contain seq 10 and neighbours, ascending.
	var hasCenter bool
	for i, m := range res.Messages {
		if m.Seq == 10 {
			hasCenter = true
		}
		if i > 0 && res.Messages[i-1].Seq > m.Seq {
			t.Fatalf("not ascending: %+v", res.Messages)
		}
	}
	if !hasCenter {
		t.Fatalf("center seq 10 missing: %+v", res.Messages)
	}
	if res.ReachedTop || res.ReachedBottom {
		t.Fatalf("mid-history window should not report ends: top=%v bottom=%v", res.ReachedTop, res.ReachedBottom)
	}
}
