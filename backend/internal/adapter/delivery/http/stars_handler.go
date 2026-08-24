package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

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
	writeJSON(w, http.StatusOK, domain.NewStarsStatus(bal))
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
	writeJSON(w, http.StatusOK, domain.NewStarsStatus(bal))
}

// StarsTransactions — GET /stars/transactions?offset&limit: история движений
// баланса звёзд (экран «Кошелёк», tweb Stars transactions).
func (h *ChatHandler) StarsTransactions(w http.ResponseWriter, r *http.Request) {
	offset := int(queryInt(r, "offset", 0))
	limit := int(queryInt(r, "limit", 30))
	txs, err := h.svc.StarsTransactions(r.Context(), h.meID(r), offset, limit)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "stars disabled")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load transactions")
		return
	}
	// История едет ТЕМ ЖЕ конструктором, что и остаток: у оригинала это один
	// ответ `payments.starsStatus`, где `history` — необязательный параметр.
	// Остаток спрашивается здесь же: без него конструктор неполон, а клиенту
	// он всё равно нужен на том же экране.
	bal, err := h.svc.StarsBalance(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load balance")
		return
	}
	out := make([]domain.StarsTransaction, 0, len(txs))
	for _, tx := range txs {
		// Вид операции больше не строка: «это подарок» говорит ФЛАГ, вторую
		// сторону — конструктор, а «начисление или списание» — знак суммы.
		out = append(out, domain.NewStarsTransaction(tx.ID, tx.Amount, unixOf(tx.Date), tx.PeerID, tx.Title,
			strings.HasPrefix(tx.Kind, "gift")))
	}
	writeJSON(w, http.StatusOK, domain.NewStarsStatusWithHistory(bal, out))
}

// UnlockPaidMedia — POST /chats/{peerID}/messages/{msgSeq}/unlock: разблокировать
// платное медиа за звёзды. Списывает цену у покупателя, начисляет автору,
// отдаёт медиа.
//
// Ключ пира в адресе обязателен: сообщение адресуется парой «пир + номер», и
// без пира этот путь мог существовать только на внутреннем ключе строки.
func (h *ChatHandler) UnlockPaidMedia(w http.ResponseWriter, r *http.Request) {
	chatID, ok := peerChatID(w, r, h.svc)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.svc, chatID)
	if !ok {
		return
	}
	msg, _, err := h.svc.UnlockPaidMedia(r.Context(), msgID, h.meID(r))
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
	// Ответ — само СООБЩЕНИЕ. Баланса рядом больше нет: его владелец —
	// кадр `updateStarsBalance`, который и так уходит по сокету, а второе
	// значение того же факта в теле ответа расходилось бы с ним.
	writeMessage(w, r, h.svc, msg)
}

// GiftCatalog — GET /gifts/catalog: доступные подарки.
//
// Позиция каталога едет конструктором starGift — ТЕМ ЖЕ, каким она уже ехала
// внутри savedStarGift и messageActionStarGift. Прежде та же позиция имела
// вторую, плоскую форму (price_stars/sold_out/total/remains): каталог был
// единственным местом, куда строка domain.StarGift выходила на провод как есть.
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
	out := make([]domain.MTStarGift, 0, len(gifts))
	for _, g := range gifts {
		out = append(out, domain.NewStarGift(g))
	}
	writeJSON(w, http.StatusOK, domain.NewPaymentsStarGifts(out))
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
	msg, _, err := h.svc.SendGift(r.Context(), h.meID(r), b.ToUserID, b.GiftID, b.Message, b.Anonymous)
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
	// Ответ — само СООБЩЕНИЕ. Баланса рядом больше нет: его владелец —
	// кадр `updateStarsBalance`, который и так уходит по сокету, а второе
	// значение того же факта в теле ответа расходилось бы с ним.
	writeMessage(w, r, h.svc, msg)
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
	// Витрина профиля отдаёт savedStarGift — тот же подарок, что приходит в
	// ленту действием messageActionStarGift, но в форме своего конструктора.
	out := make([]domain.SavedStarGift, 0, len(gifts))
	for _, g := range gifts {
		out = append(out, g.ToSaved())
	}
	writeJSON(w, http.StatusOK, domain.NewPaymentsSavedStarGifts(out))
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
	writeJSON(w, http.StatusOK, domain.NewStarsStatus(bal))
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

// unixOf — дата строки истории в секундах эпохи. Наш столбец хранит её
// строкой RFC 3339; конструктор просит число, как и у любой другой даты схемы.
func unixOf(v string) int {
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return 0
	}
	return int(t.Unix())
}
