package http

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/messenger-denis/backend/internal/openapi"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

func NewRouter(authUC *usecaseauth.Interactor, chatUC *usecasechat.Interactor, wsHandler http.Handler, mediaH *MediaHandler, pushH *PushHandler) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	authH := NewAuthHandler(authUC)
	r.Post("/auth/request_code", authH.RequestCode)
	r.Post("/auth/sign_in", authH.SignIn)

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// API documentation (public).
	r.Get("/openapi.yaml", openapi.SpecHandler())
	r.Get("/swagger", openapi.UIHandler())

	if wsHandler != nil {
		r.Get("/ws", wsHandler.ServeHTTP)
	}

	// GET media content is mounted outside the Bearer group: browser <img>/<video>
	// elements can't set an Authorization header, so it authenticates via ?token=.
	if mediaH != nil {
		r.Get("/media/{mediaID}/content", mediaH.GetContent)
	}

	r.Group(func(pr chi.Router) {
		pr.Use(AuthMiddleware(authUC))
		pr.Get("/me", MeHandler)

		ch := NewChatHandler(chatUC)
		pr.Post("/chats", ch.CreatePrivate)
		pr.Get("/chats", ch.ListDialogs)
		pr.Post("/chats/{chatID}/messages", ch.Send)
		pr.Get("/chats/{chatID}/history", ch.History)
		pr.Post("/chats/{chatID}/read", ch.Read)
		pr.Get("/sync", ch.Sync)
		pr.Post("/chats/{chatID}/messages/{msgID}/reactions", ch.AddReaction)
		pr.Delete("/chats/{chatID}/messages/{msgID}/reactions/{emoji}", ch.RemoveReaction)
		pr.Get("/chats/{chatID}/messages/{msgID}/reactions", ch.ListReactions)

		if mediaH != nil {
			pr.Post("/media/upload", mediaH.CreateUpload)
			pr.Get("/media/{mediaID}", mediaH.Get)
			pr.Put("/media/{mediaID}/content", mediaH.PutContent)
		}

		if pushH != nil {
			pr.Get("/push/vapid_public_key", pushH.VAPIDPublicKey)
			pr.Post("/push/subscribe", pushH.Subscribe)
		}

		sh := NewSessionHandler(authUC)
		pr.Get("/sessions", sh.List)
		pr.Delete("/sessions/{deviceID}", sh.Revoke)
		pr.Post("/auth/logout", sh.Logout)
	})
	return r
}
