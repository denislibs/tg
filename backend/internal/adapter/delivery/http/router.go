package http

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/messenger-denis/backend/internal/openapi"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecasecontacts "github.com/messenger-denis/backend/internal/usecase/contacts"
	usecasefolders "github.com/messenger-denis/backend/internal/usecase/folders"
	usecasenotify "github.com/messenger-denis/backend/internal/usecase/notify"
	usecaseprivacy "github.com/messenger-denis/backend/internal/usecase/privacy"
)

func NewRouter(authUC *usecaseauth.Interactor, chatUC *usecasechat.Interactor, wsHandler http.Handler, mediaH *MediaHandler, pushH *PushHandler, storyH *StoryHandler, memberPresence PresenceQuery, contactsUC *usecasecontacts.Interactor, iceH *ICEHandler, notifyUC *usecasenotify.Interactor, foldersUC *usecasefolders.Interactor, pubH *PublicHandler, privacyUC *usecaseprivacy.Interactor, passkeyH *PasskeyHandler) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// Privacy как read-model-шов для хендлеров (аватар/онлайн с учётом правил);
	// typed-nil не заворачиваем в интерфейс, чтобы nil-проверки работали.
	var privacyQ PrivacyQuery
	if privacyUC != nil {
		privacyQ = privacyUC
	}

	authH := NewAuthHandler(authUC)
	r.Post("/auth/request_code", authH.RequestCode)
	r.Post("/auth/sign_in", authH.SignIn)
	r.Post("/auth/check_password", authH.CheckPassword)
	if passkeyH != nil {
		r.Post("/auth/passkey/begin", passkeyH.BeginLogin)
		r.Post("/auth/passkey/finish", passkeyH.FinishLogin)
	}
	r.Post("/auth/qr/new", authH.QRNew)
	r.Get("/auth/qr/{token}", authH.QRStatus)

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

	// Публичная страница-превью @username (аналог t.me) — без авторизации.
	if pubH != nil {
		r.Get("/@{username}", pubH.Page)
		r.Get("/@{username}/photo", pubH.Photo)
	}

	r.Group(func(pr chi.Router) {
		pr.Use(AuthMiddleware(authUC))

		ph := NewProfileHandler(authUC)
		pr.Get("/me", ph.Me)
		pr.Patch("/me", ph.Update)
		pr.Put("/me/username", ph.SetUsername)
		pr.Get("/username/available", ph.CheckUsername)
		pr.Put("/me/avatar", ph.SetAvatar)

		nh := NewNotifyHandler(notifyUC)
		pr.Get("/me/notify_settings", nh.Get)
		pr.Put("/me/notify_settings", nh.Update)

		if passkeyH != nil {
			pr.Get("/me/passkeys", passkeyH.List)
			pr.Post("/me/passkeys/begin", passkeyH.BeginRegistration)
			pr.Post("/me/passkeys/finish", passkeyH.FinishRegistration)
			pr.Delete("/me/passkeys/{passkeyID}", passkeyH.Delete)
		}

		pwh := NewPasswordHandler(authUC)
		pr.Get("/me/password", pwh.State)
		pr.Post("/me/password", pwh.Set)
		pr.Post("/me/password/verify", pwh.Verify)
		pr.Delete("/me/password", pwh.Remove)

		if privacyUC != nil {
			pvh := NewPrivacyHandler(privacyUC)
			pr.Get("/me/privacy", pvh.Rules)
			pr.Put("/me/privacy/{key}", pvh.SetRule)
			pr.Get("/me/blocked", pvh.Blocked)
			pr.Post("/me/blocked", pvh.Block)
			pr.Delete("/me/blocked/{userID}", pvh.Unblock)
			pr.Get("/users/{userID}", pvh.Profile)
		}

		if foldersUC != nil {
			fh := NewFoldersHandler(foldersUC)
			pr.Get("/me/folders", fh.List)
			pr.Post("/me/folders", fh.Create)
			pr.Put("/me/folders/{folderID}", fh.Update)
			pr.Delete("/me/folders/{folderID}", fh.Delete)
		}

		ch := NewChatHandler(chatUC)
		pr.Post("/chats", ch.CreatePrivate)
		pr.Get("/me/auto_delete", ch.MyAutoDelete)
		pr.Put("/me/auto_delete", ch.SetMyAutoDelete)
		pr.Put("/chats/{chatID}/auto_delete", ch.SetChatAutoDelete)
		pr.Post("/saved", ch.Saved)
		pr.Get("/saved/dialogs", ch.SavedDialogs)
		pr.Get("/chats", ch.ListDialogs)
		pr.Post("/chats/{chatID}/messages", ch.Send)
		pr.Patch("/chats/{chatID}/messages/{msgID}", ch.EditMessage)
		pr.Delete("/chats/{chatID}/messages/{msgID}", ch.DeleteMessage)
		pr.Post("/chats/{chatID}/forward", ch.Forward)
		pr.Post("/chats/{chatID}/messages/{msgID}/pin", ch.Pin)
		pr.Delete("/chats/{chatID}/messages/{msgID}/pin", ch.Unpin)
		pr.Get("/chats/{chatID}/pins", ch.ListPins)
		pr.Get("/chats/{chatID}/messages/{msgID}/viewers", ch.Viewers)
		pr.Get("/chats/{chatID}/history", ch.History)
		pr.Get("/chats/{chatID}/search", ch.SearchMessages)
		pr.Get("/chats/{chatID}/media", ch.MediaHistory)
		pr.Post("/chats/{chatID}/read", ch.Read)
		pr.Get("/sync", ch.Sync)
		pr.Post("/chats/{chatID}/messages/{msgID}/reactions", ch.AddReaction)
		pr.Delete("/chats/{chatID}/messages/{msgID}/reactions/{emoji}", ch.RemoveReaction)
		pr.Get("/chats/{chatID}/messages/{msgID}/reactions", ch.ListReactions)

		gh := NewGroupHandler(chatUC, memberPresence, privacyQ)
		pr.Post("/groups", gh.CreateGroup)
		pr.Get("/chats/{chatID}/card", gh.Card)
		pr.Get("/chats/{chatID}/members", gh.ListMembers)
		pr.Patch("/chats/{chatID}", gh.EditInfo)
		pr.Delete("/chats/{chatID}", gh.DeleteGroup)
		pr.Put("/chats/{chatID}/photo", gh.SetPhoto)
		pr.Put("/chats/{chatID}/type", gh.SetType)
		pr.Put("/chats/{chatID}/permissions", gh.SetPermissions)
		pr.Put("/chats/{chatID}/reactions", gh.SetReactions)
		pr.Put("/chats/{chatID}/history", gh.SetHistory)
		pr.Get("/chats/{chatID}/bans", gh.ListBans)
		pr.Post("/chats/{chatID}/bans", gh.Ban)
		pr.Delete("/chats/{chatID}/bans/{userID}", gh.Unban)
		pr.Post("/chats/{chatID}/members", gh.AddMember)
		pr.Delete("/chats/{chatID}/members/{userID}", gh.RemoveMember)
		pr.Post("/chats/{chatID}/admins", gh.PromoteAdmin)
		pr.Delete("/chats/{chatID}/admins/{userID}", gh.DemoteAdmin)
		pr.Post("/chats/{chatID}/mute", gh.SetMute)
		pr.Post("/chats/{chatID}/invite_links", gh.CreateInvite)
		pr.Get("/chats/{chatID}/invite_links", gh.ListInvites)
		pr.Delete("/chats/{chatID}/invite_links/{token}", gh.RevokeInvite)
		pr.Post("/join/{token}", gh.Join)
		pr.Get("/chats/{chatID}/join_requests", gh.JoinRequests)
		pr.Post("/chats/{chatID}/join_requests/{userID}/approve", gh.ApproveJoinRequest)
		pr.Post("/chats/{chatID}/join_requests/{userID}/decline", gh.DeclineJoinRequest)
		pr.Get("/users", gh.Users)

		presenceH := NewPresenceHandler(memberPresence, privacyQ)
		pr.Get("/presence", presenceH.Get)

		chh := NewChannelHandler(chatUC, privacyQ)
		pr.Post("/channels", chh.Create)
		pr.Post("/channels/{chatID}/messages", chh.Post)
		pr.Get("/channels/{chatID}/difference", chh.Difference)
		pr.Post("/channels/join", chh.Join)
		pr.Post("/channels/{chatID}/discussion", chh.EnableDiscussion)
		pr.Post("/channels/{chatID}/posts/{postId}/comments", chh.PostComment)
		pr.Get("/channels/{chatID}/posts/{postId}/comments", chh.ListComments)
		pr.Get("/channels/{chatID}/comment_counts", chh.CommentCounts)
		pr.Get("/channels/{chatID}/view_counts", chh.ViewCounts)
		pr.Get("/search", chh.Search)

		if mediaH != nil {
			pr.Get("/media/token", mediaH.MediaToken)
			pr.Post("/media/upload", mediaH.CreateUpload)
			pr.Get("/media/{mediaID}", mediaH.Get)
			pr.Put("/media/{mediaID}/content", mediaH.PutContent)
		}

		if pushH != nil {
			pr.Get("/push/vapid_public_key", pushH.VAPIDPublicKey)
			pr.Post("/push/subscribe", pushH.Subscribe)
		}

		if storyH != nil {
			pr.Post("/stories", storyH.Post)
			pr.Get("/stories", storyH.Feed)
			pr.Post("/stories/{storyID}/view", storyH.View)
			pr.Get("/stories/{storyID}/viewers", storyH.Viewers)
			pr.Delete("/stories/{storyID}", storyH.Delete)
		}

		if contactsUC != nil {
			coh := NewContactsHandler(contactsUC)
			pr.Post("/contacts", coh.Add)
			pr.Get("/contacts", coh.List)
			pr.Delete("/contacts/{userID}", coh.Delete)
		}

		// ICE-конфиг для звонков (STUN + эфемерные TURN-креды)
		pr.Get("/calls/ice", iceH.Get)

		sh := NewSessionHandler(authUC)
		pr.Get("/sessions", sh.List)
		pr.Delete("/sessions/others", sh.RevokeOthers)
		pr.Delete("/sessions/{deviceID}", sh.Revoke)
		pr.Post("/auth/logout", sh.Logout)
		pr.Post("/auth/qr/confirm", authH.QRConfirm)
	})
	return r
}
