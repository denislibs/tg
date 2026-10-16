package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/messenger-denis/backend/internal/adapter/delivery/netx"
	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// PasswordHandler — облачный пароль (Two-Step Verification):
// GET/POST/DELETE /me/password.
//
// Ручки, проверяющие пароль (Set/Verify/Remove), ограничены частотой ДО
// сравнения — иначе с украденной сессией пароль подбирается со скоростью
// сервера (Б-4). Лимитер в памяти процесса — допущение одного экземпляра,
// как у AuthHandler; растущее ожидание и общий счётчик — М-1 (М1-5).
type PasswordHandler struct {
	uc      *usecaseauth.Interactor
	limiter *keyRateLimiter
}

func NewPasswordHandler(uc *usecaseauth.Interactor) *PasswordHandler {
	return &PasswordHandler{uc: uc, limiter: newKeyRateLimiter()}
}

// Ведра проверки пароля: сначала IP (как `pw-ip:` у check_password — 0.2 rps,
// burst 5), затем пара «пользователь, сессия»: 5 попыток, дальше одна в минуту.
// Ключ по сессии, а не по пользователю: сценарий Б-4 — украденная сессия, и
// укравший, выбирая общее ведро пользователя, запирал бы владельцу смену
// пароля из его собственной сессии.
const (
	pwUserRPS   = 1.0 / 60
	pwUserBurst = 5
)

// allowCheck — пускает ли проверку пароля; при отказе уже написан 420
// FLOOD_WAIT_<N> (tweb ждёт N секунд и повторяет, apiManager.ts:759-791).
func (h *PasswordHandler) allowCheck(w http.ResponseWriter, r *http.Request, user domain.UserRecord, deviceID int64) bool {
	if ok, wait := h.limiter.allowWait("mepw-ip:"+netx.ClientIP(r), 0.2, 5); !ok {
		writeFloodWait(w, wait)
		return false
	}
	if ok, wait := h.limiter.allowWait(fmt.Sprintf("mepw-user:%d:%d", user.ID, deviceID), pwUserRPS, pwUserBurst); !ok {
		writeFloodWait(w, wait)
		return false
	}
	return true
}

// State — GET /me/password: {enabled, hint, email(маскированный)}.
func (h *PasswordHandler) State(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	st, err := h.uc.PasswordState(r.Context(), user.ID)
	if err != nil {
		writeDomainError(w, err, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": st.Enabled, "hint": st.Hint, "email": st.Email})
}

// Set — POST /me/password {current_password?, new_password, hint, email}.
func (h *PasswordHandler) Set(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	deviceID, _ := DeviceIDFromContext(r.Context())
	if !h.allowCheck(w, r, user, deviceID) {
		return
	}
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
	err := h.uc.SetPassword(r.Context(), user.ID, deviceID, b.CurrentPassword, b.NewPassword, b.Hint, b.Email)
	if errors.Is(err, domain.ErrBadPassword) {
		writeError(w, http.StatusForbidden, "invalid password")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// Verify — POST /me/password/verify {password}: проверка текущего пароля
// перед входом в настройки 2FA.
func (h *PasswordHandler) Verify(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	deviceID, _ := DeviceIDFromContext(r.Context())
	if !h.allowCheck(w, r, user, deviceID) {
		return
	}
	var b struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	err := h.uc.VerifyPassword(r.Context(), user.ID, deviceID, b.Password)
	if errors.Is(err, domain.ErrBadPassword) {
		writeError(w, http.StatusForbidden, "invalid password")
		return
	}
	if err != nil {
		writeDomainError(w, err, "internal")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// Remove — DELETE /me/password {current_password}.
func (h *PasswordHandler) Remove(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	deviceID, _ := DeviceIDFromContext(r.Context())
	if !h.allowCheck(w, r, user, deviceID) {
		return
	}
	var b struct {
		CurrentPassword string `json:"current_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	err := h.uc.RemovePassword(r.Context(), user.ID, deviceID, b.CurrentPassword)
	if errors.Is(err, domain.ErrBadPassword) {
		writeError(w, http.StatusForbidden, "invalid password")
		return
	}
	if err != nil {
		writeDomainError(w, err, "internal")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}
