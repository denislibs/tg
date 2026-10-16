package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ф7-И1 (MC-08): единый разборщик отказов usecase — код и текст берутся по
// типу ошибки, а не по ветке ручки. Ручка с «любая ошибка → 500» превращала
// ErrNotFound/ErrInvalid в 500, и клиент (apiManager.ts:800-808) считал бы их
// сбоем сервера.
func TestWriteDomainError(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		status int
		text   string
	}{
		{"not found", domain.ErrNotFound, http.StatusNotFound, "not found"},
		{"обёрнутый not found", fmt.Errorf("x: %w", domain.ErrNotFound), http.StatusNotFound, "not found"},
		{"forbidden", domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{"invalid", domain.ErrInvalid, http.StatusBadRequest, "invalid"},
		{"conflict", domain.ErrConflict, http.StatusConflict, "conflict"},
		{"privacy", domain.ErrPrivacy, http.StatusForbidden, "USER_PRIVACY_RESTRICTED"},
		{"allow payment", domain.ErrAllowPaymentRequired{Stars: 15}, http.StatusForbidden, "ALLOW_PAYMENT_REQUIRED_15"},
		{"balance", domain.ErrBalanceTooLow, http.StatusBadRequest, "BALANCE_TOO_LOW"},
		{"slowmode", domain.ErrSlowmodeWait{Seconds: 20}, 420, "SLOWMODE_WAIT_20"},
		{"обёрнутый slowmode", errors.Join(errors.New("send"), domain.ErrSlowmodeWait{Seconds: 3}), 420, "SLOWMODE_WAIT_3"},
		{"too long", domain.ErrTooLong, http.StatusBadRequest, "too long"},
		{"очередь отложенных", domain.ErrScheduleTooMuch, http.StatusBadRequest, "SCHEDULE_TOO_MUCH"},
		{"unavailable", domain.ErrUnavailable, http.StatusServiceUnavailable, "unavailable"},
		{"обёрнутый unavailable (забытая проводка)", fmt.Errorf("media reader не подключён: %w", domain.ErrUnavailable), http.StatusServiceUnavailable, "unavailable"},
		{"неизвестная", errors.New("boom"), http.StatusInternalServerError, "fallback text"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			writeDomainError(rec, c.err, "fallback text")
			var body domain.Error
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("тело: %v (%s)", err, rec.Body.String())
			}
			if rec.Code != c.status || body.Text != c.text || body.Code != c.status {
				t.Fatalf("%v → %d {%d %q}, want %d %q", c.err, rec.Code, body.Code, body.Text, c.status, c.text)
			}
		})
	}
}

// Отказ БД из-за самого запроса (класс 22 — данные, 23 — целостность) при
// повторе повторится, поэтому не 500 (клиент 500 повторяет, apiManager.ts:800-808).
// Прочие классы (связь, блокировки, нехватка ресурсов) — сбой, 500.
func TestWriteDomainError_SQLState(t *testing.T) {
	cases := []struct {
		code   string
		status int
		text   string
	}{
		{"22021", http.StatusBadRequest, "invalid"}, // NUL в text
		{"22001", http.StatusBadRequest, "invalid"}, // длина колонки
		{"22008", http.StatusBadRequest, "invalid"}, // дата вне диапазона
		{"23503", http.StatusBadRequest, "invalid"}, // внешний ключ
		{"23514", http.StatusBadRequest, "invalid"}, // CHECK
		{"54000", http.StatusBadRequest, "invalid"}, // строка индекса длиннее предела
		{"23505", http.StatusConflict, "conflict"},  // дубль
		{"23P01", http.StatusConflict, "conflict"},  // exclusion
		{"40001", http.StatusInternalServerError, "fallback text"},
		{"57014", http.StatusInternalServerError, "fallback text"},
		{"08006", http.StatusInternalServerError, "fallback text"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		writeDomainError(rec, fmt.Errorf("repo: %w", &pgconn.PgError{Code: c.code}), "fallback text")
		if got := errText(t, rec); rec.Code != c.status || got != c.text {
			t.Errorf("SQLSTATE %s → %d %q, want %d %q", c.code, rec.Code, got, c.status, c.text)
		}
	}
}

// writeSendError — тот же разборщик; свои у неё только «не найдено» (403 с
// текстом ручки), слишком длинное и очередь отложенных.
func TestWriteSendError_Table(t *testing.T) {
	cases := []struct {
		err    error
		status int
		text   string
	}{
		{domain.ErrNotFound, http.StatusForbidden, "mine"},
		{domain.ErrTooLong, http.StatusBadRequest, "message too long"},
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrSlowmodeWait{Seconds: 9}, 420, "SLOWMODE_WAIT_9"},
		{domain.ErrPrivacy, http.StatusForbidden, "USER_PRIVACY_RESTRICTED"},
		{domain.ErrScheduleTooMuch, http.StatusBadRequest, "SCHEDULE_TOO_MUCH"},
		{errors.New("boom"), http.StatusInternalServerError, "send failed"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		writeSendError(rec, c.err, "mine")
		if got := errText(t, rec); rec.Code != c.status || got != c.text {
			t.Errorf("%v → %d %q, want %d %q", c.err, rec.Code, got, c.status, c.text)
		}
	}
}
