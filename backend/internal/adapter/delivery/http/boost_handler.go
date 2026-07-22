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
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	st, err := h.svc.BoostStatus(r.Context(), chatID, h.meID(r))
	if h.boostErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// BoostChannel — POST /channels/{chatID}/boost: буст канала (только premium).
func (h *ChatHandler) BoostChannel(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	st, err := h.svc.BoostChannel(r.Context(), chatID, h.meID(r))
	if h.boostErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, st)
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
	chatID, ok := pathInt(w, r, "chatID")
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
	writeJSON(w, http.StatusOK, messageJSON(m))
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
	writeJSON(w, http.StatusOK, map[string]any{"giveaway": info})
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
	writeJSON(w, http.StatusOK, map[string]any{"giveaway": info})
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
