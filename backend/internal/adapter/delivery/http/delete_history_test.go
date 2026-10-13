package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

// F6: DELETE /chats/{p}/history — одна ручка messages.deleteHistory
// (just_clear / revoke), ответ — messages.affectedHistory. POST /clear снят.
func TestDeleteHistory_AffectedHistory_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000260")
	_, idB := signUp(t, h, pool, "+79990000261")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}
	peer := itoa(createdPeerFrom(t, rec))
	for _, text := range []string{"раз", "два"} {
		if rec := authedReq(t, h, http.MethodPost, "/chats/"+peer+"/messages", tokenA, map[string]any{"text": text}); rec.Code != http.StatusOK {
			t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
		}
	}

	type affected struct {
		Underscore string `json:"_"`
		Pts        int64  `json:"pts"`
		PtsCount   int    `json:"pts_count"`
		Offset     *int   `json:"offset"`
	}
	call := func(query string) affected {
		t.Helper()
		rec := authedReq(t, h, http.MethodDelete, "/chats/"+peer+"/history"+query, tokenA, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("DELETE history%s: %d %s", query, rec.Code, rec.Body.String())
		}
		var out affected
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return out
	}

	got := call("?just_clear=1")
	if got.Underscore != "messages.affectedHistory" || got.Pts <= 0 || got.PtsCount <= 0 || got.Offset == nil || *got.Offset != 0 {
		t.Fatalf("just_clear: ответ %+v", got)
	}
	// Очистка не прячет строку диалога, удаление — прячет.
	if rec := authedReq(t, h, http.MethodGet, "/chats", tokenA, nil); rec.Code != http.StatusOK {
		t.Fatalf("chats: %d", rec.Code)
	}
	del := call("?revoke=1")
	if del.Underscore != "messages.affectedHistory" || del.Pts <= got.Pts || del.PtsCount <= 0 {
		t.Fatalf("revoke: ответ %+v после just_clear %+v", del, got)
	}

	if rec := authedReq(t, h, http.MethodPost, "/chats/"+peer+"/clear", tokenA, nil); rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /clear снят, а ответил %d", rec.Code)
	}
}
