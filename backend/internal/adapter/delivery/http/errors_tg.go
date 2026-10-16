package http

import (
	"errors"
	"net/http"
	"strings"

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
//	ErrTooLong   → 400 too long           ErrScheduleTooMuch → 400 SCHEDULE_TOO_MUCH
//	ErrUnavailable (и обёртки: забытая проводка, выключенная фича) → 503 unavailable
//	SQLSTATE 23505/23P01 → 409 conflict, прочие 22xxx/23xxx и 54000 → 400 invalid
//
// Всё остальное — 500 с прежним текстом ручки (fallback). Имена — только те,
// что tweb разбирает (apiManager.ts:715-812, appImManager.ts:551-565,
// repayRequestHandler.ts:12); голые 403/404/400/409/503 с текстом — отказы, у
// которых имени TG нет, клиент по ним не ветвится.
//
// 500 клиент повторяет (tweb apiManager.ts:800-808: пауза 1 с ×1,5 до 60 с),
// поэтому сюда не должна доходить ошибка, которая при повторе повторится:
// отказ usecase, нарушенное запросом ограничение БД (класс 22 — данные, 23 —
// целостность), отсутствующая конфигурацией фича. Перечень проверяет
// TestOnly500_NoDeterministicSources.
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
	case errors.Is(err, domain.ErrTooLong):
		writeError(w, http.StatusBadRequest, "too long")
	case errors.Is(err, domain.ErrScheduleTooMuch):
		// Лимит очереди отложенных чата (Telegram SCHEDULE_TOO_MUCH).
		writeError(w, http.StatusBadRequest, "SCHEDULE_TOO_MUCH")
	case errors.Is(err, domain.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "unavailable")
	case writeSQLStateError(w, err):
	default:
		writeError(w, http.StatusInternalServerError, fallback)
	}
}

// writeSQLStateError — ошибка Postgres классов 22 (данные: NUL в тексте,
// переполнение числа или даты, длина колонки) и 23 (целостность: дубль, внешний
// ключ, CHECK) — следствие самого запроса, повтор даст то же. pgx здесь не
// импортируется: *pgconn.PgError отдаёт код методом SQLState. false — ошибка
// не из этих классов.
func writeSQLStateError(w http.ResponseWriter, err error) bool {
	var pg interface{ SQLState() string }
	if !errors.As(err, &pg) {
		return false
	}
	switch code := pg.SQLState(); {
	case code == "23505", code == "23P01": // unique_violation, exclusion_violation
		writeError(w, http.StatusConflict, "conflict")
	case strings.HasPrefix(code, "22"), strings.HasPrefix(code, "23"), code == "54000": // 54000 — строка индекса длиннее предела
		writeError(w, http.StatusBadRequest, "invalid")
	default:
		return false
	}
	return true
}
