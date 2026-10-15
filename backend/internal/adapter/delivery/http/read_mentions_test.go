package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

// Ф-6, задача 18: POST /chats/{p}/reactions/read и /mentions/read — ответ
// messages.affectedHistory, top_msg_id — серверный номер темы форума.
func TestReadReactionsAndMentions_AffectedHistory_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990081101")
	tokenB, idB := signUp(t, h, pool, "+79990081102")
	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Форум"})
	cid := itoa(createdPeerID(t, rec))
	authedReq(t, h, http.MethodPost, "/chats/"+cid+"/members", tokenA, map[string]int64{"user_id": idB})
	authedReq(t, h, http.MethodPost, "/chats/"+cid+"/forum", tokenA, map[string]any{"enabled": true})
	topic := func(title string) int64 {
		rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/topics", tokenA, map[string]any{"title": title})
		var out struct {
			Updates []struct {
				Message struct {
					ID int64 `json:"id"`
				} `json:"message"`
			} `json:"updates"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		if len(out.Updates) != 1 {
			t.Fatalf("тема %s: %s", title, rec.Body.String())
		}
		return out.Updates[0].Message.ID
	}
	a, b := topic("A"), topic("B")
	send := func(thread int64, text string) int64 {
		rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenB,
			map[string]any{"text": text, "client_msg_id": text, "thread_root_id": thread})
		var m struct {
			ID int64 `json:"id"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &m)
		if rec.Code != http.StatusOK {
			t.Fatalf("сообщение %s: %d %s", text, rec.Code, rec.Body.String())
		}
		return m.ID
	}
	inA, inB := send(a, "a1"), send(b, "b1")
	for _, seq := range []int64{inA, inB} {
		if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages/"+itoa(seq)+"/reactions", tokenA, map[string]any{"emoji": "❤"}); rec.Code != http.StatusOK {
			t.Fatalf("реакция: %d %s", rec.Code, rec.Body.String())
		}
	}

	type affected struct {
		Underscore string `json:"_"`
		Pts        int64  `json:"pts"`
		PtsCount   int    `json:"pts_count"`
		Offset     *int   `json:"offset"`
	}
	call := func(path, query string) (affected, int) {
		t.Helper()
		rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/"+path+"/read"+query, tokenB, nil)
		var out affected
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out, rec.Code
	}

	// Тема A: top_msg_id доходит до usecase серверным номером — читается только она.
	first, code := call("reactions", "?top_msg_id="+itoa(a))
	if code != http.StatusOK || first.Underscore != "messages.affectedHistory" || first.PtsCount != 1 || first.Pts <= 0 || first.Offset == nil || *first.Offset != 0 {
		t.Fatalf("reactions тема A: %d %+v", code, first)
	}
	// Тема B осталась непрочитанной: её чтение снова даёт одну строку.
	second, _ := call("reactions", "?top_msg_id="+itoa(b))
	if second.PtsCount != 1 || second.Pts <= first.Pts {
		t.Fatalf("reactions тема B: %+v после %+v", second, first)
	}
	// Повтор — ничего не снято, pts тот же.
	again, _ := call("reactions", "")
	if again.PtsCount != 0 || again.Pts != second.Pts {
		t.Fatalf("пустой повтор: %+v, want pts_count=0 pts=%d", again, second.Pts)
	}
	// Упоминаний нет — тот же ответ.
	if m, code := call("mentions", ""); code != http.StatusOK || m.Underscore != "messages.affectedHistory" || m.PtsCount != 0 {
		t.Fatalf("mentions пусто: %d %+v", code, m)
	}
	// Номер, который не тема, и мусор в top_msg_id.
	if _, code := call("mentions", "?top_msg_id=999999"); code != http.StatusBadRequest {
		t.Fatalf("чужой номер: %d, want 400 TOPIC_ID_INVALID", code)
	}
	if _, code := call("reactions", "?top_msg_id=abc"); code != http.StatusBadRequest {
		t.Fatalf("мусор: %d, want 400", code)
	}
	// Не участник.
	tokenC, _ := signUp(t, h, pool, "+79990081103")
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/mentions/read", tokenC, nil); rec.Code != http.StatusForbidden && rec.Code != http.StatusNotFound {
		t.Fatalf("не участник: %d", rec.Code)
	}
}
