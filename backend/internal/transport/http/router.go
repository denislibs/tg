package http

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/messaging"
)

func NewRouter(authSvc *auth.Service, chatSvc *messaging.Service, wsHandler http.Handler) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	authH := NewAuthHandler(authSvc)
	r.Post("/auth/request_code", authH.RequestCode)
	r.Post("/auth/sign_in", authH.SignIn)

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	if wsHandler != nil {
		r.Get("/ws", wsHandler.ServeHTTP)
	}

	r.Group(func(pr chi.Router) {
		pr.Use(AuthMiddleware(authSvc))
		pr.Get("/me", MeHandler)

		ch := NewChatHandler(chatSvc)
		pr.Post("/chats", ch.CreatePrivate)
		pr.Get("/chats", ch.ListDialogs)
		pr.Post("/chats/{chatID}/messages", ch.Send)
		pr.Get("/chats/{chatID}/history", ch.History)
		pr.Post("/chats/{chatID}/read", ch.Read)
		pr.Get("/sync", ch.Sync)
		pr.Post("/chats/{chatID}/messages/{msgID}/reactions", ch.AddReaction)
		pr.Delete("/chats/{chatID}/messages/{msgID}/reactions/{emoji}", ch.RemoveReaction)
		pr.Get("/chats/{chatID}/messages/{msgID}/reactions", ch.ListReactions)

		sh := NewSessionHandler(authSvc)
		pr.Get("/sessions", sh.List)
		pr.Delete("/sessions/{deviceID}", sh.Revoke)
		pr.Post("/auth/logout", sh.Logout)
	})
	return r
}
