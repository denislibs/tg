package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

// GET /chats/{peerID}/messages?ids= — разрешение ССЫЛОК и единственный
// производитель конструктора messageEmpty.
//
// Пока reply_to, корень треда и цель закрепления ехали СНИМКАМИ, разрешать их
// было незачем. Теперь это ссылки, и на ссылку в снесённое сообщение сервер
// обязан отвечать ДЫРОЙ: без неё клиент не отличает «ещё не загружено» от
// «больше не существует» и ждёт вечно.
func TestMessagesByIDs_ProducesHoleForDeleted(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990009001")
	_, idB := signUp(t, h, pool, "+79990009002")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.PeerID)

	send := func(text string) int64 {
		t.Helper()
		rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenA,
			map[string]any{"text": text, "client_msg_id": text})
		if rec.Code != http.StatusOK {
			t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
		}
		var m struct {
			ID int64 `json:"id"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &m)
		return m.ID
	}
	alive := send("живое")
	gone := send("снесённое")

	rec = authedReq(t, h, http.MethodDelete, "/chats/"+cid+"/messages/"+itoa(gone)+"?revoke=true", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}

	// Порядок ответа повторяет порядок запроса — клиент сопоставляет ссылку с
	// объектом по позиции и по id, а не догадывается по длине вектора.
	rec = authedReq(t, h, http.MethodGet,
		"/chats/"+cid+"/messages?ids="+itoa(gone)+","+itoa(alive)+",999999", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("messages by ids: %d %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Messages []struct {
			Underscore string `json:"_"`
			ID         int64  `json:"id"`
			Message    string `json:"message"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if len(got.Messages) != 3 {
		t.Fatalf("сообщений = %d, ждали 3 (по одному на каждый запрошенный номер): %s",
			len(got.Messages), rec.Body.String())
	}
	if got.Messages[0].Underscore != "messageEmpty" || got.Messages[0].ID != gone {
		t.Errorf("на снесённое сообщение уехало %+v, ждали дыру с номером %d", got.Messages[0], gone)
	}
	if got.Messages[1].Underscore != "message" || got.Messages[1].Message != "живое" {
		t.Errorf("живое сообщение = %+v", got.Messages[1])
	}
	if got.Messages[2].Underscore != "messageEmpty" || got.Messages[2].ID != 999999 {
		t.Errorf("на несуществующий номер уехало %+v, ждали дыру", got.Messages[2])
	}
}
