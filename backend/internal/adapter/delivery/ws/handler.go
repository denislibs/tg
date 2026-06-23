package ws

import (
	"context"
	"net/http"

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

func NewHandler(hub *Hub, auth Authenticator, chatSvc *usecasechat.Interactor, presence Presence) *Handler {
	return &Handler{
		hub:      hub,
		auth:     auth,
		chatSvc:  chatSvc,
		presence: presence,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true }, // dev: allow all origins
		},
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
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
