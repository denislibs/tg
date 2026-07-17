package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// PasswordHandler — облачный пароль (Two-Step Verification):
// GET/POST/DELETE /me/password.
type PasswordHandler struct{ uc *usecaseauth.Interactor }

func NewPasswordHandler(uc *usecaseauth.Interactor) *PasswordHandler { return &PasswordHandler{uc: uc} }

// State — GET /me/password: {enabled, hint, email(маскированный)}.
func (h *PasswordHandler) State(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	st, err := h.uc.PasswordState(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": st.Enabled, "hint": st.Hint, "email": st.Email})
}

// Set — POST /me/password {current_password?, new_password, hint, email}.
func (h *PasswordHandler) Set(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
		Hint            string `json:"hint"`
		Email           string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	err := h.uc.SetPassword(r.Context(), user.ID, b.CurrentPassword, b.NewPassword, b.Hint, b.Email)
	if errors.Is(err, domain.ErrBadPassword) {
		writeError(w, http.StatusForbidden, "invalid password")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Verify — POST /me/password/verify {password}: проверка текущего пароля
// перед входом в настройки 2FA.
func (h *PasswordHandler) Verify(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	err := h.uc.VerifyPassword(r.Context(), user.ID, b.Password)
	if errors.Is(err, domain.ErrBadPassword) {
		writeError(w, http.StatusForbidden, "invalid password")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Remove — DELETE /me/password {current_password}.
func (h *PasswordHandler) Remove(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		CurrentPassword string `json:"current_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	err := h.uc.RemovePassword(r.Context(), user.ID, b.CurrentPassword)
	if errors.Is(err, domain.ErrBadPassword) {
		writeError(w, http.StatusForbidden, "invalid password")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
