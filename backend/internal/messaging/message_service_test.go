package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestService_Send_FanoutAndUnread(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+760")
	b := seedUser(t, pool, "+761")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)

	msg, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hello", ClientMsgID: "c1"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if msg.Seq != 1 || msg.Text != "hello" {
		t.Fatalf("unexpected message: %+v", msg)
	}

	// Both members got a new_message update (pts=1 each).
	for _, uid := range []int64{a, b} {
		st, _ := s.updates.GetUserState(ctx, pool, uid)
		if st.Pts != 1 {
			t.Fatalf("user %d pts = %d, want 1", uid, st.Pts)
		}
	}

	// Recipient b has unread=1; sender a has unread=0.
	dialogsB, _ := s.ListDialogs(ctx, b)
	if dialogsB[0].UnreadCount != 1 {
		t.Fatalf("b unread = %d, want 1", dialogsB[0].UnreadCount)
	}
	dialogsA, _ := s.ListDialogs(ctx, a)
	if dialogsA[0].UnreadCount != 0 {
		t.Fatalf("a unread = %d, want 0", dialogsA[0].UnreadCount)
	}
}

func TestService_Send_IdempotentClientMsgID(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+770")
	b := seedUser(t, pool, "+771")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)

	m1, _ := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "x", ClientMsgID: "dup"})
	m2, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "x", ClientMsgID: "dup"})
	if err != nil {
		t.Fatalf("second Send: %v", err)
	}
	if m1.ID != m2.ID || m1.Seq != m2.Seq {
		t.Fatalf("idempotency broken: %+v vs %+v", m1, m2)
	}
	n, _ := s.msgs.CountMessages(ctx, pool, chatID)
	if n != 1 {
		t.Fatalf("expected 1 message after duplicate send, got %d", n)
	}
}

func TestService_MarkRead(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+780")
	b := seedUser(t, pool, "+781")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	_, _ = s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "1"})
	_, _ = s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "2"})

	if d, _ := s.ListDialogs(ctx, b); d[0].UnreadCount != 2 {
		t.Fatalf("b unread before read = %d, want 2", d[0].UnreadCount)
	}
	if err := s.MarkRead(ctx, chatID, b, 2); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	d, _ := s.ListDialogs(ctx, b)
	if d[0].UnreadCount != 0 || d[0].LastReadSeq != 2 {
		t.Fatalf("after read: unread=%d lastRead=%d", d[0].UnreadCount, d[0].LastReadSeq)
	}
}
