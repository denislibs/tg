package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/messaging"
)

type ChatHandler struct{ svc *messaging.Service }

func NewChatHandler(svc *messaging.Service) *ChatHandler { return &ChatHandler{svc: svc} }

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
			"last_read_seq": d.LastReadSeq, "unread": d.UnreadCount, "muted": d.Muted,
		}
		if d.HasLast {
			row["last_message"] = map[string]any{
				"seq": d.LastSeq, "text": d.LastText, "sender_id": d.LastSenderID, "at": d.LastAt,
			}
		}
		out = append(out, row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"chats": out})
}

type sendBody struct {
	Type        string `json:"type"`
	Text        string `json:"text"`
	ReplyToID   *int64 `json:"reply_to_id"`
	ClientMsgID string `json:"client_msg_id"`
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
	msg, err := h.svc.Send(r.Context(), messaging.SendInput{
		ChatID: chatID, SenderID: h.meID(r), Type: body.Type, Text: body.Text,
		ReplyToID: body.ReplyToID, ClientMsgID: body.ClientMsgID,
	})
	if errors.Is(err, messaging.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
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
	offsetSeq := queryInt(r, "offset_id", 0)
	addOffset := int(queryInt(r, "add_offset", 0))
	limit := int(queryInt(r, "limit", 40))
	res, err := h.svc.GetHistory(r.Context(), chatID, h.meID(r), offsetSeq, addOffset, limit)
	if errors.Is(err, messaging.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
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
	if errors.Is(err, messaging.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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

func messageJSON(m messaging.Message) map[string]any {
	return map[string]any{
		"id": m.ID, "chat_id": m.ChatID, "seq": m.Seq, "sender_id": m.SenderID,
		"type": m.Type, "text": m.Text, "reply_to_id": m.ReplyToID,
		"created_at": m.CreatedAt, "deleted": m.Deleted,
	}
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
