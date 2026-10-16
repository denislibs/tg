package http

import (
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
)

// writeDomainError — единый разборщик отказов usecase для ручек, у которых
// иного исхода, кроме 500, не было. Код и текст выбираются по типу ошибки:
//
//	ErrNotFound  → 404 not found          ErrForbidden → 403 forbidden
//	ErrInvalid   → 400 invalid            ErrConflict  → 409 conflict
//	ErrPrivacy   → 403 USER_PRIVACY_RESTRICTED
//	ErrAllowPaymentRequired → 403 ALLOW_PAYMENT_REQUIRED_<N>, ErrBalanceTooLow → 400 BALANCE_TOO_LOW
//	ErrSlowmodeWait → 420 SLOWMODE_WAIT_<N>
//
// Всё остальное — 500 с прежним текстом ручки (fallback). Имена — только те,
// что tweb разбирает (apiManager.ts:715-812, appImManager.ts:551-565,
// repayRequestHandler.ts:12); голые 403/404/400/409 с текстом — отказы, у
// которых имени TG нет, клиент по ним не ветвится.
func writeDomainError(w http.ResponseWriter, err error, fallback string) {
	var wait domain.ErrSlowmodeWait
	switch {
	case errors.As(err, &wait):
		writeError(w, 420, wait.Error())
	case writePaidError(w, err):
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid")
	case errors.Is(err, domain.ErrConflict):
		writeError(w, http.StatusConflict, "conflict")
	case errors.Is(err, domain.ErrPrivacy):
		writeError(w, http.StatusForbidden, "USER_PRIVACY_RESTRICTED")
	default:
		writeError(w, http.StatusInternalServerError, fallback)
	}
}
