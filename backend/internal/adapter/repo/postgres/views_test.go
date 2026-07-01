package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// RegisterChannelViews on the real schema: increments views once per (post, viewer),
// dedups re-reads, respects the read-seq boundary, and is a no-op for non-channels.
func TestMessagesRepo_ChannelViews(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	groups := NewGroupRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()

	author := seedUser(t, pool, "+790")
	reader1 := seedUser(t, pool, "+791")
	reader2 := seedUser(t, pool, "+792")

	chID, err := groups.CreateMultiMember(ctx, "channel", "News", "", "", true, author)
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	p1, _ := msgs.Insert(ctx, domain.Message{ChatID: chID, Seq: 1, SenderID: author, Type: "text", Text: "a"})
	p2, _ := msgs.Insert(ctx, domain.Message{ChatID: chID, Seq: 2, SenderID: author, Type: "text", Text: "b"})

	// reader1 reads up to seq 2 → both posts; reader2 up to seq 1 → only p1.
	if err := msgs.RegisterChannelViews(ctx, chID, reader1, 2); err != nil {
		t.Fatal(err)
	}
	if err := msgs.RegisterChannelViews(ctx, chID, reader2, 1); err != nil {
		t.Fatal(err)
	}
	// reader1 re-reads → dedup, no double count.
	if err := msgs.RegisterChannelViews(ctx, chID, reader1, 2); err != nil {
		t.Fatal(err)
	}

	counts, err := msgs.ViewCounts(ctx, []int64{p1.ID, p2.ID})
	if err != nil {
		t.Fatal(err)
	}
	if counts[p1.ID] != 2 {
		t.Fatalf("p1 views = %d; want 2", counts[p1.ID])
	}
	if counts[p2.ID] != 1 {
		t.Fatalf("p2 views = %d; want 1", counts[p2.ID])
	}

	// A group chat's messages never accrue views (self-gated to channels).
	grpID, _ := groups.CreateMultiMember(ctx, "group", "G", "", "", false, author)
	gm, _ := msgs.Insert(ctx, domain.Message{ChatID: grpID, Seq: 1, SenderID: author, Type: "text", Text: "x"})
	if err := msgs.RegisterChannelViews(ctx, grpID, reader1, 1); err != nil {
		t.Fatal(err)
	}
	counts, _ = msgs.ViewCounts(ctx, []int64{gm.ID})
	if counts[gm.ID] != 0 {
		t.Fatalf("group message views = %d; want 0", counts[gm.ID])
	}
}
