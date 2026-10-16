package http

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"

	cacheredis "github.com/messenger-denis/backend/internal/adapter/cache/redis"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
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
		if rec := e.verify(t, int64(n), "198.51.100.7", "неверный"); rec.Code != http.StatusBadRequest {
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

// withPasswordAttempts подключает к usecase Redis-стор неудач пароля (М1-5) на
// miniredis; часы блокировок — mr.FastForward.
func withPasswordAttempts(t *testing.T, uc *usecaseauth.Interactor) *miniredis.Miniredis {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	uc.SetPasswordAttempts(cacheredis.NewPasswordAttemptStore(goredis.NewClient(&goredis.Options{Addr: mr.Addr()})))
	return mr
}

// М1-5 (остаток Б-4): после 5 неверных паролей сессия заперта растущим
// ожиданием — 420 FLOOD_WAIT_<N> во всех трёх ручках ДО сверки, даже когда
// ведро лимитера Ф7-И1 уже полно; другая сессия не заперта.
func TestPasswordFlood_HTTPLockAfterFiveFailures(t *testing.T) {
	e := newPwEnv(t, "+79990170021")
	mr := withPasswordAttempts(t, e.h.uc)
	for n := 1; n <= 5; n++ {
		if rec := e.verify(t, 1, "203.0.113."+itoa(int64(n)), "неверный"); rec.Code != http.StatusBadRequest {
			t.Fatalf("неудача %d: %d %s", n, rec.Code, rec.Body.String())
		}
	}
	if n := countKeys(mr, fmt.Sprintf("pwfail:%d:1:", e.userID), fmt.Sprintf("pwlock:%d:1:", e.userID)); n != 2 {
		t.Fatalf("ключей счётчика и блокировки сессии после 5 неудач: %d %v", n, mr.Keys())
	}
	// Ведро лимитера пополнено (10 минут по его часам) — отказ даёт только
	// блокировка М1-5, её часы (Redis) не сдвигались.
	e.clock = e.clock.Add(10 * time.Minute)
	rec := e.verify(t, 1, "203.0.113.10", "s3cret")
	if err := wantFlood(t, rec, "Verify в блокировке"); err.Text != "FLOOD_WAIT_60" {
		t.Fatalf("Verify: %q, want FLOOD_WAIT_60", err.Text)
	}
	wantFlood(t, e.call(t, e.h.Set, e.userID, 1, "203.0.113.11",
		map[string]string{"current_password": "s3cret", "new_password": "другой", "hint": "h"}), "Set в блокировке")
	wantFlood(t, e.call(t, e.h.Remove, e.userID, 1, "203.0.113.12", map[string]string{"current_password": "s3cret"}), "Remove в блокировке")
	// Другая сессия того же пользователя не заперта.
	if rec := e.verify(t, 2, "203.0.113.13", "s3cret"); rec.Code != http.StatusOK {
		t.Fatalf("сессия 2: %d %s", rec.Code, rec.Body.String())
	}
	// Блокировка истекла — верный пароль проходит и сбрасывает счётчик.
	mr.FastForward(61 * time.Second)
	if rec := e.verify(t, 1, "203.0.113.14", "s3cret"); rec.Code != http.StatusOK {
		t.Fatalf("после блокировки: %d %s", rec.Code, rec.Body.String())
	}
	if countKeys(mr, fmt.Sprintf("pwfail:%d:1:", e.userID)) != 0 {
		t.Fatalf("верный пароль не удалил счётчик неудач: %v", mr.Keys())
	}
}

// Остаток М1-1 (#467): потолок попыток пароля на пользователя при входе по
// check_password. Пять неудач (токен сгорает на пятой) запирают шаг входа:
// новый password_token с верным паролем получает 420 FLOOD_WAIT_60.
func TestPasswordFlood_HTTPCheckPasswordPerUser(t *testing.T) {
	pool := postgres.NewTestDB(t)
	uc := newAuthUC(pool)
	h := routerFor(uc, pool)
	const phone = "+79990170022"
	token, _ := loginViaHTTP(t, h, phone)
	enableCloudPassword(t, h, token, "")
	mr := withPasswordAttempts(t, uc)

	check := func(pwToken, password, ip string) *httptest.ResponseRecorder {
		buf, _ := json.Marshal(map[string]string{"password_token": pwToken, "password": password, "device": "web", "platform": "browser"})
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/auth/check_password", bytes.NewReader(buf))
		req.Header.Set("X-Real-IP", ip) // свежее ведро pw-ip: на каждую попытку
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	tok := passwordStep(t, h, phone)
	for n := 1; n <= 5; n++ {
		rec := check(tok, "неверный", "198.51.100."+itoa(int64(n)))
		// 1–4 — неверный пароль, 5-я сжигает токен (5 попыток на токен).
		want := http.StatusBadRequest
		if n == 5 {
			want = http.StatusUnauthorized
		}
		if rec.Code != want {
			t.Fatalf("неудача %d: %d %s", n, rec.Code, rec.Body.String())
		}
	}
	tok2 := passwordStep(t, h, phone)
	rec := check(tok2, "s3cret", "198.51.100.20")
	if err := wantFlood(t, rec, "check_password в блокировке"); err.Text != "FLOOD_WAIT_60" {
		t.Fatalf("check_password: %q, want FLOOD_WAIT_60", err.Text)
	}
	// Блокировка истекла — тот же токен (не сгорел в блокировке) входит.
	mr.FastForward(61 * time.Second)
	if rec := check(tok2, "s3cret", "198.51.100.21"); rec.Code != http.StatusOK {
		t.Fatalf("вход после блокировки: %d %s", rec.Code, rec.Body.String())
	}
}

// countKeys — сколько ключей miniredis начинается с одного из префиксов.
func countKeys(mr *miniredis.Miniredis, prefixes ...string) int {
	n := 0
	for _, k := range mr.Keys() {
		for _, p := range prefixes {
			if strings.HasPrefix(k, p) {
				n++
			}
		}
	}
	return n
}

// Без устройства в контексте ручки пароля отвечают 401 no session: иначе
// счётчик сессии с deviceID 0 совпал бы с областью шага входа (М1-5).
func TestPasswordHandler_NoDeviceUnauthorized(t *testing.T) {
	e := newPwEnv(t, "+79990170023")
	for name, fn := range map[string]http.HandlerFunc{"Verify": e.h.Verify, "Set": e.h.Set, "Remove": e.h.Remove} {
		rec := e.call(t, fn, e.userID, 0, "203.0.113.30", map[string]string{"password": "s3cret", "current_password": "s3cret"})
		if rec.Code != http.StatusUnauthorized || wireErrorOf(rec).Text != "no session" {
			t.Fatalf("%s без устройства: %d %s", name, rec.Code, rec.Body.String())
		}
	}
}
