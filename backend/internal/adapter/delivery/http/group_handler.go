package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// PresenceQuery reports whether a user is currently online. It's an optional
// seam: when nil, the members endpoint reports everyone as offline and lets the
// client overlay its own presence store.
type PresenceQuery interface {
	IsOnline(ctx context.Context, userID int64) (bool, error)
}

type GroupHandler struct {
	uc       *usecasechat.Interactor
	presence PresenceQuery
}

func NewGroupHandler(uc *usecasechat.Interactor, presence PresenceQuery) *GroupHandler {
	return &GroupHandler{uc: uc, presence: presence}
}

func (h *GroupHandler) mapErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		writeError(w, http.StatusInternalServerError, "server error")
	}
}

func (h *GroupHandler) CreateGroup(w http.ResponseWriter, r *http.Request) {
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
	id, err := h.uc.CreateGroup(r.Context(), user.ID, b.Title, b.About, b.Username, b.IsPublic)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chat_id": id})
}

func (h *GroupHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		UserID int64 `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.UserID == 0 {
		writeError(w, http.StatusBadRequest, "user_id required")
		return
	}
	if err := h.uc.AddMember(r.Context(), chatID, user.ID, b.UserID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	uid, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	if err := h.uc.RemoveMember(r.Context(), chatID, user.ID, uid); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) PromoteAdmin(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		UserID int64 `json:"user_id"`
		Rights int   `json:"rights"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.UserID == 0 {
		writeError(w, http.StatusBadRequest, "user_id required")
		return
	}
	if err := h.uc.PromoteAdmin(r.Context(), chatID, user.ID, b.UserID, domain.Rights(b.Rights)); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) DemoteAdmin(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	uid, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	if err := h.uc.DemoteAdmin(r.Context(), chatID, user.ID, uid); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) EditInfo(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		Title    string `json:"title"`
		About    string `json:"about"`
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.uc.EditInfo(r.Context(), chatID, user.ID, b.Title, b.About, b.Username); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) SetMute(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
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
	if err := h.uc.SetMute(r.Context(), chatID, user.ID, b.Muted); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) Card(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	c, err := h.uc.ChatCard(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": c.ID, "type": c.Type, "title": c.Title, "username": c.Username, "about": c.About,
		"photo_media_id": c.PhotoMediaID, "creator_id": c.CreatorID, "member_count": c.MemberCount,
		"is_public": c.IsPublic, "my_role": c.MyRole, "my_rights": int(c.MyRights), "muted": c.Muted,
	})
}

func (h *GroupHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	members, err := h.uc.ListMembers(r.Context(), chatID, user.ID, offset, limit)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(members))
	for _, m := range members {
		online := false
		if h.presence != nil {
			online, _ = h.presence.IsOnline(r.Context(), m.UserID)
		}
		out = append(out, map[string]any{"user_id": m.UserID, "role": m.Role, "online": online})
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": out})
}

func (h *GroupHandler) Users(w http.ResponseWriter, r *http.Request) {
	idsParam := r.URL.Query().Get("ids")
	var ids []int64
	for _, s := range strings.Split(idsParam, ",") {
		if s == "" {
			continue
		}
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			ids = append(ids, n)
		}
	}
	cards, err := h.uc.UsersByIDs(r.Context(), ids)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(cards))
	for _, c := range cards {
		out = append(out, map[string]any{"id": c.ID, "username": c.Username, "display_name": c.DisplayName, "avatar_url": c.AvatarURL})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

func (h *GroupHandler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		UsageLimit *int `json:"usage_limit"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	link, err := h.uc.CreateInvite(r.Context(), chatID, user.ID, b.UsageLimit)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": link.Token, "url": "/join/" + link.Token})
}

func (h *GroupHandler) ListInvites(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	links, err := h.uc.ListInvites(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(links))
	for _, l := range links {
		out = append(out, map[string]any{"token": l.Token, "uses": l.Uses, "url": "/join/" + l.Token})
	}
	writeJSON(w, http.StatusOK, map[string]any{"invite_links": out})
}

func (h *GroupHandler) Join(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	token := chi.URLParam(r, "token")
	if err := h.uc.JoinByToken(r.Context(), token, user.ID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
