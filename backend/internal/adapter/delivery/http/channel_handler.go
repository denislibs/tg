package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

type ChannelHandler struct {
	uc      *usecasechat.Interactor
	privacy PrivacyQuery
}

func NewChannelHandler(uc *usecasechat.Interactor, privacy PrivacyQuery) *ChannelHandler {
	return &ChannelHandler{uc: uc, privacy: privacy}
}

func (h *ChannelHandler) mapErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid request")
	case errors.Is(err, domain.ErrTooLong):
		writeError(w, http.StatusBadRequest, "too long")
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
	writeJSON(w, http.StatusOK, map[string]any{"peer_id": domain.ToPeerID(id, true)})
}

func (h *ChannelHandler) Post(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	var b struct {
		Text        string                 `json:"text"`
		Entities    domain.MessageEntities `json:"entities"`
		ClientMsgID string                 `json:"client_msg_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	msg, err := h.uc.PostToChannel(r.Context(), chatID, user.ID, b.Text, b.Entities, b.ClientMsgID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": msg.ID, "peer_id": domain.ToPeerID(msg.ChatID, true), "seq": msg.Seq, "created_at": msg.CreatedAt,
	})
}

// Suggest — участник предлагает пост в канал (текст/медиа + опц. время публикации).
func (h *ChannelHandler) Suggest(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	var b struct {
		Text      string                 `json:"text"`
		Entities  domain.MessageEntities `json:"entities"`
		MediaID   *int64                 `json:"media_id"`
		PublishAt int64                  `json:"publish_at"` // unix-секунды, 0 — как можно скорее
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	info, err := h.uc.SuggestPost(r.Context(), chatID, user.ID, b.Text, b.Entities, b.MediaID, unixToTime(b.PublishAt))
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// ListSuggested — предложенные посты канала (админу все pending, автору свои).
func (h *ChannelHandler) ListSuggested(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	posts, err := h.uc.ListSuggestedPosts(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": posts})
}

// ApproveSuggested — админ одобряет предложенный пост (публикует; опц. по времени).
func (h *ChannelHandler) ApproveSuggested(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	id, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	var b struct {
		PublishAt int64 `json:"publish_at"` // unix-секунды, 0 — опубликовать сейчас
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	info, err := h.uc.ApproveSuggestedPost(r.Context(), id, user.ID, unixToTime(b.PublishAt))
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// RejectSuggested — админ отклоняет предложенный пост.
func (h *ChannelHandler) RejectSuggested(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	id, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	info, err := h.uc.RejectSuggestedPost(r.Context(), id, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// unixToTime переводит unix-секунды (>0) в *time.Time; 0/отрицательное — nil.
func unixToTime(sec int64) *time.Time {
	if sec <= 0 {
		return nil
	}
	t := time.Unix(sec, 0)
	return &t
}

func (h *ChannelHandler) EnableDiscussion(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	disc, err := h.uc.EnableDiscussion(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"discussion_peer_id": discussionPeer(disc)})
}

// LinkDiscussion links an existing group as the channel's discussion group
// (PUT /channels/{chatID}/discussion, body {group_peer_id}).
func (h *ChannelHandler) LinkDiscussion(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	var b struct {
		GroupPeerID domain.PeerID `json:"group_peer_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || !b.GroupPeerID.IsAnyChat() {
		writeError(w, http.StatusBadRequest, "group_peer_id required")
		return
	}
	disc, err := h.uc.LinkDiscussion(r.Context(), chatID, b.GroupPeerID.ToChatID(), user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"discussion_peer_id": discussionPeer(disc)})
}

// UnlinkDiscussion detaches the channel's discussion group
// (DELETE /channels/{chatID}/discussion).
func (h *ChannelHandler) UnlinkDiscussion(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	if err := h.uc.UnlinkDiscussion(r.Context(), chatID, user.ID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// DiscussionCandidates lists groups the actor may link as a discussion group
// (GET /channels/{chatID}/discussion_candidates).
func (h *ChannelHandler) DiscussionCandidates(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	if _, ok := peerChatID(w, r, h.uc); !ok {
		return
	}
	cands, err := h.uc.DiscussionCandidates(r.Context(), user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(cands))
	for _, c := range cands {
		out = append(out, map[string]any{"peer_id": domain.ToPeerID(c.ID, true), "title": c.Title, "username": c.Username, "member_count": c.MemberCount})
	}
	writeJSON(w, http.StatusOK, map[string]any{"chats": out})
}

// SetSignatures toggles channel post signatures
// (PUT /channels/{chatID}/sign_messages, body {signatures, profiles}).
func (h *ChannelHandler) SetSignatures(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	var b struct {
		Signatures bool `json:"signatures"`
		Profiles   bool `json:"profiles"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.uc.SetSignatures(r.Context(), chatID, user.ID, b.Signatures, b.Profiles); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *ChannelHandler) PostComment(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	// thread_root_id наружу — id поста (messageJSONOut, единый чокпоинт,
	// см. usecase/chat/discussion_mirror.go): внутри PostComment комментарий
	// тредится на id зеркала поста в группе обсуждения, но клиент про
	// зеркало ничего не знает и сверяет thread_root_id с постом, который открыл.
	writeJSON(w, http.StatusOK, messageJSONOut(r.Context(), h.uc, m))
}

func (h *ChannelHandler) ListComments(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	out := messagesJSON(r.Context(), h.uc, msgs)
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": count})
}

func (h *ChannelHandler) CommentCounts(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.uc)
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
	counts, recent, err := h.uc.CommentCounts(r.Context(), chatID, ids)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make(map[string]int, len(counts))
	for id, n := range counts {
		out[strconv.FormatInt(id, 10)] = n
	}
	// Авторы последних комментариев — под стек аватаров в футере поста.
	rec := make(map[string][]domain.UserReal, len(recent))
	for id, users := range recent {
		rec[strconv.FormatInt(id, 10)] = users
	}
	writeJSON(w, http.StatusOK, map[string]any{"counts": out, "recent_repliers": rec})
}

func (h *ChannelHandler) ViewCounts(w http.ResponseWriter, r *http.Request) {
	if _, ok := peerChatID(w, r, h.uc); !ok {
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
	counts, err := h.uc.ViewCounts(r.Context(), ids)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make(map[string]int64, len(counts))
	for id, n := range counts {
		out[strconv.FormatInt(id, 10)] = n
	}
	writeJSON(w, http.StatusOK, map[string]any{"counts": out})
}

func (h *ChannelHandler) Difference(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	pts, _ := strconv.ParseInt(r.URL.Query().Get("pts"), 10, 64)
	ups, err := h.uc.GetChannelDifference(r.Context(), chatID, user.ID, pts, 100)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Типизированный конверт {t,pts,d} — тот же, что несёт живой channel-кадр, так
	// что клиент прогоняет catch-up через тот же per-channel funnel, что и live.
	out := make([]map[string]any, 0, len(ups))
	maxPts := pts
	for _, u := range ups {
		out = append(out, map[string]any{"t": u.Type, "pts": u.Pts, "d": json.RawMessage(u.Payload)})
		if u.Pts > maxPts {
			maxPts = u.Pts
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"updates": out, "pts": maxPts, "slice": len(ups) == 100})
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

// Similar — похожие каналы (по пересечению аудитории). Формат строки канала
// совпадает с выдачей поиска; count — общее число похожих (для «+N» под Premium).
func (h *ChannelHandler) Similar(w http.ResponseWriter, r *http.Request) {
	viewer, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	chats, count, err := h.uc.SimilarChannels(r.Context(), chatID, viewer.ID, 30)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"chats": channelsOf(chats), "count": count,
	})
}

func (h *ChannelHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	chats, _ := h.uc.SearchChats(r.Context(), q, 20)
	users, _ := h.uc.SearchUsers(r.Context(), q, 20)
	// Аватар в выдаче поиска — по правилу profile_photo владельца.
	gatePhotos(r, h.privacy, users)
	writeJSON(w, http.StatusOK, domain.NewContactsFound(channelsOf(chats), users))
}
