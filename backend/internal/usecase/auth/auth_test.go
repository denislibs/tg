package auth

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeUserRepo upserts users by phone, assigning sequential ids.
type fakeUserRepo struct {
	byPhone map[string]domain.User
	nextID  int64
}

func newFakeUserRepo() *fakeUserRepo {
	return &fakeUserRepo{byPhone: map[string]domain.User{}, nextID: 1}
}

func (r *fakeUserRepo) UpsertByPhone(_ context.Context, phone string) (domain.User, error) {
	if u, ok := r.byPhone[phone]; ok {
		return u, nil
	}
	u := domain.User{ID: r.nextID, Phone: phone, DisplayName: phone}
	r.nextID++
	r.byPhone[phone] = u
	return u, nil
}

func (r *fakeUserRepo) find(id int64) (string, domain.User, bool) {
	for phone, u := range r.byPhone {
		if u.ID == id {
			return phone, u, true
		}
	}
	return "", domain.User{}, false
}

func (r *fakeUserRepo) GetByID(_ context.Context, id int64) (domain.User, error) {
	if _, u, ok := r.find(id); ok {
		return u, nil
	}
	return domain.User{}, domain.ErrNotFound
}

func (r *fakeUserRepo) UpdateProfile(_ context.Context, id int64, first, last, bio string, birthday *time.Time, pv string) (domain.User, error) {
	phone, u, ok := r.find(id)
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	u.FirstName, u.LastName, u.Bio = first, last, bio
	u.DisplayName = domain.BuildDisplayName(first, last)
	u.Birthday, u.PhoneVisibility = birthday, pv
	r.byPhone[phone] = u
	return u, nil
}

func (r *fakeUserRepo) UsernameAvailable(_ context.Context, username string, excludeID int64) (bool, error) {
	for _, u := range r.byPhone {
		if u.ID != excludeID && u.Username != nil && *u.Username == username {
			return false, nil
		}
	}
	return true, nil
}

func (r *fakeUserRepo) SetUsername(_ context.Context, id int64, username *string) (domain.User, error) {
	phone, u, ok := r.find(id)
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	if username != nil {
		for _, other := range r.byPhone {
			if other.ID != id && other.Username != nil && *other.Username == *username {
				return domain.User{}, domain.ErrConflict
			}
		}
	}
	u.Username = username
	r.byPhone[phone] = u
	return u, nil
}

func (r *fakeUserRepo) SetAvatar(_ context.Context, id int64, url string) (domain.User, error) {
	phone, u, ok := r.find(id)
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	u.AvatarURL = url
	r.byPhone[phone] = u
	return u, nil
}

// fakeDeviceRepo stores devices keyed by token hash and id.
type fakeDeviceRepo struct {
	byHash map[string]domain.Device
	byID   map[int64]domain.Device
	users  *fakeUserRepo
	nextID int64
	calls  int // SessionByTokenHash invocations
}

func newFakeDeviceRepo(users *fakeUserRepo) *fakeDeviceRepo {
	return &fakeDeviceRepo{byHash: map[string]domain.Device{}, byID: map[int64]domain.Device{}, users: users, nextID: 1}
}

func (r *fakeDeviceRepo) Create(_ context.Context, userID int64, name, platform, tokenHash string) (domain.Device, error) {
	d := domain.Device{ID: r.nextID, UserID: userID, Name: name, Platform: platform, TokenHash: tokenHash, LastActive: time.Now()}
	r.nextID++
	r.byHash[tokenHash] = d
	r.byID[d.ID] = d
	return d, nil
}

func (r *fakeDeviceRepo) SessionByTokenHash(_ context.Context, tokenHash string) (domain.User, int64, error) {
	r.calls++
	d, ok := r.byHash[tokenHash]
	if !ok {
		return domain.User{}, 0, domain.ErrNotFound
	}
	var u domain.User
	for _, usr := range r.users.byPhone {
		if usr.ID == d.UserID {
			u = usr
			break
		}
	}
	return u, d.ID, nil
}

func (r *fakeDeviceRepo) ListByUser(_ context.Context, userID int64) ([]domain.Device, error) {
	var out []domain.Device
	for _, d := range r.byID {
		if d.UserID == userID {
			out = append(out, d)
		}
	}
	return out, nil
}

func (r *fakeDeviceRepo) Delete(_ context.Context, userID, deviceID int64) (string, bool, error) {
	d, ok := r.byID[deviceID]
	if !ok || d.UserID != userID {
		return "", false, nil
	}
	delete(r.byID, deviceID)
	delete(r.byHash, d.TokenHash)
	return d.TokenHash, true, nil
}

// fakeCodeRepo stores codes with expiry.
type fakeCodeRepo struct {
	m map[string]struct {
		code    string
		expires time.Time
	}
}

func newFakeCodeRepo() *fakeCodeRepo {
	return &fakeCodeRepo{m: map[string]struct {
		code    string
		expires time.Time
	}{}}
}

func (r *fakeCodeRepo) SaveCode(_ context.Context, phone, code string, expires time.Time) error {
	r.m[phone] = struct {
		code    string
		expires time.Time
	}{code, expires}
	return nil
}

func (r *fakeCodeRepo) GetCode(_ context.Context, phone string) (string, error) {
	e, ok := r.m[phone]
	if !ok || time.Now().After(e.expires) {
		return "", domain.ErrNotFound
	}
	return e.code, nil
}

func (r *fakeCodeRepo) DeleteCode(_ context.Context, phone string) error {
	delete(r.m, phone)
	return nil
}

// fakeCache is an in-memory SessionCache counting lookups.
type fakeCache struct {
	m    map[string]domain.Session
	gets int
}

func newFakeCache() *fakeCache { return &fakeCache{m: map[string]domain.Session{}} }

func (f *fakeCache) GetSession(_ context.Context, h string) (*domain.Session, error) {
	f.gets++
	if s, ok := f.m[h]; ok {
		return &s, nil
	}
	return nil, nil
}
func (f *fakeCache) SetSession(_ context.Context, h string, s domain.Session, _ time.Duration) error {
	f.m[h] = s
	return nil
}
func (f *fakeCache) DelSession(_ context.Context, h string) error {
	delete(f.m, h)
	return nil
}

type fakeRevoker struct{ revoked []int64 }

func (r *fakeRevoker) NotifyRevoked(_ context.Context, deviceID int64) error {
	r.revoked = append(r.revoked, deviceID)
	return nil
}

func newInteractor() (*Interactor, *fakeUserRepo, *fakeDeviceRepo, *fakeCodeRepo) {
	users := newFakeUserRepo()
	devices := newFakeDeviceRepo(users)
	codes := newFakeCodeRepo()
	i := New(users, devices, codes, "12345", func(string, ...any) {})
	return i, users, devices, codes
}

func TestRequestAndSignIn(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	if err := i.RequestCode(ctx, "+7 (999) 000-00-00"); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	res, err := i.SignIn(ctx, "+79990000000", "12345", "web", "browser")
	if err != nil {
		t.Fatalf("SignIn: %v", err)
	}
	if res.Token == "" || res.User.ID == 0 {
		t.Fatalf("empty result: %+v", res)
	}

	got, _, err := i.Authenticate(ctx, res.Token)
	if err != nil || got.ID != res.User.ID {
		t.Fatalf("Authenticate = %+v, %v", got, err)
	}
}

func TestWrongCode(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	_ = i.RequestCode(ctx, "+79991112233")
	if _, err := i.SignIn(ctx, "+79991112233", "00000", "web", "browser"); err != domain.ErrInvalidCode {
		t.Fatalf("expected ErrInvalidCode, got %v", err)
	}
}

func TestNoCodeRequested(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	if _, err := i.SignIn(ctx, "+79994445566", "12345", "web", "browser"); err != domain.ErrInvalidCode {
		t.Fatalf("expected ErrInvalidCode, got %v", err)
	}
}

func TestAuthenticateUsesCache(t *testing.T) {
	ctx := context.Background()
	i, _, devices, _ := newInteractor()
	cache := newFakeCache()
	i.SetCache(cache)

	_ = i.RequestCode(ctx, "+79991230000")
	res, err := i.SignIn(ctx, "+79991230000", "12345", "web", "browser")
	if err != nil {
		t.Fatalf("SignIn: %v", err)
	}

	// First auth: cache miss -> populated via repo.
	if _, _, err := i.Authenticate(ctx, res.Token); err != nil {
		t.Fatalf("auth 1: %v", err)
	}
	if len(cache.m) != 1 {
		t.Fatalf("cache not populated: %d entries", len(cache.m))
	}
	repoCalls := devices.calls

	// Second auth: served from cache, repo not consulted again.
	if _, _, err := i.Authenticate(ctx, res.Token); err != nil {
		t.Fatalf("auth 2: %v", err)
	}
	if cache.gets != 2 {
		t.Fatalf("expected 2 cache lookups, got %d", cache.gets)
	}
	if devices.calls != repoCalls {
		t.Fatalf("expected repo not consulted on cache hit, calls %d -> %d", repoCalls, devices.calls)
	}
	if len(cache.m) != 1 {
		t.Fatalf("expected 1 cache entry, got %d", len(cache.m))
	}
}

func TestRevokeSession(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	cache := newFakeCache()
	rev := &fakeRevoker{}
	i.SetCache(cache)
	i.SetRevocationNotifier(rev)

	_ = i.RequestCode(ctx, "+79991230001")
	res, _ := i.SignIn(ctx, "+79991230001", "12345", "web", "browser")
	_, deviceID, _ := i.Authenticate(ctx, res.Token) // populates cache

	sessions, err := i.ListSessions(ctx, res.User.ID)
	if err != nil || len(sessions) != 1 {
		t.Fatalf("ListSessions = %v, %v", sessions, err)
	}

	ok, err := i.RevokeSession(ctx, res.User.ID, deviceID)
	if err != nil || !ok {
		t.Fatalf("RevokeSession = %v, %v", ok, err)
	}
	// Token no longer authenticates and cache was evicted.
	if _, _, err := i.Authenticate(ctx, res.Token); err != domain.ErrNotFound {
		t.Fatalf("expected ErrNotFound after revoke, got %v", err)
	}
	if len(cache.m) != 0 {
		t.Fatalf("cache not evicted: %d entries", len(cache.m))
	}
	if len(rev.revoked) != 1 || rev.revoked[0] != deviceID {
		t.Fatalf("notifier got %v; want [%d]", rev.revoked, deviceID)
	}
}

func TestListSessions(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	_ = i.RequestCode(ctx, "+79990000001")
	res, _ := i.SignIn(ctx, "+79990000001", "12345", "web", "browser")
	_, _ = i.SignIn(ctx, "+79990000001", "12345", "phone", "ios") // code consumed; re-request

	_ = i.RequestCode(ctx, "+79990000001")
	_, _ = i.SignIn(ctx, "+79990000001", "12345", "phone", "ios")

	sessions, err := i.ListSessions(ctx, res.User.ID)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
}
