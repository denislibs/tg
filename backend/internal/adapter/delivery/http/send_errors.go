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
// notFound — текст отказа «не участник / нет такого» (у ручек он свой).
func writeSendError(w http.ResponseWriter, err error, notFound string) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusForbidden, notFound)
	case errors.Is(err, domain.ErrTooLong):
		writeError(w, http.StatusBadRequest, "message too long")
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid")
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "not allowed")
	case errors.Is(err, domain.ErrSlowmode):
		writeError(w, http.StatusTooManyRequests, "slowmode")
	case errors.Is(err, domain.ErrPrivacy):
		writeError(w, http.StatusForbidden, "privacy")
	case errors.Is(err, domain.ErrPaidRequired):
		writeError(w, http.StatusPaymentRequired, "paid_required")
	default:
		writeError(w, http.StatusInternalServerError, "send failed")
	}
}
