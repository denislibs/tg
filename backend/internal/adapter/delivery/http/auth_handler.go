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

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// clientInfoFromRequest extracts the signing-in device's browser/OS (from the
// User-Agent) and IP (X-Forwarded-For when behind a proxy) for the login alert.
func clientInfoFromRequest(r *http.Request) usecaseauth.ClientInfo {
	browser, os := parseUserAgent(r.UserAgent())
	return usecaseauth.ClientInfo{Browser: browser, OS: os, IP: clientIP(r)}
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
}

func NewAuthHandler(svc *usecaseauth.Interactor) *AuthHandler {
	return &AuthHandler{svc: svc, limiter: newKeyRateLimiter()}
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
// (POST /media/upload + PUT /me/avatar).
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

type qrNewBody struct {
	Platform string `json:"platform"`
}

func (h *AuthHandler) QRNew(w http.ResponseWriter, r *http.Request) {
	var body qrNewBody
	_ = json.NewDecoder(r.Body).Decode(&body) // platform optional
	token, expiresAt, err := h.svc.NewQRLogin(r.Context(), body.Platform)
	if errors.Is(err, usecaseauth.ErrQRUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "qr login unavailable")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not start qr login")
		return
	}
	// Ссылку для сканера строит клиент от своего origin: серверную он и раньше
	// игнорировал (за прокси она теряла порт), так что адрес ехал дважды, а
	// читали его один раз.
	out, err := qrLoginToken(token, expiresAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not start qr login")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// qrLoginToken — конструктор выпущенного кода. `token` у схемы БАЙТЫ, а
// маршрут `/auth/qr/{token}` берёт ту же величину шестнадцатеричной записью
// (domain.GenerateToken).
func qrLoginToken(token string, expiresAt time.Time) (domain.AuthLoginTokenReal, error) {
	raw, err := hex.DecodeString(token)
	if err != nil {
		return domain.AuthLoginTokenReal{}, err
	}
	return domain.NewAuthLoginToken(raw, expiresAt), nil
}

func (h *AuthHandler) QRStatus(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	rec, err := h.svc.QRStatus(r.Context(), token)
	if errors.Is(err, domain.ErrNotFound) {
		// Протухший код — ОТКАЗ, а не третий конструктор объединения: так у
		// оригинала (`AUTH_TOKEN_EXPIRED`). Прежде ехало `{"status":"expired"}`
		// со статусом 200, то есть «не получилось» витриной успеха.
		writeError(w, http.StatusNotFound, "AUTH_TOKEN_EXPIRED")
		return
	}
	if errors.Is(err, usecaseauth.ErrQRUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "qr login unavailable")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "qr status failed")
		return
	}
	if rec.Status == domain.QRConfirmed {
		// Подтверждённый код несёт ТОТ ЖЕ исход входа, что и обычный шаг:
		// прежде сессия и карточка ехали соседними ключами — второй формой
		// одного предмета.
		writeJSON(w, http.StatusOK, domain.NewAuthLoginTokenSuccess(
			domain.NewAuthAuthorization(rec.SessionToken, selfUser(rec.User))))
		return
	}
	out, err := qrLoginToken(token, rec.CreatedAt.Add(usecaseauth.QRLoginTTL))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "qr status failed")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type qrConfirmBody struct {
	Token string `json:"token"`
}

func (h *AuthHandler) QRConfirm(w http.ResponseWriter, r *http.Request) {
	var body qrConfirmBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Token == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}
	user, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	err := h.svc.ConfirmQRLogin(r.Context(), body.Token, user)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "invalid or expired token")
		return
	}
	if errors.Is(err, usecaseauth.ErrQRUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "qr login unavailable")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "qr confirm failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
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
