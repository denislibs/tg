package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Cards — один сборщик карточек чатов глазами зрителя (A1-01): порядок ids,
// допуск (Hidden → честный min), связанный чат в обе стороны (A1-25).
func TestGroupRepo_Cards(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7400")
	viewer := seedUser(t, pool, "+7401")
	g := NewGroupRepo(pool)

	pub, _ := g.CreateMultiMember(ctx, "group", "Публичная", "", "pub400", true, owner)
	priv, _ := g.CreateMultiMember(ctx, "group", "Приватная", "", "", false, owner)
	mine, _ := g.CreateMultiMember(ctx, "group", "Моя", "", "", false, owner)
	_ = g.AddMember(ctx, mine, viewer, "member", 0)
	banned, _ := g.CreateMultiMember(ctx, "group", "Бан", "", "ban400", true, owner)
	_ = g.Ban(ctx, banned, viewer, owner)
	ch, _ := g.CreateMultiMember(ctx, "channel", "Канал", "", "ch400", true, owner)
	disc, _ := g.CreateMultiMember(ctx, "group", "Обсуждение", "", "", false, owner)
	_ = g.SetDiscussion(ctx, ch, disc)

	cards, err := g.Cards(ctx, viewer, []int64{priv, pub, 999999, mine, banned, disc, ch, pub})
	if err != nil {
		t.Fatal(err)
	}
	want := []struct {
		id     int64
		hidden bool
		linked int64
	}{{priv, true, 0}, {pub, false, 0}, {mine, false, 0}, {banned, true, 0}, {disc, false, ch}, {ch, false, disc}}
	if len(cards) != len(want) {
		t.Fatalf("Cards = %d строк, want %d (отсутствующий и повтор пропущены)", len(cards), len(want))
	}
	for k, w := range want {
		c := cards[k]
		if c.ID != w.id || c.Hidden != w.hidden || c.ToChannelFull().LinkedChatID != w.linked {
			t.Errorf("#%d: id=%d hidden=%v linked=%d, want id=%d hidden=%v linked=%d",
				k, c.ID, c.Hidden, c.ToChannelFull().LinkedChatID, w.id, w.hidden, w.linked)
		}
	}
	// Публичная группа, где зритель не состоит: полная форма с left и
	// настройками группы — не «запрещено всё».
	pubCh := cards[1].ToChannel()
	if pubCh.PFlags["min"] || !pubCh.Left() || pubCh.DefaultBanned == nil || pubCh.DefaultBanned.Denies("send_messages") {
		t.Fatalf("публичная группа не-участнику: %+v", pubCh)
	}
	// Приватная — честный min без прав.
	if privCh := cards[0].ToChannel(); !privCh.PFlags["min"] || privCh.DefaultBanned != nil {
		t.Fatalf("приватная группа не-участнику: %+v, want min без default_banned_rights", privCh)
	}
	// Одиночная Card — тот же сборщик.
	one, err := g.Card(ctx, disc, viewer)
	if err != nil || one.ToChannelFull().LinkedChatID != ch || one.Hidden {
		t.Fatalf("Card(обсуждение) = %+v %v", one, err)
	}
}

// A4-08: сборщик карточки `user` глазами зрителя ставит pFlags.self своей
// карточке на любой витрине (не только /me) и читает номер скрытым — наружу
// его выпускает только правило приватности (domain.UserViewRules).
func TestUsersByIDs_SelfAndHiddenPhone(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	me := seedUser(t, pool, "+7410")
	other := seedUser(t, pool, "+7411")
	cards, err := NewGroupRepo(pool).UsersByIDs(ctx, me, []int64{me, other})
	if err != nil || len(cards) != 2 {
		t.Fatalf("UsersByIDs = %+v %v", cards, err)
	}
	for _, u := range cards {
		if u.Self() != (u.ID == me) {
			t.Errorf("user %d: self=%v", u.ID, u.Self())
		}
		if u.Phone != "" {
			t.Errorf("user %d: номер показан мимо правила: %q", u.ID, u.Phone)
		}
	}
	domain.UserViewRules{ViewerID: me, Photo: map[int64]bool{}, Phone: map[int64]bool{}, LastSeen: map[int64]bool{}}.Apply(cards)
	for _, u := range cards {
		if (u.Phone != "") != (u.ID == me) {
			t.Errorf("user %d после правила: phone=%q", u.ID, u.Phone)
		}
	}
}

// A4-19: userFull — общие группы/каналы и уведомления лички зрителя с пиром.
func TestPrivacyRepo_PeerFullState(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+7420")
	b := seedUser(t, pool, "+7421")
	g := NewGroupRepo(pool)
	shared, _ := g.CreateMultiMember(ctx, "group", "Общая", "", "", false, a)
	_ = g.AddMember(ctx, shared, a, "creator", 0)
	_ = g.AddMember(ctx, shared, b, "member", 0)
	alone, _ := g.CreateMultiMember(ctx, "channel", "Своя", "", "", false, a)
	_ = g.AddMember(ctx, alone, a, "creator", 0)
	if _, err := NewChatsRepo(pool).CreatePrivate(ctx, a, b); err != nil {
		t.Fatal(err)
	}
	r := NewPrivacyRepo(pool)
	st, err := r.PeerFullState(ctx, a, b)
	if err != nil {
		t.Fatal(err)
	}
	if st.CommonChats != 1 || st.NotifySettings == nil || st.PinnedMsgID != 0 {
		t.Fatalf("PeerFullState = %+v, want 1 общий чат и notify_settings", st)
	}
	self, err := r.PeerFullState(ctx, a, a)
	if err != nil || self.CommonChats != 0 || self.NotifySettings != nil {
		t.Fatalf("себе: %+v %v, want без общих чатов и notify_settings", self, err)
	}
}
