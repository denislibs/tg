package http

import (
	"encoding/json"
	"net/http"

	"github.com/messenger-denis/backend/internal/push"
)

type PushHandler struct {
	repo      *push.Repo
	publicKey string
}

func NewPushHandler(repo *push.Repo, publicKey string) *PushHandler {
	return &PushHandler{repo: repo, publicKey: publicKey}
}

func (h *PushHandler) VAPIDPublicKey(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"public_key": h.publicKey})
}

type subscribeBody struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"`
	Auth     string `json:"auth"`
}

func (h *PushHandler) Subscribe(w http.ResponseWriter, r *http.Request) {
	deviceID, ok := DeviceIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	var body subscribeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" {
		writeError(w, http.StatusBadRequest, "endpoint, p256dh, auth required")
		return
	}
	if err := h.repo.AddSubscription(r.Context(), deviceID, push.Subscription{
		Endpoint: body.Endpoint, P256dh: body.P256dh, Auth: body.Auth,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not subscribe")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
