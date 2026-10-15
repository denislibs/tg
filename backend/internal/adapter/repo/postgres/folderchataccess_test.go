package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// CanInvite: право приглашать — у создателя и у админа с invite_users
// (tweb hasRights(peer, 'invite_links'), hasRights.ts:105-110); рядовой,
// админ без бита и не участник — нет.
func TestFolderChatAccess_CanInvite(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	g := NewGroupRepo(pool)
	a := NewFolderChatAccess(pool, nil, nil)
	ctx := context.Background()
	creator := seedUser(t, pool, "+7821")
	adminInvite := seedUser(t, pool, "+7822")
	adminNoBit := seedUser(t, pool, "+7823")
	member := seedUser(t, pool, "+7824")
	outsider := seedUser(t, pool, "+7825")

	chatID, err := g.CreateMultiMember(ctx, "group", "G", "", "", false, creator)
	if err != nil {
		t.Fatal(err)
	}
	if err := g.AddMember(ctx, chatID, creator, domain.RoleCreator, domain.AllRights); err != nil {
		t.Fatal(err)
	}
	for _, u := range []int64{adminInvite, adminNoBit, member} {
		if err := g.AddMember(ctx, chatID, u, domain.RoleMember, 0); err != nil {
			t.Fatal(err)
		}
	}
	if err := g.SetRole(ctx, chatID, adminInvite, domain.RoleAdmin, domain.RightInviteUsers, creator); err != nil {
		t.Fatal(err)
	}
	if err := g.SetRole(ctx, chatID, adminNoBit, domain.RoleAdmin, domain.RightPinMessages, creator); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name string
		user int64
		want bool
	}{
		{"создатель", creator, true},
		{"админ с invite_users", adminInvite, true},
		{"админ без invite_users", adminNoBit, false},
		{"рядовой", member, false},
		{"не участник", outsider, false},
	} {
		got, err := a.CanInvite(ctx, chatID, tc.user)
		if err != nil || got != tc.want {
			t.Errorf("%s: CanInvite = %v, %v, ждали %v", tc.name, got, err, tc.want)
		}
	}
}
