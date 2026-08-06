package ws

import (
	"context"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// Authenticator resolves a token to the authenticated user + device.
type Authenticator interface {
	Authenticate(ctx context.Context, token string) (domain.User, int64, error)
}

// Handler upgrades HTTP to WebSocket, authenticates via the ?token= query
// parameter (browsers can't set headers on WS), and runs the connection.
type Handler struct {
	hub           *Hub
	auth          Authenticator
	chatSvc       *usecasechat.Interactor
	presence      Presence
	upgrader      websocket.Upgrader
	dnpServerPriv []byte           // nil → DNP выключен (ветка dnp/2 не активируется)
	rpc           RPCDispatcher    // late-bound (см. SetRPCDispatcher); nil → rpc_req игнорируется
	file          FileDispatcher   // late-bound (см. SetFileDispatcher); nil → file_req игнорируется
	upload        UploadDispatcher // late-bound (см. SetUploadDispatcher); nil → file_up игнорируется
}

// SetRPCDispatcher связывает диспетчер после сборки роутера (разрыв цикла wsHandler↔router).
func (h *Handler) SetRPCDispatcher(d RPCDispatcher) { h.rpc = d }

// SetFileDispatcher связывает file-диспетчер после сборки роутера (как SetRPCDispatcher).
func (h *Handler) SetFileDispatcher(d FileDispatcher) { h.file = d }

// SetUploadDispatcher связывает upload-диспетчер после сборки роутера (как SetFileDispatcher).
// Каждый новый Conn получает его в ServeHTTP ДО conn.run() (happens-before запуска
// readPump/writePump — гонок с dispatchFileUp нет).
func (h *Handler) SetUploadDispatcher(d UploadDispatcher) { h.upload = d }

func NewHandler(hub *Hub, auth Authenticator, chatSvc *usecasechat.Interactor, presence Presence, allowedOrigins []string, dnpServerPrivHex string) *Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		if o = strings.TrimSpace(o); o != "" {
			allowed[o] = struct{}{}
		}
	}
	var dnpPriv []byte
	if dnpServerPrivHex != "" {
		if b, err := hex.DecodeString(dnpServerPrivHex); err == nil && len(b) == 32 {
			dnpPriv = b
		}
	}
	return &Handler{
		hub:           hub,
		auth:          auth,
		chatSvc:       chatSvc,
		presence:      presence,
		dnpServerPriv: dnpPriv,
		upgrader: websocket.Upgrader{
			// Эхаем subprotocol 'bearer'/'dnp.2' в ответе рукопожатия: клиент
			// присылает ['bearer', <token>] (аутентификация по токену, не в URL)
			// либо ['dnp.2'] (Noise-хендшейк, аутентификация внутри канала). Без
			// эха браузер закрыл бы соединение (сервер обязан выбрать subprotocol).
			// ВАЖНО: токен 'dnp.2' через '.', а не '/': '/' — separator по RFC 2616,
			// браузерный WebSocket-конструктор такой subprotocol отвергает. Noise-
			// prologue при этом остаётся 'dnp/2' (noise.go) — это отдельные байты.
			Subprotocols: []string{"bearer", "dnp.2"},
			// Анти-CSWSH: пускаем только с allow-list origin'ов (те же, что WebAuthn).
			// Пустой Origin (нативные клиенты/тесты — не браузер) допускаем; аутентификация
			// по токену (subprotocol/query), origin-гейт снимает cross-site-подключение.
			CheckOrigin: func(r *http.Request) bool {
				origin := r.Header.Get("Origin")
				if origin == "" {
					return true
				}
				_, ok := allowed[origin]
				return ok
			},
		},
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.dnpServerPriv != nil && hasSubprotocol(r, "dnp.2") {
		wsConn, err := h.upgrader.Upgrade(w, r, nil)
		if err != nil {
			return // Upgrade already wrote the error
		}
		// Читаем WS-кадры хендшейка ДО того, как readPump успел бы выставить
		// лимит: без этого oversized-кадр обошёл бы MaxFrameLen-границу.
		wsConn.SetReadLimit(maxMessageSize)
		codec, user, deviceID, err := dnpAccept(r.Context(), wsConn, h.dnpServerPriv, h.auth)
		if err != nil {
			_ = wsConn.Close()
			return
		}
		conn := newConn(wsConn, h.hub, h.chatSvc, h.presence, user, deviceID, codec, h.rpc, h.file)
		conn.SetUploadDispatcher(h.upload)
		conn.run(r.Context())
		return
	}
	token := wsToken(r)
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	user, deviceID, err := h.auth.Authenticate(r.Context(), token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	wsConn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade already wrote the error
	}
	conn := newConn(wsConn, h.hub, h.chatSvc, h.presence, user, deviceID, plainCodec{}, nil, nil)
	conn.run(r.Context())
}

func hasSubprotocol(r *http.Request, want string) bool {
	for _, p := range websocket.Subprotocols(r) {
		if p == want {
			return true
		}
	}
	return false
}

// wsToken достаёт сессионный токен из WS-subprotocol (клиент шлёт ['bearer',
// <token>] в Sec-WebSocket-Protocol — токен НЕ в URL). Fallback — устаревший
// ?token= (старые вкладки до раскатки; query оседает в логах — см. SEC-6).
func wsToken(r *http.Request) string {
	for _, p := range websocket.Subprotocols(r) {
		if p != "" && p != "bearer" {
			return p
		}
	}
	return r.URL.Query().Get("token")
}
