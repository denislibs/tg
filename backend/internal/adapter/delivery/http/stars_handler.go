package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
)

// Stars/Gifts HTTP. Хендлеры висят на ChatHandler (тот же usecase.Interactor).

// StarsBalance — GET /stars/balance: баланс звёзд текущего пользователя.
func (h *ChatHandler) StarsBalance(w http.ResponseWriter, r *http.Request) {
	bal, err := h.svc.StarsBalance(r.Context(), h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "stars disabled")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load balance")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"balance": bal})
}

// TopUpStars — POST /stars/topup {amount}: dev-пополнение (без реальной оплаты).
func (h *ChatHandler) TopUpStars(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Amount int64 `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	bal, err := h.svc.TopUpStars(r.Context(), h.meID(r), b.Amount)
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusBadRequest, "invalid amount")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "stars disabled")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "top-up failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"balance": bal})
}

// UnlockPaidMedia — POST /messages/{msgID}/unlock: разблокировать платное медиа
// за звёзды. Списывает цену у покупателя, начисляет автору, отдаёт медиа.
func (h *ChatHandler) UnlockPaidMedia(w http.ResponseWriter, r *http.Request) {
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	msg, bal, err := h.svc.UnlockPaidMedia(r.Context(), msgID, h.meID(r))
	if errors.Is(err, domain.ErrPaidRequired) {
		writeError(w, http.StatusPaymentRequired, "not enough stars")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "paid media not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not unlock")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": messageJSON(msg), "balance": bal})
}

// GiftCatalog — GET /gifts/catalog: доступные подарки.
func (h *ChatHandler) GiftCatalog(w http.ResponseWriter, r *http.Request) {
	gifts, err := h.svc.GiftCatalog(r.Context())
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "gifts disabled")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load catalog")
		return
	}
	if gifts == nil {
		gifts = []domain.StarGift{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"gifts": gifts})
}

// SendGift — POST /gifts/send {to_user_id, gift_id, message, anonymous}.
func (h *ChatHandler) SendGift(w http.ResponseWriter, r *http.Request) {
	var b struct {
		ToUserID  int64  `json:"to_user_id"`
		GiftID    int64  `json:"gift_id"`
		Message   string `json:"message"`
		Anonymous bool   `json:"anonymous"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.ToUserID <= 0 || b.GiftID <= 0 {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	msg, bal, err := h.svc.SendGift(r.Context(), h.meID(r), b.ToUserID, b.GiftID, b.Message, b.Anonymous)
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusPaymentRequired, "not enough stars")
		return
	}
	if errors.Is(err, domain.ErrTooLong) {
		writeError(w, http.StatusBadRequest, "message too long")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "gift not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not send gift")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": messageJSON(msg), "balance": bal})
}

// ProfileGifts — GET /users/{userID}/gifts: подарки в профиле пользователя.
func (h *ChatHandler) ProfileGifts(w http.ResponseWriter, r *http.Request) {
	ownerID, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	gifts, err := h.svc.ProfileGifts(r.Context(), ownerID, h.meID(r))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "gifts disabled")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load gifts")
		return
	}
	if gifts == nil {
		gifts = []domain.GiftInfo{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"gifts": gifts})
}

// ConvertGift — POST /gifts/{giftID}/convert: обменять подарок на звёзды.
func (h *ChatHandler) ConvertGift(w http.ResponseWriter, r *http.Request) {
	savedID, ok := pathInt(w, r, "giftID")
	if !ok {
		return
	}
	bal, err := h.svc.ConvertGift(r.Context(), savedID, h.meID(r))
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "cannot convert")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "gift not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not convert")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"balance": bal})
}

// SetGiftHidden — POST /gifts/{giftID}/hidden {hidden}: показать/скрыть в профиле.
func (h *ChatHandler) SetGiftHidden(w http.ResponseWriter, r *http.Request) {
	savedID, ok := pathInt(w, r, "giftID")
	if !ok {
		return
	}
	var b struct {
		Hidden bool `json:"hidden"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	err := h.svc.SetGiftHidden(r.Context(), savedID, h.meID(r), b.Hidden)
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not your gift")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "gift not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not update gift")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
