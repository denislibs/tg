package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/auth"
)

type AuthHandler struct{ svc *auth.Service }

func NewAuthHandler(svc *auth.Service) *AuthHandler { return &AuthHandler{svc: svc} }

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
	res, err := h.svc.SignIn(r.Context(), body.Phone, body.Code, body.Device, body.Platform)
	if errors.Is(err, auth.ErrInvalidCode) {
		writeError(w, http.StatusUnauthorized, "invalid code")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sign in failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": res.Token,
		"user": map[string]any{
			"id":           res.User.ID,
			"phone":        res.User.Phone,
			"display_name": res.User.DisplayName,
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
