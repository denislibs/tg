package auth

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

const (
	// signUpTokenTTL — время между подтверждением кода и отправкой имени.
	signUpTokenTTL = 10 * time.Minute
	// Границы имени на шаге регистрации — как в tweb SignUpCard (InputField
	// maxLength: FirstName 70, LastName 64).
	maxFirstNameLen = 70
	maxLastNameLen  = 64
)

// ErrLoginStepsUnavailable — не подключено хранилище одноразовых токенов шагов
// входа, поэтому регистрация/восстановление/веб-импорт невозможны.
var ErrLoginStepsUnavailable = errors.New("login steps unavailable")

// ErrNameRequired — пустое имя на шаге регистрации (tweb не даёт отправить
// форму с пустым FirstName).
var ErrNameRequired = errors.New("first name required")

// startSignUp — хвост SignIn для незнакомого номера: код сгорает, наружу уходит
// одноразовый токен шага регистрации (только его хеш лежит в хранилище).
func (i *Interactor) startSignUp(ctx context.Context, phone string) (SignInResult, error) {
	if i.steps == nil {
		return SignInResult{}, ErrLoginStepsUnavailable
	}
	token, hash, err := domain.GenerateToken()
	if err != nil {
		return SignInResult{}, err
	}
	if err := i.steps.SaveSignUpToken(ctx, hash, phone, time.Now().Add(signUpTokenTTL)); err != nil {
		return SignInResult{}, err
	}
	_ = i.codes.DeleteCode(ctx, phone)
	return SignInResult{SignUpRequired: true, SignUpToken: token}, nil
}

// SignUp — второй шаг входа для нового номера (Telegram auth.signUp): токен шага
// регистрации + имя → пользователь и сессия. Токен одноразовый: сгорает и при
// успехе, и когда номер успели занять параллельно.
//
// Аватар здесь не принимается: как и в tweb (SignUpCard шлёт uploadProfilePhoto
// уже после auth.authorization), он загружается обычным путём — POST /media/upload
// + PUT /me/avatar — под свежей сессией.
func (i *Interactor) SignUp(ctx context.Context, rawToken, firstName, lastName, deviceName, platform string) (SignInResult, error) {
	if i.steps == nil {
		return SignInResult{}, ErrLoginStepsUnavailable
	}
	first := strings.TrimSpace(firstName)
	last := strings.TrimSpace(lastName)
	if first == "" {
		return SignInResult{}, ErrNameRequired
	}
	if utf8.RuneCountInString(first) > maxFirstNameLen || utf8.RuneCountInString(last) > maxLastNameLen {
		return SignInResult{}, domain.ErrTooLong
	}
	tokenHash := domain.HashToken(rawToken)
	phone, err := i.steps.SignUpTokenPhone(ctx, tokenHash)
	if err != nil {
		return SignInResult{}, err // ErrNotFound → токен истёк/использован
	}
	user, err := i.users.CreateWithName(ctx, phone, first, last)
	if err != nil {
		// Номер заняли между шагами — токен больше не нужен.
		if errors.Is(err, domain.ErrConflict) {
			_ = i.steps.DeleteSignUpToken(ctx, tokenHash)
		}
		return SignInResult{}, err
	}
	res, err := i.mintSession(ctx, user, deviceName, platform)
	if err != nil {
		return SignInResult{}, err
	}
	_ = i.steps.DeleteSignUpToken(ctx, tokenHash)
	return res, nil
}
