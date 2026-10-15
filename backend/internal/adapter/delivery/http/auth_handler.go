package http

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// clientInfoFromRequest extracts the signing-in device's browser/OS (from the
// User-Agent) and IP (X-Forwarded-For when behind a proxy) for the login alert.
//
// Версия сборки клиента приезжает ЗАГОЛОВКОМ: у оригинала клиент называет себя
// в `initConnection` — преамбуле соединения, а не в теле каждого запроса, и
// заголовок это её прямой аналог. Так реквизит попадает во ВСЕ пути входа
// (код, пароль, восстановление, веб-токен, ключ доступа) одним местом, а не
// шестью полями в шести телах.
//
// Не доверяем ему ничего, кроме показа: строка попадает только в витрину
// сессий владельца. Длину режем — иначе клиент положил бы в колонку роман.
func clientInfoFromRequest(r *http.Request) usecaseauth.ClientInfo {
	browser, os := parseUserAgent(r.UserAgent())
	return usecaseauth.ClientInfo{
		Browser:    browser,
		OS:         os,
		IP:         clientIP(r),
		AppVersion: clientAppVersion(r),
	}
}

// appVersionHeader — заголовок, которым клиент называет свою версию сборки.
const appVersionHeader = "X-App-Version"

// maxAppVersionLen — потолок длины версии сборки В РУНАХ; у клиента она вида
// «0.1.0 (7)».
const maxAppVersionLen = 32

// clientAppVersion — версия сборки, которой клиент назвался, приведённая к
// тому, что БД согласна хранить.
//
// Значение заголовка — это БАЙТЫ, а не текст: клиент волен прислать любую
// последовательность от 0x20 и выше. Поэтому две операции, и обе обязательны.
//
//   - Невалидный UTF-8 выбрасывается. В колонку text такая строка не ложится:
//     Postgres отвергает INSERT, `mintSession` возвращает ошибку — и ВХОД
//     отвечает 500. То есть заголовок, который «просто показывают», умел
//     ронять вход.
//   - Режем по РУНАМ, а не по байтам. Срез посреди многобайтовой руны сам
//     создаёт невалидный UTF-8 из совершенно валимого заголовка — и прячется:
//     ровно на границе руны (16 кириллических букв = 32 байта) всё проходит.
func clientAppVersion(r *http.Request) string {
	v := strings.ToValidUTF8(strings.TrimSpace(r.Header.Get(appVersionHeader)), "")
	if utf8.RuneCountInString(v) > maxAppVersionLen {
		v = string([]rune(v)[:maxAppVersionLen])
	}
	return v
}

// clientIP — реальный IP клиента за доверенным обратным прокси (nginx). Клиент
// НЕ должен уметь его подделать: иначе смена заголовка обходит rate-limit/анти-
// брутфорс и подделывает IP/гео в login-alert.
//   - X-Real-IP nginx ставит в $remote_addr (реальный peer) и ПЕРЕЗАПИСЫВАЕТ
//     присланное клиентом — берём его в первую очередь.
//   - X-Forwarded-For клиент-контролируем в ЛЕВОЙ части; nginx добавляет реальный
//     peer в КОНЕЦ ($proxy_add_x_forwarded_for), поэтому fallback — ПРАВАЯ запись.
//   - Иначе (без прокси, тесты) — RemoteAddr.
func clientIP(r *http.Request) string {
	if xr := strings.TrimSpace(r.Header.Get("X-Real-IP")); xr != "" && net.ParseIP(xr) != nil {
		return xr
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if last := strings.TrimSpace(parts[len(parts)-1]); net.ParseIP(last) != nil {
			return last
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// parseUserAgent does a light, dependency-free best-effort parse of the browser
// and OS names. Order matters (Edge/Opera/Yandex masquerade as Chrome).
func parseUserAgent(ua string) (browser, os string) {
	switch {
	case strings.Contains(ua, "Windows NT 10"):
		os = "Windows 10"
	case strings.Contains(ua, "Windows"):
		os = "Windows"
	case strings.Contains(ua, "iPhone"):
		os = "iOS"
	case strings.Contains(ua, "iPad"):
		os = "iPadOS"
	case strings.Contains(ua, "Android"):
		os = "Android"
	case strings.Contains(ua, "Mac OS X"):
		os = "macOS"
	case strings.Contains(ua, "Linux"):
		os = "Linux"
	}
	switch {
	case strings.Contains(ua, "Edg/"):
		browser = "Edge"
	case strings.Contains(ua, "YaBrowser"):
		browser = "Yandex Browser"
	case strings.Contains(ua, "OPR/"), strings.Contains(ua, "Opera"):
		browser = "Opera"
	case strings.Contains(ua, "Firefox/"):
		browser = "Firefox"
	case strings.Contains(ua, "Chrome/"):
		browser = "Chrome"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}
	return
}

type AuthHandler struct {
	svc     *usecaseauth.Interactor
	limiter *keyRateLimiter // анти-брутфорс OTP/пароля по реальному IP + номеру
	// qrLimiter — лимиты QR-входа в отдельном экземпляре: ключи входа случайные
	// и одноразовые, им нужно короткое время простоя ведра (qrIdle). Лимитер в
	// памяти процесса — допущение одного экземпляра бэкенда.
	qrLimiter *keyRateLimiter
}

func NewAuthHandler(svc *usecaseauth.Interactor) *AuthHandler {
	return &AuthHandler{svc: svc, limiter: newKeyRateLimiter(), qrLimiter: newKeyRateLimiterIdle(qrIdle)}
}

type requestCodeBody struct {
	Phone string `json:"phone"`
}

func (h *AuthHandler) RequestCode(w http.ResponseWriter, r *http.Request) {
	var body requestCodeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Phone == "" {
		writeError(w, http.StatusBadRequest, "phone is required")
		return
	}
	// Троттлинг OTP-запроса: по IP (флуд) и по номеру (SMS-стоимость/спам жертве).
	if !h.limiter.allow("otp-ip:"+clientIP(r), 0.2, 5) || !h.limiter.allow("otp-phone:"+body.Phone, 0.1, 3) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	if err := h.svc.RequestCode(r.Context(), body.Phone); err != nil {
		writeError(w, http.StatusInternalServerError, "could not request code")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

type signInBody struct {
	Phone    string `json:"phone"`
	Code     string `json:"code"`
	Device   string `json:"device"`
	Platform string `json:"platform"`
}

func (h *AuthHandler) SignIn(w http.ResponseWriter, r *http.Request) {
	var body signInBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	// Анти-брутфорс OTP-кода по реальному IP.
	if !h.limiter.allow("signin-ip:"+clientIP(r), 0.5, 10) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	ctx := usecaseauth.WithClientInfo(r.Context(), clientInfoFromRequest(r))
	res, err := h.svc.SignIn(ctx, body.Phone, body.Code, body.Device, body.Platform)
	if errors.Is(err, domain.ErrInvalidCode) {
		writeError(w, http.StatusUnauthorized, "invalid code")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sign in failed")
		return
	}
	writeSignInResult(w, res)
}

// signInOutcome — исход шага входа КОНСТРУКТОРОМ объединения
// `auth.Authorization`. Прежде исход выяснялся наличием ключей
// (`password_needed`, `signup_required`), то есть «выключено» имело значение, а
// третья ветка не имела имени вовсе.
func signInOutcome(res usecaseauth.SignInResult) domain.AuthAuthorization {
	switch {
	// Включён облачный пароль — сессии нет, клиент идёт на шаг
	// POST /auth/check_password с одноразовым password_token.
	case res.PasswordNeeded:
		return domain.NewAuthPasswordNeeded(res.PasswordToken, res.Hint)
	// Номер подтверждён, аккаунта нет — клиент показывает форму имени и идёт на
	// POST /auth/sign_up.
	case res.SignUpRequired:
		return domain.NewAuthAuthorizationSignUpRequired(res.SignUpToken)
	default:
		// Карточка КРАТКАЯ: полной формы вход не отдаёт, её приносит первый /me.
		return domain.NewAuthAuthorization(res.Token, selfUser(res.User))
	}
}

// writeSignInResult — общий ответ всех путей входа: sign_in, sign_up,
// sign_import, check_password, восстановление пароля и вход по ключу доступа.
func writeSignInResult(w http.ResponseWriter, res usecaseauth.SignInResult) {
	writeJSON(w, http.StatusOK, signInOutcome(res))
}

type signUpBody struct {
	SignUpToken string `json:"signup_token"`
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	Device      string `json:"device"`
	Platform    string `json:"platform"`
}

// SignUp — регистрация нового номера (второй шаг после signup_required).
// Аватар сюда не передаётся: как и в tweb, он грузится уже под выданной сессией
// (POST /media/upload + POST /me/photos).
func (h *AuthHandler) SignUp(w http.ResponseWriter, r *http.Request) {
	var body signUpBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	// Анти-перебор токена регистрации по реальному IP (тот же бюджет, что у sign_in:
	// шаг регистрации — его прямое продолжение).
	if !h.limiter.allow("signup-ip:"+clientIP(r), 0.5, 10) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	ctx := usecaseauth.WithClientInfo(r.Context(), clientInfoFromRequest(r))
	res, err := h.svc.SignUp(ctx, body.SignUpToken, body.FirstName, body.LastName, body.Device, body.Platform)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusUnauthorized, "signup_token_expired")
		return
	case errors.Is(err, usecaseauth.ErrNameRequired):
		writeError(w, http.StatusBadRequest, "first_name_required")
		return
	case errors.Is(err, domain.ErrTooLong):
		writeError(w, http.StatusBadRequest, "name_too_long")
		return
	case errors.Is(err, domain.ErrConflict):
		writeError(w, http.StatusConflict, "phone_number_occupied")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "sign up failed")
		return
	}
	writeSignInResult(w, res)
}

type passwordTokenBody struct {
	PasswordToken string `json:"password_token"`
}

// RequestPasswordRecovery — «забыли пароль?»: отправляет код на привязанную
// почту и возвращает её маскированный вид.
func (h *AuthHandler) RequestPasswordRecovery(w http.ResponseWriter, r *http.Request) {
	var body passwordTokenBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	// Троттлинг по IP — поверх серверного таймера повторной отправки.
	if !h.limiter.allow("recover-ip:"+clientIP(r), 0.2, 5) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	res, err := h.svc.RequestPasswordRecovery(r.Context(), body.PasswordToken)
	switch {
	case errors.Is(err, usecaseauth.ErrResendTooSoon):
		// Остаток секунд едет ВНУТРИ кода ошибки, а не соседним ключом:
		// у конструктора `error` параметров ровно два (`code`, `text`), и
		// оригинал выражает ожидание так же — `FLOOD_WAIT_<N>`,
		// `2FA_CONFIRM_WAIT_<N>` (клиент вынимает число регуляркой,
		// tweb `getFloodWaitTime.ts`).
		writeError(w, http.StatusTooManyRequests, fmt.Sprintf("RESEND_TOO_SOON_%d", res.ResendAfter))
		return
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusUnauthorized, "password_token_expired")
		return
	case errors.Is(err, usecaseauth.ErrRecoveryUnavailable):
		writeError(w, http.StatusNotFound, "password_recovery_na")
		return
	case errors.Is(err, usecaseauth.ErrLoginStepsUnavailable):
		writeError(w, http.StatusServiceUnavailable, "password recovery unavailable")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "password recovery failed")
		return
	}
	// `resend_after` рядом больше нет: паузу повторной отправки держит сервер
	// (отказ `RESEND_TOO_SOON_<N>` выше), своего таймера клиент не заводит и
	// это число не читал.
	writeJSON(w, http.StatusOK, domain.NewAuthPasswordRecovery(res.EmailPattern))
}

type recoverConfirmBody struct {
	PasswordToken string `json:"password_token"`
	Code          string `json:"code"`
	Device        string `json:"device"`
	Platform      string `json:"platform"`
}

// ConfirmPasswordRecovery — код с почты: снимает облачный пароль и выдаёт сессию.
func (h *AuthHandler) ConfirmPasswordRecovery(w http.ResponseWriter, r *http.Request) {
	var body recoverConfirmBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	// Анти-перебор кода по реальному IP (в дополнение к лимиту попыток на токен).
	if !h.limiter.allow("recover-confirm-ip:"+clientIP(r), 0.2, 5) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	ctx := usecaseauth.WithClientInfo(r.Context(), clientInfoFromRequest(r))
	res, err := h.svc.ConfirmPasswordRecovery(ctx, body.PasswordToken, body.Code, body.Device, body.Platform)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusUnauthorized, "recovery_expired")
		return
	case errors.Is(err, domain.ErrInvalidCode):
		writeError(w, http.StatusUnauthorized, "invalid code")
		return
	case errors.Is(err, usecaseauth.ErrLoginStepsUnavailable):
		writeError(w, http.StatusServiceUnavailable, "password recovery unavailable")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "password recovery failed")
		return
	}
	writeSignInResult(w, res)
}

// ResetAccount — «забыли пароль?» при облачном пароле без привязанной почты:
// восстанавливать нечем, остаётся удалить аккаунт и начать заново. Публичная
// ручка: авторизует сам одноразовый password_token.
//
// Удаление отложенное, поэтому 200 отдаётся только на вызове, который его
// исполнил. Первый вызов планирует и отвечает 409 2fa_confirm_wait с остатком
// секунд, а если владелец успел войти — 409 2fa_recent_confirm (Telegram
// 2FA_CONFIRM_WAIT_<N> / 2FA_RECENT_CONFIRM).
func (h *AuthHandler) ResetAccount(w http.ResponseWriter, r *http.Request) {
	var body passwordTokenBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	// Анти-перебор password_token по реальному IP — тот же бюджет, что у остальных
	// ветвей шага пароля (check_password, password/recover).
	if !h.limiter.allow("reset-ip:"+clientIP(r), 0.2, 5) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	retryAfter, err := h.svc.ResetAccount(r.Context(), body.PasswordToken)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusUnauthorized, "password_token_expired")
		return
	case errors.Is(err, usecaseauth.ErrResetPending):
		// Форма оригинала названа прямо в докблоке ручки: `2FA_CONFIRM_WAIT_<N>`.
		writeError(w, http.StatusConflict, fmt.Sprintf("2FA_CONFIRM_WAIT_%d", retryAfter))
		return
	case errors.Is(err, usecaseauth.ErrResetRecentConfirm):
		writeError(w, http.StatusConflict, "2fa_recent_confirm")
		return
	case errors.Is(err, usecaseauth.ErrRecoveryAvailable):
		writeError(w, http.StatusConflict, "recovery_available")
		return
	case errors.Is(err, usecaseauth.ErrLoginStepsUnavailable):
		writeError(w, http.StatusServiceUnavailable, "account reset unavailable")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "account reset failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// NearestCountry — страна клиента по его IP (Telegram help.getNearestDc): экран
// входа преднастраивает по ней выбор страны. Определить не удалось — пустая
// строка со статусом 200, это штатный исход, а не ошибка.
func (h *AuthHandler) NearestCountry(w http.ResponseWriter, r *http.Request) {
	// Щадящий лимит: ручка дёргается на каждом открытии экрана входа, а утечки
	// в ней нет — только защита от флуда.
	if !h.limiter.allow("nearest-ip:"+clientIP(r), 1, 20) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	// Тот же путь IP → GeoIP, что наполняет местоположение активных сессий.
	ctx := usecaseauth.WithClientInfo(r.Context(), usecaseauth.ClientInfo{IP: clientIP(r)})
	writeJSON(w, http.StatusOK, domain.NewHelpCountryCode(h.svc.NearestCountry(ctx)))
}

type signImportBody struct {
	WebAuthToken string `json:"web_auth_token"`
	Device       string `json:"device"`
	Platform     string `json:"platform"`
}

// SignImport меняет одноразовый веб-токен (#?tgWebAuthToken=…) на сессию.
func (h *AuthHandler) SignImport(w http.ResponseWriter, r *http.Request) {
	var body signImportBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	// Анти-перебор веб-токена по реальному IP.
	if !h.limiter.allow("import-ip:"+clientIP(r), 0.2, 5) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	ctx := usecaseauth.WithClientInfo(r.Context(), clientInfoFromRequest(r))
	res, err := h.svc.SignImport(ctx, body.WebAuthToken, body.Device, body.Platform)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusUnauthorized, "web_auth_token_invalid")
		return
	case errors.Is(err, usecaseauth.ErrLoginStepsUnavailable):
		writeError(w, http.StatusServiceUnavailable, "web token login unavailable")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "sign import failed")
		return
	}
	writeSignInResult(w, res)
}

// CancelWebToken сжигает веб-токен, который клиент не стал импортировать
// (auth.cancelWebTokenAuthorization). Ответ — boolTrue и для токена, который
// сервер уже забыл. Ведро то же, что у SignImport: отмена не даёт лишних попыток
// перебора. Следствие: если импорт получил 429, отмена получит его же — токен
// доживёт до своего TTL (5 мин); принято планом М1-4.
func (h *AuthHandler) CancelWebToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WebAuthToken string `json:"web_auth_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.WebAuthToken == "" {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if !h.limiter.allow("import-ip:"+clientIP(r), 0.2, 5) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	switch err := h.svc.CancelWebAuthToken(r.Context(), body.WebAuthToken); {
	case errors.Is(err, usecaseauth.ErrLoginStepsUnavailable):
		writeError(w, http.StatusServiceUnavailable, "web token login unavailable")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "cancel failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// NewWebAuthToken выпускает одноразовый веб-токен входа для текущей сессии —
// его отдают другому веб-клиенту в ссылке #?tgWebAuthToken=…
func (h *AuthHandler) NewWebAuthToken(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !h.limiter.allow("webtoken-user:"+strconv.FormatInt(u.ID, 10), 0.2, 5) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	token, expiresAt, err := h.svc.NewWebAuthToken(r.Context(), u.ID)
	if errors.Is(err, usecaseauth.ErrLoginStepsUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "web token login unavailable")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue web token")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewAuthWebAuthToken(token, expiresAt))
}

type checkPasswordBody struct {
	PasswordToken string `json:"password_token"`
	Password      string `json:"password"`
	Device        string `json:"device"`
	Platform      string `json:"platform"`
}

// CheckPassword — второй шаг входа при включённом облачном пароле.
func (h *AuthHandler) CheckPassword(w http.ResponseWriter, r *http.Request) {
	var body checkPasswordBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	// Анти-брутфорс облачного пароля по реальному IP (в дополнение к лимиту попыток
	// на сам password_token в usecase).
	if !h.limiter.allow("pw-ip:"+clientIP(r), 0.2, 5) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	ctx := usecaseauth.WithClientInfo(r.Context(), clientInfoFromRequest(r))
	res, err := h.svc.CheckPassword(ctx, body.PasswordToken, body.Password, body.Device, body.Platform)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusUnauthorized, "password_token_expired")
		return
	}
	if errors.Is(err, domain.ErrBadPassword) {
		writeError(w, http.StatusUnauthorized, "invalid password")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "check password failed")
		return
	}
	writeSignInResult(w, res)
}

// loginKeyHeader — ключ входа QR: 32 случайных байта, которые экспортёр
// генерирует сам и НЕ показывает (в QR только код). Право забрать сессию живёт в
// нём, а не в коде: код видит любой, кто смотрит на экран.
const loginKeyHeader = "X-Login-Key"

// qrIdle — срок простоя ведра QR-лимитера: ключи случайные и одноразовые, и без
// короткого срока они раздували бы карту общего лимитера.
const qrIdle = time.Minute

// Предельные размеры тела экспорта: аккаунтов на одном устройстве немного.
const (
	qrMaxExceptIDs = 20
	qrMaxPlatform  = 32
	qrMaxBody      = 4 << 10 // байт: 20 id и короткая строка влезают с запасом
)

type exportLoginTokenBody struct {
	ExceptIDs []int64 `json:"except_ids"`
	Platform  string  `json:"platform"`
}

// parseLoginKey разбирает ключ входа: ровно 64 шестнадцатеричных символа нижнего
// регистра. Возвращает его хеш — им адресуется запись в хранилище.
func parseLoginKey(r *http.Request) (keyHash string, ok bool) {
	k := r.Header.Get(loginKeyHeader)
	if len(k) != 64 || strings.ToLower(k) != k {
		return "", false
	}
	if _, err := hex.DecodeString(k); err != nil {
		return "", false
	}
	return domain.HashToken(k), true
}

// writeFloodWait — лимит как у оригинала: 420 FLOOD_WAIT_<N>, N — секунды.
func writeFloodWait(w http.ResponseWriter, waitSec int) {
	writeError(w, 420, fmt.Sprintf("FLOOD_WAIT_%d", waitSec))
}

// ExportLoginToken — auth.exportLoginToken. Публичная: вызывающее устройство ещё
// не вошло. Опрашивается раз в несколько секунд (цикл iterate у tweb).
func (h *AuthHandler) ExportLoginToken(w http.ResponseWriter, r *http.Request) {
	keyHash, ok := parseLoginKey(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "LOGIN_KEY_INVALID")
		return
	}
	// Лимиты — ДО разбора тела: ручка публичная, и тело не должно стоить памяти
	// тому, кого всё равно откажут. Сначала IP (несколько карточек за одним NAT),
	// и только пропущенный по IP запрос заводит ведро ключа.
	if ok, wait := h.qrLimiter.allowWait("qrexport-ip:"+clientIP(r), 5, 50); !ok {
		writeFloodWait(w, wait)
		return
	}
	if ok, wait := h.qrLimiter.allowWait("qrexport-key:"+keyHash, 1, 5); !ok {
		writeFloodWait(w, wait)
		return
	}
	var body exportLoginTokenBody
	r.Body = http.MaxBytesReader(w, r.Body, qrMaxBody)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
		len(body.ExceptIDs) > qrMaxExceptIDs || len(body.Platform) > qrMaxPlatform {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	ctx := usecaseauth.WithClientInfo(r.Context(), clientInfoFromRequest(r))
	res, err := h.svc.ExportLoginToken(ctx, keyHash, body.ExceptIDs, body.Platform)
	switch {
	case errors.Is(err, usecaseauth.ErrQRUnavailable):
		writeError(w, http.StatusServiceUnavailable, "qr login unavailable")
		return
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "AUTH_TOKEN_EXPIRED")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "export login token failed")
		return
	}
	switch {
	case res.Session != nil:
		// Тот же исход входа, что у обычного шага: вложенный конструктор.
		writeJSON(w, http.StatusOK, domain.NewAuthLoginTokenSuccess(
			domain.NewAuthAuthorization(res.Session.Token, selfUser(res.Session.User))))
	case res.Password != nil:
		writeJSON(w, http.StatusOK, domain.NewAuthLoginTokenSuccess(
			domain.NewAuthPasswordNeeded(res.Password.PasswordToken, res.Password.Hint)))
	default:
		// `token` у схемы БАЙТЫ; ссылку для сканера строит клиент от своего origin.
		raw, err := hex.DecodeString(res.Pending.Token)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "export login token failed")
			return
		}
		writeJSON(w, http.StatusOK, domain.NewAuthLoginToken(raw, res.Pending.ExpiresAt))
	}
}

type acceptLoginTokenBody struct {
	Token string `json:"token"`
}

// AcceptLoginToken — auth.acceptLoginToken: вошедшее устройство подтверждает код
// с экрана другого. Любой отказ — 404 AUTH_TOKEN_EXPIRED (код неизвестен,
// протух, принят, или аккаунт уже вошёл на устройстве-экспортёре).
func (h *AuthHandler) AcceptLoginToken(w http.ResponseWriter, r *http.Request) {
	var body acceptLoginTokenBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Token == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}
	user, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if ok, wait := h.qrLimiter.allowWait("qraccept-ip:"+clientIP(r), 0.2, 5); !ok {
		writeFloodWait(w, wait)
		return
	}
	authz, err := h.svc.AcceptLoginToken(r.Context(), body.Token, user)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "AUTH_TOKEN_EXPIRED")
	case errors.Is(err, usecaseauth.ErrQRUnavailable):
		writeError(w, http.StatusServiceUnavailable, "qr login unavailable")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "accept login token failed")
	default:
		writeJSON(w, http.StatusOK, authz)
	}
}

// writeJSON — витрина на проводе. Имя осталось прежним, но формат теперь
// выбирает не она: если запрос попросил TL заголовком `Accept`, тело уезжает
// байтами схемы (см. wiretl.go). Витрине об этом знать нечего — она отдаёт
// ЗНАЧЕНИЕ, а не текст.
func writeJSON(w http.ResponseWriter, status int, v any) {
	if encodeTL(w, status, v) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError — тело ответа-ошибки.
//
// В оригинале ошибка заменяет результат в ТРАНСПОРТЕ (`rpc_error`, секция
// MTProto, ловится в `networker.ts:1948`), а не приезжает витриной метода. У нас
// эту позицию занимает статус HTTP; телу остаётся объявленный конструктор
// `error{code, text}` — разбор в docs/readiness/tl-rest-analysis.md, Р3.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, domain.NewError(status, msg))
}
