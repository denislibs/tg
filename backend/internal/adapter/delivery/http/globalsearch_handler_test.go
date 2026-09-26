package http

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
	"time"
)

// searchSlice — messages.messagesSlice глазами клиента. NextRate — указатель:
// отсутствие ключа и ноль для клиента разные вещи (tweb appSearchSuper.ts:2312).
type searchSlice struct {
	Count    int  `json:"count"`
	NextRate *int `json:"next_rate"`
	Messages []struct {
		ID int64 `json:"id"`
	} `json:"messages"`
}

func getSlice(t *testing.T, h http.Handler, token, path string) searchSlice {
	t.Helper()
	rec := authedReq(t, h, http.MethodGet, path, token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s: %d %s", path, rec.Code, rec.Body.String())
	}
	var s searchSlice
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	return s
}

func sliceIDs(s searchSlice) []int64 {
	out := make([]int64, len(s.Messages))
	for i, m := range s.Messages {
		out[i] = m.ID
	}
	return out
}

// Пин на ГРАНИЦУ глобального поиска: имя параметра `offset_rate` и ключ
// `next_rate` в ответе — ровно те, на которых поедет порт AppSearchSuper
// (tweb appMessagesManager.ts:9995 — `offset_rate: nextRate`, :9432 —
// `nextRate: slice.next_rate`). Прежний `offset` ручка больше не слушает.
func TestGlobalSearchHTTP_NextRate(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990004501")
	_, idB := signUp(t, h, pool, "+79990004502")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	peer := itoa(createdPeerFrom(t, rec))
	send := func(text, cid string) {
		t.Helper()
		r := authedReq(t, h, http.MethodPost, "/chats/"+peer+"/messages", tokenA,
			map[string]any{"text": text, "client_msg_id": cid})
		if r.Code != http.StatusOK {
			t.Fatalf("send %s: %d %s", cid, r.Code, r.Body.String())
		}
	}
	for _, c := range []string{"k1", "k2", "k3"} {
		send("рыжий кот "+c, c)
	}
	q := "/search/messages?q=" + url.QueryEscape("кот") + "&limit=2"

	page1 := getSlice(t, h, tokenA, q)
	if page1.Count != 3 || len(page1.Messages) != 2 || page1.NextRate == nil {
		t.Fatalf("page1 = %+v: want 2 из 3 и next_rate", page1)
	}
	// Старый параметр смещения ничего не сдвигает.
	if ignored := getSlice(t, h, tokenA, q+"&offset=1"); !sameIDs(sliceIDs(ignored), sliceIDs(page1)...) {
		t.Fatalf("offset=1 сдвинул выдачу: %v, want %v", sliceIDs(ignored), sliceIDs(page1))
	}

	send("ещё кот", "k4") // живой апдейт поверх показанного окна

	page2 := getSlice(t, h, tokenA, q+"&offset_rate="+itoa(int64(*page1.NextRate)))
	if page2.Count != 4 || len(page2.Messages) != 1 || page2.NextRate != nil {
		t.Fatalf("page2 = %+v: want 1 сообщение без next_rate", page2)
	}
	if page2.Messages[0].ID >= page1.Messages[1].ID {
		t.Fatalf("page2 = %v не ниже page1 = %v (дубль от вставки сверху)", sliceIDs(page2), sliceIDs(page1))
	}
}

// Пин на ГРАНИЦУ ChatTypeMenu и чипов дат: имена `chat_type` (users/groups/
// channels) и `min_date`/`max_date` (unix-секунды) — те, на которых поедет
// шов менеджеров (задача 6). Неизвестный chat_type — 400, а не «всё».
func TestGlobalSearchHTTP_ChatTypeAndDates(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990004511")
	_, idB := signUp(t, h, pool, "+79990004512")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	peer := itoa(createdPeerFrom(t, rec))
	rec = authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{"title": "Коты", "is_public": false})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	channel := itoa(createdPeerID(t, rec))
	for path, text := range map[string]string{
		"/chats/" + peer + "/messages":       "кот в личке",
		"/channels/" + channel + "/messages": "кот в канале",
	} {
		if r := authedReq(t, h, http.MethodPost, path, tokenA, map[string]any{"text": text}); r.Code != http.StatusOK {
			t.Fatalf("send %s: %d %s", path, r.Code, r.Body.String())
		}
	}
	q := "/search/messages?q=" + url.QueryEscape("кот")

	if all := getSlice(t, h, tokenA, q); all.Count != 2 {
		t.Fatalf("без chat_type: count=%d, want 2", all.Count)
	}
	if users := getSlice(t, h, tokenA, q+"&chat_type=users"); users.Count != 1 {
		t.Fatalf("chat_type=users: count=%d, want 1", users.Count)
	}
	if chans := getSlice(t, h, tokenA, q+"&chat_type=channels"); chans.Count != 1 {
		t.Fatalf("chat_type=channels: count=%d, want 1", chans.Count)
	}
	if groups := getSlice(t, h, tokenA, q+"&chat_type=groups"); groups.Count != 0 {
		t.Fatalf("chat_type=groups: count=%d, want 0", groups.Count)
	}
	if r := authedReq(t, h, http.MethodGet, q+"&chat_type=bots", tokenA, nil); r.Code != http.StatusBadRequest {
		t.Fatalf("chat_type=bots: %d %s, want 400", r.Code, r.Body.String())
	}

	// Всё отправлено только что: вчерашние сутки пусты, сегодняшние — нет.
	now := time.Now().Unix()
	if past := getSlice(t, h, tokenA, q+"&max_date="+itoa(now-86400)); past.Count != 0 {
		t.Fatalf("max_date=вчера: count=%d, want 0", past.Count)
	}
	if future := getSlice(t, h, tokenA, q+"&min_date="+itoa(now+86400)); future.Count != 0 {
		t.Fatalf("min_date=завтра: count=%d, want 0", future.Count)
	}
	if today := getSlice(t, h, tokenA, q+"&min_date="+itoa(now-3600)+"&max_date="+itoa(now+3600)); today.Count != 2 {
		t.Fatalf("сегодня: count=%d, want 2", today.Count)
	}
}

func sameIDs(got []int64, want ...int64) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
