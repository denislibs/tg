package auth

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// passwordTokenTTL — время между шагом OTP и вводом облачного пароля.
const passwordTokenTTL = 10 * time.Minute

// ErrPasswordRequired — операция требует текущий пароль, а он не подошёл/не
// передан (алиас доменной ошибки для читаемости хендлера).
var ErrPasswordRequired = domain.ErrBadPassword

// errBlankPassword — новый пароль из одних пробельных символов.
var errBlankPassword = errors.New("password must not be blank")

// checkPassword сверяет введённый облачный пароль с хешем.
//
// Пароль не нормализуется (как в Telegram: пробелы значимы), поэтому сначала
// сверяется ввод как есть. Запасная ветка — совместимость: до фикса
// SetPassword резал пробелы по краям (strings.TrimSpace), и у тех, кто задал
// « abc », в базе хеш от «abc». Без неё такие пользователи не смогли бы ни
// войти, ни сменить/снять пароль. Перехэширование «как есть» после успешной
// запасной проверки НЕ делаем: по хешу не отличить «задал « abc » до фикса» от
// «задал abc и случайно ввёл с пробелом» — во втором случае перехэш молча
// сменил бы пароль и заблокировал бы человека. Цена ветки — у таких (старых и
// новых без пробелов по краям) паролей принимается ещё и вариант с пробелами
// по краям; стойкость от этого не падает.
func checkPassword(hash, input string) bool {
	if domain.CheckPasswordHash(hash, input) {
		return true
	}
	trimmed := strings.TrimSpace(input)
	return trimmed != input && domain.CheckPasswordHash(hash, trimmed)
}

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
	// Пароль сохраняется как есть — без TrimSpace: иначе хеш считается от
	// другой строки, чем потом сверяется, и « abc » не проходит проверку.
	// Проверка ниже — валидация «не пустой», а не нормализация.
	if newPassword != "" && strings.TrimSpace(newPassword) == "" {
		return errBlankPassword
	}
	if hint != "" && hint == newPassword {
		return errors.New("hint must differ from password")
	}
	hash, _, curEmail, err := i.pw.Password(ctx, userID)
	if err != nil {
		return err
	}
	if hash != nil && !checkPassword(*hash, current) {
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
	if hash == nil || !checkPassword(*hash, password) {
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
	if !checkPassword(*hash, current) {
		return domain.ErrBadPassword
	}
	return i.pw.SetPassword(ctx, userID, nil, "", "")
}

// MintPasskeySession выдаёт сессию после успешной WebAuthn-аутентификации
// (вход по ключу доступа — второй фактор не спрашивается, как в Telegram).
func (i *Interactor) MintPasskeySession(ctx context.Context, userID int64, deviceName, platform string) (SignInResult, error) {
	user, err := i.users.GetByID(ctx, userID)
	if err != nil {
		return SignInResult{}, err
	}
	return i.mintSession(ctx, user, deviceName, platform)
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
	if hash == nil || !checkPassword(*hash, password) {
		// Токен переживает опечатку (не гоняем OTP заново), НО не бесконечно:
		// после maxPasswordAttempts неудач сжигаем его — иначе перебор облачного
		// пароля в пределах TTL (в паре с rate-limit роута по реальному IP).
		if i.pwFails.inc(tokenHash) >= maxPasswordAttempts {
			_ = i.pw.DeletePasswordToken(ctx, tokenHash)
			i.pwFails.clear(tokenHash)
			return SignInResult{}, domain.ErrNotFound // токен исчерпан → как истёкший
		}
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
	i.pwFails.clear(tokenHash)
	_ = i.pw.DeletePasswordToken(ctx, tokenHash)
	return res, nil
}

// maxPasswordAttempts — сколько неверных паролей допускается на один
// password_token, прежде чем он сгорит (баланс: опечатка vs брутфорс).
const maxPasswordAttempts = 5

// failCounter — потокобезопасный счётчик неудач по ключу (in-memory; токены
// короткоживущие). Обнуляется при успехе/исчерпании.
type failCounter struct {
	mu sync.Mutex
	m  map[string]int
}

func newFailCounter() *failCounter { return &failCounter{m: map[string]int{}} }

func (f *failCounter) inc(key string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.m[key]++
	return f.m[key]
}

func (f *failCounter) clear(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.m, key)
}
