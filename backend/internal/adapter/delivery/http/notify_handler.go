package http

import (
	"encoding/json"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecasenotify "github.com/messenger-denis/backend/internal/usecase/notify"
)

// NotifyHandler — глобальные настройки уведомлений (страница
// «Notifications and Sounds»): GET/PUT /me/notify_settings.
type NotifyHandler struct{ uc *usecasenotify.Interactor }

func NewNotifyHandler(uc *usecasenotify.Interactor) *NotifyHandler { return &NotifyHandler{uc: uc} }

func (h *NotifyHandler) Get(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	s, err := h.uc.Get(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, notifySettingsJSON(s))
}

type notifyTypePatchJSON struct {
	Muted   *bool `json:"muted"`
	Preview *bool `json:"preview"`
}

func (h *NotifyHandler) Update(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		Private  notifyTypePatchJSON `json:"private"`
		Groups   notifyTypePatchJSON `json:"groups"`
		Channels notifyTypePatchJSON `json:"channels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	s, err := h.uc.Update(r.Context(), user.ID, usecasenotify.Patch{
		Private:  usecasenotify.TypePatch{Muted: b.Private.Muted, Preview: b.Private.Preview},
		Groups:   usecasenotify.TypePatch{Muted: b.Groups.Muted, Preview: b.Groups.Preview},
		Channels: usecasenotify.TypePatch{Muted: b.Channels.Muted, Preview: b.Channels.Preview},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, notifySettingsJSON(s))
}

func notifySettingsJSON(s domain.NotifySettings) map[string]any {
	typeJSON := func(t domain.NotifyTypeSettings) map[string]any {
		return map[string]any{"muted": t.Muted, "preview": t.Preview}
	}
	return map[string]any{
		"private":  typeJSON(s.Private),
		"groups":   typeJSON(s.Groups),
		"channels": typeJSON(s.Channels),
	}
}
