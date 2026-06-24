package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestGroupRepo_CreateAndMembership(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	u1 := seedUser(t, pool, "+7001")
	u2 := seedUser(t, pool, "+7002")
	r := NewGroupRepo(pool)

	chatID, err := r.CreateMultiMember(ctx, "group", "My Group", "about", "", false, u1)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.AddMember(ctx, chatID, u1, domain.RoleCreator, domain.AllRights); err != nil {
		t.Fatal(err)
	}
	if err := r.AddMember(ctx, chatID, u2, domain.RoleMember, 0); err != nil {
		t.Fatal(err)
	}

	m, err := r.GetMember(ctx, chatID, u2)
	if err != nil || m.Role != domain.RoleMember {
		t.Fatalf("member: %+v %v", m, err)
	}

	card, err := r.Card(ctx, chatID, u1)
	if err != nil {
		t.Fatal(err)
	}
	if card.Title != "My Group" || card.MemberCount != 2 || card.MyRole != domain.RoleCreator {
		t.Fatalf("card: %+v", card)
	}

	if err := r.SetRole(ctx, chatID, u2, domain.RoleAdmin, domain.RightPostMessages); err != nil {
		t.Fatal(err)
	}
	m2, _ := r.GetMember(ctx, chatID, u2)
	if m2.Role != domain.RoleAdmin || m2.Rights != domain.RightPostMessages {
		t.Fatalf("promote: %+v", m2)
	}

	if err := r.SetMuted(ctx, chatID, u2, true); err != nil {
		t.Fatal(err)
	}
	m3, _ := r.GetMember(ctx, chatID, u2)
	if !m3.Muted {
		t.Fatal("mute not set")
	}

	if err := r.RemoveMember(ctx, chatID, u2); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetMember(ctx, chatID, u2); err == nil {
		t.Fatal("expected not-member after remove")
	}
	card2, _ := r.Card(ctx, chatID, u1)
	if card2.MemberCount != 1 {
		t.Fatalf("count after remove = %d", card2.MemberCount)
	}

	cards, err := r.UsersByIDs(ctx, []int64{u1, u2})
	if err != nil || len(cards) != 2 {
		t.Fatalf("usersByIDs: %v %d", err, len(cards))
	}
}
