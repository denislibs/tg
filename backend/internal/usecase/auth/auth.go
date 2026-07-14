package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// ErrQRUnavailable is returned when QR login is requested but no QRStore is
// configured (e.g. Redis is down).
var ErrQRUnavailable = errors.New("qr login unavailable")

const codeTTL = 5 * time.Minute

type Interactor struct {
	users   UserRepo
	devices DeviceRepo
	codes   CodeRepo
	devCode string
	logf    func(string, ...any)
	cache   SessionCache       // optional
	revoker RevocationNotifier // optional
	qr      QRStore            // optional
	svc     ServiceNotifier    // optional
	geo     GeoResolver        // optional
}

// GeoResolver turns an IP into a human place ("Москва, Россия"). Backed by a
// MaxMind GeoLite2 lookup; optional, so auth runs without it (returns "").
type GeoResolver interface {
	Locate(ip string) string
}

// ServiceNotifier delivers a system message into a user's official-service chat.
// Wired to the chat usecase; optional so auth can run without it.
type ServiceNotifier interface {
	PostServiceMessage(ctx context.Context, userID int64, text string) error
}

// ClientInfo describes the device/browser that signed in, for the login alert.
// Populated by the delivery layer from the request (User-Agent, IP) and carried
// to the usecase via the request context (see WithClientInfo).
type ClientInfo struct {
	Device   string // high-level kind, e.g. "QR-код" (else derived from browser/OS)
	Browser  string // "Chrome", "Safari", …
	OS       string // "macOS", "Windows", "Android", …
	IP       string
	Location string // human place, when a GeoIP lookup is available (else empty)
}

type clientInfoKey struct{}

// WithClientInfo attaches sign-in client details to the context (delivery layer).
func WithClientInfo(ctx context.Context, ci ClientInfo) context.Context {
	return context.WithValue(ctx, clientInfoKey{}, ci)
}

func clientInfoFromContext(ctx context.Context) ClientInfo {
	ci, _ := ctx.Value(clientInfoKey{}).(ClientInfo)
	return ci
}

// buildLoginText composes the "new login" service message from whatever client
// details we have (fields are omitted when unknown).
func buildLoginText(ci ClientInfo) string {
	var b strings.Builder
	b.WriteString("🔐 Новый вход в аккаунт\n\nВыполнен вход с нового устройства.")
	if ci.Device != "" {
		b.WriteString("\n\nСпособ: " + ci.Device)
	}
	app := ci.Browser
	if app != "" && ci.OS != "" {
		app += " · " + ci.OS
	} else if app == "" {
		app = ci.OS
	}
	if app != "" {
		b.WriteString("\nПриложение: " + app)
	}
	if ci.Location != "" {
		b.WriteString("\nМесто: " + ci.Location)
	}
	if ci.IP != "" {
		b.WriteString("\nIP-адрес: " + ci.IP)
	}
	b.WriteString("\n\nЕсли это были вы — всё в порядке. Если нет — завершите этот сеанс в Настройках → Устройства и смените код доступа.")
	return b.String()
}

func New(users UserRepo, devices DeviceRepo, codes CodeRepo, devCode string, logf func(string, ...any)) *Interactor {
	return &Interactor{users: users, devices: devices, codes: codes, devCode: devCode, logf: logf}
}

func (i *Interactor) SetCache(c SessionCache)                    { i.cache = c }
func (i *Interactor) SetServiceNotifier(n ServiceNotifier)       { i.svc = n }
func (i *Interactor) SetGeoResolver(g GeoResolver)               { i.geo = g }
func (i *Interactor) SetRevocationNotifier(n RevocationNotifier) { i.revoker = n }
func (i *Interactor) SetQRStore(q QRStore)                       { i.qr = q }

func (i *Interactor) RequestCode(ctx context.Context, rawPhone string) error {
	phone := domain.NormalizePhone(rawPhone)
	if phone == "" {
		return errors.New("empty phone")
	}
	if err := i.codes.SaveCode(ctx, phone, i.devCode, time.Now().Add(codeTTL)); err != nil {
		return err
	}
	i.logf("[dev-otp] phone=%s code=%s", phone, i.devCode)
	return nil
}

type SignInResult struct {
	Token string
	User  domain.User
}

func (i *Interactor) SignIn(ctx context.Context, rawPhone, suppliedCode, deviceName, platform string) (SignInResult, error) {
	phone := domain.NormalizePhone(rawPhone)
	stored, err := i.codes.GetCode(ctx, phone)
	if errors.Is(err, domain.ErrNotFound) {
		return SignInResult{}, domain.ErrInvalidCode
	}
	if err != nil {
		return SignInResult{}, err
	}
	if !domain.CodeMatches(stored, suppliedCode) {
		return SignInResult{}, domain.ErrInvalidCode
	}
	user, err := i.users.UpsertByPhone(ctx, phone)
	if err != nil {
		return SignInResult{}, err
	}
	token, hash, err := domain.GenerateToken()
	if err != nil {
		return SignInResult{}, err
	}
	// Session row keeps the sign-in metadata for the Active Sessions screen:
	// a human name from the parsed User-Agent (fallback: the client-sent one),
	// plus IP and GeoIP location when available.
	ci := clientInfoFromContext(ctx)
	if ci.Location == "" && i.geo != nil && ci.IP != "" {
		ci.Location = i.geo.Locate(ci.IP)
	}
	name := deviceName
	if ci.Browser != "" && ci.OS != "" {
		name = ci.Browser + " · " + ci.OS
	} else if ci.Browser != "" {
		name = ci.Browser
	}
	if _, err := i.devices.Create(ctx, user.ID, name, platform, hash, ci.IP, ci.Location); err != nil {
		return SignInResult{}, err
	}
	_ = i.codes.DeleteCode(ctx, phone)
	i.notifyLogin(user.ID, ci)
	return SignInResult{Token: token, User: user}, nil
}

// notifyLogin fires a best-effort "new login" service message. It runs detached
// (own context, goroutine) so a slow/failing notification never blocks or fails
// sign-in; the request context would also be cancelled once the response is sent.
func (i *Interactor) notifyLogin(userID int64, ci ClientInfo) {
	if i.svc == nil {
		return
	}
	if ci.Location == "" && i.geo != nil && ci.IP != "" {
		ci.Location = i.geo.Locate(ci.IP)
	}
	text := buildLoginText(ci)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := i.svc.PostServiceMessage(ctx, userID, text); err != nil {
			i.logf("service login notification failed: %v", err)
		}
	}()
}

func (i *Interactor) Authenticate(ctx context.Context, token string) (domain.User, int64, error) {
	hash := domain.HashToken(token)
	if i.cache != nil {
		if s, err := i.cache.GetSession(ctx, hash); err == nil && s != nil {
			return s.User, s.DeviceID, nil
		}
	}
	user, deviceID, err := i.devices.SessionByTokenHash(ctx, hash)
	if err != nil {
		return domain.User{}, 0, err
	}
	if i.cache != nil {
		_ = i.cache.SetSession(ctx, hash, domain.Session{User: user, DeviceID: deviceID}, SessionCacheTTL)
	}
	return user, deviceID, nil
}

// NewQRLogin creates a pending QR-login record and returns the raw token and
// its expiry. The raw token is only ever returned here; the store keys on its
// hash.
func (i *Interactor) NewQRLogin(ctx context.Context, platform string) (token string, expiresAt time.Time, err error) {
	if i.qr == nil {
		return "", time.Time{}, ErrQRUnavailable
	}
	token, hash, err := domain.GenerateToken()
	if err != nil {
		return "", time.Time{}, err
	}
	now := time.Now()
	rec := domain.QRLogin{Status: domain.QRPending, Platform: platform, CreatedAt: now}
	if err := i.qr.Put(ctx, hash, rec, QRLoginTTL); err != nil {
		return "", time.Time{}, err
	}
	return token, now.Add(QRLoginTTL), nil
}

// QRStatus returns the record for a token. A confirmed record is single-use: it
// is deleted on read so the desktop consumes the session token exactly once.
func (i *Interactor) QRStatus(ctx context.Context, token string) (domain.QRLogin, error) {
	if i.qr == nil {
		return domain.QRLogin{}, ErrQRUnavailable
	}
	hash := domain.HashToken(token)
	rec, err := i.qr.Get(ctx, hash)
	if err != nil {
		return domain.QRLogin{}, err // ErrNotFound ⇒ caller maps to "expired"
	}
	if rec.Status == domain.QRConfirmed {
		_ = i.qr.Delete(ctx, hash)
	}
	return rec, nil
}

// ConfirmQRLogin is called by an already-authenticated user (the scanning
// device). It mints a fresh session for that user and stores it on the record
// so the waiting desktop can read it.
func (i *Interactor) ConfirmQRLogin(ctx context.Context, token string, user domain.User) error {
	if i.qr == nil {
		return ErrQRUnavailable
	}
	hash := domain.HashToken(token)
	rec, err := i.qr.Get(ctx, hash)
	if err != nil {
		return err // ErrNotFound (absent/expired)
	}
	if rec.Status != domain.QRPending {
		return domain.ErrNotFound // already used
	}
	sessionToken, sessionHash, err := domain.GenerateToken()
	if err != nil {
		return err
	}
	if _, err := i.devices.Create(ctx, user.ID, "QR login", rec.Platform, sessionHash, "", ""); err != nil {
		return err
	}
	i.notifyLogin(user.ID, ClientInfo{Device: "QR-код", OS: rec.Platform})
	rec.Status = domain.QRConfirmed
	rec.SessionToken = sessionToken
	rec.User = user
	return i.qr.Put(ctx, hash, rec, QRLoginTTL)
}

func (i *Interactor) ListSessions(ctx context.Context, userID int64) ([]domain.Device, error) {
	return i.devices.ListByUser(ctx, userID)
}

func (i *Interactor) RevokeSession(ctx context.Context, userID, deviceID int64) (bool, error) {
	tokenHash, found, err := i.devices.Delete(ctx, userID, deviceID)
	if err != nil || !found {
		return false, err
	}
	if i.cache != nil {
		_ = i.cache.DelSession(ctx, tokenHash)
	}
	if i.revoker != nil {
		_ = i.revoker.NotifyRevoked(ctx, deviceID)
	}
	return true, nil
}

// RevokeOtherSessions terminates every session of the user except the current
// one ("Terminate All Other Sessions"): rows are deleted, cached sessions
// evicted and each device's sockets closed. Returns how many were revoked.
func (i *Interactor) RevokeOtherSessions(ctx context.Context, userID, currentDeviceID int64) (int, error) {
	removed, err := i.devices.DeleteOthers(ctx, userID, currentDeviceID)
	if err != nil {
		return 0, err
	}
	for _, d := range removed {
		if i.cache != nil {
			_ = i.cache.DelSession(ctx, d.TokenHash)
		}
		if i.revoker != nil {
			_ = i.revoker.NotifyRevoked(ctx, d.ID)
		}
	}
	return len(removed), nil
}
