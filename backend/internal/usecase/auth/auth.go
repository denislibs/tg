package auth

import (
	"context"
	"errors"
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
}

func New(users UserRepo, devices DeviceRepo, codes CodeRepo, devCode string, logf func(string, ...any)) *Interactor {
	return &Interactor{users: users, devices: devices, codes: codes, devCode: devCode, logf: logf}
}

func (i *Interactor) SetCache(c SessionCache)                    { i.cache = c }
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
	if _, err := i.devices.Create(ctx, user.ID, deviceName, platform, hash); err != nil {
		return SignInResult{}, err
	}
	_ = i.codes.DeleteCode(ctx, phone)
	return SignInResult{Token: token, User: user}, nil
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
	if _, err := i.devices.Create(ctx, user.ID, "QR login", rec.Platform, sessionHash); err != nil {
		return err
	}
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
