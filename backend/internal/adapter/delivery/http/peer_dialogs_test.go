package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

// GET /peer_dialogs — порт messages.getPeerDialogs (tweb
// appMessagesManager.reloadConversation :6247-6366). Клиент перечитывает строку
// диалога, когда удалено её ПОСЛЕДНЕЕ сообщение, а нового низа истории у него
// нет (onUpdateDeleteMessages :11577-11593): сервер обязан отдать новый
// top_message и сам объект сообщения вектором messages, иначе превью в списке
// осталось бы на удалённом.
func TestPeerDialogs_TopMessageAfterDelete_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990000250")
	tokenB, idB := signUp(t, h, pool, "+79990000251")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}
	peerForA := itoa(createdPeerFrom(t, rec))
	send := func(text string) int64 {
		t.Helper()
		rec := authedReq(t, h, http.MethodPost, "/chats/"+peerForA+"/messages", tokenA, map[string]any{"text": text})
		if rec.Code != http.StatusOK {
			t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
		}
		var sent struct {
			ID int64 `json:"id"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &sent)
		return sent.ID
	}
	first := send("один")
	second := send("два")

	del := func(id int64) {
		t.Helper()
		rec := authedReq(t, h, http.MethodDelete, "/chats/"+peerForA+"/messages/"+itoa(id)+"?revoke=true", tokenA, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
		}
	}
	// Собеседник спрашивает свою строку: пир для него — автор.
	peerDialogs := func() dialogsContainer {
		t.Helper()
		rec := authedReq(t, h, http.MethodGet, "/peer_dialogs?peers="+itoa(idA), tokenB, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /peer_dialogs: %d %s", rec.Code, rec.Body.String())
		}
		var out dialogsContainer
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return out
	}

	got := peerDialogs()
	if got.Underscore != "messages.peerDialogs" {
		t.Fatalf("конструктор = %q; want messages.peerDialogs", got.Underscore)
	}
	if len(got.Dialogs) != 1 || got.Dialogs[0].TopMessage != second {
		t.Fatalf("до удаления: dialogs = %+v; want одну строку с top_message %d", got.Dialogs, second)
	}

	// Удалили последнее — top_message сползает на предыдущее, и оно едет объектом.
	del(second)
	got = peerDialogs()
	if len(got.Dialogs) != 1 || got.Dialogs[0].TopMessage != first {
		t.Fatalf("после удаления: dialogs = %+v; want top_message %d", got.Dialogs, first)
	}
	if len(got.Messages) != 1 || int64(got.Messages[0]["id"].(float64)) != first || got.Messages[0]["message"] != "один" {
		t.Fatalf("messages = %v; want «один» объектом", got.Messages)
	}
	// Автор превью — пиром в users, как у /chats.
	if len(got.Users) == 0 {
		t.Fatalf("users пуст: %v", got.Users)
	}

	// Удалили всё — строка остаётся, но без последнего сообщения.
	del(first)
	got = peerDialogs()
	if len(got.Dialogs) != 1 || got.Dialogs[0].TopMessage != 0 {
		t.Fatalf("после удаления всего: dialogs = %+v; want top_message 0", got.Dialogs)
	}
	if got.Messages == nil || len(got.Messages) != 0 {
		t.Fatalf("messages = %v; want []", got.Messages)
	}
}

// Чужой / неизвестный пир — не ошибка: строки просто нет (у tweb такие пиры
// резолвятся `fullfillLeft` пустым значением, :6283-6293).
func TestPeerDialogs_UnknownPeerIsAbsent_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000252")
	_, idB := signUp(t, h, pool, "+79990000253")
	_, idC := signUp(t, h, pool, "+79990000254")
	for _, peer := range []int64{idB, idC} {
		if rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": peer}); rec.Code != http.StatusOK {
			t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
		}
	}
	get := func(peers string) dialogsContainer {
		t.Helper()
		rec := authedReq(t, h, http.MethodGet, "/peer_dialogs?peers="+peers, tokenA, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /peer_dialogs: %d %s", rec.Code, rec.Body.String())
		}
		var out dialogsContainer
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return out
	}

	// Только запрошенные строки: второй диалог зрителя в ответ не попадает.
	if got := get(itoa(idB)).peerIDs(); len(got) != 1 || got[0] != idB {
		t.Fatalf("peers=%d → %v; want только его строку", idB, got)
	}
	out := get("-987654")
	if out.Underscore != "messages.peerDialogs" || out.Dialogs == nil || len(out.Dialogs) != 0 {
		t.Fatalf("ответ = %+v; want пустой messages.peerDialogs", out)
	}

	rec := authedReq(t, h, http.MethodGet, "/peer_dialogs?peers=abc", tokenA, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("кривой ключ: %d; want 400", rec.Code)
	}
}

// `state` ответа — `updates.state` ТОГО ЖЕ ящика, что отдаёт /updates/state:
// tweb reloadConversation сверяет state.pts с локальным курсором и при
// расхождении повторяет запрос через 500 мс (appMessagesManager.ts:6313-6319).
// Без state на клиенте нечего сравнивать.
func TestPeerDialogs_StateMatchesUpdatesState_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990000255")
	tokenB, idB := signUp(t, h, pool, "+79990000256")
	rec := authedReq(t, h, http.MethodPost, "/chats", tokenB, map[string]int64{"user_id": idA})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}
	// Сообщение от B пишет в журнал A строку (pts > 0) и непрочитанное (unread > 0):
	// без этого и подставленный нулевой state совпал бы с настоящим.
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+itoa(createdPeerFrom(t, rec))+"/messages", tokenB, map[string]any{"text": "привет"}); rec.Code != http.StatusOK {
		t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
	}

	type stateBody struct {
		Underscore  string `json:"_"`
		Pts         int64  `json:"pts"`
		Date        int64  `json:"date"`
		UnreadCount int    `json:"unread_count"`
	}
	rec = authedReq(t, h, http.MethodGet, "/updates/state", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /updates/state: %d %s", rec.Code, rec.Body.String())
	}
	var want stateBody
	if err := json.Unmarshal(rec.Body.Bytes(), &want); err != nil {
		t.Fatalf("decode state: %v", err)
	}

	if want.Pts == 0 || want.UnreadCount == 0 {
		t.Fatalf("/updates/state = %+v; ждали pts > 0 и unread_count > 0 после сообщения от собеседника", want)
	}

	rec = authedReq(t, h, http.MethodGet, "/peer_dialogs?peers="+itoa(idB), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /peer_dialogs: %d %s", rec.Code, rec.Body.String())
	}
	var got struct {
		State *stateBody `json:"state"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.State == nil || got.State.Underscore != "updates.state" {
		t.Fatalf("state = %+v; want updates.state", got.State)
	}
	if got.State.Pts != want.Pts || got.State.UnreadCount != want.UnreadCount {
		t.Fatalf("state = %+v; want pts %d, unread_count %d (как /updates/state)", got.State, want.Pts, want.UnreadCount)
	}

	// Пустой запрос (ни одного известного пира) — state всё равно есть.
	rec = authedReq(t, h, http.MethodGet, "/peer_dialogs?peers=-987654", tokenA, nil)
	got.State = nil
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got.State == nil || got.State.Underscore != "updates.state" {
		t.Fatalf("пустой ответ: state = %+v; want updates.state", got.State)
	}
}
