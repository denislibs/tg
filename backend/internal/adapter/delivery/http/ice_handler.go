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
// ephemeral (coturn "REST API" / use-auth-secret scheme): username is
// "<unix expiry>:<user id>" and credential = base64(HMAC-SHA1(secret, username)),
// so no long-lived TURN password ever reaches a client. User id в имени — не
// украшение: coturn считает квоту аллокаций (`--user-quota`) по части после
// двоеточия, и один аккаунт не может занять весь пул relay-портов.
type ICEHandler struct {
	limiter    *keyRateLimiter // выдача кредов по пользователю: клиент берёт их на вход в звонок и заранее обновляет
	turnHost   string          // empty → STUN only: звонок 1:1 в одной сети пойдёт, а групповой и звонок с запретом P2P (relay-only) не начнутся
	turnSecret string
	ttl        time.Duration
}

// iceCredentialTTL — срок кредов TURN (К1): выдаются на вход в звонок и живут час, клиент
// обновляет их заранее, пока звонок идёт (callEngine.ts::keepIceFresh). Отозвать выданные
// креды нельзя (схема use-auth-secret без БД), поэтому срок и есть окно, в котором вышедший
// из звонка или забаненный пользователь ещё может занимать relay. coturn проверяет метку при
// аутентификации новой аллокации, идущая живёт на запомненном ключе: истечение кредов
// идущий pc переживает, новый pc (поздний участник mesh, смена сети) берёт свежие — клиент
// отдаёт их и идущим pc через setConfiguration. У tweb креды приходят
// с самим звонком (phoneConnectionWebrtc, callInstance.ts:676-688) — тоже на вход в звонок.
const iceCredentialTTL = time.Hour

func NewICEHandler(turnHost, turnSecret string) *ICEHandler {
	return &ICEHandler{turnHost: turnHost, turnSecret: turnSecret, ttl: iceCredentialTTL, limiter: newKeyRateLimiter()}
}

// iceRate, iceBurst — выдача кредов одному пользователю: клиент склеивает одновременные запросы
// и держит конфиг, пока до истечения кредов больше 10 минут (callEngine.ts::iceServers), так что
// запрос — это вход в звонок или плановое обновление раз в ~50 минут; 20 подряд и 1/с с большим запасом. Лимитер — в памяти процесса
// (при нескольких экземплярах предел умножается, общий стор — М-1). Полоса и пул relay держатся
// не им, а квотами coturn (coturn/turnserver.conf); размер mesh ограничивает user-quota.
const (
	iceRate  = 1.0
	iceBurst = 20.0
)

func (h *ICEHandler) Get(w http.ResponseWriter, r *http.Request) {
	user, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if allowed, wait := h.limiter.allowWait("ice-user:"+strconv.FormatInt(user.ID, 10), iceRate, iceBurst); !allowed {
		writeFloodWait(w, wait)
		return
	}
	servers := []map[string]any{
		{"urls": []string{"stun:stun.l.google.com:19302"}},
	}
	if h.turnHost != "" {
		username := strconv.FormatInt(time.Now().Add(h.ttl).Unix(), 10) + ":" + strconv.FormatInt(user.ID, 10)
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
