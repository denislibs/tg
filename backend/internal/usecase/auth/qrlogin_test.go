package auth

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeQRStoreTTL is an in-memory QRStore keyed by token hash.
type fakeQRStoreTTL struct{ m map[string]domain.QRLogin }

func newFakeQRStoreTTL() *fakeQRStoreTTL { return &fakeQRStoreTTL{m: map[string]domain.QRLogin{}} }

func (s *fakeQRStoreTTL) Put(_ context.Context, h string, r domain.QRLogin, _ time.Duration) error {
	s.m[h] = r
	return nil
}
func (s *fakeQRStoreTTL) Get(_ context.Context, h string) (domain.QRLogin, error) {
	r, ok := s.m[h]
	if !ok {
		return domain.QRLogin{}, domain.ErrNotFound
	}
	return r, nil
}
func (s *fakeQRStoreTTL) Delete(_ context.Context, h string) error { delete(s.m, h); return nil }

func TestQRLogin_NewStatusConfirmFlow(t *testing.T) {
	users := newFakeUserRepo()
	devices := newFakeDeviceRepo(users)
	i := New(users, devices, nil, "12345", func(string, ...any) {})

	ctx := context.Background()
	// No QRStore configured → unavailable.
	if _, _, err := i.NewQRLogin(ctx, "web"); err != ErrQRUnavailable {
		t.Fatalf("NewQRLogin without store: got %v, want ErrQRUnavailable", err)
	}

	store := newFakeQRStoreTTL()
	i.SetQRStore(store)

	// Generate a pending record.
	token, _, err := i.NewQRLogin(ctx, "web")
	if err != nil {
		t.Fatalf("NewQRLogin: %v", err)
	}
	if token == "" {
		t.Fatal("expected a non-empty token")
	}
	st, err := i.QRStatus(ctx, token)
	if err != nil || st.Status != domain.QRPending {
		t.Fatalf("QRStatus pending: status=%q err=%v", st.Status, err)
	}

	// An authenticated user confirms.
	confirming := domain.User{ID: 7, Phone: "+700", DisplayName: "+700"}
	if err := i.ConfirmQRLogin(ctx, token, confirming); err != nil {
		t.Fatalf("ConfirmQRLogin: %v", err)
	}
	// A device/session was minted for the confirming user.
	if devices.nextID == 1 {
		t.Fatal("expected a device to be created on confirm")
	}

	// Desktop reads the result once → confirmed + a working session token; reading
	// again is gone (single-use).
	st, err = i.QRStatus(ctx, token)
	if err != nil {
		t.Fatalf("QRStatus after confirm: %v", err)
	}
	if st.Status != domain.QRConfirmed || st.SessionToken == "" || st.User.ID != 7 {
		t.Fatalf("confirmed status wrong: %+v", st)
	}
	if _, _, err := i.Authenticate(ctx, st.SessionToken); err != nil {
		t.Fatalf("minted session token should authenticate: %v", err)
	}
	if _, err := i.QRStatus(ctx, token); err != domain.ErrNotFound {
		t.Fatalf("second read should be ErrNotFound (single-use), got %v", err)
	}

	// Confirming an unknown token → ErrNotFound.
	if err := i.ConfirmQRLogin(ctx, "deadbeef", confirming); err != domain.ErrNotFound {
		t.Fatalf("confirm unknown token: got %v, want ErrNotFound", err)
	}
}
