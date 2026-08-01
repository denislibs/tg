package http

import (
	"encoding/json"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseiv "github.com/messenger-denis/backend/internal/usecase/iv"
	usecasepush "github.com/messenger-denis/backend/internal/usecase/push"
)

type PushHandler struct {
	subs      usecasepush.SubRepo
	publicKey string
}

func NewPushHandler(subs usecasepush.SubRepo, publicKey string) *PushHandler {
	return &PushHandler{subs: subs, publicKey: publicKey}
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
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" || body.P256dh == "" || body.Auth == "" {
		writeError(w, http.StatusBadRequest, "endpoint, p256dh, auth required")
		return
	}
	// Anti-SSRF: endpoint задаёт клиент. Раннее отклонение не-http(s)/относительных
	// URL; резолв хоста и запрет private/loopback — на самой отправке (safe-клиент).
	if _, err := usecaseiv.ParseTargetURL(body.Endpoint); err != nil {
		writeError(w, http.StatusBadRequest, "invalid endpoint")
		return
	}
	if err := h.subs.Add(r.Context(), deviceID, domain.PushSubscription{
		Endpoint: body.Endpoint, P256dh: body.P256dh, Auth: body.Auth,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not subscribe")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
