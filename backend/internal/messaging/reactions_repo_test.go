package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestReactionsRepo_AddRemoveAggregate(t *testing.T) {
	pool := postgres.NewTestDB(t)
	chats := NewChatsRepo()
	msgs := NewMessagesRepo()
	reacts := NewReactionsRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+760")
	b := seedUser(t, pool, "+761")
	chatID, _ := chats.CreatePrivateChat(ctx, pool, a, b)
	seq, _ := msgs.NextSeq(ctx, pool, chatID)
	m, _ := msgs.Insert(ctx, pool, Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "x"})

	// Two users react with 🔥; b also adds ❤️.
	if err := reacts.Add(ctx, pool, m.ID, a, "🔥"); err != nil {
		t.Fatalf("add a fire: %v", err)
	}
	_ = reacts.Add(ctx, pool, m.ID, b, "🔥")
	_ = reacts.Add(ctx, pool, m.ID, b, "❤️")
	// Duplicate add is a no-op.
	_ = reacts.Add(ctx, pool, m.ID, a, "🔥")

	counts, err := reacts.ReactionsFor(ctx, pool, m.ID)
	if err != nil {
		t.Fatalf("ReactionsFor: %v", err)
	}
	if len(counts) != 2 || counts[0].Emoji != "🔥" || counts[0].Count != 2 {
		t.Fatalf("counts = %+v; want 🔥:2 first", counts)
	}

	// Remove a's 🔥 → count drops to 1.
	if err := reacts.Remove(ctx, pool, m.ID, a, "🔥"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	counts, _ = reacts.ReactionsFor(ctx, pool, m.ID)
	for _, c := range counts {
		if c.Emoji == "🔥" && c.Count != 1 {
			t.Fatalf("🔥 count = %d after remove; want 1", c.Count)
		}
	}
}
