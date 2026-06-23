package auth

import (
	"context"
	"testing"
	"time"

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

	got, _, err := s.Authenticate(ctx, res.Token)
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

// fakeCache is an in-memory SessionCache for tests, counting lookups.
type fakeCache struct {
	m    map[string]CachedSession
	gets int
}

func newFakeCache() *fakeCache { return &fakeCache{m: map[string]CachedSession{}} }

func (f *fakeCache) GetSession(_ context.Context, h string) (*CachedSession, error) {
	f.gets++
	if s, ok := f.m[h]; ok {
		return &s, nil
	}
	return nil, nil
}
func (f *fakeCache) SetSession(_ context.Context, h string, s CachedSession, _ time.Duration) error {
	f.m[h] = s
	return nil
}
func (f *fakeCache) DelSession(_ context.Context, h string) error {
	delete(f.m, h)
	return nil
}

func TestService_AuthenticateUsesCache(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	cache := newFakeCache()
	s := NewService(repo, "12345", func(string, ...any) {})
	s.SetCache(cache)
	ctx := context.Background()

	_ = s.RequestCode(ctx, "+79991230000")
	res, err := s.SignIn(ctx, "+79991230000", "12345", "web", "browser")
	if err != nil {
		t.Fatalf("SignIn: %v", err)
	}
	// First auth: cache miss → populated.
	if _, _, err := s.Authenticate(ctx, res.Token); err != nil {
		t.Fatalf("auth 1: %v", err)
	}
	if len(cache.m) != 1 {
		t.Fatalf("cache not populated: %d entries", len(cache.m))
	}
	// Second auth: served from cache (cache consulted both times, still 1 entry).
	if _, _, err := s.Authenticate(ctx, res.Token); err != nil {
		t.Fatalf("auth 2: %v", err)
	}
	if cache.gets != 2 {
		t.Fatalf("expected 2 cache lookups, got %d", cache.gets)
	}
	if len(cache.m) != 1 {
		t.Fatalf("expected 1 cache entry, got %d", len(cache.m))
	}
}

func TestService_RevokeSession(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	cache := newFakeCache()
	s := NewService(repo, "12345", func(string, ...any) {})
	s.SetCache(cache)
	ctx := context.Background()

	_ = s.RequestCode(ctx, "+79991230001")
	res, _ := s.SignIn(ctx, "+79991230001", "12345", "web", "browser")
	_, deviceID, _ := s.Authenticate(ctx, res.Token) // populates cache

	sessions, err := s.ListSessions(ctx, res.User.ID)
	if err != nil || len(sessions) != 1 {
		t.Fatalf("ListSessions = %v, %v", sessions, err)
	}

	ok, err := s.RevokeSession(ctx, res.User.ID, deviceID)
	if err != nil || !ok {
		t.Fatalf("RevokeSession = %v, %v", ok, err)
	}
	// Token no longer authenticates and cache was evicted.
	if _, _, err := s.Authenticate(ctx, res.Token); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound after revoke, got %v", err)
	}
	if len(cache.m) != 0 {
		t.Fatalf("cache not evicted: %d entries", len(cache.m))
	}
}

type fakeRevoker struct{ revoked []int64 }

func (r *fakeRevoker) NotifyRevoked(_ context.Context, deviceID int64) error {
	r.revoked = append(r.revoked, deviceID)
	return nil
}

func TestService_RevokeNotifies(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(NewRepo(pool), "12345", func(string, ...any) {})
	rev := &fakeRevoker{}
	s.SetRevocationNotifier(rev)
	ctx := context.Background()

	_ = s.RequestCode(ctx, "+79991240000")
	res, _ := s.SignIn(ctx, "+79991240000", "12345", "web", "browser")
	_, deviceID, _ := s.Authenticate(ctx, res.Token)

	ok, err := s.RevokeSession(ctx, res.User.ID, deviceID)
	if err != nil || !ok {
		t.Fatalf("RevokeSession = %v, %v", ok, err)
	}
	if len(rev.revoked) != 1 || rev.revoked[0] != deviceID {
		t.Fatalf("notifier got %v; want [%d]", rev.revoked, deviceID)
	}
}
