package http

import (
	"net/http"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

type SessionHandler struct{ svc *usecaseauth.Interactor }

func NewSessionHandler(svc *usecaseauth.Interactor) *SessionHandler { return &SessionHandler{svc: svc} }

func (h *SessionHandler) List(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	current, _ := DeviceIDFromContext(r.Context())
	devices, err := h.svc.ListSessions(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list sessions")
		return
	}
	// «Текущая» — ФЛАГ конструктора, а не булево поле рядом: прежде ехало
	// `current: false`, то есть «выключено» имело значение.
	out := make([]domain.Authorization, 0, len(devices))
	for _, d := range devices {
		out = append(out, // Даты создания у строки устройства нет — только последняя активность;
			// названо в OmittedWithoutSubject.
			domain.NewAuthorization(d.ID, d.Name, d.Platform, d.IP, d.Location, time.Time{}, d.LastActive, d.ID == current))
	}
	writeJSON(w, http.StatusOK, domain.NewAccountAuthorizations(out))
}

// RevokeOthers terminates every session except the current one.
func (h *SessionHandler) RevokeOthers(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	current, ok := DeviceIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	n, err := h.svc.RevokeOtherSessions(r.Context(), user.ID, current)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not revoke sessions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "revoked": n})
}

func (h *SessionHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	deviceID, ok := pathInt(w, r, "deviceID")
	if !ok {
		return
	}
	revoked, err := h.svc.RevokeSession(r.Context(), user.ID, deviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not revoke session")
		return
	}
	if !revoked {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *SessionHandler) Logout(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	deviceID, ok := DeviceIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	if _, err := h.svc.RevokeSession(r.Context(), user.ID, deviceID); err != nil {
		writeError(w, http.StatusInternalServerError, "logout failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}
