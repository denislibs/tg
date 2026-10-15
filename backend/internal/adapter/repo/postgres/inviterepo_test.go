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
	list, _ := r.ListBy(ctx, chatID, u, false)
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
	if act, _ := r.ListBy(ctx, chatID, u, false); len(act) != 0 {
		t.Fatalf("active list after revoke: %+v", act)
	}
	if rev, _ := r.ListBy(ctx, chatID, u, true); len(rev) != 1 || rev[0].Token != "tok123" {
		t.Fatalf("revoked list after revoke: %+v", rev)
	}
	// Hard-delete removes the row from every list.
	if err := r.Delete(ctx, chatID, "tok123"); err != nil {
		t.Fatal(err)
	}
	if rev, _ := r.ListBy(ctx, chatID, u, true); len(rev) != 0 {
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

	// DeleteRevokedBy removes only the owner's revoked links in the chat.
	revoked := true
	if _, err := r.Update(ctx, chatID, "tt", domain.InviteEdit{Revoked: &revoked}); err != nil {
		t.Fatal(err)
	}
	if err := r.DeleteRevokedBy(ctx, chatID, owner); err != nil {
		t.Fatal(err)
	}
	if rev, _ := r.ListBy(ctx, chatID, owner, true); len(rev) != 0 {
		t.Fatalf("revoked list after DeleteRevokedBy: %+v", rev)
	}
}

// Б-6: выборки по создателю ссылки; отозванные видны GetInChat; счётчики по админам.
func TestInviteRepo_ByCreator(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7021")
	admin := seedUser(t, pool, "+7022")
	g := NewGroupRepo(pool)
	chatID, _ := g.CreateMultiMember(ctx, "group", "G", "", "", false, owner)
	other, _ := g.CreateMultiMember(ctx, "group", "Other", "", "", false, owner)
	r := NewInviteRepo(pool)

	for _, c := range []struct {
		chat, by int64
		tok      string
	}{{chatID, owner, "o1"}, {chatID, owner, "o2"}, {chatID, admin, "a1"}, {chatID, admin, "a2"}, {other, admin, "x1"}} {
		if _, err := r.Create(ctx, c.chat, c.by, c.tok, "", nil, false, nil); err != nil {
			t.Fatal(err)
		}
	}
	revoked := true
	for _, tok := range []string{"o2", "a2"} {
		if _, err := r.Update(ctx, chatID, tok, domain.InviteEdit{Revoked: &revoked}); err != nil {
			t.Fatal(err)
		}
	}

	if act, _ := r.ListBy(ctx, chatID, admin, false); len(act) != 1 || act[0].Token != "a1" {
		t.Fatalf("admin active: %+v", act)
	}
	if rev, _ := r.ListBy(ctx, chatID, admin, true); len(rev) != 1 || rev[0].Token != "a2" {
		t.Fatalf("admin revoked: %+v", rev)
	}
	if act, _ := r.ListBy(ctx, chatID, owner, false); len(act) != 1 || act[0].Token != "o1" {
		t.Fatalf("owner active: %+v", act)
	}

	// Отозванная ссылка находится GetInChat (GetByToken её скрывает); чужой чат — нет.
	if l, err := r.GetInChat(ctx, chatID, "a2"); err != nil || l.CreatedBy != admin || !l.Revoked {
		t.Fatalf("GetInChat revoked: %+v %v", l, err)
	}
	if _, err := r.GetInChat(ctx, chatID, "x1"); err != domain.ErrNotFound {
		t.Fatalf("GetInChat foreign chat: %v; want ErrNotFound", err)
	}

	counts, err := r.CountsByAdmin(ctx, chatID)
	want := []domain.AdminInvites{{AdminID: owner, Active: 1, Revoked: 1}, {AdminID: admin, Active: 1, Revoked: 1}}
	if err != nil || len(counts) != 2 || counts[0] != want[0] || counts[1] != want[1] {
		t.Fatalf("CountsByAdmin = %+v, %v; want %+v", counts, err, want)
	}

	// DeleteRevokedBy задевает только отозванные указанного создателя в этом чате.
	if err := r.DeleteRevokedBy(ctx, chatID, admin); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetInChat(ctx, chatID, "a2"); err != domain.ErrNotFound {
		t.Fatalf("a2 after DeleteRevokedBy: %v", err)
	}
	if _, err := r.GetInChat(ctx, chatID, "o2"); err != nil {
		t.Fatalf("owner's revoked link must stay: %v", err)
	}
	if _, err := r.GetInChat(ctx, chatID, "a1"); err != nil {
		t.Fatalf("admin's active link must stay: %v", err)
	}
}
