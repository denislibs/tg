package http

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ICEHandler issues the ICE server list for WebRTC calls. TURN credentials are
// ephemeral (coturn "REST API" / use-auth-secret scheme): username is a unix
// expiry timestamp and credential = base64(HMAC-SHA1(secret, username)), so no
// long-lived TURN password ever reaches a client.
type ICEHandler struct {
	turnHost   string // empty → STUN only: звонок 1:1 в одной сети пойдёт, а групповой и звонок с запретом P2P (relay-only) не начнутся
	turnSecret string
	ttl        time.Duration
}

func NewICEHandler(turnHost, turnSecret string) *ICEHandler {
	// ttl — сутки: relay-звонок и групповой mesh целиком зависят от кредов TURN (coturn проверяет
	// метку истечения на каждом Refresh/CreatePermission), звонок не должен рваться на её границе.
	return &ICEHandler{turnHost: turnHost, turnSecret: turnSecret, ttl: 24 * time.Hour}
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
		// JoinHostPort: голый IPv6 получает скобки (`turn:[2001:db8::1]:3478`), иначе
		// конструктор RTCPeerConnection бросает на URL.
		addr := net.JoinHostPort(strings.Trim(h.turnHost, "[]"), "3478")
		servers = append(servers, map[string]any{
			"urls": []string{
				"stun:" + addr,
				"turn:" + addr + "?transport=udp",
				"turn:" + addr + "?transport=tcp",
			},
			"username":   username,
			"credential": credential,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ice_servers": servers, "ttl": int(h.ttl.Seconds())})
}
