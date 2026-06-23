package auth

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func newTestService(t *testing.T) *Service {
	pool := postgres.NewTestDB(t)
	return NewService(NewRepo(pool), "12345", func(string, ...any) {})
}

func TestService_RequestAndSignIn(t *testing.T) {
	ctx := context.Background()
	s := newTestService(t)

	if err := s.RequestCode(ctx, "+7 (999) 000-00-00"); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	res, err := s.SignIn(ctx, "+79990000000", "12345", "web", "browser")
	if err != nil {
		t.Fatalf("SignIn: %v", err)
	}
	if res.Token == "" || res.User.ID == 0 {
		t.Fatalf("empty result: %+v", res)
	}

	got, err := s.Authenticate(ctx, res.Token)
	if err != nil || got.ID != res.User.ID {
		t.Fatalf("Authenticate = %+v, %v", got, err)
	}
}

func TestService_WrongCode(t *testing.T) {
	ctx := context.Background()
	s := newTestService(t)
	_ = s.RequestCode(ctx, "+79991112233")
	if _, err := s.SignIn(ctx, "+79991112233", "00000", "web", "browser"); err != ErrInvalidCode {
		t.Fatalf("expected ErrInvalidCode, got %v", err)
	}
}

func TestService_NoCodeRequested(t *testing.T) {
	ctx := context.Background()
	s := newTestService(t)
	if _, err := s.SignIn(ctx, "+79994445566", "12345", "web", "browser"); err != ErrInvalidCode {
		t.Fatalf("expected ErrInvalidCode, got %v", err)
	}
}
