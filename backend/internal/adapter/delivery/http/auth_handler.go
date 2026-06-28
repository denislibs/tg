package http

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
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

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
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

type AuthHandler struct{ svc *usecaseauth.Interactor }

func NewAuthHandler(svc *usecaseauth.Interactor) *AuthHandler { return &AuthHandler{svc: svc} }

type requestCodeBody struct {
	Phone string `json:"phone"`
}

func (h *AuthHandler) RequestCode(w http.ResponseWriter, r *http.Request) {
	var body requestCodeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Phone == "" {
		writeError(w, http.StatusBadRequest, "phone is required")
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
		resp["user"] = map[string]any{
			"id":           rec.User.ID,
			"phone":        rec.User.Phone,
			"display_name": rec.User.DisplayName,
		}
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
