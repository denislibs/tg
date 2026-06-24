package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestJoinRequestRepo(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	u1 := seedUser(t, pool, "+7020")
	u2 := seedUser(t, pool, "+7021")
	g := NewGroupRepo(pool)
	chatID, err := g.CreateMultiMember(ctx, "group", "G", "", "", false, u1)
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}
	r := NewJoinRequestRepo(pool)

	if err := r.Create(ctx, chatID, u2, "tok"); err != nil {
		t.Fatalf("create: %v", err)
	}
	list, err := r.List(ctx, chatID)
	if err != nil || len(list) != 1 || list[0].UserID != u2 || list[0].ChatID != chatID {
		t.Fatalf("list after create: %+v %v", list, err)
	}

	// Idempotent: re-creating the same (chat,user) is a no-op via ON CONFLICT.
	if err := r.Create(ctx, chatID, u2, "tok"); err != nil {
		t.Fatalf("create dup: %v", err)
	}
	list, err = r.List(ctx, chatID)
	if err != nil || len(list) != 1 {
		t.Fatalf("list after dup: %+v %v", list, err)
	}

	if err := r.Delete(ctx, chatID, u2); err != nil {
		t.Fatalf("delete: %v", err)
	}
	list, err = r.List(ctx, chatID)
	if err != nil || len(list) != 0 {
		t.Fatalf("list after delete: %+v %v", list, err)
	}
}
