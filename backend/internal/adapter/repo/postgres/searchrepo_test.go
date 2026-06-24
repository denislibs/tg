package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestSearchRepo(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	u := seedUser(t, pool, "+7200")
	g := NewGroupRepo(pool)
	_, _ = g.CreateMultiMember(ctx, "channel", "Go News Daily", "", "gonews", true, u)
	_, _ = g.CreateMultiMember(ctx, "channel", "Private Thing", "", "", false, u) // not public
	r := NewSearchRepo(pool)

	chats, err := r.SearchChats(ctx, "gonews", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(chats) != 1 || chats[0].Username != "gonews" {
		t.Fatalf("by username: %+v", chats)
	}

	byTitle, _ := r.SearchChats(ctx, "Go New", 10)
	if len(byTitle) != 1 {
		t.Fatalf("by title: %+v", byTitle)
	}

	id, err := r.PublicChatByUsername(ctx, "gonews")
	if err != nil || id == 0 {
		t.Fatalf("resolve username: %d %v", id, err)
	}
	if _, err := r.PublicChatByUsername(ctx, "nope"); err == nil {
		t.Fatal("expected not found")
	}
}
