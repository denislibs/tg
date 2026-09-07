package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

// Пин на ГРАНИЦУ: имена параметров ручек шаред-медиа и форму ответа счётчиков —
// именно на них поедет порт AppSearchSuper. Опечатка в `offset_id` или в
// `filters` внутри слоёв не видна: юзкейс получит нули и молча отдаст первую
// страницу заново.
func TestSharedMediaHTTP_OffsetIDAndCounters(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990004401")
	_, idB := signUp(t, h, pool, "+79990004402")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}
	peer := itoa(createdPeerFrom(t, rec))

	send := func(text, cid string) int64 {
		t.Helper()
		r := authedReq(t, h, http.MethodPost, "/chats/"+peer+"/messages", tokenA,
			map[string]any{"text": text, "client_msg_id": cid})
		if r.Code != http.StatusOK {
			t.Fatalf("send %s: %d %s", cid, r.Code, r.Body.String())
		}
		var m struct {
			ID int64 `json:"id"`
		}
		if err := json.Unmarshal(r.Body.Bytes(), &m); err != nil {
			t.Fatalf("decode send: %v", err)
		}
		return m.ID
	}
	// Вкладка «Ссылки»: сообщение со ссылкой в тексте.
	var links []int64
	for _, c := range []string{"l1", "l2", "l3", "l4", "l5"} {
		links = append(links, send("см https://example.com/"+c, c))
	}

	type slice struct {
		Count    int `json:"count"`
		Messages []struct {
			ID int64 `json:"id"`
		} `json:"messages"`
	}
	getMedia := func(query string) slice {
		t.Helper()
		r := authedReq(t, h, http.MethodGet, "/chats/"+peer+"/media?filter=links&"+query, tokenA, nil)
		if r.Code != http.StatusOK {
			t.Fatalf("media %s: %d %s", query, r.Code, r.Body.String())
		}
		var s slice
		if err := json.Unmarshal(r.Body.Bytes(), &s); err != nil {
			t.Fatalf("decode media: %v", err)
		}
		return s
	}

	page1 := getMedia("limit=2")
	if page1.Count != 5 || len(page1.Messages) != 2 ||
		page1.Messages[0].ID != links[4] || page1.Messages[1].ID != links[3] {
		t.Fatalf("page1 = %+v (links=%v)", page1, links)
	}

	// Живой апдейт поверх показанного окна — как `history.unshift` в оригинале
	// (tweb src/components/sidebarRight/tabs/sharedMedia.tsx:239).
	send("см https://example.com/l6", "l6")

	page2 := getMedia("limit=2&offset_id=" + itoa(page1.Messages[1].ID))
	if page2.Count != 6 || len(page2.Messages) != 2 ||
		page2.Messages[0].ID != links[2] || page2.Messages[1].ID != links[1] {
		t.Fatalf("page2 = %+v, want id [%d %d] (дубль/дыра от вставки сверху)",
			page2, links[2], links[1])
	}

	// Счётчики всех вкладок одним запросом: порядок ответа = порядок запроса,
	// неизвестный вид — ноль, а не ошибка.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+peer+"/search_counters?filters=links,media,gifs", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("counters: %d %s", rec.Code, rec.Body.String())
	}
	var counters struct {
		Counters []struct {
			Filter string `json:"filter"`
			Count  int    `json:"count"`
		} `json:"counters"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &counters); err != nil {
		t.Fatalf("decode counters: %v", err)
	}
	want := []struct {
		filter string
		count  int
	}{{"links", 6}, {"media", 0}, {"gifs", 0}}
	if len(counters.Counters) != len(want) {
		t.Fatalf("counters = %+v, want %d записей", counters.Counters, len(want))
	}
	for i, w := range want {
		if counters.Counters[i].Filter != w.filter || counters.Counters[i].Count != w.count {
			t.Fatalf("counters[%d] = %+v, want {%s %d}", i, counters.Counters[i], w.filter, w.count)
		}
	}
}
