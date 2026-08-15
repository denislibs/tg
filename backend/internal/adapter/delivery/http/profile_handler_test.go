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

	// PATCH /me — set names, bio, birthday, phone visibility.
	rec := reqJSONAuth(t, h, http.MethodPatch, "/me", map[string]any{
		"first_name":       "Denis",
		"last_name":        "M",
		"bio":              "designer",
		"birthday":         map[string]any{"day": 15, "month": 3, "year": 2000},
		"phone_visibility": "nobody",
	}, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /me: %d %s", rec.Code, rec.Body.String())
	}
	var me struct {
		DisplayName     string `json:"display_name"`
		Bio             string `json:"bio"`
		PhoneVisibility string `json:"phone_visibility"`
		Birthday        *struct {
			Day, Month int
			Year       *int
		} `json:"birthday"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &me)
	if me.DisplayName != "Denis M" || me.Bio != "designer" || me.PhoneVisibility != "nobody" {
		t.Fatalf("unexpected profile: %+v", me)
	}
	if me.Birthday == nil || me.Birthday.Day != 15 || me.Birthday.Month != 3 || me.Birthday.Year == nil || *me.Birthday.Year != 2000 {
		t.Fatalf("unexpected birthday: %+v", me.Birthday)
	}

	// GET /me reflects the update (fresh from DB).
	rec = reqJSONAuth(t, h, http.MethodGet, "/me", nil, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"display_name":"Denis M"`)) {
		t.Fatalf("GET /me: %d %s", rec.Code, rec.Body.String())
	}

	// Username availability + set.
	rec = reqJSONAuth(t, h, http.MethodGet, "/username/available?u=Denis_M", nil, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"available":true`)) {
		t.Fatalf("check username: %d %s", rec.Code, rec.Body.String())
	}
	rec = reqJSONAuth(t, h, http.MethodPut, "/me/username", map[string]string{"username": "Denis_M"}, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"username":"denis_m"`)) {
		t.Fatalf("set username: %d %s", rec.Code, rec.Body.String())
	}

	// A second user can't take the same username (case-insensitive) → 409.
	token2, _ := signInToken(t, h, "+79990000002")
	rec = reqJSONAuth(t, h, http.MethodGet, "/username/available?u=DENIS_M", nil, token2)
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"available":false`)) {
		t.Fatalf("expected taken, got %s", rec.Body.String())
	}
	rec = reqJSONAuth(t, h, http.MethodPut, "/me/username", map[string]string{"username": "DENIS_M"}, token2)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d %s", rec.Code, rec.Body.String())
	}

	// Avatar set stores the media content path. Превьюер не подключён (медиа в
	// этих тестах не поднимается) — avatar_preview null, ответ не ломается (то же
	// поведение у старых аватарок без превью).
	rec = reqJSONAuth(t, h, http.MethodPut, "/me/avatar", map[string]any{"media_id": 42}, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"avatar_url":"/media/42/content"`)) {
		t.Fatalf("set avatar: %d %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"avatar_preview":null`)) {
		t.Fatalf("avatar_preview absent/non-null without previewer: %s", rec.Body.String())
	}
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

	const wantB64 = `"avatar_preview":"/9j/4AU="` // base64([ff d8 ff e0 05])
	rec := reqJSONAuth(t, h, http.MethodPut, "/me/avatar", map[string]any{"media_id": 7}, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(wantB64)) {
		t.Fatalf("set avatar with preview: %d %s", rec.Code, rec.Body.String())
	}
	rec = reqJSONAuth(t, h, http.MethodGet, "/me", nil, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(wantB64)) {
		t.Fatalf("GET /me preview: %d %s", rec.Code, rec.Body.String())
	}
}
