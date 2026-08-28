package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

// reqJSONAuth issues an authenticated request with an optional JSON body.
func reqJSONAuth(t *testing.T, h http.Handler, method, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	var r *bytes.Reader
	if body != nil {
		buf, _ := json.Marshal(body)
		r = bytes.NewReader(buf)
	} else {
		r = bytes.NewReader(nil)
	}
	req := httptest.NewRequestWithContext(context.Background(), method, path, r)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// signInToken регистрирует номер и возвращает bearer-токен + id пользователя.
func signInToken(t *testing.T, h http.Handler, phone string) (string, int64) {
	t.Helper()
	return loginViaHTTP(t, h, phone)
}

func TestProfileEndpoints_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	h := NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	token, _ := signInToken(t, h, "+79990000001")

	// PATCH /me — set names, bio, birthday. phone_visibility здесь больше нет:
	// видимость номера это правило приватности (/me/privacy/phone_number).
	rec := reqJSONAuth(t, h, http.MethodPatch, "/me", map[string]any{
		"first_name": "Denis",
		"last_name":  "M",
		"bio":        "designer",
		"birthday":   map[string]any{"day": 15, "month": 3, "year": 2000},
	}, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /me: %d %s", rec.Code, rec.Body.String())
	}
	// Своя витрина — ТА ЖЕ пара конструкторов, что и чужая (users.userFull):
	// краткая карточка `user` с именем, полная `userFull` с bio и днём рождения.
	me := decodeMe(t, rec)
	if me.Underscore != "users.userFull" {
		t.Fatalf("GET /me отдал не users.userFull: %s", rec.Body.String())
	}
	if len(me.Users) != 1 || me.Users[0].FirstName != "Denis" || me.Users[0].LastName != "M" {
		t.Fatalf("краткая карточка: %s", rec.Body.String())
	}
	if me.FullUser.Underscore != "userFull" || me.FullUser.About != "designer" {
		t.Fatalf("полная карточка: %s", rec.Body.String())
	}
	b := me.FullUser.Birthday
	if b == nil || b.Underscore != "birthday" || b.Day != 15 || b.Month != 3 || b.Year != 2000 {
		t.Fatalf("день рождения: %s", rec.Body.String())
	}
	// Имя на проводе собирается из first_name/last_name — денормализованного
	// display_name нет вовсе.
	if bytes.Contains(rec.Body.Bytes(), []byte(`"display_name"`)) {
		t.Fatalf("display_name уехал на провод: %s", rec.Body.String())
	}

	// GET /me reflects the update (fresh from DB).
	rec = reqJSONAuth(t, h, http.MethodGet, "/me", nil, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"first_name":"Denis"`)) {
		t.Fatalf("GET /me: %d %s", rec.Code, rec.Body.String())
	}

	// Username availability + set.
	// Ответ проверки имени — конструктор Bool, как у account.checkUsername.
	rec = reqJSONAuth(t, h, http.MethodGet, "/username/available?u=Denis_M", nil, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"boolTrue"`)) {
		t.Fatalf("check username: %d %s", rec.Code, rec.Body.String())
	}
	rec = reqJSONAuth(t, h, http.MethodPut, "/me/username", map[string]string{"username": "Denis_M"}, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"username":"denis_m"`)) {
		t.Fatalf("set username: %d %s", rec.Code, rec.Body.String())
	}

	// A second user can't take the same username (case-insensitive) → 409.
	token2, _ := signInToken(t, h, "+79990000002")
	rec = reqJSONAuth(t, h, http.MethodGet, "/username/available?u=DENIS_M", nil, token2)
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"boolFalse"`)) {
		t.Fatalf("expected taken, got %s", rec.Body.String())
	}
	rec = reqJSONAuth(t, h, http.MethodPut, "/me/username", map[string]string{"username": "DENIS_M"}, token2)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d %s", rec.Code, rec.Body.String())
	}

	// Аватарка едет ОДНИМ конструктором userProfilePhoto с готовым photo_id —
	// тем числом, которого ждёт клиентский downloadMediaURL. Строки
	// «/media/N/content» на проводе больше нет. Превьюер не подключён (медиа в
	// этих тестах не поднимается) — stripped_thumb просто отсутствует.
	rec = reqJSONAuth(t, h, http.MethodPut, "/me/avatar", map[string]any{"media_id": 42}, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"_":"userProfilePhoto","photo_id":42`)) {
		t.Fatalf("set avatar: %d %s", rec.Code, rec.Body.String())
	}
	if bytes.Contains(rec.Body.Bytes(), []byte(`/media/42/content`)) {
		t.Fatalf("content-путь аватарки уехал на провод: %s", rec.Body.String())
	}
	if bytes.Contains(rec.Body.Bytes(), []byte(`"stripped_thumb"`)) {
		t.Fatalf("stripped_thumb без превьюера: %s", rec.Body.String())
	}
}

// meResponse — форма ответа /me: конструктор users.userFull В КОРНЕ, а
// can_message — наш клиентский параметр ВНУТРИ него.
type meResponse struct {
	Underscore string `json:"_"`
	CanMessage bool   `json:"can_message"`
	FullUser   struct {
		Underscore string `json:"_"`
		About      string `json:"about"`
		Birthday   *struct {
			Underscore string `json:"_"`
			Day        int    `json:"day"`
			Month      int    `json:"month"`
			Year       int    `json:"year"`
		} `json:"birthday"`
	} `json:"full_user"`
	Users []struct {
		Underscore string `json:"_"`
		FirstName  string `json:"first_name"`
		LastName   string `json:"last_name"`
	} `json:"users"`
}

func decodeMe(t *testing.T, rec *httptest.ResponseRecorder) meResponse {
	t.Helper()
	var out meResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("разбор /me: %v (%s)", err, rec.Body.String())
	}
	return out
}

// httpFakePreviewer — AvatarPreviewer для HTTP-теста: фиксированное stripped-превью.
type httpFakePreviewer struct{ preview []byte }

func (p httpFakePreviewer) StrippedPreview(context.Context, int64) ([]byte, error) {
	return p.preview, nil
}

// С подключённым превьюером установка аватарки кладёт stripped-превью в DTO
// (base64 в JSON) — и в ответ PUT /me/avatar, и в последующий GET /me.
func TestSetAvatarPreview_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	authUC := newAuthUC(pool)
	authUC.SetAvatarPreviewer(httpFakePreviewer{preview: []byte{0xff, 0xd8, 0xff, 0xe0, 5}})
	h := NewRouter(authUC, newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	token, _ := signInToken(t, h, "+79990000021")

	const wantB64 = `"stripped_thumb":"/9j/4AU="` // base64([ff d8 ff e0 05])
	rec := reqJSONAuth(t, h, http.MethodPut, "/me/avatar", map[string]any{"media_id": 7}, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(wantB64)) {
		t.Fatalf("set avatar with preview: %d %s", rec.Code, rec.Body.String())
	}
	rec = reqJSONAuth(t, h, http.MethodGet, "/me", nil, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(wantB64)) {
		t.Fatalf("GET /me preview: %d %s", rec.Code, rec.Body.String())
	}
}
