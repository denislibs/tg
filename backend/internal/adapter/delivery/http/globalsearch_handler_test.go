package http

import (
	"context"
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

// Пин на ГРАНИЦУ поиска в одном чате (чип пира → messages.search, tweb
// appMessagesManager.ts:9966-9982): `offset_id` — номер последнего
// отданного, `filter` — лексика вкладок класса, `min_date`/`max_date`.
// Прежний `offset` ручка больше не слушает.
func TestChatSearchHTTP_OffsetIDFilterDates(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990004521")
	_, idB := signUp(t, h, pool, "+79990004522")

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
	send("кот https://example.com/1", "c1")
	send("кот без ссылки", "c2")
	send("кот https://example.com/3", "c3")
	send("кот без ссылки", "c4")
	q := "/chats/" + peer + "/search?q=" + url.QueryEscape("кот") + "&limit=2"

	page1 := getSlice(t, h, tokenA, q)
	if page1.Count != 4 || !sameIDs(sliceIDs(page1), 4, 3) {
		t.Fatalf("page1 = %+v, want [4 3] из 4", page1)
	}
	if ignored := getSlice(t, h, tokenA, q+"&offset=2"); !sameIDs(sliceIDs(ignored), 4, 3) {
		t.Fatalf("offset=2 сдвинул выдачу: %v", sliceIDs(ignored))
	}
	send("ещё кот", "c5") // живой апдейт сверху
	if page2 := getSlice(t, h, tokenA, q+"&offset_id=3"); !sameIDs(sliceIDs(page2), 2, 1) {
		t.Fatalf("page2 = %v, want [2 1] (дубль от вставки сверху)", sliceIDs(page2))
	}
	if links := getSlice(t, h, tokenA, q+"&filter=links"); links.Count != 2 || !sameIDs(sliceIDs(links), 3, 1) {
		t.Fatalf("filter=links = %+v, want [3 1]", links)
	}
	now := time.Now().Unix()
	if past := getSlice(t, h, tokenA, q+"&max_date="+itoa(now-86400)); past.Count != 0 {
		t.Fatalf("max_date=вчера: count=%d, want 0", past.Count)
	}
	if today := getSlice(t, h, tokenA, q+"&min_date="+itoa(now-3600)+"&max_date="+itoa(now+3600)); today.Count != 5 {
		t.Fatalf("сегодня: count=%d, want 5", today.Count)
	}
}

// Пин на ГРАНИЦУ contacts.search: свой пир (подписанный канал, собеседник по
// личному чату) едет ссылкой в `my_results`, чужой — в `results` (tweb
// appSearchSuper.ts:1427-1428); тела — один раз в `chats`/`users`; `limit`
// режет выдачу (класс просит 20 и 200, :1977).
func TestPeerSearchHTTP_MyResultsAndLimit(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990004531")
	tokenB, _ := signUp(t, h, pool, "+79990004532")
	_, idC := signUp(t, h, pool, "+79990004533")
	for id, name := range map[int64]string{idA: "kot_a", idC: "kot_c"} {
		if _, err := pool.Exec(context.Background(), `UPDATE users SET username=$2 WHERE id=$1`, id, name); err != nil {
			t.Fatalf("username: %v", err)
		}
	}
	if r := authedReq(t, h, http.MethodPost, "/chats", tokenB, map[string]int64{"user_id": idA}); r.Code != http.StatusOK {
		t.Fatalf("private chat: %d %s", r.Code, r.Body.String())
	}
	for _, u := range []string{"kot_own", "kot_foreign"} {
		if r := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{"title": u, "username": u, "is_public": true}); r.Code != http.StatusOK {
			t.Fatalf("channel %s: %d %s", u, r.Code, r.Body.String())
		}
	}
	if r := authedReq(t, h, http.MethodPost, "/channels/join", tokenB, map[string]any{"username": "kot_own"}); r.Code != http.StatusOK {
		t.Fatalf("join: %d %s", r.Code, r.Body.String())
	}

	type peer struct {
		T         string `json:"_"`
		UserID    int64  `json:"user_id"`
		ChannelID int64  `json:"channel_id"`
	}
	type found struct {
		My      []peer `json:"my_results"`
		Results []peer `json:"results"`
		Chats   []struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
		} `json:"chats"`
		Users []struct {
			ID int64 `json:"id"`
		} `json:"users"`
	}
	search := func(query string) found {
		t.Helper()
		rec := authedReq(t, h, http.MethodGet, "/search?"+query, tokenB, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("search %s: %d %s", query, rec.Code, rec.Body.String())
		}
		var f found
		if err := json.Unmarshal(rec.Body.Bytes(), &f); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return f
	}
	chanName := func(f found, id int64) string {
		for _, c := range f.Chats {
			if c.ID == id {
				return c.Username
			}
		}
		return ""
	}

	f := search("q=kot")
	var myUsers, myChans, resUsers, resChans []string
	for _, p := range f.My {
		if p.T == "peerUser" {
			myUsers = append(myUsers, itoa(p.UserID))
		} else {
			myChans = append(myChans, chanName(f, p.ChannelID))
		}
	}
	for _, p := range f.Results {
		if p.T == "peerUser" {
			resUsers = append(resUsers, itoa(p.UserID))
		} else {
			resChans = append(resChans, chanName(f, p.ChannelID))
		}
	}
	if len(myUsers) != 1 || myUsers[0] != itoa(idA) || len(resUsers) != 1 || resUsers[0] != itoa(idC) {
		t.Fatalf("люди: my=%v results=%v, want my=[%d] results=[%d]", myUsers, resUsers, idA, idC)
	}
	if len(myChans) != 1 || myChans[0] != "kot_own" || len(resChans) != 1 || resChans[0] != "kot_foreign" {
		t.Fatalf("каналы: my=%v results=%v, want my=[kot_own] results=[kot_foreign]", myChans, resChans)
	}
	if len(f.Chats) != 2 || len(f.Users) != 2 {
		t.Fatalf("тела: chats=%d users=%d, want по 2 (каждое один раз)", len(f.Chats), len(f.Users))
	}

	if lim := search("q=kot&limit=1"); len(lim.Chats) != 1 || len(lim.Users) != 1 {
		t.Fatalf("limit=1: chats=%d users=%d, want по 1", len(lim.Chats), len(lim.Users))
	}
}
