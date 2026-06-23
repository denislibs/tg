package auth

import (
	"context"
	"errors"
	"time"
)

const codeTTL = 5 * time.Minute

var ErrInvalidCode = errors.New("invalid code")

type Service struct {
	repo    *Repo
	devCode string // fixed dev OTP, also logged
	logf    func(format string, args ...any)
	cache   SessionCache
}

// SetCache attaches a session cache (optional). When nil, Authenticate always
// resolves via Postgres.
func (s *Service) SetCache(c SessionCache) { s.cache = c }

func NewService(repo *Repo, devCode string, logf func(string, ...any)) *Service {
	return &Service{repo: repo, devCode: devCode, logf: logf}
}

// RequestCode stores the (dev-fixed) code for the phone and "sends" it (logs it).
func (s *Service) RequestCode(ctx context.Context, rawPhone string) error {
	phone := NormalizePhone(rawPhone)
	if phone == "" {
		return errors.New("empty phone")
	}
	if err := s.repo.SaveCode(ctx, phone, s.devCode, time.Now().Add(codeTTL)); err != nil {
		return err
	}
	s.logf("[dev-otp] phone=%s code=%s", phone, s.devCode)
	return nil
}

// SignInResult is returned to the client after a successful sign-in.
type SignInResult struct {
	Token string
	User  User
}

// SignIn verifies the code, upserts the user, creates a device, and returns a token.
func (s *Service) SignIn(ctx context.Context, rawPhone, suppliedCode, deviceName, platform string) (SignInResult, error) {
	phone := NormalizePhone(rawPhone)
	stored, err := s.repo.GetCode(ctx, phone)
	if errors.Is(err, ErrNotFound) {
		return SignInResult{}, ErrInvalidCode
	}
	if err != nil {
		return SignInResult{}, err
	}
	if !CodeMatches(stored, suppliedCode) {
		return SignInResult{}, ErrInvalidCode
	}

	user, err := s.repo.UpsertUserByPhone(ctx, phone)
	if err != nil {
		return SignInResult{}, err
	}
	token, hash, err := GenerateToken()
	if err != nil {
		return SignInResult{}, err
	}
	if _, err := s.repo.CreateDevice(ctx, user.ID, deviceName, platform, hash); err != nil {
		return SignInResult{}, err
	}
	_ = s.repo.DeleteCode(ctx, phone)
	return SignInResult{Token: token, User: user}, nil
}

// Authenticate resolves a raw token to its user and device id, using the cache
// when available and falling back to Postgres (then populating the cache).
func (s *Service) Authenticate(ctx context.Context, token string) (User, int64, error) {
	hash := HashToken(token)
	if s.cache != nil {
		if cs, err := s.cache.GetSession(ctx, hash); err == nil && cs != nil {
			return cs.User, cs.DeviceID, nil
		}
	}
	user, deviceID, err := s.repo.SessionByTokenHash(ctx, hash)
	if err != nil {
		return User{}, 0, err
	}
	if s.cache != nil {
		_ = s.cache.SetSession(ctx, hash, CachedSession{User: user, DeviceID: deviceID}, SessionCacheTTL)
	}
	return user, deviceID, nil
}

// ListSessions returns the user's devices.
func (s *Service) ListSessions(ctx context.Context, userID int64) ([]Device, error) {
	return s.repo.ListDevices(ctx, userID)
}

// RevokeSession deletes a user's device and evicts its cached session. Returns
// false if the device does not belong to the user / does not exist.
func (s *Service) RevokeSession(ctx context.Context, userID, deviceID int64) (bool, error) {
	tokenHash, found, err := s.repo.DeleteDevice(ctx, userID, deviceID)
	if err != nil || !found {
		return false, err
	}
	if s.cache != nil {
		_ = s.cache.DelSession(ctx, tokenHash)
	}
	return true, nil
}
