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

// PresenceQuery — присутствие пользователя. Опциональный шов: без него статус
// не производится вовсе (userStatusEmpty — «неизвестно»), и клиент накладывает
// собственный кэш присутствия.
//
// Status отдаёт ТРИ величины, а не две: третья — expires, дедлайн, после
// которого клиент обязан считать пира офлайн сам. Без него потерянный кадр
// оставлял человека онлайн навсегда.
type PresenceQuery interface {
	Status(ctx context.Context, userID int64) (online bool, expires, lastSeen time.Time)
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
		// Имя отказа — Telegram (channels.inviteToChannel/messages.addChatUser):
		// по нему tweb addChatUsers показывает тост InviteToGroupError.
		writeError(w, http.StatusForbidden, "USER_PRIVACY_RESTRICTED")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, "PEER_ID_INVALID")
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
	id, missing, err := h.uc.CreateGroup(r.Context(), user.ID, b.Title, b.About, b.Username, b.IsPublic, b.MemberIDs)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Ответ — `messages.invitedUsers`, как у `messages.createChat` оригинала:
	// созданный чат в `updates.chats` (tweb `appChatsManager.createChat` берёт
	// его оттуда) и позванные, кого настройка приватности не пустила. Вектор
	// `updates` пуст: служебное «создал(а) группу» доезжает кадром WS.
	c, err := h.uc.ChatCard(r.Context(), id, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	updates := domain.NewUpdates(nil, nil, time.Now())
	updates.Chats = []domain.Chat{c.ToChannel()}
	writeJSON(w, http.StatusOK, domain.NewMessagesInvitedUsers(updates, missing))
}

func (h *GroupHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *GroupHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// SetPhoto points the chat's photo at an uploaded media object (PUT
// /chats/{chatID}/photo). Access to the bytes is enforced by the media GET.
func (h *GroupHandler) SetPhoto(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

var usernameRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{4,31}$`)

// SetType switches private/public (PUT /chats/{chatID}/type).
func (h *GroupHandler) SetType(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// CheckUsername — channels.checkUsername (GET
// /chats/{peerID}/username/available?u=...): Bool «имя свободно для этого
// чата». Имя, занятое пользователем или другим чатом, — boolFalse (общее
// пространство имён), своё имя чата — boolTrue. Негодная форма — 400
// USERNAME_INVALID (правило то же, что у SetType); нет права менять инфо — 403
// CHAT_ADMIN_REQUIRED.
func (h *GroupHandler) CheckUsername(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	u := r.URL.Query().Get("u")
	if !usernameRe.MatchString(u) {
		writeError(w, http.StatusBadRequest, "USERNAME_INVALID")
		return
	}
	available, err := h.uc.CheckChatUsername(r.Context(), chatID, user.ID, u)
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "CHAT_ADMIN_REQUIRED")
		return
	}
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(available))
}

// SetPermissions stores default member permissions + slowmode (PUT /chats/{chatID}/permissions).
func (h *GroupHandler) SetPermissions(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// SetReactions stores the reaction policy (PUT /chats/{chatID}/reactions).
func (h *GroupHandler) SetReactions(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// SetHistory toggles chat history visibility for new members (PUT /chats/{chatID}/history).
func (h *GroupHandler) SetHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// Ban kicks a user and adds them to the removed-users list (POST /chats/{chatID}/bans).
func (h *GroupHandler) Ban(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// Unban removes a user from the removed-users list (DELETE /chats/{chatID}/bans/{userID}).
func (h *GroupHandler) Unban(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// Restrict applies a granular per-user restriction (POST /chats/{chatID}/restrictions).
func (h *GroupHandler) Restrict(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	var b struct {
		UserID       int64 `json:"user_id"`
		DeniedRights int   `json:"denied_rights"`
		UntilSeconds int   `json:"until_seconds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.UserID == 0 {
		writeError(w, http.StatusBadRequest, "user_id required")
		return
	}
	if err := h.uc.RestrictMember(r.Context(), chatID, user.ID, b.UserID, domain.MemberPerms(b.DeniedRights), b.UntilSeconds); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// Unrestrict lifts a member's granular restriction
// (DELETE /chats/{chatID}/restrictions/{userID}).
func (h *GroupHandler) Unrestrict(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	uid, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	if err := h.uc.UnrestrictMember(r.Context(), chatID, user.ID, uid); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// DeleteInvite hard-deletes an invite link
// (DELETE /chats/{chatID}/invite_links/{token}). Revoking is done via PATCH
// (revoked:true); this permanently removes the row (Telegram deleteExportedChatInvite).
func (h *GroupHandler) DeleteInvite(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	token := chi.URLParam(r, "token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "token required")
		return
	}
	if err := h.uc.DeleteInvite(r.Context(), chatID, user.ID, token); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// DeleteAllRevoked hard-deletes every revoked link of the chat
// (DELETE /chats/{chatID}/revoked_invite_links; Telegram deleteRevokedExportedChatInvites).
func (h *GroupHandler) DeleteAllRevoked(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	if err := h.uc.DeleteAllRevoked(r.Context(), chatID, user.ID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// DeleteGroup deletes the group for everyone (DELETE /chats/{chatID}; creator only).
func (h *GroupHandler) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	if err := h.uc.DeleteGroup(r.Context(), chatID, user.ID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *GroupHandler) PromoteAdmin(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	var b struct {
		UserID int64 `json:"user_id"`
		Rights int   `json:"rights"`
		// Rank — подпись админа (channels.editAdmin rank, Б-117).
		Rank string `json:"rank"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.UserID == 0 {
		writeError(w, http.StatusBadRequest, "user_id required")
		return
	}
	if err := h.uc.PromoteAdmin(r.Context(), chatID, user.ID, b.UserID, domain.Rights(b.Rights), b.Rank); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *GroupHandler) DemoteAdmin(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *GroupHandler) EditInfo(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *GroupHandler) SetMute(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// SetNotify — PUT /chats/{chatID}/notify_settings: per-chat превью/звук.
// Тело: { preview *bool, sound *string ('default'|'none') } — переданные поля
// применяются, отсутствующие не меняются.
func (h *GroupHandler) SetNotify(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// SetPin — POST /chats/{chatID}/pin {pinned}: закрепить/открепить диалог.
func (h *GroupHandler) SetPin(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// SetArchive — POST /chats/{chatID}/archive {archived}: в архив / из архива.
func (h *GroupHandler) SetArchive(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *GroupHandler) Card(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	out, err := h.uc.ChatFullContainer(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// ОДИН ответ на карточку чата — messages.chatFull: полная карточка вместе
	// с краткой формой самого чата. Ровно тот же объект уходит кадром
	// chat_update (usecase/chat/chat_update.go): прежде эта ручка и кадр
	// отдавали одну ChatCard в двух разных формах.
	//
	// Чего в конструкторах нет и почему: `my_role` исчезает (creator это
	// pFlags.creator, admin — наличие admin_rights, решение №3), `is_public`
	// выражено наличием username, `default_permissions` — инвертированными
	// default_banned_rights, `history_for_new` — pFlags.hidden_prehistory с
	// обратным знаком.
	//
	// Обёртки вокруг конструктора больше нет. `peer_id` был выводим из самого
	// ответа (краткая карточка лежит в `chats`, ключ пира клиент и так строит
	// из неё), а `creator_id` — мёртвым: его никто не читал, только хранил.
	// «Создатель ли я» выражает `pFlags.creator` краткой карточки, а «кто
	// создатель» — конструктор `channelParticipantCreator` в списке участников.
	// Связанный чат (Б-119, A4-12) и карточки заявителей плашки заявок
	// (recent_requesters, Б-86) собирает ChatFullContainer.
	writeJSON(w, http.StatusOK, out)
}

// SetChargeStars sets the paid-message price in stars (PUT /chats/{chatID}/charge_stars).
func (h *GroupHandler) SetChargeStars(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	var b struct {
		ChargeStars int `json:"charge_stars"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.uc.SetChatChargeStars(r.Context(), chatID, user.ID, b.ChargeStars); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// Participants — channels.getParticipants (GET /chats/{peerID}/participants):
// filter = recent|admins|kicked|banned|bots|search|contacts|mentions, q,
// top_msg_id, offset, limit. count — ВСЕГО по фильтру (A4-07), не длина
// страницы. Одна ручка вместо трёх (`/members`, `/bans`, `/restrictions`).
func (h *GroupHandler) Participants(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	qs := r.URL.Query()
	offset, _ := strconv.Atoi(qs.Get("offset"))
	limit := 200
	if v := qs.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	f := domain.ParticipantsFilter{Kind: domain.ParticipantsFilterKind(qs.Get("filter")), Q: qs.Get("q")}
	if f.Kind == "" {
		f.Kind = domain.ParticipantsRecent
	}
	if !f.Kind.Valid() {
		writeError(w, http.StatusBadRequest, "invalid filter")
		return
	}
	f.TopMsgID, _ = strconv.ParseInt(qs.Get("top_msg_id"), 10, 64)
	page, err := h.uc.ListParticipants(r.Context(), chatID, user.ID, f, offset, limit)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// РОЛЬ — выбор конструктора, ПРИСУТСТВИЕ — на карточке пользователя
	// (`user.status`) в векторе `users` того же контейнера.
	cards, err := h.participantCards(r, user.ID, page.UserIDs)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewChannelsChannelParticipants(page.Count, page.Participants, cards))
}

// Participant — channels.getParticipant (GET /chats/{peerID}/participants/{userID}).
// Не участник и не удалённый — USER_NOT_PARTICIPANT, как у оригинала.
func (h *GroupHandler) Participant(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	uid, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	p, ids, err := h.uc.GetParticipant(r.Context(), chatID, user.ID, uid)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusBadRequest, "USER_NOT_PARTICIPANT")
		return
	}
	if err != nil {
		h.mapErr(w, err)
		return
	}
	cards, err := h.participantCards(r, user.ID, ids)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewChannelsChannelParticipant(p, cards))
}

// participantCards — карточки участников глазами зрителя (privacy.ViewUsers):
// онлайн видит тот, кому участник разрешил last seen (иначе — другой
// конструктор, userStatusRecently, как у оригинала).
func (h *GroupHandler) participantCards(r *http.Request, viewerID int64, ids []int64) ([]domain.UserReal, error) {
	cards, err := h.uc.UsersByIDs(r.Context(), viewerID, ids)
	if err != nil {
		return nil, err
	}
	// Фото, номер и статус по last_seen — общий сборщик карточек (A4-08).
	viewUsers(r, h.privacy, cards)
	return cards, nil
}

// OnlineCounter — сколько из ids сейчас онлайн (presence.Manager, одним
// конвейером Redis). Опциональный шов: без него онлайн не считается.
type OnlineCounter interface {
	CountOnline(ctx context.Context, userIDs []int64) (int, error)
}

// Onlines — messages.getOnlines (GET /chats/{peerID}/onlines) → chatOnlines
// (Б-84). Канал — 1, как у tweb getOnlines; минимум 1 — сам зритель.
// Считаются ВСЕ онлайн, включая скрывших время визита: число не раскрывает,
// кто именно (решение по умолчанию, как у Telegram по наблюдению).
func (h *GroupHandler) Onlines(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	ids, broadcast, err := h.uc.OnlineCandidates(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	n := 1
	if oc, ok := h.presence.(OnlineCounter); ok && !broadcast {
		if c, err := oc.CountOnline(r.Context(), ids); err == nil && c > n {
			n = c
		}
	}
	writeJSON(w, http.StatusOK, domain.NewChatOnlines(n))
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
	viewer, _ := UserFromContext(r.Context())
	cards, err := h.uc.KnownUsersByIDs(r.Context(), viewer.ID, ids)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Аватар скрывается по правилу profile_photo владельца.
	//
	// Краткая карточка — конструктор `user` целиком. Прежде витрина собирала
	// свою пятёрку полей и теряла на этом `verified` (дефект 5 разбора): поле
	// в базе было, в выдачу не попадало.
	viewUsers(r, h.privacy, cards)
	// Ответ — сам ВЕКТОР карточек: обёртка `{"users": …}` конструктора не имеет.
	writeJSON(w, http.StatusOK, orEmptyUsers(cards))
}

// isoOrNil renders a nullable timestamp as an ISO-8601 string, or nil in JSON
// when unset (e.g. an invite link with no expiry).
func isoOrNil(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

func (h *GroupHandler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	var b struct {
		Title            string `json:"title"`
		UsageLimit       *int   `json:"usage_limit"`
		RequiresApproval bool   `json:"requires_approval"`
		// ExpireSeconds — TTL ссылки от текущего момента; 0/отсутствует — бессрочная.
		ExpireSeconds int `json:"expire_seconds"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	var expiresAt *time.Time
	if b.ExpireSeconds > 0 {
		t := time.Now().Add(time.Duration(b.ExpireSeconds) * time.Second)
		expiresAt = &t
	}
	link, err := h.uc.CreateInvite(r.Context(), chatID, user.ID, b.Title, b.UsageLimit, b.RequiresApproval, expiresAt)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesExportedChatInvite(link))
}

func (h *GroupHandler) ListInvites(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	revoked := r.URL.Query().Get("revoked") == "true"
	links, err := h.uc.ListInvites(r.Context(), chatID, user.ID, revoked)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Карточки создателей ссылок — вектором `users` контейнера (как у оригинала).
	seen := make(map[int64]bool, len(links))
	ids := make([]int64, 0, len(links))
	for _, l := range links {
		if !seen[l.CreatedBy] {
			seen[l.CreatedBy] = true
			ids = append(ids, l.CreatedBy)
		}
	}
	cards, err := h.uc.UsersByIDs(r.Context(), user.ID, ids)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	viewUsers(r, h.privacy, cards)
	writeJSON(w, http.StatusOK, domain.NewMessagesExportedChatInvites(links, cards))
}

// EditInvite updates an invite link (PATCH /chats/{chatID}/invite_links/{token}).
// Only fields present in the body change; expire_seconds resets the TTL from now
// (0 → no expiry).
func (h *GroupHandler) EditInvite(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	token := chi.URLParam(r, "token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "token required")
		return
	}
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	var edit domain.InviteEdit
	if v, ok := raw["title"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil {
			edit.Title = &s
		}
	}
	if v, ok := raw["requires_approval"]; ok {
		var b bool
		if json.Unmarshal(v, &b) == nil {
			edit.RequiresApproval = &b
		}
	}
	if v, ok := raw["revoked"]; ok {
		var b bool
		if json.Unmarshal(v, &b) == nil {
			edit.Revoked = &b
		}
	}
	if v, ok := raw["usage_limit"]; ok {
		edit.SetUsageLimit = true
		var n *int
		if json.Unmarshal(v, &n) == nil {
			edit.UsageLimit = n // nil → unlimited
		}
	}
	if v, ok := raw["expire_seconds"]; ok {
		edit.SetExpiry = true
		var secs int
		if json.Unmarshal(v, &secs) == nil && secs > 0 {
			t := time.Now().Add(time.Duration(secs) * time.Second)
			edit.ExpiresAt = &t
		} // 0/negative → nil → no expiry
	}
	link, err := h.uc.EditInvite(r.Context(), chatID, user.ID, token, edit)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesExportedChatInvite(link))
}

// InviteImporters lists users who joined via a link
// (GET /chats/{chatID}/invite_links/{token}/importers).
func (h *GroupHandler) InviteImporters(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	token := chi.URLParam(r, "token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "token required")
		return
	}
	importers, count, err := h.uc.InviteImporters(r.Context(), chatID, user.ID, token)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Вошедший и ждущий одобрения — ОДИН конструктор `chatInviteImporter`,
	// разницу выражает `pFlags.requested`. У нас это были два разных списка.
	out := make([]domain.ChatInviteImporter, 0, len(importers))
	ids := make([]int64, 0, len(importers))
	for _, im := range importers {
		out = append(out, domain.NewChatInviteImporter(im.UserID, im.JoinedAt, false, 0))
		ids = append(ids, im.UserID)
	}
	// Карточки вошедших едут вектором `users` того же контейнера, как у
	// оригинала (`messages.chatInviteImporters`): список вступивших (вкладка
	// ссылки, tweb `chatInviteLink.tsx`) рисует строку пользователя по ключу и
	// читает карточку из зеркала, второго запроса за ней клиент не делает.
	cards, err := h.uc.UsersByIDs(r.Context(), user.ID, ids)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	viewUsers(r, h.privacy, cards)
	writeJSON(w, http.StatusOK, domain.NewMessagesChatInviteImporters(count, out, cards))
}

func (h *GroupHandler) Join(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	token := chi.URLParam(r, "token")
	chatID, requested, err := h.uc.JoinByToken(r.Context(), token, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// `messages.importChatInvite` оригинала: заявка — отказ с именем
	// `INVITE_REQUEST_SENT` (tweb `joinChatInvite.tsx:122-124` показывает по нему
	// тост), вступление — `Updates` с чатом в `chats[0]` (tweb
	// `appChatInvitesManager.ts:92-104` открывает его). Вектор `updates` пуст:
	// служебное «вступил(а) по ссылке» доезжает кадром WS, как у CreateGroup.
	if requested {
		writeError(w, http.StatusBadRequest, "INVITE_REQUEST_SENT")
		return
	}
	c, err := h.uc.ChatCard(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	updates := domain.NewUpdates(nil, nil, time.Now())
	updates.Chats = []domain.Chat{c.ToChannel()}
	writeJSON(w, http.StatusOK, updates)
}

func (h *GroupHandler) JoinRequests(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	// Страница messages.getChatInviteImporters{requested}: q, курсор
	// (offset_date, offset_user) — последняя полученная строка, limit.
	qs := r.URL.Query()
	var offsetDate time.Time
	if v, _ := strconv.ParseInt(qs.Get("offset_date"), 10, 64); v > 0 {
		offsetDate = time.Unix(v, 0)
	}
	offsetUser, _ := strconv.ParseInt(qs.Get("offset_user"), 10, 64)
	limit, _ := strconv.Atoi(qs.Get("limit"))
	reqs, total, err := h.uc.ListJoinRequests(r.Context(), chatID, user.ID, qs.Get("q"), offsetDate, offsetUser, limit)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Заявка — ТОТ ЖЕ конструктор `chatInviteImporter`, что и вошедший, с
	// флагом `requested`: у оригинала это один список, отфильтрованный по
	// флагу, а не два разных.
	out := make([]domain.ChatInviteImporter, 0, len(reqs))
	ids := make([]int64, 0, len(reqs))
	for _, rq := range reqs {
		out = append(out, domain.NewChatInviteImporter(rq.UserID, rq.CreatedAt, true, 0))
		ids = append(ids, rq.UserID)
	}
	// Карточки заявителей — вектором users: строка вкладки читает их синхронно.
	cards, err := h.participantCards(r, user.ID, ids)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesChatInviteImporters(total, out, cards))
}

func (h *GroupHandler) ApproveJoinRequest(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *GroupHandler) DeclineJoinRequest(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// orEmptyUsers — вектор карточек, который на проводе остаётся вектором:
// «пусто» у обязательного вектора это `[]`, а не null.
func orEmptyUsers(cards []domain.UserReal) []domain.UserReal {
	if cards == nil {
		return []domain.UserReal{}
	}
	return cards
}
