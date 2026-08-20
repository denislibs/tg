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
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
	usecasenotify "github.com/messenger-denis/backend/internal/usecase/notify"
	usecaseprivacy "github.com/messenger-denis/backend/internal/usecase/privacy"
	usecasereport "github.com/messenger-denis/backend/internal/usecase/report"
	usecasestats "github.com/messenger-denis/backend/internal/usecase/stats"
)

func NewRouter(authUC *usecaseauth.Interactor, chatUC *usecasechat.Interactor, wsHandler http.Handler, mediaH *MediaHandler, mediaUC *usecasemedia.Interactor, pushH *PushHandler, storyH *StoryHandler, memberPresence PresenceQuery, contactsUC *usecasecontacts.Interactor, iceH *ICEHandler, notifyUC *usecasenotify.Interactor, foldersUC *usecasefolders.Interactor, pubH *PublicHandler, privacyUC *usecaseprivacy.Interactor, passkeyH *PasskeyHandler, stickersH *StickersHandler, ivH *IVHandler, reportUC *usecasereport.Interactor, statsUC *usecasestats.Interactor, reactionsH *ReactionsHandler) http.Handler {
	r := chi.NewRouter()
	r.Use(requestLogger) // вместо middleware.Logger: не пишет токены в логи
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
	r.Post("/auth/sign_up", authH.SignUp)
	r.Post("/auth/check_password", authH.CheckPassword)
	r.Post("/auth/password/recover", authH.RequestPasswordRecovery)
	r.Post("/auth/password/recover/confirm", authH.ConfirmPasswordRecovery)
	// Восстановление невозможно (почта не привязана) — сброс аккаунта по тому же
	// одноразовому password_token.
	r.Post("/auth/account/reset", authH.ResetAccount)
	// Страна клиента для экрана входа (аналог help.getNearestDc).
	r.Get("/auth/nearest_country", authH.NearestCountry)
	r.Post("/auth/sign_import", authH.SignImport)
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

	// Bot API (Telegram-подобный): /bot/{token}/{method}. Аутентификация по
	// токену в пути, поэтому вне Bearer-группы. Принимает GET и POST.
	botAPIH := NewBotAPIHandler(chatUC, mediaUC)
	r.HandleFunc("/bot/{token}/{method}", botAPIH.Handle)
	// Скачивание файлов бота (getFile → download); аутентификация по токену.
	r.Get("/file/bot/{token}/{fileID}", botAPIH.File)

	r.Group(func(pr chi.Router) {
		pr.Use(AuthMiddleware(authUC))

		ph := NewProfileHandler(authUC)
		pr.Get("/me", ph.Me)
		pr.Patch("/me", ph.Update)
		pr.Put("/me/username", ph.SetUsername)
		pr.Get("/username/available", ph.CheckUsername)
		pr.Put("/me/avatar", ph.SetAvatar)
		pr.Put("/me/emoji_status", ph.SetEmojiStatus)
		pr.Post("/me/premium", ph.ActivatePremium)
		pr.Post("/me/premium/checkout", ph.Checkout)
		pr.Get("/me/premium/subscription", ph.PremiumSubscription)
		pr.Post("/me/premium/cancel", ph.CancelPremium)
		pr.Post("/me/photos", ph.AddPhoto)
		pr.Delete("/me/photos/{photoID}", ph.DeletePhoto)
		pr.Get("/users/{userID}/photos", ph.ListPhotos)
		pr.Delete("/me", ph.DeleteAccount)

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
			// Ссылки-приглашения в папку (chatlist invites)
			pr.Post("/me/folders/{folderID}/invites", fh.CreateInvite)
			pr.Get("/me/folders/{folderID}/invites", fh.ListInvites)
			pr.Delete("/me/folder_invites/{slug}", fh.RevokeInvite)
			pr.Get("/folder_invites/{slug}", fh.PreviewInvite)
			pr.Post("/folder_invites/{slug}/join", fh.JoinInvite)
		}

		ch := NewChatHandler(chatUC)
		pr.Post("/chats", ch.CreatePrivate)
		pr.Post("/secret_chats", ch.CreateSecretChat)
		pr.Get("/secret_chats/{peerID}", ch.GetSecretChat)
		pr.Post("/secret_chats/{peerID}/accept", ch.AcceptSecretChat)
		pr.Post("/secret_chats/{peerID}/reject", ch.RejectSecretChat)
		pr.Get("/me/auto_delete", ch.MyAutoDelete)
		pr.Put("/me/auto_delete", ch.SetMyAutoDelete)
		pr.Put("/chats/{peerID}/auto_delete", ch.SetChatAutoDelete)
		pr.Put("/chats/{peerID}/theme", ch.SetChatTheme)
		pr.Get("/drafts", ch.MyDrafts)
		pr.Delete("/drafts", ch.ClearAllDrafts)
		pr.Put("/chats/{peerID}/draft", ch.SaveDraft)
		pr.Delete("/chats/{peerID}/draft", ch.DeleteDraft)
		pr.Post("/saved", ch.Saved)
		pr.Get("/saved/dialogs", ch.SavedDialogs)
		pr.Get("/saved/tags", ch.SavedTags)                  // теги-реакции «Избранного»
		pr.Put("/saved/tags/{reaction}", ch.SetSavedTagName) // имя тега (updateSavedReactionTag)
		pr.Get("/chats", ch.ListDialogs)
		pr.Post("/chats/{peerID}/messages", ch.Send)
		// Выборка по АДРЕСАМ (?ids=): разрешение ссылок reply_to/reply_to_top_id
		// и единственный производитель messageEmpty — аналог messages.getMessages.
		pr.Get("/chats/{peerID}/messages", ch.MessagesByIDs)
		pr.Patch("/chats/{peerID}/messages/{msgSeq}", ch.EditMessage)
		pr.Delete("/chats/{peerID}/messages/{msgSeq}", ch.DeleteMessage)
		pr.Post("/chats/{peerID}/forward", ch.Forward)
		pr.Post("/chats/{peerID}/messages/{msgSeq}/geo_live", ch.UpdateGeoLive)
		pr.Post("/chats/{peerID}/messages/{msgSeq}/pin", ch.Pin)
		pr.Delete("/chats/{peerID}/messages/{msgSeq}/pin", ch.Unpin)
		pr.Post("/chats/{peerID}/messages/{msgSeq}/factcheck", ch.SetFactCheck)
		pr.Delete("/chats/{peerID}/messages/{msgSeq}/factcheck", ch.RemoveFactCheck)
		pr.Post("/chats/{peerID}/messages/{msgSeq}/transcribe", ch.TranscribeMessage) // расшифровка голосового/кружка
		pr.Get("/chats/{peerID}/send_as", ch.SendAs)                                  // «личности отправителя» (send_as)
		pr.Get("/chats/{peerID}/pins", ch.ListPins)
		pr.Get("/chats/{peerID}/messages/{msgSeq}/viewers", ch.Viewers)
		pr.Get("/chats/{peerID}/messages/{msgSeq}/read_date", ch.ReadDate)
		pr.Get("/chats/{peerID}/mentions/next", ch.NextMention)
		pr.Get("/chats/{peerID}/history", ch.History)
		pr.Get("/chats/{peerID}/search", ch.SearchMessages)
		pr.Get("/chats/{peerID}/message_by_date", ch.MessageByDate)
		pr.Get("/chats/{peerID}/calendar", ch.Calendar)
		pr.Post("/translate", ch.Translate)
		pr.Post("/chats/{peerID}/polls", ch.SendPoll)
		pr.Get("/chats/{peerID}/group_call", ch.GroupCallParticipants)
		// RTMP-трансляции (Telegram livestream): старт/стоп — только админ,
		// статус — любой участник (креды в нём только админу).
		pr.Get("/chats/{peerID}/livestream", ch.LivestreamStatus)
		pr.Post("/chats/{peerID}/livestream/start", ch.StartLivestream)
		pr.Post("/chats/{peerID}/livestream/stop", ch.StopLivestream)
		pr.Post("/chats/{peerID}/livestream/revoke_key", ch.RevokeStreamKey)
		pr.Post("/chats/{peerID}/forum", ch.SetForum)
		pr.Post("/chats/{peerID}/topics", ch.CreateTopic)
		pr.Get("/chats/{peerID}/topics", ch.ListTopics)
		pr.Post("/chats/{peerID}/topics/{topicID}/close", ch.CloseTopic)
		pr.Patch("/chats/{peerID}/topics/{topicID}", ch.EditTopic)
		pr.Post("/chats/{peerID}/topics/{topicID}/hide", ch.HideTopic)
		pr.Post("/chats/{peerID}/topics/{topicID}/pin", ch.PinTopic)
		// read/mute адресуют тему по НОМЕРУ корневого сообщения (пара chat+root —
		// ключ состояния); имя chi-параметра {topicID} общее с close/hide/pin, чтобы
		// дерево роутов не конфликтовало — значение в этом слоте для read/mute
		// передаётся root_msg_id, то есть тот же номер, что едет наружу витриной тем.
		pr.Post("/chats/{peerID}/topics/{topicID}/read", ch.ReadTopic)
		pr.Post("/chats/{peerID}/topics/{topicID}/mute", ch.MuteTopic)
		pr.Get("/chats/{peerID}/threads/{rootSeq}", ch.ThreadMessages)
		pr.Post("/chats/{peerID}/scheduled", ch.ScheduleMessage)
		pr.Get("/chats/{peerID}/scheduled", ch.ListScheduled)
		pr.Patch("/chats/{peerID}/scheduled/{schedID}", ch.UpdateScheduled)
		pr.Delete("/chats/{peerID}/scheduled/{schedID}", ch.DeleteScheduled)
		pr.Post("/chats/{peerID}/scheduled/{schedID}/send_now", ch.SendScheduledNow)
		pr.Post("/polls/{pollID}/vote", ch.VotePoll)
		pr.Post("/polls/{pollID}/close", ch.ClosePoll)
		// Чек-листы (Telegram todo list)
		pr.Post("/chats/{peerID}/checklists", ch.SendChecklist)
		pr.Post("/checklists/{id}/items", ch.AddChecklistItems)
		pr.Post("/checklists/{id}/items/{itemID}/toggle", ch.ToggleChecklistItem)
		// Бусты каналов + розыгрыши
		pr.Get("/channels/{peerID}/boosts", ch.ChannelBoosts)
		pr.Post("/channels/{peerID}/boost", ch.BoostChannel)
		pr.Post("/channels/{peerID}/giveaways", ch.CreateGiveaway)
		pr.Post("/giveaways/{id}/participate", ch.ParticipateGiveaway)
		pr.Get("/giveaways/{id}", ch.GetGiveaway)
		// Stars + Star Gifts
		pr.Get("/stars/balance", ch.StarsBalance)
		pr.Get("/stars/transactions", ch.StarsTransactions)
		pr.Post("/stars/topup", ch.TopUpStars)
		pr.Post("/chats/{peerID}/messages/{msgSeq}/unlock", ch.UnlockPaidMedia)
		pr.Get("/gifts/catalog", ch.GiftCatalog)
		pr.Post("/gifts/send", ch.SendGift)
		pr.Get("/users/{userID}/gifts", ch.ProfileGifts)
		pr.Post("/gifts/{giftID}/convert", ch.ConvertGift)
		pr.Post("/gifts/{giftID}/hidden", ch.SetGiftHidden)
		// Боты
		pr.Get("/bots/{botID}/commands", ch.BotCommands)
		pr.Get("/bots/{botID}/inline", ch.BotInline)
		pr.Get("/bots/{botID}/menu_button", ch.BotMenuButton)
		pr.Post("/bots/{botID}/callback", ch.BotCallback)
		pr.Post("/bots/{botID}/start", ch.BotStart)            // deep link t.me/bot?start=
		pr.Post("/bots/{botID}/webapp_data", ch.BotWebAppData) // sendData из mini-app
		pr.Post("/bots/{botID}/cloud/get", ch.BotCloudGet)     // CloudStorage
		pr.Post("/bots/{botID}/cloud/set", ch.BotCloudSet)
		pr.Post("/bots/{botID}/cloud/remove", ch.BotCloudRemove)
		pr.Get("/bots/{botID}/cloud/keys", ch.BotCloudKeys)
		pr.Get("/chats/{peerID}/media", ch.MediaHistory)
		pr.Post("/chats/{peerID}/read", ch.Read)
		pr.Post("/chats/{peerID}/clear", ch.ClearHistory)
		pr.Get("/sync", ch.Sync)
		pr.Post("/chats/{peerID}/messages/{msgSeq}/reactions", ch.AddReaction)
		pr.Delete("/chats/{peerID}/messages/{msgSeq}/reactions/{emoji}", ch.RemoveReaction)
		pr.Get("/chats/{peerID}/messages/{msgSeq}/reactions", ch.ListReactions)
		pr.Get("/chats/{peerID}/messages/{msgSeq}/reactions/users", ch.ReactionUsers)
		pr.Post("/chats/{peerID}/messages/{msgSeq}/star_reaction", ch.SendStarReaction) // платная ⭐-реакция
		pr.Get("/chats/{peerID}/messages/{msgSeq}/star_reaction", ch.GetStarReaction)
		pr.Post("/chats/{peerID}/reactions/read", ch.ReadReactions) // T12: сброс бейджа непрочитанных реакций

		// Стикеры и GIF
		if stickersH != nil {
			pr.Get("/sticker-sets", stickersH.MySets)
			pr.Post("/sticker-sets", stickersH.CreateSet)
			pr.Get("/sticker-sets/search", stickersH.SearchSets)
			// featured — до {slug}: статический сегмент, как search
			pr.Get("/sticker-sets/featured", stickersH.Featured)
			pr.Get("/sticker-sets/{slug}", stickersH.SetBySlug)
			pr.Post("/sticker-sets/{id}/install", stickersH.Install)
			pr.Delete("/sticker-sets/{id}/install", stickersH.Uninstall)
			pr.Post("/sticker-sets/{id}/stickers", stickersH.AddSticker)
			// by-media — до {id}-веток остальных /stickers/*: обратный поиск набора
			// по media_id (клик по стикеру в чате, ConvMsg несёт только его).
			pr.Get("/stickers/by-media/{mediaID}", stickersH.SetByMediaID)
			pr.Get("/stickers/recent", stickersH.Recent)
			pr.Delete("/stickers/recent", stickersH.ClearRecent)
			pr.Get("/stickers/faved", stickersH.Faved)
			pr.Get("/stickers/search", stickersH.SearchByEmoji)
			pr.Post("/stickers/{id}/fave", stickersH.Fave)
			pr.Delete("/stickers/{id}/fave", stickersH.Unfave)
			pr.Post("/stickers/{id}/use", stickersH.Use)
			pr.Get("/gifs/saved", stickersH.SavedGifs)
			pr.Post("/gifs/saved", stickersH.SaveGif)
			pr.Delete("/gifs/saved/{mediaID}", stickersH.DeleteGif)
			pr.Get("/gifs/search", stickersH.SearchGifs)
		}

		// Каталог доступных реакций (Telegram messages.getAvailableReactions) —
		// публичный справочник, как наборы стикеров, но ручка в защищённой
		// группе: анонимный доступ не нужен.
		if reactionsH != nil {
			pr.Get("/reactions", reactionsH.List)
		}

		gh := NewGroupHandler(chatUC, memberPresence, privacyQ)
		pr.Post("/groups", gh.CreateGroup)
		pr.Get("/chats/{peerID}/card", gh.Card)
		pr.Get("/chats/{peerID}/members", gh.ListMembers)
		pr.Patch("/chats/{peerID}", gh.EditInfo)
		pr.Delete("/chats/{peerID}", gh.DeleteGroup)
		pr.Put("/chats/{peerID}/photo", gh.SetPhoto)
		pr.Put("/chats/{peerID}/type", gh.SetType)
		pr.Put("/chats/{peerID}/permissions", gh.SetPermissions)
		pr.Put("/chats/{peerID}/reactions", gh.SetReactions)
		pr.Put("/chats/{peerID}/history", gh.SetHistory)
		pr.Put("/chats/{peerID}/charge_stars", gh.SetChargeStars)
		pr.Get("/chats/{peerID}/bans", gh.ListBans)
		pr.Post("/chats/{peerID}/bans", gh.Ban)
		pr.Delete("/chats/{peerID}/bans/{userID}", gh.Unban)
		pr.Get("/chats/{peerID}/restrictions", gh.ListRestrictions)
		pr.Post("/chats/{peerID}/restrictions", gh.Restrict)
		pr.Delete("/chats/{peerID}/restrictions/{userID}", gh.Unrestrict)
		pr.Post("/chats/{peerID}/members", gh.AddMember)
		pr.Delete("/chats/{peerID}/members/{userID}", gh.RemoveMember)
		pr.Post("/chats/{peerID}/admins", gh.PromoteAdmin)
		pr.Delete("/chats/{peerID}/admins/{userID}", gh.DemoteAdmin)
		pr.Post("/chats/{peerID}/mute", gh.SetMute)
		pr.Put("/chats/{peerID}/notify_settings", gh.SetNotify)
		pr.Post("/chats/{peerID}/pin", gh.SetPin)
		pr.Post("/chats/{peerID}/archive", gh.SetArchive)
		pr.Post("/chats/{peerID}/invite_links", gh.CreateInvite)
		pr.Get("/chats/{peerID}/invite_links", gh.ListInvites)
		pr.Patch("/chats/{peerID}/invite_links/{token}", gh.EditInvite)
		pr.Delete("/chats/{peerID}/invite_links/{token}", gh.DeleteInvite)
		pr.Delete("/chats/{peerID}/revoked_invite_links", gh.DeleteAllRevoked)
		pr.Get("/chats/{peerID}/invite_links/{token}/importers", gh.InviteImporters)
		pr.Post("/join/{token}", gh.Join)
		pr.Get("/chats/{peerID}/join_requests", gh.JoinRequests)
		pr.Post("/chats/{peerID}/join_requests/{userID}/approve", gh.ApproveJoinRequest)
		pr.Post("/chats/{peerID}/join_requests/{userID}/decline", gh.DeclineJoinRequest)
		pr.Get("/users", gh.Users)

		presenceH := NewPresenceHandler(memberPresence, privacyQ)
		pr.Get("/presence", presenceH.Get)

		chh := NewChannelHandler(chatUC, privacyQ)
		pr.Post("/channels", chh.Create)
		pr.Post("/channels/{peerID}/messages", chh.Post)
		pr.Get("/channels/{peerID}/difference", chh.Difference)
		pr.Post("/channels/join", chh.Join)
		pr.Post("/channels/{peerID}/discussion", chh.EnableDiscussion)
		pr.Put("/channels/{peerID}/discussion", chh.LinkDiscussion)
		pr.Delete("/channels/{peerID}/discussion", chh.UnlinkDiscussion)
		pr.Get("/channels/{peerID}/discussion_candidates", chh.DiscussionCandidates)
		pr.Put("/channels/{peerID}/sign_messages", chh.SetSignatures)
		pr.Post("/channels/{peerID}/posts/{postSeq}/comments", chh.PostComment)
		pr.Get("/channels/{peerID}/posts/{postSeq}/comments", chh.ListComments)
		pr.Get("/channels/{peerID}/comment_counts", chh.CommentCounts)
		pr.Get("/channels/{peerID}/view_counts", chh.ViewCounts)
		pr.Get("/channels/{peerID}/similar", chh.Similar)
		// Предложка постов (Telegram suggested posts).
		pr.Post("/channels/{peerID}/suggested_posts", chh.Suggest)
		pr.Get("/channels/{peerID}/suggested_posts", chh.ListSuggested)
		pr.Post("/suggested_posts/{id}/approve", chh.ApproveSuggested)
		pr.Post("/suggested_posts/{id}/reject", chh.RejectSuggested)
		if statsUC != nil {
			sth := NewStatsHandler(statsUC, chatUC)
			pr.Get("/channels/{peerID}/stats", sth.ChannelStats)
			pr.Get("/chats/{peerID}/messages/{msgSeq}/stats", sth.PostStats)
		}
		pr.Get("/search", chh.Search)
		pr.Get("/search/messages", ch.GlobalSearchMessages)

		if mediaH != nil {
			pr.Get("/media/token", mediaH.MediaToken)
			pr.Post("/media/upload", mediaH.CreateUpload)
			pr.Get("/media/{mediaID}", mediaH.Get)
			pr.Put("/media/{mediaID}/content", mediaH.PutContent)
			// Chunked/resumable upload of large files.
			pr.Put("/media/{mediaID}/parts/{index}", mediaH.PutPart)
			pr.Get("/media/{mediaID}/parts", mediaH.UploadParts)
			pr.Post("/media/{mediaID}/finalize", mediaH.FinalizeUpload)
		}

		if pushH != nil {
			pr.Get("/push/vapid_public_key", pushH.VAPIDPublicKey)
			pr.Post("/push/subscribe", pushH.Subscribe)
		}

		if storyH != nil {
			pr.Post("/stories", storyH.Post)
			pr.Post("/stories/repost", storyH.Repost)
			pr.Get("/stories", storyH.Feed)
			pr.Get("/stories/archive", storyH.Archive)
			pr.Get("/stories/pinned", storyH.Pinned)
			pr.Get("/stories/stealth", storyH.StealthState)
			pr.Post("/stories/stealth/activate", storyH.ActivateStealth)
			pr.Post("/stories/{storyID}/view", storyH.View)
			pr.Post("/stories/{storyID}/reaction", storyH.SetReaction)
			pr.Delete("/stories/{storyID}/reaction", storyH.RemoveReaction)
			pr.Post("/stories/{storyID}/pin", storyH.Pin)
			pr.Post("/stories/{storyID}/share", storyH.Share)
			pr.Get("/stories/{storyID}/viewers", storyH.Viewers)
			pr.Get("/stories/{storyID}/stats", storyH.Stats)
			pr.Patch("/stories/{storyID}", storyH.Edit)
			pr.Delete("/stories/{storyID}", storyH.Delete)
			pr.Get("/me/close_friends", storyH.CloseFriends)
			pr.Put("/me/close_friends", storyH.SetCloseFriends)
		}

		if reportUC != nil {
			rph := NewReportHandler(reportUC, chatUC)
			pr.Post("/report", rph.Report)
		}

		if contactsUC != nil {
			coh := NewContactsHandler(contactsUC)
			pr.Post("/contacts", coh.Add)
			pr.Get("/contacts", coh.List)
			pr.Delete("/contacts/{userID}", coh.Delete)

			// Личное фото контакта (только у владельца) + предложение фото профиля.
			cph := NewContactPhotoHandler(contactsUC, chatUC)
			pr.Put("/contacts/{userID}/photo", cph.SetCustomPhoto)
			pr.Delete("/contacts/{userID}/photo", cph.ClearCustomPhoto)
			pr.Post("/contacts/{userID}/suggest_photo", cph.SuggestPhoto)
			pr.Post("/chats/{peerID}/photo_suggestions/{msgSeq}/accept", cph.AcceptSuggestion)
		}

		// ICE-конфиг для звонков (STUN + эфемерные TURN-креды)
		pr.Get("/calls/ice", iceH.Get)
		// Журнал звонков (вкладка «Звонки») — агрегирует call-сообщения личных чатов
		pr.Get("/calls", ch.CallLog)

		// Instant View: reader-mode статья по ссылке из сообщения
		if ivH != nil {
			pr.Get("/iv", ivH.Article)
		}

		sh := NewSessionHandler(authUC)
		pr.Get("/sessions", sh.List)
		pr.Delete("/sessions/others", sh.RevokeOthers)
		pr.Delete("/sessions/{deviceID}", sh.Revoke)
		pr.Post("/auth/logout", sh.Logout)
		pr.Post("/auth/qr/confirm", authH.QRConfirm)
		pr.Post("/auth/web_token", authH.NewWebAuthToken)
	})
	return r
}
