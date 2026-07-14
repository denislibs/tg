package http

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// ICEHandler issues the ICE server list for WebRTC calls. TURN credentials are
// ephemeral (coturn "REST API" / use-auth-secret scheme): username is a unix
// expiry timestamp and credential = base64(HMAC-SHA1(secret, username)), so no
// long-lived TURN password ever reaches a client.
type ICEHandler struct {
	turnHost   string // empty → STUN only (same-network calls still work)
	turnSecret string
	ttl        time.Duration
}

func NewICEHandler(turnHost, turnSecret string) *ICEHandler {
	return &ICEHandler{turnHost: turnHost, turnSecret: turnSecret, ttl: time.Hour}
}

func (h *ICEHandler) Get(w http.ResponseWriter, r *http.Request) {
	servers := []map[string]any{
		{"urls": []string{"stun:stun.l.google.com:19302"}},
	}
	if h.turnHost != "" {
		username := strconv.FormatInt(time.Now().Add(h.ttl).Unix(), 10)
		mac := hmac.New(sha1.New, []byte(h.turnSecret))
		mac.Write([]byte(username))
		credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))
		servers = append(servers, map[string]any{
			"urls": []string{
				fmt.Sprintf("stun:%s:3478", h.turnHost),
				fmt.Sprintf("turn:%s:3478?transport=udp", h.turnHost),
				fmt.Sprintf("turn:%s:3478?transport=tcp", h.turnHost),
			},
			"username":   username,
			"credential": credential,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ice_servers": servers, "ttl": int(h.ttl.Seconds())})
}
