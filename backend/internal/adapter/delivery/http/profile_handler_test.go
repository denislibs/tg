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

// signInToken signs a phone in and returns its bearer token + user id.
func signInToken(t *testing.T, h http.Handler, phone string) (string, int64) {
	t.Helper()
	if rec := postJSON(t, h, "/auth/request_code", map[string]string{"phone": phone}); rec.Code != http.StatusOK {
		t.Fatalf("request_code: %d %s", rec.Code, rec.Body.String())
	}
	rec := postJSON(t, h, "/auth/sign_in", map[string]string{
		"phone": phone, "code": "12345", "device": "web", "platform": "browser",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("sign_in: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Token string `json:"token"`
		User  struct {
			ID int64 `json:"id"`
		} `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return out.Token, out.User.ID
}

func TestProfileEndpoints_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	h := NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil)
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

	// Avatar set stores the media content path.
	rec = reqJSONAuth(t, h, http.MethodPut, "/me/avatar", map[string]any{"media_id": 42}, token)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"avatar_url":"/media/42/content"`)) {
		t.Fatalf("set avatar: %d %s", rec.Code, rec.Body.String())
	}
}
