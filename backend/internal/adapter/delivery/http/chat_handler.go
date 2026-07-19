package http

import (
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
	id, err := h.svc.CreatePrivateChat(r.Context(), h.meID(r), body.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create chat")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chat_id": id})
}

// Saved returns (creating on first access) the caller's "Saved Messages" chat.
func (h *ChatHandler) Saved(w http.ResponseWriter, r *http.Request) {
	id, err := h.svc.GetOrCreateSaved(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not open saved messages")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chat_id": id})
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
			"kind": d.Kind, "peer_id": d.PeerID, "title": d.Title, "photo_url": d.PhotoURL,
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

func (h *ChatHandler) ListDialogs(w http.ResponseWriter, r *http.Request) {
	dialogs, err := h.svc.ListDialogs(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list chats")
		return
	}
	out := make([]map[string]any, 0, len(dialogs))
	for _, d := range dialogs {
		row := map[string]any{
			"chat_id": d.ChatID, "type": d.Type,
			"title": d.Title, "username": d.Username, "photo_url": d.PhotoURL,
			"last_read_seq": d.LastReadSeq, "peer_read_seq": d.PeerReadSeq, "unread": d.UnreadCount, "muted": d.Muted,
			"pinned": d.Pinned, "archived": d.Archived, "is_forum": d.IsForum,
			"auto_delete_period": d.AutoDeletePeriod,
		}
		if d.HasLast {
			row["last_message"] = map[string]any{
				"seq": d.LastSeq, "text": d.LastText, "sender_id": d.LastSenderID, "at": d.LastAt,
				"media_id": d.LastMediaID, "type": d.LastType, "forwarded": d.LastForwarded,
				"sender_name": d.LastSenderName,
			}
		}
		if d.Peer != nil {
			row["peer"] = map[string]any{
				"id": d.Peer.ID, "display_name": d.Peer.DisplayName, "avatar_url": d.Peer.AvatarURL,
				"verified": d.Peer.Verified,
			}
		}
		out = append(out, row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"chats": out})
}

type sendBody struct {
	Type        string                 `json:"type"`
	Text        string                 `json:"text"`
	Entities    []domain.MessageEntity `json:"entities"`
	ReplyToID   *int64                 `json:"reply_to_id"`
	ClientMsgID string                 `json:"client_msg_id"`
	MediaID     *int64                 `json:"media_id"`
	GroupedID   string                 `json:"grouped_id"`
	// сообщение в тред (форум-топик): id корневого сообщения топика
	ThreadRootID *int64 `json:"thread_root_id"`
}

func (h *ChatHandler) Send(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
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
	msg, err := h.svc.Send(r.Context(), usecasechat.SendInput{
		ChatID: chatID, SenderID: h.meID(r), Type: body.Type, Text: body.Text, Entities: body.Entities,
		ReplyToID: body.ReplyToID, ClientMsgID: body.ClientMsgID, MediaID: body.MediaID, GroupedID: body.GroupedID,
		ThreadRootID: body.ThreadRootID,
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
	writeJSON(w, http.StatusOK, messageJSON(msg))
}

func (h *ChatHandler) History(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	limit := int(queryInt(r, "limit", 40))
	// Jump-to-message: ?around=<seq> returns a window centered on that message.
	if around := queryInt(r, "around", 0); around > 0 {
		a, err := h.svc.GetHistoryAround(r.Context(), chatID, h.meID(r), around, limit)
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusForbidden, "not a member of this chat")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "history failed")
			return
		}
		out := make([]map[string]any, 0, len(a.Messages))
		for _, m := range a.Messages {
			out = append(out, messageJSON(m))
		}
		writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": a.Count, "reached_top": a.ReachedTop, "reached_bottom": a.ReachedBottom})
		return
	}
	offsetSeq := queryInt(r, "offset_id", 0)
	addOffset := int(queryInt(r, "add_offset", 0))
	res, err := h.svc.GetHistory(r.Context(), chatID, h.meID(r), offsetSeq, addOffset, limit)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		log.Printf("history failed chat=%d: %v", chatID, err)
		writeError(w, http.StatusInternalServerError, "history failed")
		return
	}
	out := make([]map[string]any, 0, len(res.Messages))
	for _, m := range res.Messages {
		out = append(out, messageJSON(m))
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": res.Count})
}

type readBody struct {
	UpToSeq int64 `json:"up_to_seq"`
}

func (h *ChatHandler) Read(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
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

type editBody struct {
	Text     string                 `json:"text"`
	Entities []domain.MessageEntity `json:"entities"`
}

func (h *ChatHandler) EditMessage(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
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
	writeJSON(w, http.StatusOK, messageJSON(msg))
}

func (h *ChatHandler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
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
	FromChatID int64   `json:"from_chat_id"`
	MsgIDs     []int64 `json:"msg_ids"`
}

func (h *ChatHandler) Forward(w http.ResponseWriter, r *http.Request) {
	toChatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var body forwardBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.FromChatID == 0 || len(body.MsgIDs) == 0 {
		writeError(w, http.StatusBadRequest, "from_chat_id and msg_ids are required")
		return
	}
	msgs, err := h.svc.ForwardMessages(r.Context(), usecasechat.ForwardInput{
		FromChatID: body.FromChatID, ToChatID: toChatID, MsgIDs: body.MsgIDs, SenderID: h.meID(r),
	})
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member or message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "forward failed")
		return
	}
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, messageJSON(m))
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": out})
}

func (h *ChatHandler) Pin(w http.ResponseWriter, r *http.Request)   { h.setPin(w, r, true) }
func (h *ChatHandler) Unpin(w http.ResponseWriter, r *http.Request) { h.setPin(w, r, false) }

func (h *ChatHandler) setPin(w http.ResponseWriter, r *http.Request, pin bool) {
	chatID, ok := pathInt(w, r, "chatID")
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
	chatID, ok := pathInt(w, r, "chatID")
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
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, messageJSON(m))
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": out})
}

func (h *ChatHandler) Viewers(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
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

// MediaHistory serves the profile's shared-media tabs:
// GET /chats/{chatID}/media?filter=media|files|links|music|voice
func (h *ChatHandler) MediaHistory(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
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
	out := make([]map[string]any, 0, len(res.Messages))
	for _, m := range res.Messages {
		out = append(out, messageJSON(m))
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": res.Count})
}

func (h *ChatHandler) SearchMessages(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	q := r.URL.Query().Get("q")
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 20))
	res, err := h.svc.SearchMessages(r.Context(), chatID, h.meID(r), q, offset, limit)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}
	out := make([]map[string]any, 0, len(res.Messages))
	for _, m := range res.Messages {
		out = append(out, messageJSON(m))
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": res.Count})
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
	out := make([]map[string]any, 0, len(res.Messages))
	for _, m := range res.Messages {
		out = append(out, messageJSON(m))
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": res.Count})
}

// SendPoll — POST /chats/{chatID}/polls: отправить опрос (сообщение типа 'poll').
func (h *ChatHandler) SendPoll(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
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
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	m, err := h.svc.SendPoll(r.Context(), usecasechat.SendPollInput{
		ChatID: chatID, SenderID: h.meID(r),
		Question: b.Question, Options: b.Options,
		Anonymous: b.Anonymous, Multiple: b.Multiple, Quiz: b.Quiz, CorrectOption: b.CorrectOption,
		ClientMsgID: b.ClientMsgID,
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
	writeJSON(w, http.StatusOK, messageJSON(m))
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

// scheduledJSON — представление запланированного сообщения.
func scheduledJSON(m domain.ScheduledMessage) map[string]any {
	j := map[string]any{
		"id": m.ID, "chat_id": m.ChatID, "sender_id": m.SenderID,
		"type": m.Type, "text": m.Text, "reply_to_id": m.ReplyToID,
		"media_id": m.MediaID, "send_at": m.SendAt, "created_at": m.CreatedAt,
	}
	if len(m.Entities) > 0 {
		j["entities"] = m.Entities
	}
	return j
}

// ScheduleMessage — POST /chats/{chatID}/scheduled: запланировать отправку.
func (h *ChatHandler) ScheduleMessage(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		Type     string                 `json:"type"`
		Text     string                 `json:"text"`
		Entities []domain.MessageEntity `json:"entities"`
		ReplyTo  *int64                 `json:"reply_to_id"`
		MediaID  *int64                 `json:"media_id"`
		SendAt   int64                  `json:"send_at"` // unix-секунды
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	m, err := h.svc.ScheduleMessage(r.Context(), usecasechat.SendInput{
		ChatID: chatID, SenderID: h.meID(r), Type: b.Type, Text: b.Text,
		Entities: b.Entities, ReplyToID: b.ReplyTo, MediaID: b.MediaID,
	}, time.Unix(b.SendAt, 0))
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "invalid scheduled message")
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
	writeJSON(w, http.StatusOK, scheduledJSON(m))
}

// ListScheduled — GET /chats/{chatID}/scheduled: свои запланированные.
func (h *ChatHandler) ListScheduled(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
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
		out = append(out, scheduledJSON(m))
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
	writeJSON(w, http.StatusOK, messageJSON(m))
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
	chatID, ok := pathInt(w, r, "chatID")
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
		"id": row.Topic.ID, "chat_id": row.Topic.ChatID, "root_msg_id": row.Topic.RootMsgID,
		"title": row.Topic.Title, "icon_color": row.Topic.IconColor, "closed": row.Topic.Closed,
		"created_by": row.Topic.CreatedBy, "created_at": row.Topic.CreatedAt,
		"msg_count": row.MsgCount, "last_text": row.LastText, "last_type": row.LastType,
		"last_sender_name": row.LastSenderName, "last_at": row.LastAt,
	}
}

// CreateTopic — POST /chats/{chatID}/topics {title, icon_color}.
func (h *ChatHandler) CreateTopic(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		Title     string `json:"title"`
		IconColor int    `json:"icon_color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	t, err := h.svc.CreateTopic(r.Context(), chatID, h.meID(r), b.Title, b.IconColor)
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
	chatID, ok := pathInt(w, r, "chatID")
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

// ThreadMessages — GET /chats/{chatID}/threads/{rootID}: сообщения треда.
func (h *ChatHandler) ThreadMessages(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
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
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, messageJSON(m))
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": count})
}

// GroupCallParticipants — GET /chats/{chatID}/group_call: кто сейчас в видеочате.
func (h *ChatHandler) GroupCallParticipants(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
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
	chatID, ok := pathInt(w, r, "chatID")
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
	chatID, ok := pathInt(w, r, "chatID")
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
	chatID, ok := pathInt(w, r, "chatID")
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

func messageJSON(m domain.Message) map[string]any {
	j := map[string]any{
		"id": m.ID, "chat_id": m.ChatID, "seq": m.Seq, "sender_id": m.SenderID,
		"type": m.Type, "text": m.Text, "reply_to_id": m.ReplyToID,
		"media_id": m.MediaID, "thread_root_id": m.ThreadRootID,
		"created_at": m.CreatedAt, "deleted": m.Deleted,
		"edited_at":        m.EditedAt,
		"fwd_from_user_id": m.FwdFromUserID, "fwd_from_chat_id": m.FwdFromChatID,
		"fwd_from_msg_id": m.FwdFromMsgID, "fwd_date": m.FwdDate, "fwd_from_name": m.FwdFromName,
		"views": m.Views, "media_unread": m.MediaUnread, "grouped_id": m.GroupedID,
	}
	if len(m.Entities) > 0 {
		j["entities"] = m.Entities
	}
	if len(m.Reactions) > 0 {
		j["reactions"] = m.Reactions
	}
	if m.PollID != nil {
		j["poll_id"] = *m.PollID
	}
	if m.Poll != nil {
		j["poll"] = m.Poll
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
		j["reply_to"] = rt
	}
	// Media metadata (history read model) so the client renders the media bubble
	// entirely from the message — exact box, blur placeholder, poster, mime, etc. —
	// with no per-media meta request.
	if m.MediaWidth > 0 && m.MediaHeight > 0 {
		j["media_w"] = m.MediaWidth
		j["media_h"] = m.MediaHeight
	}
	if m.MediaMime != "" {
		j["media_mime"] = m.MediaMime
	}
	if len(m.MediaBlur) > 0 {
		j["media_blur"] = m.MediaBlur // []byte → base64 string in JSON
	}
	if m.MediaHasThumb {
		j["media_has_thumb"] = true
	}
	if m.MediaDuration > 0 {
		j["media_duration"] = m.MediaDuration
	}
	if m.MediaSize > 0 {
		j["media_size"] = m.MediaSize
	}
	if m.MediaName != "" {
		j["media_name"] = m.MediaName
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
	chatID, ok := pathInt(w, r, "chatID")
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

// draftJSON — wire-представление черновика.
func draftJSON(d domain.Draft) map[string]any {
	return map[string]any{
		"chat_id": d.ChatID, "text": d.Text, "entities": d.Entities,
		"reply_to_id": d.ReplyToID, "updated_at": d.UpdatedAt,
	}
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
		out = append(out, draftJSON(d))
	}
	writeJSON(w, http.StatusOK, map[string]any{"drafts": out})
}

// SaveDraft — PUT /chats/{chatID}/draft {text, entities, reply_to_id}.
// Пустой текст без reply_to_id удаляет черновик (Telegram draftMessageEmpty).
func (h *ChatHandler) SaveDraft(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		Text      string                 `json:"text"`
		Entities  []domain.MessageEntity `json:"entities"`
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
	writeJSON(w, http.StatusOK, map[string]any{"draft": draftJSON(*d)})
}

// DeleteDraft — DELETE /chats/{chatID}/draft.
func (h *ChatHandler) DeleteDraft(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
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
