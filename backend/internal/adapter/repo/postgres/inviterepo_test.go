package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestInviteRepo(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	u := seedUser(t, pool, "+7010")
	g := NewGroupRepo(pool)
	chatID, _ := g.CreateMultiMember(ctx, "group", "G", "", "", false, u)
	r := NewInviteRepo(pool)

	link, err := r.Create(ctx, chatID, u, "tok123", "", nil, false, nil)
	if err != nil || link.Token != "tok123" || link.RequiresApproval || link.ExpiresAt != nil {
		t.Fatalf("create: %+v %v", link, err)
	}
	got, err := r.GetByToken(ctx, "tok123")
	if err != nil || got.ChatID != chatID || got.RequiresApproval || got.ExpiresAt != nil {
		t.Fatalf("get: %+v %v", got, err)
	}

	if err := r.IncUses(ctx, link.ID); err != nil {
		t.Fatal(err)
	}
	list, _ := r.List(ctx, chatID, false)
	if len(list) != 1 || list[0].Uses != 1 {
		t.Fatalf("list: %+v", list)
	}
	// Revoke is done via Update(revoked=true): the link leaves the active list,
	// joins the revoked list, and no longer resolves for joining.
	revoked := true
	if _, err := r.Update(ctx, chatID, "tok123", domain.InviteEdit{Revoked: &revoked}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetByToken(ctx, "tok123"); err == nil {
		t.Fatal("revoked token should not resolve")
	}
	if act, _ := r.List(ctx, chatID, false); len(act) != 0 {
		t.Fatalf("active list after revoke: %+v", act)
	}
	if rev, _ := r.List(ctx, chatID, true); len(rev) != 1 || rev[0].Token != "tok123" {
		t.Fatalf("revoked list after revoke: %+v", rev)
	}
	// Hard-delete removes the row from every list.
	if err := r.Delete(ctx, chatID, "tok123"); err != nil {
		t.Fatal(err)
	}
	if rev, _ := r.List(ctx, chatID, true); len(rev) != 0 {
		t.Fatalf("revoked list after delete: %+v", rev)
	}

	// requires_approval round-trips through Create/GetByToken.
	approval, err := r.Create(ctx, chatID, u, "tok456", "", nil, true, nil)
	if err != nil || !approval.RequiresApproval {
		t.Fatalf("create approval: %+v %v", approval, err)
	}
	gotApproval, err := r.GetByToken(ctx, "tok456")
	if err != nil || !gotApproval.RequiresApproval {
		t.Fatalf("get approval: %+v %v", gotApproval, err)
	}

	// expires_at round-trips through Create/GetByToken/List.
	exp := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	expLink, err := r.Create(ctx, chatID, u, "tokexp", "", nil, false, &exp)
	if err != nil || expLink.ExpiresAt == nil || !expLink.ExpiresAt.UTC().Truncate(time.Second).Equal(exp) {
		t.Fatalf("create expiry: %+v %v", expLink, err)
	}
	gotExp, err := r.GetByToken(ctx, "tokexp")
	if err != nil || gotExp.ExpiresAt == nil || !gotExp.ExpiresAt.UTC().Truncate(time.Second).Equal(exp) {
		t.Fatalf("get expiry: %+v %v", gotExp, err)
	}
}

func TestInviteRepo_TitleEditImporters(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7011")
	joiner1 := seedUser(t, pool, "+7012")
	joiner2 := seedUser(t, pool, "+7013")
	g := NewGroupRepo(pool)
	chatID, _ := g.CreateMultiMember(ctx, "group", "G", "", "", false, owner)
	r := NewInviteRepo(pool)

	// title round-trips through Create/GetByToken.
	link, err := r.Create(ctx, chatID, owner, "tt", "My link", nil, false, nil)
	if err != nil || link.Title != "My link" {
		t.Fatalf("create title: %+v %v", link, err)
	}
	if got, _ := r.GetByToken(ctx, "tt"); got.Title != "My link" {
		t.Fatalf("get title: %+v", got)
	}

	// Update: title + usage_limit + requires_approval.
	limit := 5
	title := "Renamed"
	approval := true
	upd, err := r.Update(ctx, chatID, "tt", domain.InviteEdit{
		Title:            &title,
		RequiresApproval: &approval,
		UsageLimit:       &limit,
		SetUsageLimit:    true,
	})
	if err != nil || upd.Title != "Renamed" || !upd.RequiresApproval || upd.UsageLimit == nil || *upd.UsageLimit != 5 {
		t.Fatalf("update: %+v %v", upd, err)
	}
	// Clearing usage_limit (nil + SetUsageLimit) means unlimited.
	upd, err = r.Update(ctx, chatID, "tt", domain.InviteEdit{SetUsageLimit: true})
	if err != nil || upd.UsageLimit != nil {
		t.Fatalf("clear usage_limit: %+v %v", upd, err)
	}
	// Empty edit returns the current row unchanged.
	if noop, err := r.Update(ctx, chatID, "tt", domain.InviteEdit{}); err != nil || noop.Title != "Renamed" {
		t.Fatalf("noop update: %+v %v", noop, err)
	}

	// RecordJoin is idempotent and feeds Importers (newest first).
	if err := r.RecordJoin(ctx, chatID, "tt", joiner1); err != nil {
		t.Fatal(err)
	}
	_ = r.RecordJoin(ctx, chatID, "tt", joiner1) // dedup
	if err := r.RecordJoin(ctx, chatID, "tt", joiner2); err != nil {
		t.Fatal(err)
	}
	imps, count, err := r.Importers(ctx, chatID, "tt", 50)
	if err != nil || count != 2 || len(imps) != 2 {
		t.Fatalf("importers: %+v count=%d err=%v", imps, count, err)
	}
	if imps[0].UserID != joiner2 {
		t.Fatalf("importers not newest-first: %+v", imps)
	}

	// IDOR guard: the same token queried under a different chat_id yields nothing.
	other, _ := g.CreateMultiMember(ctx, "group", "Other", "", "", false, owner)
	if imps, count, err := r.Importers(ctx, other, "tt", 50); err != nil || count != 0 || len(imps) != 0 {
		t.Fatalf("cross-chat importers: %+v count=%d err=%v, want empty", imps, count, err)
	}

	// DeleteAllRevoked removes only the chat's revoked links.
	revoked := true
	if _, err := r.Update(ctx, chatID, "tt", domain.InviteEdit{Revoked: &revoked}); err != nil {
		t.Fatal(err)
	}
	if err := r.DeleteAllRevoked(ctx, chatID); err != nil {
		t.Fatal(err)
	}
	if rev, _ := r.List(ctx, chatID, true); len(rev) != 0 {
		t.Fatalf("revoked list after DeleteAllRevoked: %+v", rev)
	}
}
