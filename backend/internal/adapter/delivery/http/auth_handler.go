package http

import (
	"encoding/json"
	"errors"
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
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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

// writeSignInResult сериализует исход входа: сессия, шаг облачного пароля или
// шаг регистрации. Общий ответ для sign_in и sign_import.
func writeSignInResult(w http.ResponseWriter, res usecaseauth.SignInResult) {
	// Включён облачный пароль — сессии нет, клиент идёт на шаг
	// POST /auth/check_password с одноразовым password_token.
	if res.PasswordNeeded {
		writeJSON(w, http.StatusOK, map[string]any{
			"password_needed": true,
			"password_token":  res.PasswordToken,
			"hint":            res.Hint,
		})
		return
	}
	// Номер подтверждён, аккаунта нет — клиент показывает форму имени и идёт на
	// POST /auth/sign_up (Telegram auth.authorizationSignUpRequired).
	if res.SignUpRequired {
		writeJSON(w, http.StatusOK, map[string]any{
			"signup_required": true,
			"signup_token":    res.SignUpToken,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": res.Token,
		"user":  userJSON(res.User),
	})
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
		writeJSON(w, http.StatusTooManyRequests, map[string]any{
			"error":       "resend_too_soon",
			"retry_after": res.ResendAfter,
		})
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
	writeJSON(w, http.StatusOK, map[string]any{
		"email_pattern": res.EmailPattern,
		"resend_after":  res.ResendAfter,
	})
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
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":       "2fa_confirm_wait",
			"retry_after": retryAfter,
		})
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
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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
	writeJSON(w, http.StatusOK, map[string]string{"country_code": h.svc.NearestCountry(ctx)})
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
	writeJSON(w, http.StatusOK, map[string]any{
		"token":      token,
		"expires_at": expiresAt.UTC().Format(time.RFC3339),
	})
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
	writeJSON(w, http.StatusOK, map[string]any{
		"token": res.Token,
		"user":  userJSON(res.User),
	})
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
	// Build the scan URL from the request origin so a confirming device lands on
	// the SPA's /qr/{token} route. Fall back to Host when Origin is absent.
	origin := r.Header.Get("Origin")
	if origin == "" {
		scheme := "https"
		if r.TLS == nil {
			scheme = "http"
		}
		origin = scheme + "://" + r.Host
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token":      token,
		"url":        origin + "/qr/" + token,
		"expires_at": expiresAt.UTC().Format(time.RFC3339),
	})
}

func (h *AuthHandler) QRStatus(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	rec, err := h.svc.QRStatus(r.Context(), token)
	if errors.Is(err, domain.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "expired"})
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
	resp := map[string]any{"status": rec.Status}
	if rec.Status == domain.QRConfirmed {
		resp["session_token"] = rec.SessionToken
		// Подтверждённый QR отдаёт того же пользователя тем же конструктором,
		// что и остальные витрины: своей формы у этого ответа больше нет.
		resp["user"] = rec.User.ToUser(domain.UserFlags{Self: true}, nil, true)
	}
	writeJSON(w, http.StatusOK, resp)
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
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
