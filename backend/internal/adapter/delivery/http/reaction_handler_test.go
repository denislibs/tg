package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Ф7-И1 (MC-08): реакция, которую чат не принимает, — 400 REACTION_INVALID.
// По этому имени tweb откатывает локальную реакцию (appReactionsManager.ts:977-989);
// раньше «реакции выключены» уходили 403/500, и откат срабатывал по другой ветке.
func TestReact_Invalid_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990170021")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Team"})
	gid := itoa(createdPeerID(t, rec))
	rec = authedReq(t, h, http.MethodPost, "/chats/"+gid+"/messages", tokenA, map[string]any{"text": "hi"})
	var msg struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &msg)
	path := "/chats/" + gid + "/messages/" + itoa(msg.ID) + "/reactions"

	wantInvalid := func(what string, rec *httptest.ResponseRecorder) {
		t.Helper()
		var e struct {
			Text string `json:"text"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &e)
		if rec.Code != http.StatusBadRequest || e.Text != "REACTION_INVALID" {
			t.Fatalf("%s: %d %s; want 400 REACTION_INVALID", what, rec.Code, rec.Body.String())
		}
	}

	// Реакции выключены (mode none) — любая реакция отклоняется.
	if rec = authedReq(t, h, http.MethodPut, "/chats/"+gid+"/reactions", tokenA, map[string]any{"mode": "none"}); rec.Code != http.StatusOK {
		t.Fatalf("mode none: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, path, tokenA, map[string]string{"emoji": "🔥"})
	wantInvalid("mode none", rec)

	// Только из списка: эмодзи не из списка отклоняется, из списка проходит.
	if rec = authedReq(t, h, http.MethodPut, "/chats/"+gid+"/reactions", tokenA, map[string]any{"mode": "some", "emojis": []string{"👍"}}); rec.Code != http.StatusOK {
		t.Fatalf("mode some: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, path, tokenA, map[string]string{"emoji": "🔥"})
	wantInvalid("не из списка", rec)
	if rec = authedReq(t, h, http.MethodPost, path, tokenA, map[string]string{"emoji": "👍"}); rec.Code != http.StatusOK {
		t.Fatalf("из списка: %d %s", rec.Code, rec.Body.String())
	}
}
