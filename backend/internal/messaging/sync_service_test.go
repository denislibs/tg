package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestService_GetHistory_Window(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+790")
	b := seedUser(t, pool, "+791")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	for i := 0; i < 5; i++ {
		_, _ = s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "m"})
	}
	res, err := s.GetHistory(ctx, chatID, a, 0, 0, 3)
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
	stranger := seedUser(t, pool, "+792")
	if _, err := s.GetHistory(ctx, chatID, stranger, 0, 0, 10); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for non-member, got %v", err)
	}
}

func TestService_GetDifference(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+800")
	b := seedUser(t, pool, "+801")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	_, _ = s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "1"})
	_ = s.MarkRead(ctx, chatID, b, 1)

	// From scratch, b should see 1 new_message + 1 read update; state pts=2.
	d, err := s.GetDifference(ctx, b, 0)
	if err != nil {
		t.Fatalf("GetDifference: %v", err)
	}
	if len(d.NewMessages) != 1 || len(d.OtherUpdates) != 1 {
		t.Fatalf("diff = %d new, %d other", len(d.NewMessages), len(d.OtherUpdates))
	}
	if d.State.Pts != 2 || d.TooLong || d.Slice {
		t.Fatalf("state = %+v slice=%v tooLong=%v", d.State, d.Slice, d.TooLong)
	}

	// From pts=1, only the read update remains.
	d2, _ := s.GetDifference(ctx, b, 1)
	if len(d2.NewMessages) != 0 || len(d2.OtherUpdates) != 1 {
		t.Fatalf("tail diff = %d new, %d other", len(d2.NewMessages), len(d2.OtherUpdates))
	}
}
