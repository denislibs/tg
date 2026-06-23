package ws

import (
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/messaging"
)

// Handler upgrades HTTP to WebSocket, authenticates via the ?token= query
// parameter (browsers can't set headers on WS), and runs the connection.
type Handler struct {
	hub      *Hub
	authSvc  *auth.Service
	chatSvc  *messaging.Service
	upgrader websocket.Upgrader
}

func NewHandler(hub *Hub, authSvc *auth.Service, chatSvc *messaging.Service) *Handler {
	return &Handler{
		hub:     hub,
		authSvc: authSvc,
		chatSvc: chatSvc,
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
	user, deviceID, err := h.authSvc.Authenticate(r.Context(), token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	wsConn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade already wrote the error
	}
	conn := newConn(wsConn, h.hub, h.chatSvc, user.ID, deviceID)
	conn.run(r.Context())
}
