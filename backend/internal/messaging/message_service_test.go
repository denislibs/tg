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

func TestService_MarkRead_OutOfOrderDoesNotRegress(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+785")
	b := seedUser(t, pool, "+786")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	for i := 0; i < 3; i++ {
		_, _ = s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "m"})
	}
	// Read up to 3, then a stale read up to 1 arrives: marker must not move back
	// and unread must stay 0.
	if err := s.MarkRead(ctx, chatID, b, 3); err != nil {
		t.Fatalf("MarkRead(3): %v", err)
	}
	if err := s.MarkRead(ctx, chatID, b, 1); err != nil {
		t.Fatalf("MarkRead(1): %v", err)
	}
	d, _ := s.ListDialogs(ctx, b)
	if d[0].LastReadSeq != 3 || d[0].UnreadCount != 0 {
		t.Fatalf("after stale read: lastRead=%d unread=%d, want 3/0", d[0].LastReadSeq, d[0].UnreadCount)
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

func TestService_Send_WithMedia(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+790")
	b := seedUser(t, pool, "+791")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)

	// Seed a media row owned by a.
	var mediaID int64
	_ = pool.QueryRow(ctx,
		`INSERT INTO media (owner_id, bucket, object_key, mime) VALUES ($1,'media','k','image/jpeg') RETURNING id`,
		a).Scan(&mediaID)

	msg, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "photo", Text: "look", MediaID: &mediaID})
	if err != nil {
		t.Fatalf("Send with media: %v", err)
	}
	if msg.MediaID == nil || *msg.MediaID != mediaID {
		t.Fatalf("message media_id = %v; want %d", msg.MediaID, mediaID)
	}

	// Media owned by someone else is rejected.
	var otherMedia int64
	_ = pool.QueryRow(ctx,
		`INSERT INTO media (owner_id, bucket, object_key, mime) VALUES ($1,'media','k2','image/jpeg') RETURNING id`,
		b).Scan(&otherMedia)
	if _, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "photo", MediaID: &otherMedia}); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for foreign media, got %v", err)
	}
}
