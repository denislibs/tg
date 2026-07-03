package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// RegisterChannelViews increments views once per (post, viewer), dedups re-reads,
// respects the read seq boundary, and is a no-op for non-channel chats.
func TestRegisterChannelViews_DedupAndBoundary(t *testing.T) {
	ctx := context.Background()
	s := newStore()
	s.chatType[10] = "channel"
	m := fakeMsgs{s}
	p1, _ := m.Insert(ctx, domain.Message{ChatID: 10, Seq: 1, SenderID: 7, Type: "text", Text: "a"})
	p2, _ := m.Insert(ctx, domain.Message{ChatID: 10, Seq: 2, SenderID: 7, Type: "text", Text: "b"})

	// user 8 reads up to seq 2 → both posts viewed
	if err := m.RegisterChannelViews(ctx, 10, 8, 2); err != nil {
		t.Fatal(err)
	}
	// user 9 reads up to seq 1 → only p1
	if err := m.RegisterChannelViews(ctx, 10, 9, 1); err != nil {
		t.Fatal(err)
	}
	// user 8 re-reads → no double count (dedup)
	if err := m.RegisterChannelViews(ctx, 10, 8, 2); err != nil {
		t.Fatal(err)
	}

	counts, err := m.ViewCounts(ctx, []int64{p1.ID, p2.ID})
	if err != nil {
		t.Fatal(err)
	}
	if counts[p1.ID] != 2 {
		t.Fatalf("p1 views = %d; want 2 (users 8 & 9)", counts[p1.ID])
	}
	if counts[p2.ID] != 1 {
		t.Fatalf("p2 views = %d; want 1 (user 8, seq 2 > user 9's read of seq 1)", counts[p2.ID])
	}
}

func TestRegisterChannelViews_NonChannelNoop(t *testing.T) {
	ctx := context.Background()
	s := newStore()
	s.chatType[20] = "group"
	m := fakeMsgs{s}
	p, _ := m.Insert(ctx, domain.Message{ChatID: 20, Seq: 1, SenderID: 7, Type: "text", Text: "x"})
	if err := m.RegisterChannelViews(ctx, 20, 8, 1); err != nil {
		t.Fatal(err)
	}
	counts, _ := m.ViewCounts(ctx, []int64{p.ID})
	if counts[p.ID] != 0 {
		t.Fatalf("group message views = %d; want 0 (views are channel-only)", counts[p.ID])
	}
}
