package auth

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeUserRepo upserts users by phone, assigning sequential ids.
type fakeUserRepo struct {
	byPhone     map[string]domain.User
	nextID      int64
	photos      map[int64][]domain.ProfilePhoto // by userID, newest last
	nextPhotoID int64
}

func newFakeUserRepo() *fakeUserRepo {
	return &fakeUserRepo{byPhone: map[string]domain.User{}, nextID: 1, photos: map[int64][]domain.ProfilePhoto{}, nextPhotoID: 1}
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

func (r *fakeUserRepo) PhoneInUse(_ context.Context, phone string, excludeID int64) (bool, error) {
	u, ok := r.byPhone[phone]
	return ok && u.ID != excludeID, nil
}

func (r *fakeUserRepo) UpdatePhone(_ context.Context, id int64, phone string) (domain.User, error) {
	if other, ok := r.byPhone[phone]; ok && other.ID != id {
		return domain.User{}, domain.ErrConflict
	}
	oldPhone, u, ok := r.find(id)
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	delete(r.byPhone, oldPhone)
	u.Phone = phone
	r.byPhone[phone] = u
	return u, nil
}

func (r *fakeUserRepo) SoftDelete(_ context.Context, id int64) error {
	oldPhone, u, ok := r.find(id)
	if !ok {
		return domain.ErrNotFound
	}
	delete(r.byPhone, oldPhone)
	u.Phone = ""
	u.Username = nil
	u.FirstName, u.LastName = "Deleted", "Account"
	u.DisplayName = "Deleted Account"
	u.Bio, u.AvatarURL, u.EmojiStatus = "", "", ""
	// Re-key under a unique sentinel so multiple deleted users can coexist
	// (the real store keys on id; the fake keys on phone).
	r.byPhone["deleted:"+strconv.FormatInt(id, 10)] = u
	return nil
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

func (r *fakeUserRepo) SetEmojiStatus(_ context.Context, id int64, emoji string) (domain.User, error) {
	phone, u, ok := r.find(id)
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	u.EmojiStatus = emoji
	r.byPhone[phone] = u
	return u, nil
}

func (r *fakeUserRepo) SetPremium(_ context.Context, id int64, premium bool) (domain.User, error) {
	phone, u, ok := r.find(id)
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	u.IsPremium = premium
	r.byPhone[phone] = u
	return u, nil
}

func (r *fakeUserRepo) AddProfilePhoto(_ context.Context, userID int64, url, videoURL string) (domain.ProfilePhoto, error) {
	phone, u, ok := r.find(userID)
	if !ok {
		return domain.ProfilePhoto{}, domain.ErrNotFound
	}
	p := domain.ProfilePhoto{ID: r.nextPhotoID, UserID: userID, URL: url, VideoURL: videoURL, CreatedAt: time.Now()}
	r.nextPhotoID++
	r.photos[userID] = append(r.photos[userID], p)
	u.AvatarURL = url
	r.byPhone[phone] = u
	return p, nil
}

func (r *fakeUserRepo) ListProfilePhotos(_ context.Context, userID int64) ([]domain.ProfilePhoto, error) {
	src := r.photos[userID]
	out := make([]domain.ProfilePhoto, 0, len(src))
	for i := len(src) - 1; i >= 0; i-- { // newest first
		out = append(out, src[i])
	}
	return out, nil
}

func (r *fakeUserRepo) DeleteProfilePhoto(_ context.Context, userID, photoID int64) (string, error) {
	phone, u, ok := r.find(userID)
	if !ok {
		return "", domain.ErrNotFound
	}
	list := r.photos[userID]
	var deleted *domain.ProfilePhoto
	kept := list[:0:0]
	for _, p := range list {
		if p.ID == photoID {
			pp := p
			deleted = &pp
			continue
		}
		kept = append(kept, p)
	}
	r.photos[userID] = kept
	if deleted != nil && u.AvatarURL == deleted.URL {
		u.AvatarURL = ""
		if len(kept) > 0 {
			u.AvatarURL = kept[len(kept)-1].URL
		}
		r.byPhone[phone] = u
	}
	return u.AvatarURL, nil
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

func (r *fakeDeviceRepo) Create(_ context.Context, userID int64, name, platform, tokenHash, ip, location string) (domain.Device, error) {
	d := domain.Device{ID: r.nextID, UserID: userID, Name: name, Platform: platform, TokenHash: tokenHash, LastActive: time.Now(), IP: ip, Location: location}
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

func (r *fakeDeviceRepo) DeleteOthers(_ context.Context, userID, keepDeviceID int64) ([]domain.Device, error) {
	var removed []domain.Device
	for id, d := range r.byID {
		if d.UserID == userID && id != keepDeviceID {
			removed = append(removed, d)
			delete(r.byID, id)
			delete(r.byHash, d.TokenHash)
		}
	}
	return removed, nil
}

func (r *fakeDeviceRepo) DeleteAll(_ context.Context, userID int64) ([]domain.Device, error) {
	var removed []domain.Device
	for id, d := range r.byID {
		if d.UserID == userID {
			removed = append(removed, d)
			delete(r.byID, id)
			delete(r.byHash, d.TokenHash)
		}
	}
	return removed, nil
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

// fakePasswordRepo — облачный пароль (2FA) в памяти.
type fakePasswordRepo struct {
	hash   map[int64]*string
	hint   map[int64]string
	email  map[int64]string
	tokens map[string]struct {
		userID  int64
		expires time.Time
	}
}

func newFakePasswordRepo() *fakePasswordRepo {
	return &fakePasswordRepo{
		hash: map[int64]*string{}, hint: map[int64]string{}, email: map[int64]string{},
		tokens: map[string]struct {
			userID  int64
			expires time.Time
		}{},
	}
}

func (r *fakePasswordRepo) Password(_ context.Context, userID int64) (*string, string, string, error) {
	return r.hash[userID], r.hint[userID], r.email[userID], nil
}

func (r *fakePasswordRepo) SetPassword(_ context.Context, userID int64, hash *string, hint, email string) error {
	r.hash[userID], r.hint[userID], r.email[userID] = hash, hint, email
	return nil
}

func (r *fakePasswordRepo) SavePasswordToken(_ context.Context, tokenHash string, userID int64, expires time.Time) error {
	r.tokens[tokenHash] = struct {
		userID  int64
		expires time.Time
	}{userID, expires}
	return nil
}

func (r *fakePasswordRepo) PasswordTokenUser(_ context.Context, tokenHash string) (int64, error) {
	e, ok := r.tokens[tokenHash]
	if !ok || time.Now().After(e.expires) {
		return 0, domain.ErrNotFound
	}
	return e.userID, nil
}

func (r *fakePasswordRepo) DeletePasswordToken(_ context.Context, tokenHash string) error {
	delete(r.tokens, tokenHash)
	return nil
}

func newInteractor() (*Interactor, *fakeUserRepo, *fakeDeviceRepo, *fakeCodeRepo) {
	users := newFakeUserRepo()
	devices := newFakeDeviceRepo(users)
	codes := newFakeCodeRepo()
	i := New(users, devices, codes, newFakePasswordRepo(), "12345", func(string, ...any) {})
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

func TestChangePhone(t *testing.T) {
	ctx := context.Background()
	i, users, _, codes := newInteractor()

	_ = i.RequestCode(ctx, "+79990000010")
	res, _ := i.SignIn(ctx, "+79990000010", "12345", "web", "browser")

	// Start the change: a code is queued for the new number.
	if err := i.ChangePhone(ctx, res.User.ID, "+7 (999) 000-00-20"); err != nil {
		t.Fatalf("ChangePhone: %v", err)
	}
	if _, err := codes.GetCode(ctx, "+79990000020"); err != nil {
		t.Fatalf("code not queued for new phone: %v", err)
	}

	user, err := i.ConfirmChangePhone(ctx, res.User.ID, "+79990000020", "12345")
	if err != nil {
		t.Fatalf("ConfirmChangePhone: %v", err)
	}
	if user.Phone != "+79990000020" {
		t.Fatalf("phone not updated: %q", user.Phone)
	}
	if _, ok := users.byPhone["+79990000020"]; !ok {
		t.Fatalf("store not updated to new phone")
	}
	if _, ok := users.byPhone["+79990000010"]; ok {
		t.Fatalf("old phone still present")
	}
	// Code is consumed after a successful confirm.
	if _, err := codes.GetCode(ctx, "+79990000020"); err != domain.ErrNotFound {
		t.Fatalf("expected code consumed, got %v", err)
	}
}

func TestChangePhoneTaken(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	// Occupy the target number with another account.
	_ = i.RequestCode(ctx, "+79990000030")
	_, _ = i.SignIn(ctx, "+79990000030", "12345", "web", "browser")

	_ = i.RequestCode(ctx, "+79990000031")
	me, _ := i.SignIn(ctx, "+79990000031", "12345", "web", "browser")

	if err := i.ChangePhone(ctx, me.User.ID, "+79990000030"); err != domain.ErrConflict {
		t.Fatalf("expected ErrConflict, got %v", err)
	}
}

func TestConfirmChangePhoneWrongCode(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	_ = i.RequestCode(ctx, "+79990000040")
	me, _ := i.SignIn(ctx, "+79990000040", "12345", "web", "browser")

	if err := i.ChangePhone(ctx, me.User.ID, "+79990000041"); err != nil {
		t.Fatalf("ChangePhone: %v", err)
	}
	if _, err := i.ConfirmChangePhone(ctx, me.User.ID, "+79990000041", "00000"); err != domain.ErrInvalidCode {
		t.Fatalf("expected ErrInvalidCode, got %v", err)
	}
}

func TestConfirmChangePhoneNoCode(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	_ = i.RequestCode(ctx, "+79990000050")
	me, _ := i.SignIn(ctx, "+79990000050", "12345", "web", "browser")

	// No ChangePhone call ⇒ no code queued for the target number.
	if _, err := i.ConfirmChangePhone(ctx, me.User.ID, "+79990000051", "12345"); err != domain.ErrInvalidCode {
		t.Fatalf("expected ErrInvalidCode, got %v", err)
	}
}

func TestDeleteAccount(t *testing.T) {
	ctx := context.Background()
	i, users, _, _ := newInteractor()
	cache := newFakeCache()
	rev := &fakeRevoker{}
	i.SetCache(cache)
	i.SetRevocationNotifier(rev)

	_ = i.RequestCode(ctx, "+79990000060")
	res, _ := i.SignIn(ctx, "+79990000060", "12345", "web", "browser")
	_, deviceID, _ := i.Authenticate(ctx, res.Token) // populates cache

	if err := i.DeleteAccount(ctx, res.User.ID); err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}

	// Personal fields anonymized.
	u, err := users.GetByID(ctx, res.User.ID)
	if err != nil {
		t.Fatalf("GetByID after delete: %v", err)
	}
	if u.Phone != "" || u.Username != nil || u.DisplayName != "Deleted Account" ||
		u.FirstName != "Deleted" || u.LastName != "Account" || u.AvatarURL != "" {
		t.Fatalf("account not anonymized: %+v", u)
	}

	// Every session revoked: token no longer authenticates, cache evicted,
	// revocation fired for the device.
	if _, _, err := i.Authenticate(ctx, res.Token); err != domain.ErrNotFound {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
	if len(cache.m) != 0 {
		t.Fatalf("cache not evicted: %d entries", len(cache.m))
	}
	if len(rev.revoked) != 1 || rev.revoked[0] != deviceID {
		t.Fatalf("notifier got %v; want [%d]", rev.revoked, deviceID)
	}
	sessions, _ := i.ListSessions(ctx, res.User.ID)
	if len(sessions) != 0 {
		t.Fatalf("expected 0 sessions after delete, got %d", len(sessions))
	}
}
