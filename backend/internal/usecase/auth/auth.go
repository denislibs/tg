package auth

import (
	"context"
	"encoding/json"
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
	users    UserRepo
	devices  DeviceRepo
	codes    CodeRepo
	pw       PasswordRepo
	steps    LoginStepRepo // одноразовые токены шагов входа (регистрация/восстановление/веб-токен)
	devCode  string
	logf     func(string, ...any)
	cache    SessionCache       // optional
	revoker  RevocationNotifier // optional
	qr       QRStore            // optional
	svc      ServiceNotifier    // optional
	geo      GeoResolver        // optional
	premium  PremiumRepo        // optional
	mail     Mailer             // optional: доставка кода восстановления на почту
	pub      EventPublisher     // optional: realtime user_update fan-out
	partners PartnersFunc       // optional: user_update recipient set (shared-chat peers)
	updates  UpdateLog          // optional: per-user update log for user_update (dense pts)
	previews AvatarPreviewer    // optional: stripped-превью аватарки при её установке
	privacy  PrivacyChecker     // optional: видимость фото профиля в кадре user_update
	pwFails  *failCounter       // счётчик неудачных попыток пароля на password_token
	recFails *failCounter       // счётчик неудачных кодов восстановления на password_token
	// resetWait — окно ожидания отложенного сброса аккаунта; 0 = дефолт (неделя).
	resetWait time.Duration
}

// EventPublisher pushes a realtime WS frame to a user's connected sessions.
// Optional (wired to the Redis publisher when available); mirrors the chat
// usecase's publisher. Used to broadcast user_update on profile changes.
type EventPublisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

// PartnersFunc returns the ids of users who share at least one chat with the
// given user — the user_update fan-out set. Wired to the chat usecase's
// ChatPartners, the same source presence fan-out uses.
type PartnersFunc func(ctx context.Context, userID int64) ([]int64, error)

// PrivacyChecker отвечает, видит ли viewer аспект key владельца ownerID
// (usecase/privacy) — тот же шов, что у presence. Здесь нужен ровно для
// profile_photo: кадр user_update несёт конструктор `user`, а в нём photo, и
// без проверки фото уехало бы мимо правила приватности. Не подключён — фото в
// кадре нет вовсе (безопасная деградация: клиент дочитает карточку ручкой).
type PrivacyChecker interface {
	Check(ctx context.Context, ownerID, viewerID int64, key domain.PrivacyKey) (bool, error)
}

// UpdateLog appends one row to a user's per-user update log and returns the new
// dense pts (same contract as the chat usecase's UpdateRepo.AppendUpdate). A
// profile change logs user_update to every recipient (own devices + shared-chat
// peers) so /sync catch-up replays it and the pts cursor stays dense. Optional —
// no-op when unwired (tests / no-DB setups).
type UpdateLog interface {
	AppendUpdate(ctx context.Context, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error)
}

// GeoResolver turns an IP into a human place ("Москва, Россия") and into an ISO
// 3166-1 alpha-2 country code ("RU"). Backed by a MaxMind GeoLite2 lookup;
// optional, so auth runs without it (both return "").
type GeoResolver interface {
	Locate(ip string) string
	Country(ip string) string
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

// NearestCountry — страна, из которой пришёл клиент, ISO 3166-1 alpha-2 в
// верхнем регистре (Telegram help.getNearestDc.country): экран входа
// преднастраивает по ней выбор страны в поле телефона.
//
// IP берётся из ClientInfo в контексте — тот же механизм, что наполняет
// местоположение сессии на экране активных сеансов. Определить не удалось (нет
// базы GeoIP, нет IP, приватный/петлевой адрес, нет записи) — это НЕ ошибка:
// возвращается "", клиент оставляет свой выбор по умолчанию.
func (i *Interactor) NearestCountry(ctx context.Context) string {
	if i.geo == nil {
		return ""
	}
	ip := clientInfoFromContext(ctx).IP
	if ip == "" {
		return ""
	}
	return i.geo.Country(ip)
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

func New(users UserRepo, devices DeviceRepo, codes CodeRepo, pw PasswordRepo, steps LoginStepRepo, devCode string, logf func(string, ...any)) *Interactor {
	return &Interactor{
		users: users, devices: devices, codes: codes, pw: pw, steps: steps,
		devCode: devCode, logf: logf,
		pwFails: newFailCounter(), recFails: newFailCounter(),
	}
}

func (i *Interactor) SetCache(c SessionCache)                    { i.cache = c }
func (i *Interactor) SetServiceNotifier(n ServiceNotifier)       { i.svc = n }
func (i *Interactor) SetGeoResolver(g GeoResolver)               { i.geo = g }
func (i *Interactor) SetRevocationNotifier(n RevocationNotifier) { i.revoker = n }
func (i *Interactor) SetQRStore(q QRStore)                       { i.qr = q }
func (i *Interactor) SetPremiumRepo(p PremiumRepo)               { i.premium = p }
func (i *Interactor) SetMailer(m Mailer)                         { i.mail = m }
func (i *Interactor) SetPublisher(p EventPublisher)              { i.pub = p }
func (i *Interactor) SetPartners(f PartnersFunc)                 { i.partners = f }
func (i *Interactor) SetUpdateLog(u UpdateLog)                   { i.updates = u }
func (i *Interactor) SetAvatarPreviewer(p AvatarPreviewer)       { i.previews = p }
func (i *Interactor) SetPrivacy(p PrivacyChecker)                { i.privacy = p }

// SetAccountResetWindow задаёт окно ожидания отложенного сброса аккаунта
// (ACCOUNT_RESET_WAIT). Неположительное значение оставляет дефолт — неделю.
func (i *Interactor) SetAccountResetWindow(d time.Duration) { i.resetWait = d }

func (i *Interactor) RequestCode(ctx context.Context, rawPhone string) error {
	phone := domain.NormalizePhone(rawPhone)
	if phone == "" {
		return errors.New("empty phone")
	}
	if err := i.codes.SaveCode(ctx, phone, i.devCode, time.Now().Add(codeTTL)); err != nil {
		return err
	}
	// Значение кода НЕ логируем (утечка OTP в логи, если devCode заменят реальной
	// доставкой). В dev код статичен — DEV_OTP_CODE (12345).
	i.logf("[otp] requested for phone=%s", phone)
	return nil
}

type SignInResult struct {
	Token string
	User  domain.UserRecord
	// Облачный пароль включён: вместо сессии выдан одноразовый PasswordToken —
	// клиент завершает вход через CheckPassword (Telegram SESSION_PASSWORD_NEEDED).
	PasswordNeeded bool
	PasswordToken  string
	Hint           string
	// Номер подтверждён, но аккаунта с ним нет: вместо сессии выдан одноразовый
	// SignUpToken — клиент показывает форму имени и зовёт SignUp
	// (Telegram auth.authorizationSignUpRequired).
	SignUpRequired bool
	SignUpToken    string
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
	user, err := i.users.ByPhone(ctx, phone)
	if errors.Is(err, domain.ErrNotFound) {
		// Незнакомый номер: аккаунт НЕ создаём — отправляем на шаг регистрации.
		return i.startSignUp(ctx, phone)
	}
	if err != nil {
		return SignInResult{}, err
	}
	// Второй фактор: при включённом облачном пароле сессия не выдаётся — только
	// короткий токен для шага «введите пароль».
	if res, needed, err := i.startPasswordStep(ctx, user.ID); err != nil {
		return SignInResult{}, err
	} else if needed {
		_ = i.codes.DeleteCode(ctx, phone)
		return res, nil
	}
	res, err := i.mintSession(ctx, user, deviceName, platform)
	if err != nil {
		return SignInResult{}, err
	}
	_ = i.codes.DeleteCode(ctx, phone)
	return res, nil
}

// startPasswordStep выдаёт одноразовый password_token, если у пользователя
// включён облачный пароль. needed=false — пароля нет, вход продолжается сессией.
// Общий шаг для SignIn и SignImport.
func (i *Interactor) startPasswordStep(ctx context.Context, userID int64) (SignInResult, bool, error) {
	if i.pw == nil {
		return SignInResult{}, false, nil
	}
	pwHash, hint, _, err := i.pw.Password(ctx, userID)
	if err != nil || pwHash == nil {
		return SignInResult{}, false, nil // нет пароля (или профиль не читается) — обычный вход
	}
	pwToken, pwTokenHash, err := domain.GenerateToken()
	if err != nil {
		return SignInResult{}, false, err
	}
	if err := i.pw.SavePasswordToken(ctx, pwTokenHash, userID, time.Now().Add(passwordTokenTTL)); err != nil {
		return SignInResult{}, false, err
	}
	return SignInResult{PasswordNeeded: true, PasswordToken: pwToken, Hint: hint}, true, nil
}

// mintSession выдаёт новую сессию (строка devices + токен) и шлёт login-alert.
// Общий хвост SignIn и CheckPassword.
func (i *Interactor) mintSession(ctx context.Context, user domain.UserRecord, deviceName, platform string) (SignInResult, error) {
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
	// Владелец вошёл — чужая попытка сброса аккаунта снимается. Общий хвост всех
	// веток входа: отмену вешаем здесь, а не в каждой из них.
	i.cancelAccountReset(ctx, user.ID)
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

func (i *Interactor) Authenticate(ctx context.Context, token string) (domain.UserRecord, int64, error) {
	hash := domain.HashToken(token)
	if i.cache != nil {
		if s, err := i.cache.GetSession(ctx, hash); err == nil && s != nil {
			return s.User, s.DeviceID, nil
		}
	}
	user, deviceID, err := i.devices.SessionByTokenHash(ctx, hash)
	if err != nil {
		return domain.UserRecord{}, 0, err
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
func (i *Interactor) ConfirmQRLogin(ctx context.Context, token string, user domain.UserRecord) error {
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
	// Единственная выдача сессии мимо mintSession (метаданные берутся из записи
	// QR, а не из запроса), поэтому отмена сброса дублируется здесь. Подтвердить
	// QR может только уже вошедший владелец — это его активность.
	i.cancelAccountReset(ctx, user.ID)
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
