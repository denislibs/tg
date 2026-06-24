package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestInviteRepo(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	u := seedUser(t, pool, "+7010")
	g := NewGroupRepo(pool)
	chatID, _ := g.CreateMultiMember(ctx, "group", "G", "", "", false, u)
	r := NewInviteRepo(pool)

	link, err := r.Create(ctx, chatID, u, "tok123", nil)
	if err != nil || link.Token != "tok123" {
		t.Fatalf("create: %+v %v", link, err)
	}
	got, err := r.GetByToken(ctx, "tok123")
	if err != nil || got.ChatID != chatID {
		t.Fatalf("get: %+v %v", got, err)
	}
	if err := r.IncUses(ctx, link.ID); err != nil {
		t.Fatal(err)
	}
	list, _ := r.List(ctx, chatID)
	if len(list) != 1 || list[0].Uses != 1 {
		t.Fatalf("list: %+v", list)
	}
	if err := r.Revoke(ctx, chatID, "tok123"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetByToken(ctx, "tok123"); err == nil {
		t.Fatal("revoked token should not resolve")
	}
}
