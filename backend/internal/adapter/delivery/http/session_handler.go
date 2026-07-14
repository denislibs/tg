package http

import (
	"net/http"

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
	out := make([]map[string]any, 0, len(devices))
	for _, d := range devices {
		out = append(out, map[string]any{
			"id": d.ID, "name": d.Name, "platform": d.Platform,
			"last_active": d.LastActive, "current": d.ID == current,
			"ip": d.IP, "location": d.Location,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": out})
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
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
