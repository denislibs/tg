package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
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

// Растущее ожидание после неверных облачных паролей (Б-4, М1-5; параметры —
// решение В-S2). Каждая сверка заранее засчитывается попыткой f (верный пароль
// затем обнуляет счётчик). С PasswordFreeFails-й попытки подряд — блокировка
// min(PasswordLockBase × 2^(f−PasswordFreeFails), PasswordLockMax). Счётчик
// живёт PasswordFailWindow после последней попытки, а при блокировке — столько
// же после её конца: иначе на потолке он истекал бы вместе с блокировкой и рост
// начинался бы заново. Числа берёт и Lua-скрипт Redis-стора.
const (
	PasswordFreeFails  = 5
	PasswordLockBase   = time.Minute
	PasswordLockMax    = 24 * time.Hour
	PasswordFailWindow = 24 * time.Hour
)

// Области счётчика шага входа check_password (сессии ещё нет; реальных сессий с
// id ≤ 0 нет, со счётчиками сессий они не пересекаются):
//   - loginAttemptScope — вход по SMS-коду или ключу доступа;
//   - approvedLoginScope — вход, одобренный уже вошедшей сессией (QR,
//     веб-токен). Отдельно, чтобы укравший сессию, выпуская себе такие токены,
//     не запирал владельцу вход по SMS, а перехвативший SMS — вход по QR с
//     устройства владельца.
const (
	loginAttemptScope  int64 = 0
	approvedLoginScope int64 = -1
)

// passwordVersion — короткий отпечаток хеша пароля в ключе счётчика: смена,
// снятие или восстановление пароля сами начинают счёт заново во всех областях
// (старые ключи доживают свой срок), без перебора ключей.
func passwordVersion(hash string) string {
	sum := sha256.Sum256([]byte(hash))
	return hex.EncodeToString(sum[:8])
}

// acquirePasswordAttempt пускает сверку пароля по паре (пользователь, deviceID):
// в блокировке — ErrPasswordFlood с остатком в целых секундах вверх (≥ 1), иначе
// попытка уже засчитана стором атомарно — параллельные запросы в окне сверки
// (bcrypt) не проходят мимо счётчика. Без стора и при его сбое — nil: сбой Redis
// не должен запирать пароль всем.
func (i *Interactor) acquirePasswordAttempt(ctx context.Context, userID, deviceID int64, hash string) error {
	if i.pwTries == nil {
		return nil
	}
	left, err := i.pwTries.Acquire(ctx, userID, deviceID, passwordVersion(hash))
	if err != nil {
		i.logf("password attempts: acquire user=%d device=%d: %v", userID, deviceID, err)
		return nil
	}
	if left <= 0 {
		return nil
	}
	return domain.ErrPasswordFlood{Seconds: max(1, int(math.Ceil(left.Seconds())))}
}

// resetPasswordAttempts — верный пароль: счёт пары начинается заново.
func (i *Interactor) resetPasswordAttempts(ctx context.Context, userID, deviceID int64, hash string) {
	if i.pwTries == nil {
		return
	}
	if err := i.pwTries.Reset(ctx, userID, deviceID, passwordVersion(hash)); err != nil {
		i.logf("password attempts: reset user=%d device=%d: %v", userID, deviceID, err)
	}
}

// checkCurrent сверяет текущий облачный пароль в сессии deviceID: в блокировке —
// ErrPasswordFlood без сверки; неверный — ErrBadPassword (попытка засчитана);
// верный — сброс счётчика.
func (i *Interactor) checkCurrent(ctx context.Context, userID, deviceID int64, hash, password string) error {
	if err := i.acquirePasswordAttempt(ctx, userID, deviceID, hash); err != nil {
		return err
	}
	if !checkPassword(hash, password) {
		return domain.ErrBadPassword
	}
	i.resetPasswordAttempts(ctx, userID, deviceID, hash)
	return nil
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
func (i *Interactor) SetPassword(ctx context.Context, userID, deviceID int64, current, newPassword, hint, email string) error {
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
	if hash != nil {
		if err := i.checkCurrent(ctx, userID, deviceID, *hash, current); err != nil {
			return err
		}
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
func (i *Interactor) VerifyPassword(ctx context.Context, userID, deviceID int64, password string) error {
	hash, _, _, err := i.pw.Password(ctx, userID)
	if err != nil {
		return err
	}
	if hash == nil {
		return domain.ErrBadPassword
	}
	return i.checkCurrent(ctx, userID, deviceID, *hash, password)
}

// RemovePassword выключает облачный пароль (нужен текущий).
func (i *Interactor) RemovePassword(ctx context.Context, userID, deviceID int64, current string) error {
	hash, _, _, err := i.pw.Password(ctx, userID)
	if err != nil {
		return err
	}
	if hash == nil {
		return nil
	}
	if err := i.checkCurrent(ctx, userID, deviceID, *hash, current); err != nil {
		return err
	}
	return i.pw.SetPassword(ctx, userID, nil, "", "")
}

// PasskeySignIn — вход после успешной WebAuthn-проверки. Ключ доступа не
// отменяет облачный пароль: при включённом пароле сессия не выдаётся, клиент
// получает шаг пароля (tweb passkeyLoginButton.tsx:63-71 — SESSION_PASSWORD_NEEDED
// ведёт на карточку пароля); у нас этот шаг — успешный ответ
// `auth.passwordNeeded`, как у sign_in и sign_import. Пароля нет — сессия.
func (i *Interactor) PasskeySignIn(ctx context.Context, userID int64, deviceName, platform string) (SignInResult, error) {
	user, err := i.users.GetByID(ctx, userID)
	if err != nil {
		return SignInResult{}, err
	}
	if res, needed, err := i.startPasswordStep(ctx, userID, false); err != nil {
		return SignInResult{}, err
	} else if needed {
		return res, nil
	}
	return i.mintSession(ctx, user, deviceName, platform, false)
}

// CheckPassword — второй шаг входа: одноразовый password_token из SignIn +
// облачный пароль → полноценная сессия. Токен сгорает только при успехе,
// чтобы опечатка не заставляла проходить OTP заново.
func (i *Interactor) CheckPassword(ctx context.Context, rawToken, password, deviceName, platform string) (SignInResult, error) {
	tokenHash := domain.HashToken(rawToken)
	userID, approved, err := i.pw.PasswordTokenUser(ctx, tokenHash)
	if err != nil {
		return SignInResult{}, err // ErrNotFound → токен истёк
	}
	hash, _, _, err := i.pw.Password(ctx, userID)
	if err != nil {
		return SignInResult{}, err
	}
	// Потолок на пользователя (остаток М1-1): токен ограничивает 5 попыток, но
	// новый токен давал новые; попытки шага входа копятся по пользователю — в
	// области своего источника токена. В блокировке токен не тратит попыток
	// (его срок — прежний, passwordTokenTTL).
	scope := loginAttemptScope
	if approved {
		scope = approvedLoginScope
	}
	if hash != nil {
		if err := i.acquirePasswordAttempt(ctx, userID, scope, *hash); err != nil {
			return SignInResult{}, err
		}
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
	i.resetPasswordAttempts(ctx, userID, scope, *hash)
	user, err := i.users.GetByID(ctx, userID)
	if err != nil {
		return SignInResult{}, err
	}
	res, err := i.mintSession(ctx, user, deviceName, platform, approved)
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
