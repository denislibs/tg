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

	link, err := r.Create(ctx, chatID, u, "tok123", nil, false)
	if err != nil || link.Token != "tok123" || link.RequiresApproval {
		t.Fatalf("create: %+v %v", link, err)
	}
	got, err := r.GetByToken(ctx, "tok123")
	if err != nil || got.ChatID != chatID || got.RequiresApproval {
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

	// requires_approval round-trips through Create/GetByToken.
	approval, err := r.Create(ctx, chatID, u, "tok456", nil, true)
	if err != nil || !approval.RequiresApproval {
		t.Fatalf("create approval: %+v %v", approval, err)
	}
	gotApproval, err := r.GetByToken(ctx, "tok456")
	if err != nil || !gotApproval.RequiresApproval {
		t.Fatalf("get approval: %+v %v", gotApproval, err)
	}
}
