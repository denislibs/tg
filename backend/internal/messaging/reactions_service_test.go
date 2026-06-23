package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestService_React_FanoutAndAggregate(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	pub := &fakePublisher{}
	s.SetPublisher(pub)
	ctx := context.Background()
	a := seedUser(t, pool, "+770")
	b := seedUser(t, pool, "+771")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	msg, _ := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	pub.frames = nil // ignore the send fan-out

	// b reacts 🔥.
	if err := s.React(ctx, chatID, msg.ID, b, "🔥", true); err != nil {
		t.Fatalf("React add: %v", err)
	}
	if pub.countFor(a) != 1 || pub.countFor(b) != 1 {
		t.Fatalf("reaction fan-out wrong: a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}
	counts, _ := s.ReactionsOf(ctx, chatID, msg.ID, a)
	if len(counts) != 1 || counts[0].Emoji != "🔥" || counts[0].Count != 1 {
		t.Fatalf("counts = %+v", counts)
	}

	// The reaction must also reach the pts log: a syncs from after the message
	// (pts=1) and sees the reaction in other_updates.
	diff, err := s.GetDifference(ctx, a, 1)
	if err != nil {
		t.Fatalf("GetDifference: %v", err)
	}
	if len(diff.OtherUpdates) != 1 || len(diff.NewMessages) != 0 {
		t.Fatalf("expected 1 reaction in other_updates, got new=%d other=%d", len(diff.NewMessages), len(diff.OtherUpdates))
	}

	// Remove it.
	if err := s.React(ctx, chatID, msg.ID, b, "🔥", false); err != nil {
		t.Fatalf("React remove: %v", err)
	}
	counts, _ = s.ReactionsOf(ctx, chatID, msg.ID, a)
	if len(counts) != 0 {
		t.Fatalf("expected no reactions after remove, got %+v", counts)
	}
}

func TestService_React_Rejects(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+780")
	b := seedUser(t, pool, "+781")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	msg, _ := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})

	// Empty emoji rejected.
	if err := s.React(ctx, chatID, msg.ID, a, "", true); err != ErrBadReaction {
		t.Fatalf("expected ErrBadReaction, got %v", err)
	}
	// Non-member rejected.
	stranger := seedUser(t, pool, "+782")
	if err := s.React(ctx, chatID, msg.ID, stranger, "🔥", true); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for non-member, got %v", err)
	}
	// Wrong chat id for the message rejected.
	if err := s.React(ctx, chatID+999, msg.ID, a, "🔥", true); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for mismatched chat, got %v", err)
	}
}
