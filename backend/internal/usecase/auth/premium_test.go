package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakePremiumRepo is an in-memory PremiumRepo keyed by user id.
type fakePremiumRepo struct{ byUser map[int64]domain.PremiumSubscription }

func newFakePremiumRepo() *fakePremiumRepo {
	return &fakePremiumRepo{byUser: map[int64]domain.PremiumSubscription{}}
}

func (r *fakePremiumRepo) GetPremiumSubscription(_ context.Context, userID int64) (domain.PremiumSubscription, error) {
	if s, ok := r.byUser[userID]; ok {
		return s, nil
	}
	return domain.PremiumSubscription{}, domain.ErrNotFound
}

func (r *fakePremiumRepo) UpsertPremiumSubscription(_ context.Context, sub domain.PremiumSubscription) (domain.PremiumSubscription, error) {
	r.byUser[sub.UserID] = sub
	return sub, nil
}

func (r *fakePremiumRepo) SetPremiumAutoRenew(_ context.Context, userID int64, autoRenew bool) (domain.PremiumSubscription, error) {
	s, ok := r.byUser[userID]
	if !ok {
		return domain.PremiumSubscription{}, domain.ErrNotFound
	}
	s.AutoRenew = autoRenew
	r.byUser[userID] = s
	return s, nil
}

func newPremiumInteractor(t *testing.T) (*Interactor, int64) {
	t.Helper()
	users := newFakeUserRepo()
	u, _ := users.UpsertByPhone(context.Background(), "+70000000001")
	i := New(users, nil, nil, nil, "12345", func(string, ...any) {})
	i.SetPremiumRepo(newFakePremiumRepo())
	return i, u.ID
}

func TestCheckoutPremium_NewSubscription(t *testing.T) {
	i, id := newPremiumInteractor(t)
	before := time.Now().UTC()
	user, sub, err := i.CheckoutPremium(context.Background(), id, "6m")
	if err != nil {
		t.Fatalf("checkout: %v", err)
	}
	if !user.IsPremium {
		t.Fatal("expected user to become premium")
	}
	if sub.Plan != "6m" || sub.PriceCents != 2499 {
		t.Fatalf("unexpected plan/price: %+v", sub)
	}
	if !sub.AutoRenew {
		t.Fatal("expected auto-renew on")
	}
	// ~6 months out from now (allow the day the test runs).
	want := before.AddDate(0, 6, 0)
	if sub.ExpiresAt.Before(want.Add(-24*time.Hour)) || sub.ExpiresAt.After(want.Add(24*time.Hour)) {
		t.Fatalf("expiry %v not ~6 months from %v", sub.ExpiresAt, before)
	}
}

func TestCheckoutPremium_StacksOntoActive(t *testing.T) {
	i, id := newPremiumInteractor(t)
	_, first, err := i.CheckoutPremium(context.Background(), id, "1m")
	if err != nil {
		t.Fatalf("first checkout: %v", err)
	}
	// Buying again while active extends from the current expiry, not from now.
	_, second, err := i.CheckoutPremium(context.Background(), id, "12m")
	if err != nil {
		t.Fatalf("second checkout: %v", err)
	}
	want := first.ExpiresAt.AddDate(0, 12, 0)
	if !second.ExpiresAt.Equal(want) {
		t.Fatalf("expiry %v, want stacked %v", second.ExpiresAt, want)
	}
}

func TestCheckoutPremium_InvalidPlan(t *testing.T) {
	i, id := newPremiumInteractor(t)
	if _, _, err := i.CheckoutPremium(context.Background(), id, "nope"); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("want ErrInvalid, got %v", err)
	}
}

func TestCancelPremiumAutoRenew(t *testing.T) {
	i, id := newPremiumInteractor(t)
	if _, _, err := i.CheckoutPremium(context.Background(), id, "1m"); err != nil {
		t.Fatalf("checkout: %v", err)
	}
	sub, err := i.CancelPremiumAutoRenew(context.Background(), id)
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if sub.AutoRenew {
		t.Fatal("expected auto-renew off after cancel")
	}
}

func TestCancelPremiumAutoRenew_NoSubscription(t *testing.T) {
	i, id := newPremiumInteractor(t)
	if _, err := i.CancelPremiumAutoRenew(context.Background(), id); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestPremiumPlanByID(t *testing.T) {
	for _, id := range []string{"1m", "6m", "12m"} {
		if p, ok := domain.PremiumPlanByID(id); !ok || p.ID != id {
			t.Fatalf("plan %q missing", id)
		}
	}
	if _, ok := domain.PremiumPlanByID("bogus"); ok {
		t.Fatal("bogus plan should not resolve")
	}
}
