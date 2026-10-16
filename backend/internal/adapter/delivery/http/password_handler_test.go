package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

// Ф7-И1 (Б-4): /me/password* без лимитера проверяют пароль со скоростью
// сервера. Лимит стоит ДО сравнения: верный пароль тоже получает отказ, а
// отказ — 420 FLOOD_WAIT_<N> (tweb ждёт N секунд, apiManager.ts:759-791).
type pwEnv struct {
	h      *PasswordHandler
	userID int64
	clock  time.Time
}

func newPwEnv(t *testing.T, phone string) *pwEnv {
	t.Helper()
	pool := postgres.NewTestDB(t)
	uc := newAuthUC(pool)
	router := routerFor(uc, pool)
	token, id := loginViaHTTP(t, router, phone)
	enableCloudPassword(t, router, token, "")
	e := &pwEnv{h: NewPasswordHandler(uc), userID: id, clock: time.Now()}
	e.h.limiter.now = func() time.Time { return e.clock }
	return e
}

// call — прямой вызов ручки: пользователь, сессия и IP заданы явно.
func (e *pwEnv) call(t *testing.T, fn http.HandlerFunc, userID, deviceID int64, ip string, body any) *httptest.ResponseRecorder {
	t.Helper()
	buf, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(WithUser(context.Background(), domain.UserRecord{ID: userID}, deviceID), http.MethodPost, "/me/password/verify", bytes.NewReader(buf))
	req.Header.Set("X-Real-IP", ip)
	rec := httptest.NewRecorder()
	fn(rec, req)
	return rec
}

func (e *pwEnv) verify(t *testing.T, deviceID int64, ip, password string) *httptest.ResponseRecorder {
	return e.call(t, e.h.Verify, e.userID, deviceID, ip, map[string]string{"password": password})
}

func wantFlood(t *testing.T, rec *httptest.ResponseRecorder, what string) wireError {
	t.Helper()
	e := wireErrorOf(rec)
	if rec.Code != 420 || !floodWaitRe.MatchString(e.Text) {
		t.Fatalf("%s: %d %s; want 420 FLOOD_WAIT_N", what, rec.Code, rec.Body.String())
	}
	return e
}

func TestPasswordLimiter_PerSessionBucket(t *testing.T) {
	e := newPwEnv(t, "+79990170011")
	// Пять попыток с РАЗНЫХ IP (ведро IP не мешает) и ВЕРНЫМ паролем проходят.
	for n := 1; n <= 5; n++ {
		if rec := e.verify(t, 1, "203.0.113."+itoa(int64(n)), "s3cret"); rec.Code != http.StatusOK {
			t.Fatalf("попытка %d: %d %s", n, rec.Code, rec.Body.String())
		}
	}
	// Шестая с нового IP — ведро пользователя пусто: 420 FLOOD_WAIT_60, хотя
	// пароль верный (лимит раньше сравнения).
	rec := e.verify(t, 1, "203.0.113.50", "s3cret")
	if err := wantFlood(t, rec, "6-я попытка сессии"); err.Text != "FLOOD_WAIT_60" {
		t.Fatalf("текст = %q, want FLOOD_WAIT_60", err.Text)
	}
	// Другая сессия того же пользователя не заперта: укравший сессию не
	// запирает владельцу проверку пароля.
	if rec := e.verify(t, 2, "203.0.113.51", "s3cret"); rec.Code != http.StatusOK {
		t.Fatalf("другая сессия: %d %s", rec.Code, rec.Body.String())
	}
	// Через минуту ведро дарит одну попытку.
	e.clock = e.clock.Add(61 * time.Second)
	if rec := e.verify(t, 1, "203.0.113.52", "s3cret"); rec.Code != http.StatusOK {
		t.Fatalf("через минуту: %d %s", rec.Code, rec.Body.String())
	}
	wantFlood(t, e.verify(t, 1, "203.0.113.53", "s3cret"), "вторая попытка сразу после")
}

func TestPasswordLimiter_PerIPBucket(t *testing.T) {
	e := newPwEnv(t, "+79990170012")
	// С одного IP шестой запрос — отказ, даже от другой сессии и другого
	// пользователя: ведро IP общее.
	for n := 1; n <= 5; n++ {
		if rec := e.verify(t, int64(n), "198.51.100.7", "неверный"); rec.Code != http.StatusForbidden {
			t.Fatalf("попытка %d: %d %s", n, rec.Code, rec.Body.String())
		}
	}
	wantFlood(t, e.verify(t, 9, "198.51.100.7", "s3cret"), "6-й запрос с IP")
	wantFlood(t, e.call(t, e.h.Verify, e.userID+1000, 1, "198.51.100.7", map[string]string{"password": "x"}), "другой пользователь с того же IP")
}

// Set и Remove — те же ведра; отказ не меняет пароль.
func TestPasswordLimiter_SetAndRemoveBlockedBeforeCompare(t *testing.T) {
	e := newPwEnv(t, "+79990170013")
	for n := 1; n <= 5; n++ {
		e.verify(t, 1, "192.0.2."+itoa(int64(n)), "неверный")
	}
	rec := e.call(t, e.h.Set, e.userID, 1, "192.0.2.99",
		map[string]string{"current_password": "s3cret", "new_password": "другой", "hint": "h"})
	wantFlood(t, rec, "POST /me/password")
	if rec := e.call(t, e.h.Remove, e.userID, 1, "192.0.2.98", map[string]string{"current_password": "s3cret"}); rec.Code != 420 {
		t.Fatalf("DELETE /me/password: %d %s", rec.Code, rec.Body.String())
	}
	// Пароль не сменён и не снят: старый подходит (с другой сессии).
	if rec := e.verify(t, 2, "192.0.2.97", "s3cret"); rec.Code != http.StatusOK {
		t.Fatalf("старый пароль после отказов: %d %s", rec.Code, rec.Body.String())
	}
	// GET /me/password пароль не проверяет — не ограничен.
	for n := 0; n < 20; n++ {
		req := httptest.NewRequestWithContext(WithUser(context.Background(), domain.UserRecord{ID: e.userID}, 1), http.MethodGet, "/me/password", nil)
		rec := httptest.NewRecorder()
		e.h.State(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("State #%d: %d %s", n, rec.Code, rec.Body.String())
		}
	}
}
