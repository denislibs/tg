package ws

import (
	"context"
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
	hub      *Hub
	auth     Authenticator
	chatSvc  *usecasechat.Interactor
	presence Presence
	upgrader websocket.Upgrader
}

func NewHandler(hub *Hub, auth Authenticator, chatSvc *usecasechat.Interactor, presence Presence, allowedOrigins []string) *Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		if o = strings.TrimSpace(o); o != "" {
			allowed[o] = struct{}{}
		}
	}
	return &Handler{
		hub:      hub,
		auth:     auth,
		chatSvc:  chatSvc,
		presence: presence,
		upgrader: websocket.Upgrader{
			// Эхаем subprotocol 'bearer' в ответе рукопожатия: клиент присылает
			// ['bearer', <token>], токен несёт аутентификацию (не в URL). Без эха
			// браузер закрыл бы соединение (сервер обязан выбрать subprotocol).
			Subprotocols: []string{"bearer"},
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
	conn := newConn(wsConn, h.hub, h.chatSvc, h.presence, user.ID, deviceID)
	conn.run(r.Context())
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
