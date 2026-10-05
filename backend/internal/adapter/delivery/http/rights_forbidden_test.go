package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

// Отказ в праве — 403, а не 500 (A5-26/A5-27, A5-21): подписчик канала жмёт
// «Закрепить» и меняет тему — сервер отвечает «нельзя», а не «упал».
func TestRightsForbidden_PinAndTheme_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990001390")
	tokenB, _ := signUp(t, h, pool, "+79990001391")

	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Права", "username": "prava_0137", "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	cid := itoa(createdPeerID(t, rec))
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{"text": "пост"})
	if rec.Code != http.StatusOK {
		t.Fatalf("post: %d %s", rec.Code, rec.Body.String())
	}
	var post struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post)

	if rec := authedReq(t, h, http.MethodPost, "/channels/join", tokenB, map[string]any{"username": "prava_0137"}); rec.Code != http.StatusOK {
		t.Fatalf("join: %d %s", rec.Code, rec.Body.String())
	}
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages/"+itoa(post.ID)+"/pin", tokenB, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("закреп подписчиком: %d %s, ждали 403", rec.Code, rec.Body.String())
	}
	if rec := authedReq(t, h, http.MethodPut, "/chats/"+cid+"/theme", tokenB, map[string]any{"theme_id": "🐥"}); rec.Code != http.StatusForbidden {
		t.Fatalf("тема подписчиком: %d %s, ждали 403", rec.Code, rec.Body.String())
	}
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages/"+itoa(post.ID)+"/pin", tokenA, nil); rec.Code != http.StatusOK {
		t.Fatalf("закреп владельцем: %d %s", rec.Code, rec.Body.String())
	}
}
