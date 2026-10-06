package postgres

import (
	"context"
	"errors"
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

	if err := r.SetRole(ctx, chatID, u2, domain.RoleAdmin, domain.RightPostMessages, u1); err != nil {
		t.Fatal(err)
	}
	m2, _ := r.GetMember(ctx, chatID, u2)
	if m2.Role != domain.RoleAdmin || m2.Rights != domain.RightPostMessages || m2.PromotedBy != u1 {
		t.Fatalf("promote: %+v", m2)
	}
	// Не участник — ErrNotFound, а не тихий успех (A5-36: «невидимый админ»).
	if err := r.SetRole(ctx, chatID, 987654321, domain.RoleAdmin, domain.RightPostMessages, u1); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("SetRole не-участника = %v, ждали ErrNotFound", err)
	}

	// Мьют — СРОК, а не булево: «навсегда» это domain.MuteUntilForever, и
	// временный мьют доезжает наружу вместе со своим сроком. Прежде витрина
	// схлопывала его в булево, и «заглушить на час» работало как «навсегда».
	forever := time.Unix(domain.MuteUntilForever, 0)
	if err := r.SetMuted(ctx, chatID, u2, &forever); err != nil {
		t.Fatal(err)
	}
	ns, err := r.NotifySettings(ctx, chatID, u2)
	if err != nil {
		t.Fatalf("NotifySettings: %v", err)
	}
	if ns.MuteUntil == nil || *ns.MuteUntil != domain.MuteUntilForever {
		t.Fatalf("«навсегда» = %v; want срок %d", ns.MuteUntil, domain.MuteUntilForever)
	}
	if !ns.Muted(time.Now()) {
		t.Fatal("mute not set")
	}

	future := time.Now().Add(time.Hour).Truncate(time.Second)
	if err := r.SetMuted(ctx, chatID, u2, &future); err != nil {
		t.Fatal(err)
	}
	ns, _ = r.NotifySettings(ctx, chatID, u2)
	if !ns.Muted(time.Now()) {
		t.Fatal("temporary mute not effective")
	}
	// Срок обязан доехать НАРУЖУ: без него клиент не покажет «до 15:00» и не
	// погасит иконку в назначенный час сам.
	if ns.MuteUntil == nil || int64(*ns.MuteUntil) != future.Unix() {
		t.Fatalf("срок временного мьюта = %v; want %d", ns.MuteUntil, future.Unix())
	}
	past := time.Now().Add(-time.Hour)
	if err := r.SetMuted(ctx, chatID, u2, &past); err != nil {
		t.Fatal(err)
	}
	ns, _ = r.NotifySettings(ctx, chatID, u2)
	if ns.Muted(time.Now()) {
		t.Fatal("expired mute still effective")
	}
	if err := r.SetMuted(ctx, chatID, u2, nil); err != nil {
		t.Fatal(err)
	}
	ns, _ = r.NotifySettings(ctx, chatID, u2)
	if ns.MuteUntil != nil {
		t.Fatalf("снятый мьют = %v; want отсутствие переопределения", ns.MuteUntil)
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

	cards, err := r.UsersByIDs(ctx, 0, []int64{u1, u2})
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

func TestGroupRepo_Restrictions(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	admin := seedUser(t, pool, "+7101")
	target := seedUser(t, pool, "+7102")
	r := NewGroupRepo(pool)

	chatID, err := r.CreateMultiMember(ctx, "group", "G", "", "", false, admin)
	if err != nil {
		t.Fatal(err)
	}

	// No restriction yet.
	if _, ok, err := r.GetRestriction(ctx, chatID, target); err != nil || ok {
		t.Fatalf("unexpected restriction: ok=%v err=%v", ok, err)
	}

	until := time.Now().Add(time.Hour)
	res := domain.MemberRestriction{
		ChatID: chatID, UserID: target,
		DeniedRights: domain.PermSendMedia | domain.PermPinMessages,
		UntilDate:    &until, RestrictedBy: admin,
	}
	if err := r.SetRestriction(ctx, res); err != nil {
		t.Fatal(err)
	}
	got, ok, err := r.GetRestriction(ctx, chatID, target)
	if err != nil || !ok {
		t.Fatalf("get after set: ok=%v err=%v", ok, err)
	}
	if got.DeniedRights != res.DeniedRights || got.UntilDate == nil || got.RestrictedBy != admin {
		t.Fatalf("restriction roundtrip: %+v", got)
	}
	if !got.Active(time.Now()) {
		t.Fatal("restriction should be active")
	}

	// UPSERT: change denied rights + make indefinite.
	res.DeniedRights = domain.PermSendMessages
	res.UntilDate = nil
	if err := r.SetRestriction(ctx, res); err != nil {
		t.Fatal(err)
	}
	got2, _, _ := r.GetRestriction(ctx, chatID, target)
	if got2.DeniedRights != domain.PermSendMessages || got2.UntilDate != nil {
		t.Fatalf("upsert: %+v", got2)
	}

	if err := r.AddMember(ctx, chatID, target, domain.RoleMember, 0); err != nil {
		t.Fatal(err)
	}
	list, total, err := r.ListParticipants(ctx, chatID, admin, domain.ParticipantsFilter{Kind: domain.ParticipantsBanned}, 0, 50)
	if err != nil || total != 1 || len(list) != 1 || list[0].UserID != target || list[0].Restriction == nil {
		t.Fatalf("list: %v %+v", err, list)
	}

	if err := r.DeleteRestriction(ctx, chatID, target); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := r.GetRestriction(ctx, chatID, target); ok {
		t.Fatal("restriction should be gone")
	}
}

// ListParticipants с q — `channelParticipantsSearch` поиска по чату (выбор
// отправителя, tweb `topbarSearch.tsx:184-190`): префикс имени профиля или
// @username, без учёта регистра; пустой query — все участники.
func TestGroupRepo_ListParticipantsSearch(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	alice := seedUser(t, pool, "+7101")
	bob := seedUser(t, pool, "+7102")
	carol := seedUser(t, pool, "+7103")
	if _, err := pool.Exec(ctx, `UPDATE users SET display_name='Alice Liddell' WHERE id=$1`, alice); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET display_name='Bob', username='bobby' WHERE id=$1`, bob); err != nil {
		t.Fatal(err)
	}
	r := NewGroupRepo(pool)
	chatID, err := r.CreateMultiMember(ctx, "group", "G", "", "", false, alice)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []int64{alice, bob, carol} {
		if err := r.AddMember(ctx, chatID, id, domain.RoleMember, 0); err != nil {
			t.Fatal(err)
		}
	}

	ids := func(query string) []int64 {
		t.Helper()
		ms, _, err := r.ListParticipants(ctx, chatID, 0, domain.ParticipantsFilter{Kind: domain.ParticipantsSearch, Q: query}, 0, 50)
		if err != nil {
			t.Fatal(err)
		}
		out := make([]int64, 0, len(ms))
		for _, m := range ms {
			out = append(out, m.UserID)
		}
		return out
	}

	if got := ids(""); len(got) != 3 {
		t.Fatalf("пустой query: %v, want все 3", got)
	}
	if got := ids("ali"); len(got) != 1 || got[0] != alice {
		t.Fatalf("query «ali»: %v, want [%d]", got, alice)
	}
	if got := ids("BOBB"); len(got) != 1 || got[0] != bob {
		t.Fatalf("query «BOBB» по @username: %v, want [%d]", got, bob)
	}
	if got := ids("liddell"); len(got) != 0 {
		t.Fatalf("query «liddell» (не префикс): %v, want пусто", got)
	}
}
