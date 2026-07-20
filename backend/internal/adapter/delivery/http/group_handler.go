package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// PresenceQuery reports whether a user is currently online. It's an optional
// seam: when nil, the members endpoint reports everyone as offline and lets the
// client overlay its own presence store.
type PresenceQuery interface {
	IsOnline(ctx context.Context, userID int64) (bool, error)
	// Snapshot returns the user's online state and last-seen (ms; 0 when online).
	Snapshot(ctx context.Context, userID int64) (online bool, lastSeen int64)
}

type GroupHandler struct {
	uc       *usecasechat.Interactor
	presence PresenceQuery
	privacy  PrivacyQuery
}

func NewGroupHandler(uc *usecasechat.Interactor, presence PresenceQuery, privacy PrivacyQuery) *GroupHandler {
	return &GroupHandler{uc: uc, presence: presence, privacy: privacy}
}

func (h *GroupHandler) mapErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, domain.ErrPrivacy):
		writeError(w, http.StatusForbidden, "privacy")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		writeError(w, http.StatusInternalServerError, "server error")
	}
}

func (h *GroupHandler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		Title     string  `json:"title"`
		About     string  `json:"about"`
		Username  string  `json:"username"`
		IsPublic  bool    `json:"is_public"`
		MemberIDs []int64 `json:"member_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || strings.TrimSpace(b.Title) == "" {
		writeError(w, http.StatusBadRequest, "title required")
		return
	}
	id, err := h.uc.CreateGroup(r.Context(), user.ID, b.Title, b.About, b.Username, b.IsPublic, b.MemberIDs)
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

// SetPhoto points the chat's photo at an uploaded media object (PUT
// /chats/{chatID}/photo). Access to the bytes is enforced by the media GET.
func (h *GroupHandler) SetPhoto(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		MediaID int64 `json:"media_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.MediaID <= 0 {
		writeError(w, http.StatusBadRequest, "media_id required")
		return
	}
	if err := h.uc.SetChatPhoto(r.Context(), chatID, user.ID, b.MediaID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

var usernameRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{4,31}$`)

// SetType switches private/public (PUT /chats/{chatID}/type).
func (h *GroupHandler) SetType(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		IsPublic bool   `json:"is_public"`
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if b.IsPublic && !usernameRe.MatchString(b.Username) {
		writeError(w, http.StatusBadRequest, "invalid username")
		return
	}
	if err := h.uc.SetChatType(r.Context(), chatID, user.ID, b.IsPublic, b.Username); err != nil {
		if errors.Is(err, domain.ErrConflict) {
			writeError(w, http.StatusConflict, "username taken")
			return
		}
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// SetPermissions stores default member permissions + slowmode (PUT /chats/{chatID}/permissions).
func (h *GroupHandler) SetPermissions(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		Permissions     int `json:"permissions"`
		SlowmodeSeconds int `json:"slowmode_seconds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.uc.SetChatPermissions(r.Context(), chatID, user.ID, domain.MemberPerms(b.Permissions), b.SlowmodeSeconds); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// SetReactions stores the reaction policy (PUT /chats/{chatID}/reactions).
func (h *GroupHandler) SetReactions(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		Mode   string   `json:"mode"`
		Emojis []string `json:"emojis"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.uc.SetChatReactions(r.Context(), chatID, user.ID, b.Mode, b.Emojis); err != nil {
		if errors.Is(err, domain.ErrBadReaction) {
			writeError(w, http.StatusBadRequest, "invalid reactions")
			return
		}
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// SetHistory toggles chat history visibility for new members (PUT /chats/{chatID}/history).
func (h *GroupHandler) SetHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		Visible bool `json:"visible"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.uc.SetChatHistoryForNew(r.Context(), chatID, user.ID, b.Visible); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ListBans returns the removed-users list (GET /chats/{chatID}/bans).
func (h *GroupHandler) ListBans(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	bans, err := h.uc.ListBanned(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(bans))
	for _, b := range bans {
		out = append(out, map[string]any{"user_id": b.UserID, "banned_by": b.BannedBy})
	}
	writeJSON(w, http.StatusOK, map[string]any{"bans": out})
}

// Ban kicks a user and adds them to the removed-users list (POST /chats/{chatID}/bans).
func (h *GroupHandler) Ban(w http.ResponseWriter, r *http.Request) {
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
	if err := h.uc.BanMember(r.Context(), chatID, user.ID, b.UserID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Unban removes a user from the removed-users list (DELETE /chats/{chatID}/bans/{userID}).
func (h *GroupHandler) Unban(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	uid, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	if err := h.uc.UnbanMember(r.Context(), chatID, user.ID, uid); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// RevokeInvite revokes an invite link (DELETE /chats/{chatID}/invite_links/{token}).
func (h *GroupHandler) RevokeInvite(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	token := chi.URLParam(r, "token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "token required")
		return
	}
	if err := h.uc.RevokeInvite(r.Context(), chatID, user.ID, token); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// DeleteGroup deletes the group for everyone (DELETE /chats/{chatID}; creator only).
func (h *GroupHandler) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	if err := h.uc.DeleteGroup(r.Context(), chatID, user.ID); err != nil {
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
		Muted bool   `json:"muted"`
		Until *int64 `json:"until"` // unix-секунды; nil при muted=true — навсегда
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	var until *time.Time
	if b.Until != nil {
		t := time.Unix(*b.Until, 0)
		until = &t
	}
	if err := h.uc.SetMute(r.Context(), chatID, user.ID, b.Muted, until); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// SetNotify — PUT /chats/{chatID}/notify_settings: per-chat превью/звук.
// Тело: { preview *bool, sound *string ('default'|'none') } — переданные поля
// применяются, отсутствующие не меняются.
func (h *GroupHandler) SetNotify(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		Preview *bool   `json:"preview"`
		Sound   *string `json:"sound"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if b.Sound != nil && *b.Sound != "default" && *b.Sound != "none" {
		writeError(w, http.StatusBadRequest, "invalid sound")
		return
	}
	if err := h.uc.SetChatNotify(r.Context(), chatID, user.ID, b.Preview, b.Sound); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// SetPin — POST /chats/{chatID}/pin {pinned}: закрепить/открепить диалог.
func (h *GroupHandler) SetPin(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
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
	if err := h.uc.PinDialog(r.Context(), chatID, user.ID, b.Pinned); err != nil {
		if errors.Is(err, domain.ErrPinLimit) {
			writeError(w, http.StatusBadRequest, "pin limit reached")
			return
		}
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// SetArchive — POST /chats/{chatID}/archive {archived}: в архив / из архива.
func (h *GroupHandler) SetArchive(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var b struct {
		Archived bool `json:"archived"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.uc.ArchiveDialog(r.Context(), chatID, user.ID, b.Archived); err != nil {
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
		"default_permissions": int(c.Settings.DefaultPerms), "slowmode_seconds": c.Settings.SlowmodeSeconds,
		"reactions_mode": c.Settings.ReactionsMode, "reactions_allowed": c.Settings.ReactionsAllowed,
		"history_for_new": c.Settings.HistoryForNew,
		"is_public":       c.IsPublic, "my_role": c.MyRole, "my_rights": int(c.MyRights), "muted": c.Muted,
		"discussion_chat_id": c.DiscussionChatID,
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
	// Онлайн показывается только тем, кому участник разрешил видеть last seen
	// (иначе — «был(а) недавно» на клиенте).
	viewer, _ := UserFromContext(r.Context())
	seen := map[int64]bool{}
	if h.privacy != nil {
		ids := make([]int64, 0, len(members))
		for _, m := range members {
			ids = append(ids, m.UserID)
		}
		if v, err := h.privacy.VisibleMap(r.Context(), viewer.ID, ids, domain.PrivacyLastSeen); err == nil {
			seen = v
		}
	}
	out := make([]map[string]any, 0, len(members))
	for _, m := range members {
		online := false
		if h.presence != nil && (h.privacy == nil || seen[m.UserID] || m.UserID == viewer.ID) {
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
	// Аватар скрывается по правилу profile_photo владельца.
	viewer, _ := UserFromContext(r.Context())
	photoOK := map[int64]bool{}
	if h.privacy != nil && len(ids) > 0 {
		if v, err := h.privacy.VisibleMap(r.Context(), viewer.ID, ids, domain.PrivacyProfilePhoto); err == nil {
			photoOK = v
		}
	}
	out := make([]map[string]any, 0, len(cards))
	for _, c := range cards {
		avatar := c.AvatarURL
		if h.privacy != nil && !photoOK[c.ID] && c.ID != viewer.ID {
			avatar = ""
		}
		out = append(out, map[string]any{"id": c.ID, "username": c.Username, "display_name": c.DisplayName, "avatar_url": avatar})
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
		UsageLimit       *int `json:"usage_limit"`
		RequiresApproval bool `json:"requires_approval"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	link, err := h.uc.CreateInvite(r.Context(), chatID, user.ID, b.UsageLimit, b.RequiresApproval)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": link.Token, "url": "/join/" + link.Token, "requires_approval": link.RequiresApproval})
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
		out = append(out, map[string]any{"token": l.Token, "uses": l.Uses, "url": "/join/" + l.Token, "requires_approval": l.RequiresApproval})
	}
	writeJSON(w, http.StatusOK, map[string]any{"invite_links": out})
}

func (h *GroupHandler) Join(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	token := chi.URLParam(r, "token")
	requested, err := h.uc.JoinByToken(r.Context(), token, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	status := "joined"
	if requested {
		status = "requested"
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": status})
}

func (h *GroupHandler) JoinRequests(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	reqs, err := h.uc.ListJoinRequests(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(reqs))
	for _, rq := range reqs {
		out = append(out, map[string]any{"user_id": rq.UserID})
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": out})
}

func (h *GroupHandler) ApproveJoinRequest(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	uid, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	if err := h.uc.ApproveJoinRequest(r.Context(), chatID, user.ID, uid); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) DeclineJoinRequest(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	uid, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	if err := h.uc.DeclineJoinRequest(r.Context(), chatID, user.ID, uid); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
