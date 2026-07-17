package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// passwordTokenTTL — время между шагом OTP и вводом облачного пароля.
const passwordTokenTTL = 10 * time.Minute

// ErrPasswordRequired — операция требует текущий пароль, а он не подошёл/не
// передан (алиас доменной ошибки для читаемости хендлера).
var ErrPasswordRequired = domain.ErrBadPassword

// PasswordState — состояние облачного пароля для экрана Two-Step Verification.
type PasswordState struct {
	Enabled bool
	Hint    string
	Email   string // маскированный (de•••@gmail.com), пустой если не задан
}

// PasswordState возвращает состояние облачного пароля пользователя.
func (i *Interactor) PasswordState(ctx context.Context, userID int64) (PasswordState, error) {
	hash, hint, email, err := i.pw.Password(ctx, userID)
	if err != nil {
		return PasswordState{}, err
	}
	st := PasswordState{Enabled: hash != nil, Hint: hint}
	if email != "" {
		st.Email = domain.MaskEmail(email)
	}
	return st, nil
}

// SetPassword ставит или меняет облачный пароль. При уже включённом пароле
// current обязателен и сверяется. Hint не должен совпадать с паролем (tweb
// PasswordAsHintError).
func (i *Interactor) SetPassword(ctx context.Context, userID int64, current, newPassword, hint, email string) error {
	newPassword = strings.TrimSpace(newPassword)
	if hint != "" && hint == newPassword {
		return errors.New("hint must differ from password")
	}
	hash, _, curEmail, err := i.pw.Password(ctx, userID)
	if err != nil {
		return err
	}
	if hash != nil && !domain.CheckPasswordHash(*hash, current) {
		return domain.ErrBadPassword
	}
	if email == "" {
		email = curEmail // не затирать почту при смене пароля без неё
	}
	// Пустой новый пароль при включённом — обновление только hint/email
	// (tweb ChangeEmail/SetupEmail не трогают пароль).
	if newPassword == "" {
		if hash == nil {
			return domain.ErrBadPassword
		}
		return i.pw.SetPassword(ctx, userID, hash, hint, email)
	}
	newHash, err := domain.HashPassword(newPassword)
	if err != nil {
		return err
	}
	return i.pw.SetPassword(ctx, userID, &newHash, hint, email)
}

// VerifyPassword сверяет текущий пароль (вход в настройки 2FA, tweb
// AppTwoStepVerificationEnterPasswordTab).
func (i *Interactor) VerifyPassword(ctx context.Context, userID int64, password string) error {
	hash, _, _, err := i.pw.Password(ctx, userID)
	if err != nil {
		return err
	}
	if hash == nil || !domain.CheckPasswordHash(*hash, password) {
		return domain.ErrBadPassword
	}
	return nil
}

// RemovePassword выключает облачный пароль (нужен текущий).
func (i *Interactor) RemovePassword(ctx context.Context, userID int64, current string) error {
	hash, _, _, err := i.pw.Password(ctx, userID)
	if err != nil {
		return err
	}
	if hash == nil {
		return nil
	}
	if !domain.CheckPasswordHash(*hash, current) {
		return domain.ErrBadPassword
	}
	return i.pw.SetPassword(ctx, userID, nil, "", "")
}

// CheckPassword — второй шаг входа: одноразовый password_token из SignIn +
// облачный пароль → полноценная сессия. Токен сгорает только при успехе,
// чтобы опечатка не заставляла проходить OTP заново.
func (i *Interactor) CheckPassword(ctx context.Context, rawToken, password, deviceName, platform string) (SignInResult, error) {
	tokenHash := domain.HashToken(rawToken)
	userID, err := i.pw.PasswordTokenUser(ctx, tokenHash)
	if err != nil {
		return SignInResult{}, err // ErrNotFound → токен истёк
	}
	hash, _, _, err := i.pw.Password(ctx, userID)
	if err != nil {
		return SignInResult{}, err
	}
	if hash == nil || !domain.CheckPasswordHash(*hash, password) {
		return SignInResult{}, domain.ErrBadPassword
	}
	user, err := i.users.GetByID(ctx, userID)
	if err != nil {
		return SignInResult{}, err
	}
	res, err := i.mintSession(ctx, user, deviceName, platform)
	if err != nil {
		return SignInResult{}, err
	}
	_ = i.pw.DeletePasswordToken(ctx, tokenHash)
	return res, nil
}
