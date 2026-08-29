package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

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
	h, _ := newMessagingRouter(t)
	token, _ := loginViaHTTPAs(t, h, "+79990000014", map[string]string{
		"User-Agent":    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
		"X-App-Version": "0.1.0 (7)",
	})

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
	_, userID := signUp(t, h, pool, "+79990000015")

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

// Версия сборки клиента приезжает ЗАГОЛОВКОМ, то есть произвольными байтами, а
// не текстом. Обрезка по БАЙТАМ ломала вход: срез посреди многобайтовой руны
// давал невалидный UTF-8, Postgres отвергал INSERT — и вход отвечал 500. Прячется
// это тем, что ровно на границе руны всё проходит, поэтому здесь ДВЕ длины: и
// та, что делится на размер руны, и та, что нет.
func TestSessions_LongAppVersionDoesNotBreakSignIn(t *testing.T) {
	h, _ := newMessagingRouter(t)

	for i, tc := range []struct {
		name    string
		version string
	}{
		// Иероглиф — ТРИ байта: 32-й байт приходится на СЕРЕДИНУ руны, и
		// прежняя обрезка резала руну пополам.
		{"срез посреди руны", strings.Repeat("字", 40)},
		// Кириллица — ДВА байта, 32 делится на 2 нацело: прежняя обрезка тут
		// случайно попадала в границу руны и проходила. Именно поэтому дефект и
		// прятался — на половине входных данных его не видно.
		{"срез ровно по границе руны", strings.Repeat("Я", 40)},
		// Клиент волен прислать в заголовке любые байты от 0x20 — в том числе
		// не образующие UTF-8 вовсе.
		{"битая последовательность", "0.1.0 \xff\xfe"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			token, _ := loginViaHTTPAs(t, h, "+7999000002"+itoa(int64(i)),
				map[string]string{"X-App-Version": tc.version})

			rec := authedReq(t, h, http.MethodGet, "/sessions", token, nil)
			if rec.Code != http.StatusOK {
				t.Fatalf("список сессий: %d %s", rec.Code, rec.Body.String())
			}
			var listed sessionList
			_ = json.Unmarshal(rec.Body.Bytes(), &listed)
			if len(listed.Authorizations) == 0 {
				t.Fatal("сессия не завелась")
			}
			got := listed.Authorizations[0].AppVersion
			if !utf8.ValidString(got) {
				t.Errorf("app_version = %q — невалидный UTF-8, БД такую строку не примет", got)
			}
			if n := utf8.RuneCountInString(got); n > 32 {
				t.Errorf("app_version длиной %d рун; потолок 32", n)
			}
		})
	}
}

// «Завершить все прочие» без id устройства обязано ОТКАЗАТЬ, а не считать ноль
// текущей сессией: `DELETE … WHERE id<>0` снёс бы ВСЕ сессии пользователя —
// включая ту, из которой нажали кнопку. Ноль приезжает штатным путём: пара
// юзер+устройство попадает в контекст пред-инжектом канального RPC и из кэша
// сессий, где незаполненное устройство выглядит как (0, true).
func TestSessions_RevokeOthersRefusesWithoutDeviceID(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, userID := signUp(t, h, pool, "+79990000016")
	tokenB, _ := signUp(t, h, pool, "+79990000016")

	req := httptest.NewRequest(http.MethodDelete, "/sessions/others", nil)
	req = req.WithContext(WithUser(req.Context(), domain.UserRecord{ID: userID}, 0))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("отзыв прочих без id устройства = %d %s; ожидался 401", rec.Code, rec.Body.String())
	}
	// Обе сессии живы: ни своя, ни чужая не снесены.
	for _, tok := range []string{tokenA, tokenB} {
		if rec := authedReq(t, h, http.MethodGet, "/me", tok, nil); rec.Code != http.StatusOK {
			t.Fatalf("сессия снесена отказавшей ручкой: %d", rec.Code)
		}
	}
}

// Свою сессию по пути отзыва не завершить и УГАДАННЫМ настоящим id. Иначе
// выходит «половинный логаут»: сессия умирает на сервере, а вкладка держит
// мёртвый токен до ближайшего 401. У оригинала такой возможности нет по
// построению — адреса у текущей авторизации не существует.
func TestSessions_RevokeRefusesOwnDeviceByRealID(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000017")
	tokenB, _ := signUp(t, h, pool, "+79990000017")

	// Со стороны B своя сессия — та, которую A видит чужой строкой с настоящим id.
	rec := authedReq(t, h, http.MethodGet, "/sessions", tokenA, nil)
	var listed sessionList
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	var otherID int64
	for _, a := range listed.Authorizations {
		if !a.PFlags["current"] {
			otherID = a.Hash
		}
	}
	if otherID == 0 {
		t.Fatal("чужая сессия не найдена")
	}

	rec = authedReq(t, h, http.MethodDelete, "/sessions/"+itoa(otherID), tokenB, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("отзыв СВОЕЙ сессии по настоящему id = %d %s; ожидался 400", rec.Code, rec.Body.String())
	}
	if rec := authedReq(t, h, http.MethodGet, "/me", tokenB, nil); rec.Code != http.StatusOK {
		t.Fatalf("своя сессия всё-таки умерла: %d", rec.Code)
	}
}

// Версия сборки не замораживается на входе: клиент обновляется сам, и строка
// устройства обязана показывать то, чем пользуются СЕЙЧАС. У оригинала клиент
// называет себя в преамбуле каждого соединения; у нас — заголовком каждого
// запроса, а строку освежает разрешение токена (на промахе кэша сессий).
func TestSessions_AppVersionFollowsClientUpdates(t *testing.T) {
	h, _ := newMessagingRouter(t)
	token, _ := loginViaHTTPAs(t, h, "+79990000018", map[string]string{"X-App-Version": "0.1.0 (7)"})

	appVersion := func() string {
		req := httptest.NewRequest(http.MethodGet, "/sessions", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-App-Version", "0.2.0 (9)")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var listed sessionList
		_ = json.Unmarshal(rec.Body.Bytes(), &listed)
		if len(listed.Authorizations) != 1 {
			t.Fatalf("ожидалась одна сессия: %s", rec.Body.String())
		}
		return listed.Authorizations[0].AppVersion
	}

	// Первый запрос уже освежил строку, но ЧИТАЛ он её до обновления — поэтому
	// смотрим на второй.
	appVersion()
	if got := appVersion(); got != "0.2.0 (9)" {
		t.Errorf("app_version = %q; обновлённый клиент обязан обновить строку сессии", got)
	}
}
