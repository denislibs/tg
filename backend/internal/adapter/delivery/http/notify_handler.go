package http

import (
	"encoding/json"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecasenotify "github.com/messenger-denis/backend/internal/usecase/notify"
)

// NotifyHandler — глобальные настройки уведомлений по типу чатов (страница
// «Notifications and Sounds»): account.getNotifySettings / updateNotifySettings
// с адресом notifyUsers | notifyChats | notifyBroadcasts в ?peer=.
type NotifyHandler struct{ uc *usecasenotify.Interactor }

func NewNotifyHandler(uc *usecasenotify.Interactor) *NotifyHandler { return &NotifyHandler{uc: uc} }

// notifyTypeParam разбирает ?peer=; нет или неизвестный — 400.
func notifyTypeParam(w http.ResponseWriter, r *http.Request) (domain.NotifyType, bool) {
	t, ok := domain.ParseNotifyType(r.URL.Query().Get("peer"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid request")
	}
	return t, ok
}

// Get — GET /me/notify_settings?peer=… → peerNotifySettings{show_previews, mute_until}.
func (h *NotifyHandler) Get(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	t, ok := notifyTypeParam(w, r)
	if !ok {
		return
	}
	s, err := h.uc.Get(r.Context(), user.ID, t)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// Update — PUT /me/notify_settings?peer=… с телом inputPeerNotifySettings → Bool(true).
func (h *NotifyHandler) Update(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	t, ok := notifyTypeParam(w, r)
	if !ok {
		return
	}
	var in domain.InputPeerNotifySettings
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if in.Underscore != domain.InputPeerNotifySettingsTag {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.uc.Update(r.Context(), user.ID, t, in); err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}
