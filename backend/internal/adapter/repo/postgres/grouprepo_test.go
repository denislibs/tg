package postgres

import (
	"context"
	"testing"
	"time"

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

	if err := r.SetMuted(ctx, chatID, u2, true, nil); err != nil {
		t.Fatal(err)
	}
	m3, _ := r.GetMember(ctx, chatID, u2)
	if !m3.Muted {
		t.Fatal("mute not set")
	}

	// Временный mute: muted=false + muted_until в будущем → эффективно muted;
	// muted_until в прошлом → нет.
	future := time.Now().Add(time.Hour)
	if err := r.SetMuted(ctx, chatID, u2, false, &future); err != nil {
		t.Fatal(err)
	}
	m4, _ := r.GetMember(ctx, chatID, u2)
	if !m4.Muted {
		t.Fatal("temporary mute not effective")
	}
	past := time.Now().Add(-time.Hour)
	if err := r.SetMuted(ctx, chatID, u2, false, &past); err != nil {
		t.Fatal(err)
	}
	m5, _ := r.GetMember(ctx, chatID, u2)
	if m5.Muted {
		t.Fatal("expired mute still effective")
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

	// Discussion chat id is exposed on the card: a default channel reports 0,
	// and once a discussion group is linked the card reflects it.
	chID, err := r.CreateMultiMember(ctx, "channel", "My Channel", "", "", true, u1)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.AddMember(ctx, chID, u1, domain.RoleCreator, domain.AllRights); err != nil {
		t.Fatal(err)
	}
	cc, err := r.Card(ctx, chID, u1)
	if err != nil {
		t.Fatal(err)
	}
	if cc.DiscussionChatID != 0 {
		t.Fatalf("default channel DiscussionChatID = %d, want 0", cc.DiscussionChatID)
	}

	grpID, err := r.CreateMultiMember(ctx, "group", "Discussion Group", "", "", false, u1)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.SetDiscussion(ctx, chID, grpID); err != nil {
		t.Fatal(err)
	}
	cc2, err := r.Card(ctx, chID, u1)
	if err != nil {
		t.Fatal(err)
	}
	if cc2.DiscussionChatID != grpID {
		t.Fatalf("linked channel DiscussionChatID = %d, want %d", cc2.DiscussionChatID, grpID)
	}
}
