package auth

import (
	"context"
	"errors"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

const codeTTL = 5 * time.Minute

type Interactor struct {
	users   UserRepo
	devices DeviceRepo
	codes   CodeRepo
	devCode string
	logf    func(string, ...any)
	cache   SessionCache       // optional
	revoker RevocationNotifier // optional
}

func New(users UserRepo, devices DeviceRepo, codes CodeRepo, devCode string, logf func(string, ...any)) *Interactor {
	return &Interactor{users: users, devices: devices, codes: codes, devCode: devCode, logf: logf}
}

func (i *Interactor) SetCache(c SessionCache)                    { i.cache = c }
func (i *Interactor) SetRevocationNotifier(n RevocationNotifier) { i.revoker = n }

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
