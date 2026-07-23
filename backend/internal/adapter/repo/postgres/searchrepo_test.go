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

func TestSimilarChannels(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7300")
	viewer := seedUser(t, pool, "+7301")
	a1 := seedUser(t, pool, "+7302")
	a2 := seedUser(t, pool, "+7303")
	a3 := seedUser(t, pool, "+7304")

	g := NewGroupRepo(pool)
	aID, _ := g.CreateMultiMember(ctx, "channel", "Source", "", "", true, owner)       // исходный канал
	bID, _ := g.CreateMultiMember(ctx, "channel", "Very Similar", "", "", true, owner) // пересечение больше
	cID, _ := g.CreateMultiMember(ctx, "channel", "Less Similar", "", "", true, owner) // пересечение меньше
	privID, _ := g.CreateMultiMember(ctx, "channel", "Private", "", "", false, owner)  // не публичный → исключён
	joinID, _ := g.CreateMultiMember(ctx, "channel", "Joined", "", "", true, owner)    // зритель уже состоит → исключён

	// Подписчики исходного канала A.
	for _, u := range []int64{a1, a2, a3} {
		_ = g.AddMember(ctx, aID, u, "member", 0)
	}
	// B делит с A двоих (a1,a2); C — одного (a1).
	_ = g.AddMember(ctx, bID, a1, "member", 0)
	_ = g.AddMember(ctx, bID, a2, "member", 0)
	_ = g.AddMember(ctx, cID, a1, "member", 0)
	// Приватный канал делит троих, но не публичный.
	for _, u := range []int64{a1, a2, a3} {
		_ = g.AddMember(ctx, privID, u, "member", 0)
	}
	// joinID делит двоих, но зритель уже подписан.
	_ = g.AddMember(ctx, joinID, a1, "member", 0)
	_ = g.AddMember(ctx, joinID, a2, "member", 0)
	_ = g.AddMember(ctx, joinID, viewer, "member", 0)

	r := NewSearchRepo(pool)
	got, count, err := r.SimilarChannels(ctx, aID, viewer, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 similar (B,C); private & joined excluded; got %d: %+v", len(got), got)
	}
	if got[0].ID != bID {
		t.Fatalf("want B first (bigger overlap), got id=%d", got[0].ID)
	}
	if got[1].ID != cID {
		t.Fatalf("want C second, got id=%d", got[1].ID)
	}
	if count != 2 {
		t.Fatalf("want total count 2, got %d", count)
	}

	// Зритель, уже подписанный на B, больше не должен видеть B среди похожих.
	_ = g.AddMember(ctx, bID, viewer, "member", 0)
	got2, _, _ := r.SimilarChannels(ctx, aID, viewer, 10)
	for _, c := range got2 {
		if c.ID == bID {
			t.Fatal("B must be excluded once viewer joined it")
		}
	}
}
