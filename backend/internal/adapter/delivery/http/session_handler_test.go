package http

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestSessions_ListAndLogout(t *testing.T) {
	h, pool := newMessagingRouter(t)
	token, _ := signUp(t, h, pool, "+79990000010")

	// List shows one current session.
	rec := authedReq(t, h, http.MethodGet, "/sessions", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	// account.authorizations: адрес сессии зовётся `hash`, а «текущая» это
	// ФЛАГ — его отсутствие и есть «не текущая».
	var listed sessionList
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Authorizations) != 1 || !listed.Authorizations[0].PFlags["current"] {
		t.Fatalf("sessions = %+v", listed.Authorizations)
	}

	// Logout, then the token is rejected.
	rec = authedReq(t, h, http.MethodPost, "/auth/logout", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("logout: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/me", token, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 after logout, got %d", rec.Code)
	}
}

func TestSessions_RevokeOther(t *testing.T) {
	h, pool := newMessagingRouter(t)
	// Same phone signs in twice → two devices/sessions.
	tokenA, _ := signUp(t, h, pool, "+79990000011")
	tokenB, _ := signUp(t, h, pool, "+79990000011")

	rec := authedReq(t, h, http.MethodGet, "/sessions", tokenA, nil)
	// account.authorizations: адрес сессии зовётся `hash`, а «текущая» это
	// ФЛАГ — его отсутствие и есть «не текущая».
	var listed sessionList
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Authorizations) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(listed.Authorizations))
	}
	// Find the non-current (session B) and revoke it from A.
	var other int64
	for _, s := range listed.Authorizations {
		if !s.PFlags["current"] {
			other = s.Hash
		}
	}
	rec = authedReq(t, h, http.MethodDelete, "/sessions/"+itoa(other), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke: %d %s", rec.Code, rec.Body.String())
	}
	// Token B no longer works.
	rec = authedReq(t, h, http.MethodGet, "/me", tokenB, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected B revoked (401), got %d", rec.Code)
	}
}

func TestSessions_RevokeOthers(t *testing.T) {
	h, pool := newMessagingRouter(t)
	// Three sessions of the same account.
	tokenA, _ := signUp(t, h, pool, "+79990000012")
	tokenB, _ := signUp(t, h, pool, "+79990000012")
	tokenC, _ := signUp(t, h, pool, "+79990000012")

	// A terminates all other sessions.
	rec := authedReq(t, h, http.MethodDelete, "/sessions/others", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke others: %d %s", rec.Code, rec.Body.String())
	}
	// Ответ — «получилось»: числа отозванных не читал никто, а результат
	// виден по самому списку сессий ниже.
	if !isBoolTrue(rec.Body.Bytes()) {
		t.Fatalf("отзыв остальных = %s; ожидался boolTrue", rec.Body.String())
	}
	// B and C are dead, A still works and is the only session left.
	for _, tok := range []string{tokenB, tokenC} {
		if rec := authedReq(t, h, http.MethodGet, "/me", tok, nil); rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected revoked (401), got %d", rec.Code)
		}
	}
	rec = authedReq(t, h, http.MethodGet, "/sessions", tokenA, nil)
	var listed sessionList
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Authorizations) != 1 || !listed.Authorizations[0].PFlags["current"] {
		t.Fatalf("sessions after revoke-others = %+v", listed.Authorizations)
	}
}

// Адрес ТЕКУЩЕЙ сессии — ноль, у прочих — id устройства. По этому нулю вкладка
// «Устройства» узнаёт свою строку и только её не даёт завершить кликом
// (tweb activeSessions.tsx:132,157). Отдай мы туда настоящий id — пользователь
// завершил бы собственную сессию.
//
// И под-объект pFlags едет у КАЖДОЙ строки, даже пустой: клиент читает
// `auth.pFlags.current` без страховки, потому что у оригинала его всегда строит
// десериализатор.
func TestSessions_CurrentSessionHashIsZero(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000013")
	_, _ = signUp(t, h, pool, "+79990000013")

	rec := authedReq(t, h, http.MethodGet, "/sessions", tokenA, nil)
	var listed sessionList
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Authorizations) != 2 {
		t.Fatalf("ожидались 2 сессии, получено %d", len(listed.Authorizations))
	}
	var current, other int
	for _, a := range listed.Authorizations {
		if a.PFlags == nil {
			t.Errorf("строка без под-объекта pFlags: %+v", a)
		}
		if a.PFlags["current"] {
			current++
			if a.Hash != 0 {
				t.Errorf("hash текущей сессии = %d; ожидался ноль", a.Hash)
			}
		} else {
			other++
			if a.Hash == 0 {
				t.Error("чужая сессия с нулевым hash — её нечем отозвать")
			}
		}
	}
	if current != 1 || other != 1 {
		t.Fatalf("текущих=%d, прочих=%d; ожидалось по одной", current, other)
	}

	// Ноль по этому пути не проходит: текущую авторизацию не отзывают, из неё
	// выходят. Иначе клиент завершил бы свою сессию, попросив «сессию 0».
	rec = authedReq(t, h, http.MethodDelete, "/sessions/0", tokenA, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("DELETE /sessions/0 = %d %s; ожидался 400", rec.Code, rec.Body.String())
	}
	// Своя сессия жива.
	if rec := authedReq(t, h, http.MethodGet, "/me", tokenA, nil); rec.Code != http.StatusOK {
		t.Fatalf("своя сессия умерла после DELETE /sessions/0: %d", rec.Code)
	}
}

// Реквизиты клиента: заголовок строки в списке устройств это `app_name` +
// `app_version`, вторая строка — `device_model, system_version`, справа —
// `max(date_active, date_created)`. Пустые они рисовали строку без названия и
// 1970 год.
func TestSessions_ClientIdentityIsProduced(t *testing.T) {
	h, pool := newMessagingRouter(t)
	_ = pool
	token := signUpAs(t, h, "+79990000014",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
		"0.1.0 (7)")

	rec := authedReq(t, h, http.MethodGet, "/sessions", token, nil)
	var listed sessionList
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Authorizations) != 1 {
		t.Fatalf("ожидалась одна сессия, получено %d", len(listed.Authorizations))
	}
	a := listed.Authorizations[0]
	if a.AppName == "" {
		t.Error("app_name пуст — строка списка устройств осталась без заголовка")
	}
	if a.AppVersion != "0.1.0 (7)" {
		t.Errorf("app_version = %q; ожидалась версия сборки, названная клиентом", a.AppVersion)
	}
	if a.DeviceModel != "Chrome" {
		t.Errorf("device_model = %q; ожидался браузер БЕЗ склейки с ОС", a.DeviceModel)
	}
	if a.SystemVersion != "macOS" {
		t.Errorf("system_version = %q; ожидалась ОС из User-Agent", a.SystemVersion)
	}
	if a.DateCreated == 0 {
		t.Error("date_created = 0 — экран показал бы 1970 год")
	}
}

// Без id устройства список отдавать нельзя: ни одна строка не получит флага
// `current`, и вкладка покажет пустоту вместо списка устройств. Ноль приезжает
// сюда штатным путём — канальный RPC пред-инжектит пару юзер+устройство
// целиком, и незаполненный id выглядит как ноль, а не как отсутствие ключа.
func TestSessions_ListRefusesWithoutDeviceID(t *testing.T) {
	h, pool := newMessagingRouter(t)
	token, userID := signUp(t, h, pool, "+79990000015")
	_ = token

	user := domain.UserRecord{ID: userID}
	req := httptest.NewRequest(http.MethodGet, "/sessions", nil)
	req = req.WithContext(WithUser(req.Context(), user, 0))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("список без id устройства = %d %s; ожидался 401", rec.Code, rec.Body.String())
	}
}

// sessionList — ответ `GET /sessions`: контейнер account.authorizations, где
// каждая сессия это конструктор `authorization`.
type sessionList struct {
	Authorizations []struct {
		Hash          int64           `json:"hash"`
		PFlags        map[string]bool `json:"pFlags"`
		DeviceModel   string          `json:"device_model"`
		SystemVersion string          `json:"system_version"`
		AppName       string          `json:"app_name"`
		AppVersion    string          `json:"app_version"`
		DateCreated   int             `json:"date_created"`
	} `json:"authorizations"`
}

// signUpAs — вход с настоящими реквизитами клиента: User-Agent (из него сервер
// разбирает браузер и ОС) и версия сборки, которой клиент называет себя в
// заголовке — наш аналог преамбулы `initConnection` оригинала.
func signUpAs(t *testing.T, h http.Handler, phone, userAgent, appVersion string) string {
	t.Helper()
	post := func(path string, body any) *httptest.ResponseRecorder {
		buf, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(buf))
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("X-App-Version", appVersion)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := post("/auth/request_code", map[string]string{"phone": phone}); rec.Code != http.StatusOK {
		t.Fatalf("request_code: %d %s", rec.Code, rec.Body.String())
	}
	rec := post("/auth/sign_in", map[string]string{
		"phone": phone, "code": "12345", "device": "web", "platform": "browser",
	})
	step := decodeSignIn(t, rec)
	if step.Underscore == "auth.authorizationSignUpRequired" {
		rec = post("/auth/sign_up", map[string]string{
			"signup_token": step.SignUpToken, "first_name": "Тест", "device": "web", "platform": "browser",
		})
	}
	out := decodeSignIn(t, rec)
	if out.Token == "" {
		t.Fatalf("вход не выдал сессию: %s", rec.Body.String())
	}
	return out.Token
}
