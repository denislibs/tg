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
	// Ответ действия — СОЗДАННЫЙ объект, а не его адрес в безымянной обёртке.
	// У оригинала `messages.createChat` отвечает `Updates` с новым чатом
	// внутри; контейнеров Updates мы не копируем (граница программы), поэтому
	// отдаём ту же карточку тем же конструктором, что и ручка карточки.
	c, err := h.uc.ChatCard(r.Context(), id, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesChatFull(c.ToChannelFull(), c.ToChannel()))
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

// ListBans returns the removed-users list (GET /chats/{chatID}/bans).
func (h *GroupHandler) ListBans(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	bans, err := h.uc.ListBanned(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Выгнанный и ограниченный — ОДИН конструктор объединения
	// (`channelParticipantBanned`): разницу выражает флаг `left`, а чем именно
	// ограничен — маска `banned_rights`. Прежде это были два разных списка с
	// разной формой строки.
	out := make([]domain.ChannelParticipant, 0, len(bans))
	for _, b := range bans {
		out = append(out, domain.NewChannelParticipantBanned(b.UserID, b.BannedBy, 0, domain.AllMemberPerms, time.Time{}, true))
	}
	writeJSON(w, http.StatusOK, domain.NewChannelsChannelParticipants(len(out), out, nil))
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

// ListRestrictions returns the chat's granularly-restricted members
// (GET /chats/{chatID}/restrictions).
func (h *GroupHandler) ListRestrictions(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	list, err := h.uc.ListRestricted(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Ограниченный — ТОТ ЖЕ конструктор объединения, что и выгнанный
	// (`channelParticipantBanned`), только без флага `left`: он остаётся в чате.
	// Прежде это был отдельный список со своей формой строки — вторая форма
	// одного предмета.
	//
	// Срок (until_date) — обязательный параметр самого `chatBannedRights`, 0
	// значит «бессрочно»; про полярность знает MemberRestriction.ToChatBannedRights.
	out := make([]domain.ChannelParticipant, 0, len(list))
	for _, res := range list {
		out = append(out, domain.ChannelParticipantBanned{
			Underscore:   domain.ChannelParticipantBannedTag,
			Peer:         domain.NewPeerUser(res.UserID),
			KickedBy:     res.RestrictedBy,
			BannedRights: res.ToChatBannedRights(),
		})
	}
	writeJSON(w, http.StatusOK, domain.NewChannelsChannelParticipants(len(out), out, nil))
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
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.UserID == 0 {
		writeError(w, http.StatusBadRequest, "user_id required")
		return
	}
	if err := h.uc.PromoteAdmin(r.Context(), chatID, user.ID, b.UserID, domain.Rights(b.Rights)); err != nil {
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
	c, err := h.uc.ChatCard(r.Context(), chatID, user.ID)
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
	writeJSON(w, http.StatusOK, domain.NewMessagesChatFull(c.ToChannelFull(), c.ToChannel()))
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

func (h *GroupHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
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
	ids := make([]int64, 0, len(members))
	for _, m := range members {
		ids = append(ids, m.UserID)
	}
	seen := map[int64]bool{}
	if h.privacy != nil {
		if v, err := h.privacy.VisibleMap(r.Context(), viewer.ID, ids, domain.PrivacyLastSeen); err == nil {
			seen = v
		}
	}
	// РОЛЬ — это выбор конструктора, а не строка в строке участника; ПРИСУТСТВИЕ
	// живёт на карточке пользователя (`user.status`), а карточки едут вектором
	// `users` того же контейнера. Прежде статус висел на участнике — второй дом
	// у одного факта.
	participants := make([]domain.ChannelParticipant, 0, len(members))
	for _, m := range members {
		participants = append(participants, domain.NewChannelParticipant(m, 0))
	}
	cards, err := h.uc.UsersByIDs(r.Context(), ids)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	gatePhotos(r, h.privacy, cards)
	for i := range cards {
		// Скрытое правилом last_seen присутствие — это ДРУГОЙ конструктор
		// (userStatusRecently), а не online:false: приватность выражена самим
		// статусом, как в оригинале.
		switch {
		case h.presence == nil:
			cards[i].Status = domain.NewUserStatusEmpty()
		case h.privacy != nil && !seen[cards[i].ID] && cards[i].ID != viewer.ID:
			cards[i].Status = domain.NewUserStatusRecently(false)
		default:
			cards[i].Status = domain.PresenceStatus(h.presence.Status(r.Context(), cards[i].ID))
		}
	}
	writeJSON(w, http.StatusOK, domain.NewChannelsChannelParticipants(len(members), participants, cards))
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
	//
	// Краткая карточка — конструктор `user` целиком. Прежде витрина собирала
	// свою пятёрку полей и теряла на этом `verified` (дефект 5 разбора): поле
	// в базе было, в выдачу не попадало.
	gatePhotos(r, h.privacy, cards)
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
	writeJSON(w, http.StatusOK, domain.NewMessagesExportedChatInvites(links))
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
	for _, im := range importers {
		out = append(out, domain.NewChatInviteImporter(im.UserID, im.JoinedAt, false, 0))
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesChatInviteImporters(count, out, nil))
}

func (h *GroupHandler) Join(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	token := chi.URLParam(r, "token")
	requested, err := h.uc.JoinByToken(r.Context(), token, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// «Вошёл» и «заявка отправлена» — ОДИН конструктор `chatInviteImporter` с
	// флагом `requested`, а не строка состояния: тот же предмет, что в списке
	// заявок, и та же форма.
	writeJSON(w, http.StatusOK, domain.NewChatInviteImporter(user.ID, time.Now(), requested, 0))
}

func (h *GroupHandler) JoinRequests(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.uc)
	if !ok {
		return
	}
	reqs, err := h.uc.ListJoinRequests(r.Context(), chatID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Заявка — ТОТ ЖЕ конструктор `chatInviteImporter`, что и вошедший, с
	// флагом `requested`: у оригинала это один список, отфильтрованный по
	// флагу, а не два разных.
	out := make([]domain.ChatInviteImporter, 0, len(reqs))
	for _, rq := range reqs {
		out = append(out, domain.NewChatInviteImporter(rq.UserID, rq.CreatedAt, true, 0))
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesChatInviteImporters(len(out), out, nil))
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
