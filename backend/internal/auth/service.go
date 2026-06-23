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
}

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

// Authenticate resolves a raw token to a user.
func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	return s.repo.UserByTokenHash(ctx, HashToken(token))
}
