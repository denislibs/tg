package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// Бусты каналов и розыгрыши — методы ChatHandler (тот же usecase, что опросы/
// звёзды). Роуты — в router.go, группа pr.

// ChannelBoosts — GET /channels/{chatID}/boosts: состояние бустов канала.
func (h *ChatHandler) ChannelBoosts(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	st, err := h.svc.BoostStatus(r.Context(), chatID, h.meID(r))
	if h.boostErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, boostStatusJSON(st))
}

// BoostChannel — POST /channels/{chatID}/boost: буст канала (только premium).
func (h *ChatHandler) BoostChannel(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	st, err := h.svc.BoostChannel(r.Context(), chatID, h.meID(r))
	if h.boostErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, boostStatusJSON(st))
}

// boostStatusJSON — статус бустов ЗРИТЕЛЮ: конструктор схемы плюс наше число
// свободных слотов рядом.
//
// Слоты лежат СНАРУЖИ конструктора намеренно: в схеме на этом месте
// my_boost_slots — вектор ИДЕНТИФИКАТОРОВ занятых слотов, а у нас это счётчик
// свободных. Разные предметы под похожим именем, и класть счётчик в вектор
// значило бы подделать одно другим; поле ответа — наше, там ему и место.
func boostStatusJSON(st domain.BoostStatus) map[string]any {
	return map[string]any{"status": st.ToWire(true), "slots": st.Slots}
}

func (h *ChatHandler) boostErr(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "channel not found")
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "premium required or no free slots")
	default:
		writeError(w, http.StatusInternalServerError, "boost failed")
	}
	return true
}

// CreateGiveaway — POST /channels/{chatID}/giveaways: создать розыгрыш (админ).
func (h *ChatHandler) CreateGiveaway(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	var b struct {
		PrizeKind    string `json:"prize_kind"`
		Months       int    `json:"months"`
		Stars        int64  `json:"stars"`
		WinnersCount int    `json:"winners_count"`
		UntilDate    int64  `json:"until_date"` // unix millis
		ClientMsgID  string `json:"client_msg_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	m, err := h.svc.CreateGiveaway(r.Context(), usecasechat.CreateGiveawayInput{
		ChatID: chatID, CreatorID: h.meID(r),
		PrizeKind: b.PrizeKind, Months: b.Months, Stars: b.Stars,
		WinnersCount: b.WinnersCount, UntilDate: time.UnixMilli(b.UntilDate),
		ClientMsgID: b.ClientMsgID,
	})
	if h.giveawayErr(w, err) {
		return
	}
	writeMessage(w, r, h.svc, m)
}

// ParticipateGiveaway — POST /giveaways/{id}/participate: участвовать.
func (h *ChatHandler) ParticipateGiveaway(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	info, err := h.svc.ParticipateGiveaway(r.Context(), id, h.meID(r))
	if h.giveawayErr(w, err) {
		return
	}
	// Ответ — САМ конструктор объединения `payments.GiveawayInfo`: обёртки
	// вокруг него у оригинала нет.
	writeJSON(w, http.StatusOK, info.ToState())
}

// GetGiveaway — GET /giveaways/{id}: статус розыгрыша для зрителя.
func (h *ChatHandler) GetGiveaway(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	info, err := h.svc.GetGiveaway(r.Context(), id, h.meID(r))
	if h.giveawayErr(w, err) {
		return
	}
	// Наружу уходит ЛИЧНОЕ состояние зрителя (payments.giveawayInfo), а не
	// розыгрыш целиком: сами условия и победители едут вложением сообщения, и
	// повторять их здесь значило бы завести вторую форму розыгрыша.
	// Ответ — САМ конструктор объединения `payments.GiveawayInfo`: обёртки
	// вокруг него у оригинала нет.
	writeJSON(w, http.StatusOK, info.ToState())
}

func (h *ChatHandler) giveawayErr(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid giveaway")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "not allowed")
	default:
		writeError(w, http.StatusInternalServerError, "giveaway failed")
	}
	return true
}
