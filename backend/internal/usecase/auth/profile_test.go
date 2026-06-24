package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// seedUser signs a user in and returns their id.
func seedUser(t *testing.T, i *Interactor, phone string) int64 {
	t.Helper()
	ctx := context.Background()
	if err := i.RequestCode(ctx, phone); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	res, err := i.SignIn(ctx, phone, "12345", "web", "browser")
	if err != nil {
		t.Fatalf("SignIn: %v", err)
	}
	return res.User.ID
}

func TestUpdateProfile(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	id := seedUser(t, i, "+79990000001")

	bday := time.Date(2000, 3, 15, 0, 0, 0, 0, time.UTC)
	u, err := i.UpdateProfile(ctx, id, ProfileInput{FirstName: "  Denis ", LastName: "M", Bio: "hi", Birthday: &bday})
	if err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}
	if u.FirstName != "Denis" || u.LastName != "M" {
		t.Fatalf("names not trimmed/stored: %+v", u)
	}
	if u.DisplayName != "Denis M" {
		t.Fatalf("display name = %q, want %q", u.DisplayName, "Denis M")
	}
	if u.PhoneVisibility != domain.PhoneVisibilityContacts {
		t.Fatalf("default phone visibility = %q", u.PhoneVisibility)
	}

	if _, err := i.UpdateProfile(ctx, id, ProfileInput{FirstName: "   "}); err == nil {
		t.Fatal("expected error for blank first name")
	}
	if _, err := i.UpdateProfile(ctx, id, ProfileInput{FirstName: "A", PhoneVisibility: "bogus"}); err == nil {
		t.Fatal("expected error for invalid phone visibility")
	}
}

func TestSetUsername(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	a := seedUser(t, i, "+79990000001")
	b := seedUser(t, i, "+79990000002")

	if _, err := i.SetUsername(ctx, a, "Denis_M"); err != nil {
		t.Fatalf("SetUsername a: %v", err)
	}
	ua, _ := i.GetUser(ctx, a)
	if ua.Username == nil || *ua.Username != "denis_m" {
		t.Fatalf("username not normalized/stored: %+v", ua.Username)
	}

	// Taken (case-insensitive).
	if _, err := i.SetUsername(ctx, b, "DENIS_M"); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("expected ErrConflict, got %v", err)
	}
	// Bad format.
	if _, err := i.SetUsername(ctx, b, "ab"); !errors.Is(err, domain.ErrUsernameFormat) {
		t.Fatalf("expected ErrUsernameFormat, got %v", err)
	}
	// Clear.
	if u, err := i.SetUsername(ctx, a, ""); err != nil || u.Username != nil {
		t.Fatalf("clear username: err=%v username=%v", err, u.Username)
	}
}

func TestCheckUsername(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	a := seedUser(t, i, "+79990000001")
	b := seedUser(t, i, "+79990000002")
	if _, err := i.SetUsername(ctx, a, "taken_one"); err != nil {
		t.Fatalf("seed username: %v", err)
	}

	if ok, _ := i.CheckUsername(ctx, "free_one", b); !ok {
		t.Fatal("free_one should be available")
	}
	if ok, _ := i.CheckUsername(ctx, "taken_one", b); ok {
		t.Fatal("taken_one should be unavailable")
	}
	// Own username counts as available.
	if ok, _ := i.CheckUsername(ctx, "taken_one", a); !ok {
		t.Fatal("own username should be available to self")
	}
	if _, err := i.CheckUsername(ctx, "no", b); !errors.Is(err, domain.ErrUsernameFormat) {
		t.Fatalf("expected format error, got %v", err)
	}
}
