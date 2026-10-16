package http

import (
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
)

// writeSendError — ответ на отказ ГЕЙТОВ ОТПРАВКИ (usecase Send и всё, что
// через них идёт: пересылка, служебки по запросу пользователя, подарок). Одна
// таблица на все ручки: прежде каждая мапила свой поднабор, и отказ, которого
// ручка не знала (медленный режим, приватность, плата), уходил 500-й.
// notFound — текст отказа «не участник / нет такого» (у ручек он свой): здесь
// ErrNotFound — 403, а не 404 (отличие от writeDomainError). Остальное — общий
// разборщик writeDomainError (errors_tg.go).
func writeSendError(w http.ResponseWriter, err error, notFound string) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusForbidden, notFound)
	case errors.Is(err, domain.ErrTooLong):
		writeError(w, http.StatusBadRequest, "message too long")
	case errors.Is(err, domain.ErrScheduleTooMuch):
		// Лимит очереди отложенных чата (Telegram SCHEDULE_TOO_MUCH).
		writeError(w, http.StatusBadRequest, "SCHEDULE_TOO_MUCH")
	default:
		writeDomainError(w, err, "send failed")
	}
}

// writePaidError — отказы платной отправки: нет согласия на плату — 403
// ALLOW_PAYMENT_REQUIRED_<N> (N — сумма всего запроса, клиент по нему
// переспрашивает, tweb repayRequestHandler.ts:12), не хватает звёзд — 400
// BALANCE_TOO_LOW. false — ошибка не из этого семейства.
func writePaidError(w http.ResponseWriter, err error) bool {
	var need domain.ErrAllowPaymentRequired
	switch {
	case errors.As(err, &need):
		writeError(w, http.StatusForbidden, need.Error())
	case errors.Is(err, domain.ErrBalanceTooLow):
		writeError(w, http.StatusBadRequest, "BALANCE_TOO_LOW")
	default:
		return false
	}
	return true
}
