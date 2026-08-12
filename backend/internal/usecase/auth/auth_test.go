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

func (r *fakeUserRepo) ByPhone(_ context.Context, phone string) (domain.User, error) {
	if u, ok := r.byPhone[phone]; ok {
		return u, nil
	}
	return domain.User{}, domain.ErrNotFound
}

func (r *fakeUserRepo) CreateWithName(_ context.Context, phone, first, last string) (domain.User, error) {
	if _, ok := r.byPhone[phone]; ok {
		return domain.User{}, domain.ErrConflict
	}
	u := domain.User{
		ID: r.nextID, Phone: phone, FirstName: first, LastName: last,
		DisplayName: domain.BuildDisplayName(first, last),
	}
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

func (r *fakeUserRepo) AddProfilePhoto(_ context.Context, userID int64, url, videoURL string, preview []byte) (domain.ProfilePhoto, error) {
	phone, u, ok := r.find(userID)
	if !ok {
		return domain.ProfilePhoto{}, domain.ErrNotFound
	}
	p := domain.ProfilePhoto{ID: r.nextPhotoID, UserID: userID, URL: url, VideoURL: videoURL, CreatedAt: time.Now()}
	r.nextPhotoID++
	r.photos[userID] = append(r.photos[userID], p)
	u.AvatarURL = url
	u.AvatarPreview = preview
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

// fakeStepRepo — одноразовые токены шагов входа в памяти (LoginStepRepo).
type fakeStepRepo struct {
	signUp map[string]struct {
		phone   string
		expires time.Time
	}
	recovery map[string]struct {
		userID     int64
		codeHash   string
		expires    time.Time
		nextSendAt time.Time
	}
	web map[string]struct {
		userID  int64
		expires time.Time
	}
	resets map[int64]struct {
		requestedAt time.Time
		deleteAt    time.Time
		cancelledAt time.Time
	}
}

func newFakeStepRepo() *fakeStepRepo {
	return &fakeStepRepo{
		signUp: map[string]struct {
			phone   string
			expires time.Time
		}{},
		recovery: map[string]struct {
			userID     int64
			codeHash   string
			expires    time.Time
			nextSendAt time.Time
		}{},
		web: map[string]struct {
			userID  int64
			expires time.Time
		}{},
		resets: map[int64]struct {
			requestedAt time.Time
			deleteAt    time.Time
			cancelledAt time.Time
		}{},
	}
}

func (r *fakeStepRepo) SaveSignUpToken(_ context.Context, tokenHash, phone string, expires time.Time) error {
	r.signUp[tokenHash] = struct {
		phone   string
		expires time.Time
	}{phone, expires}
	return nil
}

func (r *fakeStepRepo) SignUpTokenPhone(_ context.Context, tokenHash string) (string, error) {
	e, ok := r.signUp[tokenHash]
	if !ok || time.Now().After(e.expires) {
		return "", domain.ErrNotFound
	}
	return e.phone, nil
}

func (r *fakeStepRepo) DeleteSignUpToken(_ context.Context, tokenHash string) error {
	delete(r.signUp, tokenHash)
	return nil
}

func (r *fakeStepRepo) SaveRecoveryCode(_ context.Context, tokenHash string, userID int64, codeHash string, expires, nextSendAt time.Time) error {
	r.recovery[tokenHash] = struct {
		userID     int64
		codeHash   string
		expires    time.Time
		nextSendAt time.Time
	}{userID, codeHash, expires, nextSendAt}
	return nil
}

func (r *fakeStepRepo) RecoveryCode(_ context.Context, tokenHash string) (int64, string, time.Time, error) {
	e, ok := r.recovery[tokenHash]
	if !ok || time.Now().After(e.expires) {
		return 0, "", time.Time{}, domain.ErrNotFound
	}
	return e.userID, e.codeHash, e.nextSendAt, nil
}

func (r *fakeStepRepo) DeleteRecoveryCode(_ context.Context, tokenHash string) error {
	delete(r.recovery, tokenHash)
	return nil
}

func (r *fakeStepRepo) SaveWebAuthToken(_ context.Context, tokenHash string, userID int64, expires time.Time) error {
	r.web[tokenHash] = struct {
		userID  int64
		expires time.Time
	}{userID, expires}
	return nil
}

func (r *fakeStepRepo) WebAuthTokenUser(_ context.Context, tokenHash string) (int64, error) {
	e, ok := r.web[tokenHash]
	if !ok || time.Now().After(e.expires) {
		return 0, domain.ErrNotFound
	}
	return e.userID, nil
}

func (r *fakeStepRepo) DeleteWebAuthToken(_ context.Context, tokenHash string) error {
	delete(r.web, tokenHash)
	return nil
}

func (r *fakeStepRepo) ScheduleAccountReset(_ context.Context, userID int64, requestedAt, deleteAt time.Time) error {
	r.resets[userID] = struct {
		requestedAt time.Time
		deleteAt    time.Time
		cancelledAt time.Time
	}{requestedAt: requestedAt, deleteAt: deleteAt}
	return nil
}

func (r *fakeStepRepo) AccountReset(_ context.Context, userID int64) (time.Time, time.Time, error) {
	e, ok := r.resets[userID]
	if !ok {
		return time.Time{}, time.Time{}, domain.ErrNotFound
	}
	return e.deleteAt, e.cancelledAt, nil
}

func (r *fakeStepRepo) CancelAccountReset(_ context.Context, userID int64, at time.Time) (bool, error) {
	e, ok := r.resets[userID]
	if !ok || !e.cancelledAt.IsZero() {
		return false, nil
	}
	e.cancelledAt = at
	r.resets[userID] = e
	return true, nil
}

func (r *fakeStepRepo) DeleteAccountReset(_ context.Context, userID int64) error {
	delete(r.resets, userID)
	return nil
}

func newInteractor() (*Interactor, *fakeUserRepo, *fakeDeviceRepo, *fakeCodeRepo) {
	users := newFakeUserRepo()
	devices := newFakeDeviceRepo(users)
	codes := newFakeCodeRepo()
	i := New(users, devices, codes, newFakePasswordRepo(), newFakeStepRepo(), "12345", func(string, ...any) {})
	return i, users, devices, codes
}

// registerUser проходит вход для НОВОГО номера целиком: код → sign_in
// (signup_required) → sign_up. Возвращает выданную сессию.
func registerUser(t *testing.T, i *Interactor, phone, first, last, device, platform string) SignInResult {
	t.Helper()
	ctx := context.Background()
	if err := i.RequestCode(ctx, phone); err != nil {
		t.Fatalf("RequestCode(%s): %v", phone, err)
	}
	res, err := i.SignIn(ctx, phone, "12345", device, platform)
	if err != nil {
		t.Fatalf("SignIn(%s): %v", phone, err)
	}
	if !res.SignUpRequired {
		t.Fatalf("SignIn(%s): ожидался шаг регистрации, получено %+v", phone, res)
	}
	out, err := i.SignUp(ctx, res.SignUpToken, first, last, device, platform)
	if err != nil {
		t.Fatalf("SignUp(%s): %v", phone, err)
	}
	return out
}

func TestRequestAndSignIn(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	// Новый номер: регистрация, затем повторный вход тем же номером — уже сразу
	// сессия (номер знакомый).
	reg := registerUser(t, i, "+79990000000", "Денис", "", "web", "browser")
	if reg.Token == "" || reg.User.ID == 0 {
		t.Fatalf("empty result: %+v", reg)
	}
	got, _, err := i.Authenticate(ctx, reg.Token)
	if err != nil || got.ID != reg.User.ID {
		t.Fatalf("Authenticate = %+v, %v", got, err)
	}

	if err := i.RequestCode(ctx, "+7 (999) 000-00-00"); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	res, err := i.SignIn(ctx, "+79990000000", "12345", "web", "browser")
	if err != nil {
		t.Fatalf("SignIn: %v", err)
	}
	if res.SignUpRequired || res.Token == "" || res.User.ID != reg.User.ID {
		t.Fatalf("повторный вход = %+v", res)
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

	res := registerUser(t, i, "+79991230000", "Кэш", "", "web", "browser")

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

	res := registerUser(t, i, "+79991230001", "Сессия", "", "web", "browser")
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

	res := registerUser(t, i, "+79990000001", "Список", "", "web", "browser")
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

func TestDeleteAccount(t *testing.T) {
	ctx := context.Background()
	i, users, _, _ := newInteractor()
	cache := newFakeCache()
	rev := &fakeRevoker{}
	i.SetCache(cache)
	i.SetRevocationNotifier(rev)

	res := registerUser(t, i, "+79990000060", "Удаляемый", "", "web", "browser")
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

// fakeGeo — GeoIP в памяти: IP → (место, ISO-код страны).
type fakeGeo struct{ byIP map[string][2]string }

func (g *fakeGeo) Locate(ip string) string  { return g.byIP[ip][0] }
func (g *fakeGeo) Country(ip string) string { return g.byIP[ip][1] }

// Страна для экрана входа (аналог help.getNearestDc): резолвится по тому же
// ClientInfo.IP из контекста, что наполняет местоположение активных сессий.
// Всё, что определить нельзя, — пустая строка, а не ошибка.
func TestNearestCountry(t *testing.T) {
	i, _, _, _ := newInteractor()

	// GeoIP не подключён (GEOIP_DB_PATH не задан) — пусто.
	ctx := WithClientInfo(context.Background(), ClientInfo{IP: "81.2.69.142"})
	if got := i.NearestCountry(ctx); got != "" {
		t.Fatalf("без GeoIP NearestCountry = %q, want empty", got)
	}

	i.SetGeoResolver(&fakeGeo{byIP: map[string][2]string{
		"81.2.69.142": {"Лондон, Великобритания", "GB"},
	}})
	if got := i.NearestCountry(ctx); got != "GB" {
		t.Fatalf("NearestCountry = %q, want GB", got)
	}

	// Нет IP в контексте (прямой запрос без прокси/заголовков) — пусто.
	if got := i.NearestCountry(context.Background()); got != "" {
		t.Fatalf("без IP NearestCountry = %q, want empty", got)
	}
	// IP есть, но записи по нему нет (приватный адрес, дыра в базе) — пусто.
	priv := WithClientInfo(context.Background(), ClientInfo{IP: "192.168.1.5"})
	if got := i.NearestCountry(priv); got != "" {
		t.Fatalf("приватный IP NearestCountry = %q, want empty", got)
	}
}
