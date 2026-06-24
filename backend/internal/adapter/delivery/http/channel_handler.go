package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

type ChannelHandler struct{ uc *usecasechat.Interactor }

func NewChannelHandler(uc *usecasechat.Interactor) *ChannelHandler { return &ChannelHandler{uc: uc} }

func (h *ChannelHandler) mapErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		writeError(w, http.StatusInternalServerError, "server error")
	}
}

func (h *ChannelHandler) Create(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		Title    string `json:"title"`
		About    string `json:"about"`
		Username string `json:"username"`
		IsPublic bool   `json:"is_public"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || strings.TrimSpace(b.Title) == "" {
		writeError(w, http.StatusBadRequest, "title required")
		return
	}
	id, err := h.uc.CreateChannel(r.Context(), user.ID, b.Title, b.About, b.Username, b.IsPublic)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chat_id": id})
}

func (h *ChannelHandler) Post(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		Text        string `json:"text"`
		ClientMsgID string `json:"client_msg_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	msg, err := h.uc.PostToChannel(r.Context(), chatID, user.ID, b.Text, b.ClientMsgID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": msg.ID, "chat_id": msg.ChatID, "seq": msg.Seq, "created_at": msg.CreatedAt,
	})
}

func (h *ChannelHandler) EnableDiscussion(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	disc, err := h.uc.EnableDiscussion(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"discussion_chat_id": disc})
}

func (h *ChannelHandler) PostComment(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	postID, ok := pathInt(w, r, "postId")
	if !ok {
		return
	}
	var b struct {
		Text        string `json:"text"`
		ClientMsgID string `json:"client_msg_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	m, err := h.uc.PostComment(r.Context(), chatID, postID, user.ID, b.Text, b.ClientMsgID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, messageJSON(m))
}

func (h *ChannelHandler) ListComments(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	postID, ok := pathInt(w, r, "postId")
	if !ok {
		return
	}
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 50))
	msgs, count, err := h.uc.ListComments(r.Context(), chatID, postID, user.ID, offset, limit)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, messageJSON(m))
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": count})
}

func (h *ChannelHandler) CommentCounts(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	ids := make([]int64, 0)
	for _, s := range strings.Split(r.URL.Query().Get("ids"), ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		id, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid ids")
			return
		}
		ids = append(ids, id)
	}
	counts, err := h.uc.CommentCounts(r.Context(), chatID, ids)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make(map[string]int, len(counts))
	for id, n := range counts {
		out[strconv.FormatInt(id, 10)] = n
	}
	writeJSON(w, http.StatusOK, map[string]any{"counts": out})
}

func (h *ChannelHandler) Difference(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	pts, _ := strconv.ParseInt(r.URL.Query().Get("pts"), 10, 64)
	ups, err := h.uc.GetChannelDifference(r.Context(), chatID, user.ID, pts, 100)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	raw := make([]json.RawMessage, 0, len(ups))
	maxPts := pts
	for _, u := range ups {
		raw = append(raw, json.RawMessage(u.Payload))
		if u.Pts > maxPts {
			maxPts = u.Pts
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"updates": raw, "pts": maxPts, "slice": len(ups) == 100})
}

func (h *ChannelHandler) Join(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.Username == "" {
		writeError(w, http.StatusBadRequest, "username required")
		return
	}
	if err := h.uc.JoinPublic(r.Context(), b.Username, user.ID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *ChannelHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	chats, _ := h.uc.SearchChats(r.Context(), q, 20)
	users, _ := h.uc.SearchUsers(r.Context(), q, 20)
	co := make([]map[string]any, 0, len(chats))
	for _, c := range chats {
		co = append(co, map[string]any{
			"id": c.ID, "type": c.Type, "title": c.Title, "username": c.Username, "member_count": c.MemberCount,
		})
	}
	uo := make([]map[string]any, 0, len(users))
	for _, u := range users {
		uo = append(uo, map[string]any{
			"id": u.ID, "username": u.Username, "display_name": u.DisplayName, "avatar_url": u.AvatarURL,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"chats": co, "users": uo})
}
