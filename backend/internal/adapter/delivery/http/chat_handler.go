package http

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

type ChatHandler struct{ svc *usecasechat.Interactor }

func NewChatHandler(svc *usecasechat.Interactor) *ChatHandler { return &ChatHandler{svc: svc} }

func (h *ChatHandler) meID(r *http.Request) int64 {
	u, _ := UserFromContext(r.Context())
	return u.ID
}

type createChatBody struct {
	UserID int64 `json:"user_id"`
}

func (h *ChatHandler) CreatePrivate(w http.ResponseWriter, r *http.Request) {
	var body createChatBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == 0 {
		writeError(w, http.StatusBadRequest, "user_id is required")
		return
	}
	if _, err := h.svc.CreatePrivateChat(r.Context(), h.meID(r), body.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create chat")
		return
	}
	// Наружу — ключ пира, а не id строки в chats: для приватного диалога это id
	// СОБЕСЕДНИКА (см. usecase/chat/peeraddr.go).
	writeJSON(w, http.StatusOK, map[string]any{"peer_id": domain.PeerID(body.UserID)})
}

type secretCreateBody struct {
	PeerID int64  `json:"peer_id"`
	Pub    string `json:"pub"` // base64 публичного ECDH-ключа инициатора
}

func (h *ChatHandler) CreateSecretChat(w http.ResponseWriter, r *http.Request) {
	var body secretCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PeerID == 0 || body.Pub == "" {
		writeError(w, http.StatusBadRequest, "peer_id and pub are required")
		return
	}
	pub, err := base64.StdEncoding.DecodeString(body.Pub)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid pub")
		return
	}
	sc, err := h.svc.CreateSecretChat(r.Context(), h.meID(r), body.PeerID, pub)
	if h.writeSecretErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"peer_id": domain.ToPeerID(sc.ChatID, true), "state": sc.State})
}

type secretAcceptBody struct {
	Pub string `json:"pub"` // base64 публичного ECDH-ключа получателя
}

func (h *ChatHandler) AcceptSecretChat(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var body secretAcceptBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Pub == "" {
		writeError(w, http.StatusBadRequest, "pub is required")
		return
	}
	pub, err := base64.StdEncoding.DecodeString(body.Pub)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid pub")
		return
	}
	sc, err := h.svc.AcceptSecretChat(r.Context(), chatID, h.meID(r), pub)
	if h.writeSecretErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"peer_id": domain.ToPeerID(sc.ChatID, true), "state": sc.State})
}

func (h *ChatHandler) RejectSecretChat(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	if err := h.svc.RejectSecretChat(r.Context(), chatID, h.meID(r)); h.writeSecretErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// writeSecretErr maps handshake errors to HTTP; returns true if it wrote a response.
// GetSecretChat отдаёт состояние handshake участнику (state + публичные ключи),
// чтобы UI восстановил рукопожатие после перезагрузки (accept/complete).
func (h *ChatHandler) GetSecretChat(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	sc, err := h.svc.GetSecretChat(r.Context(), chatID, h.meID(r))
	if h.writeSecretErr(w, err) {
		return
	}
	resp := map[string]any{
		"peer_id":      domain.ToPeerID(sc.ChatID, true),
		"initiator_id": sc.InitiatorID,
		"responder_id": sc.ResponderID,
		"state":        sc.State,
	}
	if len(sc.InitiatorPub) > 0 {
		resp["initiator_pub"] = base64.StdEncoding.EncodeToString(sc.InitiatorPub)
	}
	if len(sc.ResponderPub) > 0 {
		resp["responder_pub"] = base64.StdEncoding.EncodeToString(sc.ResponderPub)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *ChatHandler) writeSecretErr(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, domain.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "secret chats not available")
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid request")
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "not allowed")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "secret chat not found")
	default:
		writeError(w, http.StatusInternalServerError, "handshake failed")
	}
	return true
}

type translateBody struct {
	Text   string `json:"text"`
	ToLang string `json:"to_lang"`
}

// Translate переводит произвольный текст (сообщение/фрагмент) на to_lang через
// сконфигурированный провайдер (LibreTranslate). 503, если перевод отключён.
func (h *ChatHandler) Translate(w http.ResponseWriter, r *http.Request) {
	var body translateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	res, err := h.svc.TranslateText(r.Context(), body.Text, body.ToLang)
	switch {
	case errors.Is(err, domain.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "translation not available")
		return
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusBadRequest, "text and to_lang are required")
		return
	case errors.Is(err, domain.ErrTooLong):
		writeError(w, http.StatusBadRequest, "text too long")
		return
	case err != nil:
		writeError(w, http.StatusBadGateway, "translation failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"text": res.Text, "source": res.Source})
}

type geoLiveBody struct {
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Heading *int    `json:"heading"`
	Stopped bool    `json:"stopped"`
}

// UpdateGeoLive — POST /chats/{chatID}/messages/{msgID}/geo_live: автор обновляет
// координаты своей live-локации (watchPosition) или останавливает трансляцию.
func (h *ChatHandler) UpdateGeoLive(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	var body geoLiveBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	msg, err := h.svc.UpdateLiveLocation(r.Context(), chatID, msgID, h.meID(r), body.Lat, body.Lng, body.Heading, body.Stopped)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not a live location")
		return
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "not allowed")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, messageJSONOut(r.Context(), h.svc, msg))
}

// Saved returns (creating on first access) the caller's "Saved Messages" chat.
func (h *ChatHandler) Saved(w http.ResponseWriter, r *http.Request) {
	if _, err := h.svc.GetOrCreateSaved(r.Context(), h.meID(r)); err != nil {
		writeError(w, http.StatusInternalServerError, "could not open saved messages")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"peer_id": domain.PeerID(h.meID(r))})
}

// SavedDialogs returns the grouped «Чаты»-tab rows of the caller's Saved Messages.
func (h *ChatHandler) SavedDialogs(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.SavedDialogs(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list saved dialogs")
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, d := range list {
		out = append(out, map[string]any{
			"kind": d.Kind, "peer_id": d.PeerID, "title": d.Title, "photo_id": d.PhotoID,
			"count": d.Count,
			"last_message": map[string]any{
				"type": d.Last.Type, "text": d.Last.Text,
				"media_id": func() int64 {
					if d.Last.MediaID != nil {
						return *d.Last.MediaID
					}
					return 0
				}(),
				"at": d.Last.CreatedAt,
			},
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"dialogs": out})
}

// dialogRow — представление одного диалога в HTTP-контракте /chats.
func dialogRow(d domain.DialogRecord, peer domain.PeerID) map[string]any {
	row := map[string]any{
		"peer_id": peer, "type": d.Type,
		"title": d.Title, "photo": d.ChatPhoto(), "username": d.Username,
		"last_read_seq": d.LastReadSeq, "peer_read_seq": d.PeerReadSeq, "unread": d.UnreadCount,
		"unread_mentions_count": d.UnreadMentionsCount, "unread_reactions": d.UnreadReactionsCount, "muted": d.Muted,
		"pinned": d.Pinned, "archived": d.Archived, "is_forum": d.IsForum,
		"notify_preview": d.NotifyPreview, "notify_sound": d.NotifySound,
		"auto_delete_period": d.AutoDeletePeriod, "theme_id": d.ThemeID,
	}
	if d.HasLast {
		lastMsg := map[string]any{
			"seq": d.LastSeq, "text": d.LastText, "sender_id": d.LastSenderID, "at": d.LastAt,
			"media_id": d.LastMediaID, "type": d.LastType, "forwarded": d.LastForwarded,
			"sender_name": d.LastSenderName,
		}
		// Секретный чат: отдаём шифр-блоб — клиент расшифрует его для превью
		// (сервер plaintext не знает). У обычных чатов LastEncBody = nil.
		if len(d.LastEncBody) > 0 {
			lastMsg["enc_body"] = base64.StdEncoding.EncodeToString(d.LastEncBody)
		}
		row["last_message"] = lastMsg
	}
	if d.Peer != nil {
		// Собеседник приватного чата — конструктор `user` целиком: имя,
		// аватарка и флаги (verified/premium/bot) живут ВНУТРИ него, а не
		// рассыпаны плоскими ключами рядом.
		row["peer"] = *d.Peer
	}
	return row
}

// dialogFolder — реальная папка из query. Значения на проводе — как у tweb
// (FOLDER_ID_ALL=0, FOLDER_ID_ARCHIVE=1); отсутствие параметра и любое другое
// значение означают «весь набор»: это прежнее поведение эндпоинта, и деградация
// к нему безопаснее 400 — клиент с неизвестным номером папки увидит больше
// диалогов, а не пустой список.
func dialogFolder(r *http.Request) domain.FolderID {
	switch queryInt(r, "folder_id", -1) {
	case 0:
		return domain.FolderAll
	case 1:
		return domain.FolderArchive
	default:
		return domain.FolderGlobal
	}
}

// ListDialogs — GET /chats?limit=&offset_peer_id=&folder_id=: без параметров
// отдаёт весь список (обратная совместимость), с ними — страницу по курсору
// peer_id внутри реальной папки.
func (h *ChatHandler) ListDialogs(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 0)
	if limit < 0 {
		// Отрицательный limit — не 400: клиента с таким запросом нет,
		// тихая деградация к «весь список» безопаснее.
		limit = 0
	}
	// Курсор приезжает ключом пира; внутрь домена он идёт chatID — неизвестный
	// (диалог уехал в архив/удалён между страницами) означает «с начала», ровно
	// как трактует неизвестный id сам домен.
	var offsetChatID int64
	if cur := queryPeer(r, "offset_peer_id", domain.NullPeerID); cur != domain.NullPeerID {
		offsetChatID, _ = h.svc.PeerToChatID(r.Context(), h.meID(r), cur)
	}
	page := domain.DialogPage{
		Limit:        int(limit),
		OffsetChatID: offsetChatID,
		Folder:       dialogFolder(r),
	}
	res, err := h.svc.ListDialogsPage(r.Context(), h.meID(r), page)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list chats")
		return
	}
	out := make([]map[string]any, 0, len(res.Dialogs))
	for _, d := range res.Dialogs {
		out = append(out, dialogRow(d, h.svc.DialogPeerID(d, h.meID(r))))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"chats": out, "count": res.Count, "is_end": res.IsEnd,
	})
}

type sendBody struct {
	Type      string                 `json:"type"`
	Text      string                 `json:"text"`
	Entities  domain.MessageEntities `json:"entities"`
	ReplyToID *int64                 `json:"reply_to_id"`
	// ответ с цитатой фрагмента (Telegram reply quote): текст + offset (UTF-16)
	ReplyQuoteText   *string `json:"reply_quote_text"`
	ReplyQuoteOffset *int    `json:"reply_quote_offset"`
	ClientMsgID      string  `json:"client_msg_id"`
	MediaID          *int64  `json:"media_id"`
	GroupedID        string  `json:"grouped_id"`
	// сообщение в тред (форум-топик): id корневого сообщения топика
	ThreadRootID *int64 `json:"thread_root_id"`
	// гео-точка (type 'geo') / контакт (type 'contact')
	GeoLat        *float64 `json:"geo_lat"`
	GeoLng        *float64 `json:"geo_lng"`
	GeoTitle      *string  `json:"geo_title"`
	GeoAddress    *string  `json:"geo_address"`
	GeoLivePeriod *int     `json:"geo_live_period"`
	GeoHeading    *int     `json:"geo_heading"`
	ContactUserID *int64   `json:"contact_user_id"`
	// Платное медиа (Telegram paid media): цена доступа в звёздах. nil/<=0 — обычное
	// медиа; применяется только к фото/видео с прикреплённым media_id.
	PaidMediaPrice *int64 `json:"paid_media_price"`
	// Скрыть медиа спойлером (Telegram messageMedia.pFlags.spoiler); работает
	// только вместе с media_id.
	MediaSpoiler bool `json:"media_spoiler"`
	// Отправка от имени канала/группы (Telegram send_as); nil — от себя.
	SendAsPeerID *domain.PeerID `json:"send_as_peer_id"`
}

func (h *ChatHandler) Send(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatIDOrCreate(w, r, h.svc)
	if !ok {
		return
	}
	var body sendBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Type == "service" { // server-only type (group action pills)
		writeError(w, http.StatusBadRequest, "invalid type")
		return
	}
	// thread_root_id с клиента — id ПОСТА (внешний контракт); в discussion-группе
	// физически нужен id зеркала (см. ResolveThreadRootForSend). Резолвим здесь,
	// на входе, а не внутри Send — PostComment туда уже шлёт id зеркала.
	// Ошибка (нет зеркала и дозавести нечего) — понятный 404, а не запись
	// sentinel-нуля в thread_root_id (см. комментарий ResolveThreadRootForSend).
	threadRoot, terr := h.svc.ResolveThreadRootForSend(r.Context(), chatID, body.ThreadRootID)
	if errors.Is(terr, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "comment thread not found")
		return
	}
	if terr != nil {
		writeError(w, http.StatusInternalServerError, "send failed")
		return
	}
	msg, err := h.svc.Send(r.Context(), usecasechat.SendInput{
		ChatID: chatID, SenderID: h.meID(r), Type: body.Type, Text: body.Text, Entities: body.Entities,
		ReplyToID: body.ReplyToID, ReplyQuoteText: body.ReplyQuoteText, ReplyQuoteOffset: body.ReplyQuoteOffset,
		ClientMsgID: body.ClientMsgID, MediaID: body.MediaID, GroupedID: body.GroupedID,
		ThreadRootID: threadRoot,
		GeoLat:       body.GeoLat, GeoLng: body.GeoLng, ContactUserID: body.ContactUserID,
		GeoTitle: body.GeoTitle, GeoAddress: body.GeoAddress,
		GeoLivePeriod: body.GeoLivePeriod, GeoHeading: body.GeoHeading,
		PaidMediaPrice: body.PaidMediaPrice,
		MediaSpoiler:   body.MediaSpoiler,
		SendAsChatID:   sendAsChatID(body.SendAsPeerID),
	})
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "message too long")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed")
		return
	}
	if errors.Is(err, domain.ErrSlowmode) {
		writeError(w, http.StatusTooManyRequests, "slowmode")
		return
	}
	if errors.Is(err, domain.ErrPrivacy) {
		writeError(w, http.StatusForbidden, "privacy")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "send failed")
		return
	}
	writeJSON(w, http.StatusOK, messageJSONOut(r.Context(), h.svc, msg))
}

func (h *ChatHandler) History(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	limit := int(queryInt(r, "limit", 40))
	// Тред (форум-топик / комментарии): ?thread_root=<msgID> ограничивает окно.
	var threadRoot *int64
	if tr := queryInt(r, "thread_root", 0); tr > 0 {
		threadRoot = &tr
	}
	// Jump-to-message: ?around=<seq> returns a window centered on that message.
	if around := queryInt(r, "around", 0); around > 0 {
		a, err := h.svc.GetHistoryAround(r.Context(), chatID, h.meID(r), around, limit, threadRoot)
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusForbidden, "not a member of this chat")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "history failed")
			return
		}
		out := messagesJSON(r.Context(), h.svc, a.Messages)
		writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": a.Count, "reached_top": a.ReachedTop, "reached_bottom": a.ReachedBottom})
		return
	}
	offsetSeq := queryInt(r, "offset_id", 0)
	addOffset := int(queryInt(r, "add_offset", 0))
	// ?tag=<реакция> — фильтр «Избранного» по тегу-реакции (tweb search by saved tag).
	tag := r.URL.Query().Get("tag")
	res, err := h.svc.GetHistory(r.Context(), chatID, h.meID(r), offsetSeq, addOffset, limit, threadRoot, tag)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		log.Printf("history failed chat=%d: %v", chatID, err)
		writeError(w, http.StatusInternalServerError, "history failed")
		return
	}
	out := messagesJSON(r.Context(), h.svc, res.Messages)
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": res.Count})
}

type readBody struct {
	UpToSeq int64 `json:"up_to_seq"`
}

func (h *ChatHandler) Read(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var body readBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	err := h.svc.MarkRead(r.Context(), chatID, h.meID(r), body.UpToSeq)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ReadDate — GET /chats/{chatID}/messages/{msgID}/read_date: когда получатель
// прочитал исходящее сообщение в приватном чате (tweb getOutboxReadDate).
// 403 YOUR_PRIVACY_RESTRICTED — read-time скрыт (взаимность); 404 — read-date
// недоступна (не приватный/не исходящее/ещё не прочитано) → клиент прячет строку.
func (h *ChatHandler) ReadDate(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	at, err := h.svc.OutboxReadDate(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "YOUR_PRIVACY_RESTRICTED")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no read date")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read date failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"read_at": at.UTC().Format(time.RFC3339)})
}

// ReadReactions clears the caller's unread-reactions badge for a chat
// (POST /chats/{chatID}/reactions/read; Telegram readReactions) without moving
// the read horizon.
func (h *ChatHandler) ReadReactions(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	err := h.svc.ReadReactions(r.Context(), chatID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read reactions failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ClearHistory clears the caller's copy of the chat history (POST
// /chats/{chatID}/clear; Telegram «Очистить историю» — у себя): messages stay
// for everyone else, only this user's window is emptied.
func (h *ChatHandler) ClearHistory(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	err := h.svc.ClearHistory(r.Context(), chatID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "clear failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type editBody struct {
	Text     string                 `json:"text"`
	Entities domain.MessageEntities `json:"entities"`
}

func (h *ChatHandler) EditMessage(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	var body editBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	msg, err := h.svc.EditMessage(r.Context(), chatID, msgID, h.meID(r), body.Text, body.Entities)
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "only the author can edit")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "message too long")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "edit failed")
		return
	}
	writeJSON(w, http.StatusOK, messageJSONOut(r.Context(), h.svc, msg))
}

type factCheckBody struct {
	Text     string                 `json:"text"`
	Entities domain.MessageEntities `json:"entities"`
	Country  string                 `json:"country"`
}

// SetFactCheck — POST /chats/{chatID}/messages/{msgID}/factcheck: прикрепить/
// изменить «проверку фактов» (право — автор/админ канала).
func (h *ChatHandler) SetFactCheck(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	var body factCheckBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	msg, err := h.svc.SetFactCheck(r.Context(), chatID, msgID, h.meID(r), body.Text, body.Entities, body.Country)
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed to edit fact check")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "fact check text is required")
		return
	}
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "fact check too long")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "set fact check failed")
		return
	}
	writeJSON(w, http.StatusOK, messageJSONOut(r.Context(), h.svc, msg))
}

// RemoveFactCheck — DELETE /chats/{chatID}/messages/{msgID}/factcheck.
func (h *ChatHandler) RemoveFactCheck(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	err := h.svc.RemoveFactCheck(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed to edit fact check")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "remove fact check failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// TranscribeMessage — POST /chats/{chatID}/messages/{msgID}/transcribe: расшифровка
// голосового/видео-кружка (Telegram messages.transcribeAudio). Реального движка STT
// нет — сервер отдаёт детерминированный демо-стаб и кэширует его. pending всегда
// false (расшифровка синхронна).
func (h *ChatHandler) TranscribeMessage(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	text, err := h.svc.TranscribeMessage(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not a member")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "message is not transcribable")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "transcribe failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"text": text, "pending": false})
}

func (h *ChatHandler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	revoke := r.URL.Query().Get("revoke") == "true"
	err := h.svc.DeleteMessage(r.Context(), chatID, msgID, h.meID(r), revoke)
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "only the author can delete for everyone")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type forwardBody struct {
	FromPeerID  domain.PeerID `json:"from_peer_id"`
	MsgIDs      []int64       `json:"msg_ids"`
	DropAuthor  bool          `json:"drop_author"`
	DropCaption bool          `json:"drop_caption"`
}

func (h *ChatHandler) Forward(w http.ResponseWriter, r *http.Request) {
	toChatID, ok := peerChatIDOrCreate(w, r, h.svc)
	if !ok {
		return
	}
	var body forwardBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.FromPeerID == domain.NullPeerID || len(body.MsgIDs) == 0 {
		writeError(w, http.StatusBadRequest, "from_peer_id and msg_ids are required")
		return
	}
	fromChatID, ok := resolveBodyPeer(w, r, h.svc, body.FromPeerID, false)
	if !ok {
		return
	}
	msgs, err := h.svc.ForwardMessages(r.Context(), usecasechat.ForwardInput{
		FromChatID: fromChatID, ToChatID: toChatID, MsgIDs: body.MsgIDs, SenderID: h.meID(r),
		DropAuthor: body.DropAuthor, DropCaption: body.DropCaption,
	})
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member or message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "forward failed")
		return
	}
	out := messagesJSON(r.Context(), h.svc, msgs)
	writeJSON(w, http.StatusOK, map[string]any{"messages": out})
}

func (h *ChatHandler) Pin(w http.ResponseWriter, r *http.Request)   { h.setPin(w, r, true) }
func (h *ChatHandler) Unpin(w http.ResponseWriter, r *http.Request) { h.setPin(w, r, false) }

func (h *ChatHandler) setPin(w http.ResponseWriter, r *http.Request, pin bool) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	err := h.svc.SetPin(r.Context(), chatID, msgID, h.meID(r), pin)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "pin failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *ChatHandler) ListPins(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgs, err := h.svc.ListPins(r.Context(), chatID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list pins")
		return
	}
	out := messagesJSON(r.Context(), h.svc, msgs)
	writeJSON(w, http.StatusOK, map[string]any{"messages": out})
}

func (h *ChatHandler) Viewers(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	ids, err := h.svc.MessageViewers(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load viewers")
		return
	}
	if ids == nil {
		ids = []int64{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"user_ids": ids})
}

// NextMention serves «jump to next @»: GET /chats/{chatID}/mentions/next?after_seq=
// returns the seq/msg_id of the caller's earliest unread mention past after_seq
// (404 when there's none). Powers the floating mention button in the open chat.
func (h *ChatHandler) NextMention(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	afterSeq := queryInt(r, "after_seq", 0)
	seq, msgID, err := h.svc.NextMention(r.Context(), chatID, h.meID(r), afterSeq)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no unread mention")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load mention")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"seq": seq, "msg_id": msgID})
}

// MediaHistory serves the profile's shared-media tabs:
// GET /chats/{chatID}/media?filter=media|files|links|music|voice
func (h *ChatHandler) MediaHistory(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	filter := r.URL.Query().Get("filter")
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 30))
	res, err := h.svc.MediaHistory(r.Context(), chatID, h.meID(r), filter, offset, limit)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "media history failed")
		return
	}
	out := messagesJSON(r.Context(), h.svc, res.Messages)
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": res.Count})
}

func (h *ChatHandler) SearchMessages(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	q := r.URL.Query().Get("q")
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 20))
	// tweb topbarSearch: необязательные фильтры автор/тип медиа/реакция.
	f := usecasechat.SearchFilter{
		SenderID:  queryInt(r, "sender_id", 0),
		MediaType: r.URL.Query().Get("media_type"),
		Reaction:  r.URL.Query().Get("reaction"),
	}
	res, err := h.svc.SearchMessages(r.Context(), chatID, h.meID(r), q, f, offset, limit)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}
	out := messagesJSON(r.Context(), h.svc, res.Messages)
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": res.Count})
}

// MessageByDate — GET /chats/{chatID}/message_by_date?date=<unix>: seq
// ближайшего сообщения на/после даты (jump-to-date, tweb datePicker/onDatePick).
func (h *ChatHandler) MessageByDate(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	date := queryInt(r, "date", 0)
	seq, err := h.svc.MessageSeqByDate(r.Context(), chatID, h.meID(r), time.Unix(date, 0))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no message for this date")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "lookup failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"seq": seq})
}

// Calendar — GET /chats/{chatID}/calendar?month=<unix>: по одному медиа-сообщению
// на каждый день месяца, которому принадлежит month (пикер даты рисует их
// миниатюрами в ячейках дней — tweb getSearchResultsCalendar).
func (h *ChatHandler) Calendar(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	month := time.Unix(queryInt(r, "month", 0), 0).UTC()
	from := time.Date(month.Year(), month.Month(), 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 1, 0)
	days, err := h.svc.CalendarMonth(r.Context(), chatID, h.meID(r), from, to)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "calendar failed")
		return
	}
	out := make([]map[string]any, 0, len(days))
	for _, d := range days {
		out = append(out, map[string]any{
			"day":       d.Day.Unix(),
			"msg_id":    d.MsgID,
			"seq":       d.Seq,
			"media_id":  d.MediaID,
			"type":      d.Type,
			"has_thumb": d.HasThumb,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// GlobalSearchMessages — GET /search/messages?q=&filter=&offset=&limit=: поиск
// по сообщениям всех чатов юзера (сайдбар-поиск, tweb SearchTypes).
func (h *ChatHandler) GlobalSearchMessages(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	filter := r.URL.Query().Get("filter")
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 20))
	res, err := h.svc.GlobalSearchMessages(r.Context(), h.meID(r), q, filter, offset, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}
	out := messagesJSON(r.Context(), h.svc, res.Messages)
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": res.Count})
}

// CallLog — GET /calls?offset=&limit=: журнал звонков (вкладка «Звонки»).
func (h *ChatHandler) CallLog(w http.ResponseWriter, r *http.Request) {
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 40))
	calls, err := h.svc.CallLog(r.Context(), h.meID(r), offset, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load calls")
		return
	}
	if calls == nil {
		calls = []domain.CallLogEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"calls": calls})
}

// SendPoll — POST /chats/{chatID}/polls: отправить опрос (сообщение типа 'poll').
func (h *ChatHandler) SendPoll(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatIDOrCreate(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Question      string   `json:"question"`
		Options       []string `json:"options"`
		Anonymous     bool     `json:"anonymous"`
		Multiple      bool     `json:"multiple"`
		Quiz          bool     `json:"quiz"`
		CorrectOption *int     `json:"correct_option"`
		ClientMsgID   string   `json:"client_msg_id"`
		// Общий пакет параметров отправки — те же имена полей, что у sendBody.
		ReplyToID        *int64         `json:"reply_to_id"`
		ReplyQuoteText   *string        `json:"reply_quote_text"`
		ReplyQuoteOffset *int           `json:"reply_quote_offset"`
		ThreadRootID     *int64         `json:"thread_root_id"`
		Silent           bool           `json:"silent"`
		SendAsPeerID     *domain.PeerID `json:"send_as_peer_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	// thread_root_id с клиента — id ПОСТА (внешний контракт), см. Send.
	threadRoot, terr := h.svc.ResolveThreadRootForSend(r.Context(), chatID, b.ThreadRootID)
	if errors.Is(terr, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "comment thread not found")
		return
	}
	if terr != nil {
		writeError(w, http.StatusInternalServerError, "could not send poll")
		return
	}
	m, err := h.svc.SendPoll(r.Context(), usecasechat.SendPollInput{
		ChatID: chatID, SenderID: h.meID(r),
		Question: b.Question, Options: b.Options,
		Anonymous: b.Anonymous, Multiple: b.Multiple, Quiz: b.Quiz, CorrectOption: b.CorrectOption,
		ClientMsgID: b.ClientMsgID,
		ReplyToID:   b.ReplyToID, ReplyQuoteText: b.ReplyQuoteText, ReplyQuoteOffset: b.ReplyQuoteOffset,
		ThreadRootID: threadRoot, Silent: b.Silent, SendAsChatID: sendAsChatID(b.SendAsPeerID),
	})
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "invalid poll")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not send poll")
		return
	}
	writeJSON(w, http.StatusOK, messageJSONOut(r.Context(), h.svc, m))
}

// VotePoll — POST /polls/{pollID}/vote {options:[0,2]}: голос (пустой список — отзыв).
func (h *ChatHandler) VotePoll(w http.ResponseWriter, r *http.Request) {
	pollID, ok := pathInt(w, r, "pollID")
	if !ok {
		return
	}
	var b struct {
		Options []int `json:"options"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	info, err := h.svc.VotePoll(r.Context(), pollID, h.meID(r), b.Options)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "poll not found")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusBadRequest, "invalid vote")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not vote")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"poll": info})
}

// ClosePoll — POST /polls/{pollID}/close: остановить опрос (автор/админ).
func (h *ChatHandler) ClosePoll(w http.ResponseWriter, r *http.Request) {
	pollID, ok := pathInt(w, r, "pollID")
	if !ok {
		return
	}
	err := h.svc.ClosePoll(r.Context(), pollID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "poll not found")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not close poll")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// SendChecklist — POST /chats/{chatID}/checklists: отправить чек-лист
// (сообщение типа 'checklist').
func (h *ChatHandler) SendChecklist(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatIDOrCreate(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Title         string   `json:"title"`
		Items         []string `json:"items"`
		OthersCanAdd  bool     `json:"others_can_add"`
		OthersCanMark bool     `json:"others_can_mark"`
		ClientMsgID   string   `json:"client_msg_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	m, err := h.svc.SendChecklist(r.Context(), usecasechat.SendChecklistInput{
		ChatID: chatID, SenderID: h.meID(r),
		Title: b.Title, Items: b.Items,
		OthersCanAdd: b.OthersCanAdd, OthersCanMark: b.OthersCanMark,
		ClientMsgID: b.ClientMsgID,
	})
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "invalid checklist")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not send checklist")
		return
	}
	writeJSON(w, http.StatusOK, messageJSONOut(r.Context(), h.svc, m))
}

// ToggleChecklistItem — POST /checklists/{id}/items/{itemID}/toggle: отметить/
// снять отметку «выполнено» на пункте (учитывает право others_can_mark).
func (h *ChatHandler) ToggleChecklistItem(w http.ResponseWriter, r *http.Request) {
	checklistID, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	itemID, ok := pathInt(w, r, "itemID")
	if !ok {
		return
	}
	info, err := h.svc.ToggleChecklistItem(r.Context(), checklistID, int(itemID), h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "checklist not found")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not toggle item")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"checklist": info})
}

// AddChecklistItems — POST /checklists/{id}/items {items:[...]}: добавить пункты
// (учитывает право others_can_add).
func (h *ChatHandler) AddChecklistItems(w http.ResponseWriter, r *http.Request) {
	checklistID, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	var b struct {
		Items []string `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	info, err := h.svc.AddChecklistItems(r.Context(), checklistID, h.meID(r), b.Items)
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "invalid items")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "checklist not found")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not add items")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"checklist": info})
}

// scheduledJSON — представление запланированного сообщения.
func scheduledJSON(m domain.ScheduledMessage, peer domain.PeerID) map[string]any {
	j := map[string]any{
		"id": m.ID, "peer_id": peer, "sender_id": m.SenderID,
		"type": m.Type, "text": m.Text, "reply_to_id": m.ReplyToID,
		"media_id": m.MediaID, "send_at": m.SendAt, "created_at": m.CreatedAt,
		"when_online": m.WhenOnline,
	}
	if len(m.Entities) > 0 {
		j["entities"] = m.Entities
	}
	return j
}

// ScheduleMessage — POST /chats/{chatID}/scheduled: запланировать отправку.
func (h *ChatHandler) ScheduleMessage(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatIDOrCreate(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Type       string                 `json:"type"`
		Text       string                 `json:"text"`
		Entities   domain.MessageEntities `json:"entities"`
		ReplyTo    *int64                 `json:"reply_to_id"`
		MediaID    *int64                 `json:"media_id"`
		SendAt     int64                  `json:"send_at"`     // unix-секунды (игнор при when_online)
		WhenOnline bool                   `json:"when_online"` // отправить когда собеседник онлайн
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	m, err := h.svc.ScheduleMessage(r.Context(), usecasechat.SendInput{
		ChatID: chatID, SenderID: h.meID(r), Type: b.Type, Text: b.Text,
		Entities: b.Entities, ReplyToID: b.ReplyTo, MediaID: b.MediaID,
	}, time.Unix(b.SendAt, 0), b.WhenOnline)
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "invalid scheduled message")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "when_online requires a private chat")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not schedule")
		return
	}
	writeJSON(w, http.StatusOK, scheduledJSON(m, peerOf(r, h.svc, m.ChatID)))
}

// UpdateScheduled — PATCH /chats/{chatID}/scheduled/{schedID} {send_at}:
// перенести своё запланированное сообщение на новое время (reschedule).
func (h *ChatHandler) UpdateScheduled(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "schedID")
	if !ok {
		return
	}
	var b struct {
		SendAt int64 `json:"send_at"` // unix-секунды
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	m, err := h.svc.UpdateScheduled(r.Context(), id, h.meID(r), time.Unix(b.SendAt, 0))
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "send_at must be in the future")
		return
	}
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, scheduledJSON(m, peerOf(r, h.svc, m.ChatID)))
}

// ListScheduled — GET /chats/{chatID}/scheduled: свои запланированные.
func (h *ChatHandler) ListScheduled(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	list, err := h.svc.ListScheduled(r.Context(), chatID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list scheduled")
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, m := range list {
		out = append(out, scheduledJSON(m, peerOf(r, h.svc, m.ChatID)))
	}
	writeJSON(w, http.StatusOK, map[string]any{"scheduled": out})
}

// DeleteScheduled — DELETE /chats/{chatID}/scheduled/{schedID}.
func (h *ChatHandler) DeleteScheduled(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "schedID")
	if !ok {
		return
	}
	if err := h.svc.DeleteScheduled(r.Context(), id, h.meID(r)); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// SendScheduledNow — POST /chats/{chatID}/scheduled/{schedID}/send_now.
func (h *ChatHandler) SendScheduledNow(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "schedID")
	if !ok {
		return
	}
	m, err := h.svc.SendScheduledNow(r.Context(), id, h.meID(r))
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, messageJSONOut(r.Context(), h.svc, m))
}

func (h *ChatHandler) mapScheduledErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "not allowed")
	default:
		writeError(w, http.StatusInternalServerError, "scheduled operation failed")
	}
}

// ── Форум-топики ──

// SetForum — POST /chats/{chatID}/forum {enabled}: включить темы (CHANGE_INFO).
func (h *ChatHandler) SetForum(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.SetForum(r.Context(), chatID, h.meID(r), b.Enabled); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func topicJSON(row domain.TopicRow) map[string]any {
	return map[string]any{
		// Темы бывают только у супергрупп — ключ пира тут один на всех: -chatID.
		"id": row.Topic.ID, "peer_id": domain.ToPeerID(row.Topic.ChatID, true), "root_msg_id": row.Topic.RootMsgID,
		"title": row.Topic.Title, "icon_color": row.Topic.IconColor, "icon_emoji": row.Topic.IconEmoji,
		"closed": row.Topic.Closed, "hidden": row.Topic.Hidden, "pinned": row.Topic.Pinned,
		"pos": row.Topic.Pos, "is_general": row.Topic.IsGeneral,
		"created_by": row.Topic.CreatedBy, "created_at": row.Topic.CreatedAt,
		"msg_count": row.MsgCount, "last_text": row.LastText, "last_type": row.LastType,
		"last_sender_name": row.LastSenderName, "last_at": row.LastAt,
		// per-topic dialog-состояние (как обычный ряд диалога)
		"unread": row.UnreadCount, "unread_mentions": row.UnreadMentions,
		"muted": row.Muted, "last_out": row.LastOut, "last_seq": row.LastMsgSeq,
	}
}

// CreateTopic — POST /chats/{chatID}/topics {title, icon_color}.
func (h *ChatHandler) CreateTopic(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Title     string `json:"title"`
		IconColor int    `json:"icon_color"`
		IconEmoji string `json:"icon_emoji"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	t, err := h.svc.CreateTopic(r.Context(), chatID, h.meID(r), b.Title, b.IconEmoji, b.IconColor)
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "invalid title")
		return
	}
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, topicJSON(domain.TopicRow{Topic: t}))
}

// ListTopics — GET /chats/{chatID}/topics.
func (h *ChatHandler) ListTopics(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	rowsT, err := h.svc.ListTopics(r.Context(), chatID, h.meID(r))
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(rowsT))
	for _, t := range rowsT {
		out = append(out, topicJSON(t))
	}
	writeJSON(w, http.StatusOK, map[string]any{"topics": out})
}

// CloseTopic — POST /chats/{chatID}/topics/{topicID}/close {closed}.
func (h *ChatHandler) CloseTopic(w http.ResponseWriter, r *http.Request) {
	topicID, ok := pathInt(w, r, "topicID")
	if !ok {
		return
	}
	var b struct {
		Closed bool `json:"closed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.CloseTopic(r.Context(), topicID, h.meID(r), b.Closed); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// EditTopic — PATCH /chats/{chatID}/topics/{topicID} {title, icon_emoji, icon_color}.
func (h *ChatHandler) EditTopic(w http.ResponseWriter, r *http.Request) {
	topicID, ok := pathInt(w, r, "topicID")
	if !ok {
		return
	}
	var b struct {
		Title     string `json:"title"`
		IconEmoji string `json:"icon_emoji"`
		IconColor int    `json:"icon_color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.EditTopic(r.Context(), topicID, h.meID(r), b.Title, b.IconEmoji, b.IconColor); err != nil {
		if errors.Is(err, domain.ErrTooLong) {
			writeError(w, http.StatusBadRequest, "invalid title")
			return
		}
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// HideTopic — POST /chats/{chatID}/topics/{topicID}/hide {hidden}.
func (h *ChatHandler) HideTopic(w http.ResponseWriter, r *http.Request) {
	topicID, ok := pathInt(w, r, "topicID")
	if !ok {
		return
	}
	var b struct {
		Hidden bool `json:"hidden"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.SetTopicHidden(r.Context(), topicID, h.meID(r), b.Hidden); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// PinTopic — POST /chats/{chatID}/topics/{topicID}/pin {pinned}.
func (h *ChatHandler) PinTopic(w http.ResponseWriter, r *http.Request) {
	topicID, ok := pathInt(w, r, "topicID")
	if !ok {
		return
	}
	var b struct {
		Pinned bool `json:"pinned"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.SetTopicPinned(r.Context(), topicID, h.meID(r), b.Pinned); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ReadTopic — POST /chats/{chatID}/topics/{topicID}/read {up_to_seq}.
// Помечает тему прочитанной до up_to_seq (Telegram readDiscussion c threadId).
// В слоте {topicID} передаётся root_msg_id темы (ключ состояния — пара chat+root).
func (h *ChatHandler) ReadTopic(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	rootMsgID, ok := pathInt(w, r, "topicID")
	if !ok {
		return
	}
	var b struct {
		UpToSeq int64 `json:"up_to_seq"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.MarkTopicRead(r.Context(), chatID, rootMsgID, h.meID(r), b.UpToSeq); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// MuteTopic — POST /chats/{chatID}/topics/{topicID}/mute {muted}.
// Включает/выключает уведомления темы для пользователя.
// В слоте {topicID} передаётся root_msg_id темы (ключ состояния — пара chat+root).
func (h *ChatHandler) MuteTopic(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	rootMsgID, ok := pathInt(w, r, "topicID")
	if !ok {
		return
	}
	var b struct {
		Muted bool `json:"muted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.SetTopicMuted(r.Context(), chatID, rootMsgID, h.meID(r), b.Muted); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ThreadMessages — GET /chats/{chatID}/threads/{rootID}: сообщения треда.
func (h *ChatHandler) ThreadMessages(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	rootID, ok := pathInt(w, r, "rootID")
	if !ok {
		return
	}
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 50))
	msgs, count, err := h.svc.ListThreadMessages(r.Context(), chatID, rootID, h.meID(r), offset, limit)
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	out := messagesJSON(r.Context(), h.svc, msgs)
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": count})
}

// GroupCallParticipants — GET /chats/{chatID}/group_call: кто сейчас в видеочате.
func (h *ChatHandler) GroupCallParticipants(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	ids, err := h.svc.GroupCallParticipants(r.Context(), chatID, h.meID(r))
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	if ids == nil {
		ids = []int64{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"participants": ids})
}

// ── RTMP-трансляции (Telegram livestream) ──

// livestreamJSON сериализует состояние трансляции. Креды (rtmp_url/stream_key)
// присутствуют, только если usecase их отдал (админ) — зрителю секрет не уходит.
func livestreamJSON(st usecasechat.LivestreamState) map[string]any {
	m := map[string]any{
		"active": st.Active, "viewers": st.Viewers, "is_admin": st.IsAdmin,
	}
	if st.StartedAt != nil {
		m["started_at"] = *st.StartedAt
	}
	if st.RTMPURL != "" {
		m["rtmp_url"] = st.RTMPURL
	}
	if st.StreamKey != "" {
		m["stream_key"] = st.StreamKey
	}
	return m
}

// StartLivestream — POST /chats/{chatID}/livestream/start: админ запускает эфир,
// в ответе — креды для OBS (rtmp_url + stream_key).
func (h *ChatHandler) StartLivestream(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	st, err := h.svc.StartLivestream(r.Context(), chatID, h.meID(r))
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, livestreamJSON(st))
}

// StopLivestream — POST /chats/{chatID}/livestream/stop: админ завершает эфир.
func (h *ChatHandler) StopLivestream(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	if err := h.svc.StopLivestream(r.Context(), chatID, h.meID(r)); err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// LivestreamStatus — GET /chats/{chatID}/livestream: статус эфира для участника
// (активна ли, число зрителей; креды — только админу).
func (h *ChatHandler) LivestreamStatus(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	st, err := h.svc.LivestreamStatus(r.Context(), chatID, h.meID(r))
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, livestreamJSON(st))
}

// RevokeStreamKey — POST /chats/{chatID}/livestream/revoke_key: админ
// перевыпускает stream key (в ответе — новые креды).
func (h *ChatHandler) RevokeStreamKey(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	st, err := h.svc.RevokeStreamKey(r.Context(), chatID, h.meID(r))
	if err != nil {
		h.mapScheduledErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, livestreamJSON(st))
}

func (h *ChatHandler) Sync(w http.ResponseWriter, r *http.Request) {
	sincePts := queryInt(r, "pts", 0)
	d, err := h.svc.GetDifference(r.Context(), h.meID(r), sincePts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sync failed")
		return
	}
	writeJSON(w, http.StatusOK, d)
}

type reactionBody struct {
	Emoji string `json:"emoji"`
}

func (h *ChatHandler) AddReaction(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	var body reactionBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Emoji == "" {
		writeError(w, http.StatusBadRequest, "emoji is required")
		return
	}
	h.react(w, r, chatID, msgID, body.Emoji, true)
}

func (h *ChatHandler) RemoveReaction(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	emoji := chi.URLParam(r, "emoji")
	if emoji == "" {
		writeError(w, http.StatusBadRequest, "emoji is required")
		return
	}
	h.react(w, r, chatID, msgID, emoji, false)
}

func (h *ChatHandler) react(w http.ResponseWriter, r *http.Request, chatID, msgID int64, emoji string, add bool) {
	err := h.svc.React(r.Context(), chatID, msgID, h.meID(r), emoji, add)
	if errors.Is(err, domain.ErrBadReaction) {
		writeError(w, http.StatusBadRequest, "invalid reaction")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "reaction failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *ChatHandler) ListReactions(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	counts, err := h.svc.ReactionsOf(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load reactions")
		return
	}
	if counts == nil {
		counts = []domain.ReactionCount{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"reactions": counts})
}

// ReactionUsers — GET /chats/{chatID}/messages/{msgID}/reactions/users: кто
// отреагировал и каким эмодзи (для попапа who-reacted).
func (h *ChatHandler) ReactionUsers(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	users, err := h.svc.ReactionUsers(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load reactions")
		return
	}
	out := make([]map[string]any, 0, len(users))
	for _, ru := range users {
		out = append(out, map[string]any{"user": ru.User, "emoji": ru.Emoji})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

// SavedTags — GET /saved/tags: теги-реакции «Избранного» вызывающего (реакция +
// имя + число помеченных сообщений), самые частые первыми.
// SendAs — GET /chats/{chatID}/send_as: доступные «личности отправителя»
// (Telegram channels.getSendAs). Всегда содержит самого пользователя; для групп —
// плюс привязанный канал (если юзер его админ) и саму группу (анонимный админ).
func (h *ChatHandler) SendAs(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	peers, err := h.svc.GetSendAs(r.Context(), h.meID(r), chatID)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load send-as")
		return
	}
	// Раскладка channels.sendAsPeers: ССЫЛКИ на пиры отдельно, их тела —
	// векторами users/chats. Вид личности («это канал, а это я сам») читается
	// из конструктора тела, а не из строкового kind рядом.
	refs := make([]map[string]any, 0, len(peers))
	users := make([]domain.UserReal, 0, len(peers))
	chats := make([]domain.Chat, 0, len(peers))
	for _, p := range peers {
		refs = append(refs, map[string]any{"_": "sendAsPeer", "peer": p.Peer})
		if p.User != nil {
			users = append(users, *p.User)
		}
		if p.Chat != nil {
			chats = append(chats, *p.Chat)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"_": "channels.sendAsPeers", "peers": refs, "chats": chats, "users": users,
	})
}

func (h *ChatHandler) SavedTags(w http.ResponseWriter, r *http.Request) {
	tags, err := h.svc.SavedTags(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load saved tags")
		return
	}
	if tags == nil {
		tags = []domain.SavedTag{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}

type savedTagBody struct {
	Title string `json:"title"`
}

// SetSavedTagName — PUT /saved/tags/{reaction}: задать/переименовать/очистить имя
// тега (Telegram updateSavedReactionTag). Пустой title стирает имя.
func (h *ChatHandler) SetSavedTagName(w http.ResponseWriter, r *http.Request) {
	reaction := chi.URLParam(r, "reaction")
	if reaction == "" {
		writeError(w, http.StatusBadRequest, "reaction is required")
		return
	}
	var body savedTagBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	err := h.svc.SetSavedTagName(r.Context(), h.meID(r), reaction, body.Title)
	if errors.Is(err, domain.ErrBadReaction) {
		writeError(w, http.StatusBadRequest, "invalid reaction")
		return
	}
	if errors.Is(err, domain.ErrTooLong) || errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid tag name")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not update tag")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// SendStarReaction — POST /chats/{chatID}/messages/{msgID}/star_reaction
// {count, anonymous}: платная ⭐-реакция. Списывает звёзды у отправителя,
// начисляет автору, накопительно фиксирует вклад; отдаёт новый агрегат,
// топ-отправителей и новый баланс.
func (h *ChatHandler) SendStarReaction(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	var body struct {
		Count     int64 `json:"count"`
		Anonymous bool  `json:"anonymous"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	agg, top, bal, err := h.svc.SendStarReaction(r.Context(), chatID, msgID, h.meID(r), body.Count, body.Anonymous)
	if errors.Is(err, domain.ErrPaidRequired) {
		writeError(w, http.StatusPaymentRequired, "not enough stars")
		return
	}
	if errors.Is(err, domain.ErrBadReaction) {
		writeError(w, http.StatusBadRequest, "invalid star count")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "star reaction failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"star_reaction": map[string]any{"total": agg.Total, "mine": agg.Mine},
		"top":           starSendersJSON(top),
		"balance":       bal,
	})
}

// GetStarReaction — GET /chats/{chatID}/messages/{msgID}/star_reaction: агрегат
// звёзд сообщения (total + мой вклад) и топ-отправители.
func (h *ChatHandler) GetStarReaction(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	agg, top, err := h.svc.StarReactionOf(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load star reaction")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"star_reaction": map[string]any{"total": agg.Total, "mine": agg.Mine},
		"top":           starSendersJSON(top),
	})
}

// starSendersJSON сериализует топ-отправителей звёзд. Анонимные приходят с
// пустой карточкой (usecase затёр личность) — клиент рисует их как «Anonymous».
func starSendersJSON(top []domain.StarReactionSender) []map[string]any {
	out := make([]map[string]any, 0, len(top))
	for _, s := range top {
		out = append(out, map[string]any{
			"user": s.User, "stars": s.Stars, "anonymous": s.Anonymous,
		})
	}
	return out
}

// messagesJSON — ЕДИНАЯ точка, которой обязан отдавать наружу список
// сообщений любой хендлер: батчево переводит thread_root_id из внутреннего
// id зеркала (где комментарий физически висит — см.
// usecase/chat/discussion.go) в id ПОСТА, который знает клиент (см.
// Interactor.ExternalizeThreadRoots), и только потом сериализует. Один
// резолв на весь список — не по запросу на сообщение (N+1 недопустим).
// Использовать вместо messageJSON(m) в цикле; сбой резолва не должен ронять
// всю выдачу — тогда сообщения уезжают с внутренним id, что лучше 500-й.
func messagesJSON(ctx context.Context, svc *usecasechat.Interactor, msgs []domain.Message) []map[string]any {
	ext, err := svc.ExternalizeThreadRoots(ctx, msgs)
	if err != nil {
		ext = msgs
	}
	// Ссылки на пиры внутри сообщения (fwd_from.from_id, reply_to_peer_id)
	// вычисляются здесь же: собрать их из плоских колонок можно только зная
	// вид чата-источника — см. usecase/chat/messagepeers.go.
	ext = svc.HydrateMessagePeers(ctx, ext)
	// Ключ пира зависит от ЗРИТЕЛЯ (у приватного диалога стороны видят разный),
	// поэтому резолвится здесь, по одному разу на чат: список истории почти
	// всегда из одного чата, кэш слоя разрешения гасит остальное.
	me, _ := UserFromContext(ctx)
	peers := make(map[int64]domain.PeerID, 1)
	out := make([]map[string]any, 0, len(ext))
	for _, m := range ext {
		peer, ok := peers[m.ChatID]
		if !ok {
			peer, _ = svc.ChatIDToPeer(ctx, me.ID, m.ChatID)
			peers[m.ChatID] = peer
		}
		out = append(out, messageJSON(m, peer))
	}
	return out
}

// messageJSONOut — то же самое для одного сообщения (Send/EditMessage/
// SetFactCheck/UpdateGeoLive/PostComment и т.п. — ответы с одним сообщением).
func messageJSONOut(ctx context.Context, svc *usecasechat.Interactor, m domain.Message) map[string]any {
	return messagesJSON(ctx, svc, []domain.Message{m})[0]
}

func messageJSON(m domain.Message, peer domain.PeerID) map[string]any {
	j := map[string]any{
		"id": m.ID, "peer_id": peer, "seq": m.Seq, "sender_id": m.SenderID,
		"type": m.Type, "text": m.Text, "reply_to_id": m.ReplyToID,
		"media_id": m.MediaID, "thread_root_id": m.ThreadRootID,
		"created_at": m.CreatedAt, "deleted": m.Deleted,
		"edited_at": m.EditedAt,
		"views":     m.Views, "forwards": m.Forwards, "media_unread": m.MediaUnread, "grouped_id": m.GroupedID,
	}
	// Атрибуция пересылки — один конструктор messageFwdHeader вместо пяти
	// плоских полей; автор в from_id:Peer.
	if m.FwdFrom != nil {
		j["fwd_from"] = m.FwdFrom
	}
	if len(m.Entities) > 0 {
		j["entities"] = m.Entities
	}
	if len(m.Reactions) > 0 {
		j["reactions"] = m.Reactions
	}
	if m.StarReactionTotal > 0 {
		j["star_reaction"] = map[string]any{"total": m.StarReactionTotal, "mine": m.StarReactionMine}
	}
	if m.GeoLat != nil && m.GeoLng != nil {
		g := map[string]any{"lat": *m.GeoLat, "lng": *m.GeoLng}
		if m.GeoTitle != nil {
			g["title"] = *m.GeoTitle
		}
		if m.GeoAddress != nil {
			g["address"] = *m.GeoAddress
		}
		if m.GeoLivePeriod != nil {
			g["live_period"] = *m.GeoLivePeriod
			g["live_stopped"] = m.GeoLiveStopped
			if m.GeoHeading != nil {
				g["heading"] = *m.GeoHeading
			}
			if m.EditedAt != nil {
				g["edited_at"] = *m.EditedAt
			}
		}
		j["geo"] = g
	}
	if m.ContactUserID != nil {
		c := map[string]any{"user_id": *m.ContactUserID}
		if m.ContactName != nil {
			c["name"] = *m.ContactName
		}
		if m.ContactPhone != nil {
			c["phone"] = *m.ContactPhone
		}
		j["contact"] = c
	}
	if m.EncBody != nil {
		j["enc_body"] = base64.StdEncoding.EncodeToString(m.EncBody)
		j["ttl_seconds"] = m.TTLSeconds
		j["destruct_at"] = m.DestructAt
	}
	if m.PollID != nil {
		j["poll_id"] = *m.PollID
	}
	if m.Poll != nil {
		j["poll"] = m.Poll
	}
	if m.ChecklistID != nil {
		j["checklist_id"] = *m.ChecklistID
	}
	if m.Checklist != nil {
		j["checklist"] = m.Checklist
	}
	if m.GiveawayID != nil {
		j["giveaway_id"] = *m.GiveawayID
	}
	if m.Giveaway != nil {
		j["giveaway"] = m.Giveaway
	}
	if m.GiftID != nil {
		j["gift_id"] = *m.GiftID
	}
	if m.Gift != nil {
		j["gift"] = m.Gift
	}
	if m.ReplyMarkup != nil {
		j["reply_markup"] = m.ReplyMarkup
	}
	if m.WebPage != nil {
		j["web_page"] = m.WebPage
	}
	if m.FactCheck != nil {
		fc := map[string]any{"text": m.FactCheck.Text}
		if len(m.FactCheck.Entities) > 0 {
			fc["entities"] = m.FactCheck.Entities
		}
		if m.FactCheck.Country != "" {
			fc["country"] = m.FactCheck.Country
		}
		j["factcheck"] = fc
	}
	if m.Transcription != nil && *m.Transcription != "" {
		j["transcription"] = *m.Transcription
	}
	if m.Effect != "" {
		j["effect"] = m.Effect
	}
	// Send-as: отображаемый автор (канал/группа); sender_id остаётся реальным.
	if m.SendAsChatID != nil {
		sa := map[string]any{"peer_id": domain.ToPeerID(*m.SendAsChatID, true)}
		if m.SendAsTitle != "" {
			sa["title"] = m.SendAsTitle
		}
		if m.SendAsPhotoID != nil {
			sa["photo_id"] = *m.SendAsPhotoID
		}
		j["send_as"] = sa
	}
	if m.ReplyTo != nil {
		rt := map[string]any{
			"msg_id": m.ReplyTo.MsgID, "seq": m.ReplyTo.Seq, "sender_id": m.ReplyTo.SenderID,
			"text": m.ReplyTo.Text, "type": m.ReplyTo.Type,
		}
		if len(m.ReplyTo.Entities) > 0 {
			rt["entities"] = m.ReplyTo.Entities
		}
		if m.ReplyTo.MediaID != nil {
			rt["media_id"] = *m.ReplyTo.MediaID
		}
		if m.ReplyTo.QuoteText != "" {
			rt["quote_text"] = m.ReplyTo.QuoteText
		}
		j["reply_to"] = rt
	}
	// Кросс-чат-ответ (Telegram reply_to_peer_id): исходный чат + снимок превью
	// (имя автора + текст/лейбл) — те же ключи, что frame.go: messageUpdatePayload.
	// Оригинал в reply_to не подтягивается (чужой чат), клиент рисует из снимка.
	if m.ReplyToPeerID != nil {
		// Ссылка едет только когда источник — группа/канал: у приватного чата
		// публичного ключа пира нет (шаг B убрал внутренний id из провода).
		// Снимок превью при этом на месте, и бабл рисуется без ссылки.
		if m.ReplyToPeer != nil {
			j["reply_to_peer_id"] = m.ReplyToPeer
		}
		j["reply_snapshot_name"] = m.ReplySnapshotName
		j["reply_snapshot_text"] = m.ReplySnapshotText
	}
	// Вложение (history read model) в форме оригинала — messageMediaPhoto /
	// messageMediaDocument с лестницей превью и атрибутами: клиент рисует бабл
	// целиком из сообщения (точный бокс, stripped-плейсхолдер, контур стикера,
	// тип документа, спойлер в pFlags) без отдельного запроса меты медиа.
	// Ровно тот же объект едет в live-кадре (usecase/chat/frame.go).
	if m.Media != nil {
		j["media"] = m.Media
	}
	if m.PaidMediaPrice != nil {
		j["paid_media"] = map[string]any{"price": *m.PaidMediaPrice, "locked": m.PaidMediaLocked}
	}
	return j
}

func pathInt(w http.ResponseWriter, r *http.Request, key string) (int64, bool) {
	v, err := strconv.ParseInt(chi.URLParam(r, key), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid "+key)
		return 0, false
	}
	return v, true
}

func queryInt(r *http.Request, key string, def int64) int64 {
	if s := r.URL.Query().Get(key); s != "" {
		if v, err := strconv.ParseInt(s, 10, 64); err == nil {
			return v
		}
	}
	return def
}

// MyAutoDelete — GET /me/auto_delete: глобальный период автоудаления (сек).
func (h *ChatHandler) MyAutoDelete(w http.ResponseWriter, r *http.Request) {
	period, err := h.svc.MyAutoDelete(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"period": period})
}

// SetMyAutoDelete — PUT /me/auto_delete {period}: применяется к новым чатам.
func (h *ChatHandler) SetMyAutoDelete(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Period int `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.SetMyAutoDelete(r.Context(), h.meID(r), b.Period); err != nil {
		writeError(w, http.StatusBadRequest, "bad period")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"period": b.Period})
}

// SetChatAutoDelete — PUT /chats/{chatID}/auto_delete {period}.
func (h *ChatHandler) SetChatAutoDelete(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Period int `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	err := h.svc.SetChatAutoDelete(r.Context(), chatID, h.meID(r), b.Period)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not allowed")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"period": b.Period})
}

// SetChatTheme — PUT /chats/{chatID}/theme {theme_id}. Пустой theme_id (или
// отсутствие поля) — сброс темы к дефолту. Тема общая для чата (Telegram
// messages.setChatTheme): смена рассылается обоим участникам фреймом
// chat_theme_update.
func (h *ChatHandler) SetChatTheme(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		ThemeID string `json:"theme_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	err := h.svc.SetChatTheme(r.Context(), chatID, h.meID(r), b.ThemeID)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"theme_id": b.ThemeID})
}

// draftJSON — wire-представление черновика; ключ пира ГЛАЗАМИ владельца.
func draftJSON(d domain.Draft, peer domain.PeerID) map[string]any {
	return map[string]any{
		"peer_id": peer, "text": d.Text, "entities": d.Entities,
		"reply_to_id": d.ReplyToID, "updated_at": d.UpdatedAt,
	}
}

// sendAsChatID — знаковый ключ «личности отправителя» во внутренний chatID.
// send-as бывает только каналом/супергруппой, поэтому это чистая арифметика:
// пользователь в этом поле смысла не имеет и трактуется как «от себя».
func sendAsChatID(peer *domain.PeerID) *int64 {
	if peer == nil || !peer.IsAnyChat() {
		return nil
	}
	id := peer.ToChatID()
	return &id
}

// MyDrafts — GET /drafts: все облачные черновики пользователя.
func (h *ChatHandler) MyDrafts(w http.ResponseWriter, r *http.Request) {
	drafts, err := h.svc.MyDrafts(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(drafts))
	for _, d := range drafts {
		out = append(out, draftJSON(d, peerOf(r, h.svc, d.ChatID)))
	}
	writeJSON(w, http.StatusOK, map[string]any{"drafts": out})
}

// SaveDraft — PUT /chats/{chatID}/draft {text, entities, reply_to_id}.
// Пустой текст без reply_to_id удаляет черновик (Telegram draftMessageEmpty).
func (h *ChatHandler) SaveDraft(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatIDOrCreate(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		Text      string                 `json:"text"`
		Entities  domain.MessageEntities `json:"entities"`
		ReplyToID *int64                 `json:"reply_to_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	d, err := h.svc.SaveDraft(r.Context(), h.meID(r), chatID, b.Text, b.Entities, b.ReplyToID)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "too long")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	if d == nil {
		writeJSON(w, http.StatusOK, map[string]any{"draft": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"draft": draftJSON(*d, peerOf(r, h.svc, d.ChatID))})
}

// DeleteDraft — DELETE /chats/{chatID}/draft.
func (h *ChatHandler) DeleteDraft(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	if err := h.svc.DeleteDraft(r.Context(), h.meID(r), chatID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ClearAllDrafts — DELETE /drafts («Удалить все черновики»).
func (h *ChatHandler) ClearAllDrafts(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.ClearAllDrafts(r.Context(), h.meID(r)); err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
