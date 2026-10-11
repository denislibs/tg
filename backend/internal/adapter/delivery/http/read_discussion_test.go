package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

// messages.readDiscussion — POST /chats/{p}/threads/{n}/read {read_max_id}
// (tweb appMessagesManager.ts:9186-9210): гасит тему, а не весь форум;
// unread_count форума в списке — сумма по темам.
func TestReadDiscussion_HTTP_Forum(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990081001")
	tokenB, idB := signUp(t, h, pool, "+79990081002")
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
	lastA := send(a, "a1")
	send(b, "b1")
	send(1, "g1")

	topicUnread := func() map[int64]int {
		rec := authedReq(t, h, http.MethodGet, "/chats/"+cid+"/topics", tokenA, nil)
		var list forumTopicsWire
		_ = json.Unmarshal(rec.Body.Bytes(), &list)
		out := map[int64]int{}
		for _, tp := range list.Topics {
			out[tp.ID] = tp.Unread
		}
		return out
	}
	if u := topicUnread(); u[a] != 1 || u[b] != 1 {
		t.Fatalf("до прочтения: %v", u)
	}
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/threads/"+itoa(a)+"/read", tokenA, map[string]any{"read_max_id": lastA})
	if rec.Code != http.StatusOK {
		t.Fatalf("readDiscussion: %d %s", rec.Code, rec.Body.String())
	}
	if u := topicUnread(); u[a] != 0 || u[b] != 1 {
		t.Fatalf("после прочтения A: %v; ждали A=0, B=1", u)
	}
	// Строка форума в списке: unread_count — сумма по темам (B и General).
	rec = authedReq(t, h, http.MethodGet, "/chats?limit=50", tokenA, nil)
	var dialogs struct {
		Dialogs []struct {
			Peer struct {
				ChannelID int64 `json:"channel_id"`
			} `json:"peer"`
			Unread int `json:"unread_count"`
		} `json:"dialogs"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &dialogs)
	found := false
	for _, d := range dialogs.Dialogs {
		if itoa(-d.Peer.ChannelID) == cid {
			found = true
			if d.Unread != 2 {
				t.Fatalf("unread_count форума = %d; ждали 2 (B и General)", d.Unread)
			}
		}
	}
	if !found {
		t.Fatalf("форума нет в списке: %s", rec.Body.String())
	}
	// Тред не темы — TOPIC_ID_INVALID; старой ручки тем больше нет.
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/threads/"+itoa(lastA)+"/read", tokenA,
		map[string]any{"read_max_id": lastA}); rec.Code != http.StatusBadRequest {
		t.Fatalf("тред не темы: %d %s", rec.Code, rec.Body.String())
	}
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/topics/"+itoa(a)+"/read", tokenA,
		map[string]any{"up_to_seq": lastA}); rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("старая ручка /topics/{n}/read жива: %d", rec.Code)
	}
}

// Тред комментариев читает и не участник группы обсуждения (свой горизонт
// треда, в группу он не вступает); не тред комментариев — нет.
func TestReadDiscussion_HTTP_CommentsGuest(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990082001")
	tokenB, _ := signUp(t, h, pool, "+79990082002")
	tokenC, idC := signUp(t, h, pool, "+79990082003")
	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Канал", "username": "readdiscchan", "is_public": true,
	})
	cid := itoa(createdPeerID(t, rec))
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{"text": "пост", "client_msg_id": "p1"})
	var post struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post)
	authedReq(t, h, http.MethodPost, "/channels/"+cid+"/discussion", tokenA, nil)
	disc := itoa(linkedPeerOf(t, h, tokenA, cid))
	if rec := authedReq(t, h, http.MethodPost, "/channels/"+cid+"/posts/"+itoa(post.ID)+"/comments", tokenB,
		map[string]any{"text": "коммент", "client_msg_id": "k1"}); rec.Code != http.StatusOK {
		t.Fatalf("комментарий: %d %s", rec.Code, rec.Body.String())
	}
	mirror := discussionRoot(t, h, tokenA, cid, post.ID)
	rec = authedReq(t, h, http.MethodPost, "/chats/"+disc+"/threads/"+itoa(mirror)+"/read", tokenC, map[string]any{"read_max_id": mirror + 1})
	if rec.Code != http.StatusOK {
		t.Fatalf("гость читает тред комментариев: %d %s", rec.Code, rec.Body.String())
	}
	var member bool
	if err := pool.QueryRow(t.Context(), `SELECT EXISTS (SELECT 1 FROM chat_members WHERE user_id = $1)`, idC).Scan(&member); err != nil || member {
		t.Fatalf("гость вступил в группу: %v %v", member, err)
	}
	var horizon int64
	if err := pool.QueryRow(t.Context(), `SELECT last_read_seq FROM topic_user_state WHERE user_id = $1`, idC).Scan(&horizon); err != nil || horizon != mirror+1 {
		t.Fatalf("горизонт треда гостя = %d, %v; ждали %d", horizon, err, mirror+1)
	}

	// Участник группы читает тред комментариев — диалог группы правится, как
	// tweb на месте (appMessagesManager.ts:10814-10816, 10918-10944): горизонт
	// группы = read_max_id, дочитал до последнего — непрочитанного 0.
	// Группа обсуждения в списке чатов пока скрыта (снимает БЭК-3) —
	// состояние диалога владельца читаем из его строки членства.
	groupDialog := func() (read int64, unread int) {
		t.Helper()
		if err := pool.QueryRow(t.Context(),
			`SELECT cm.last_read_seq, cm.unread_count FROM chat_members cm
			  WHERE cm.user_id = $1 AND cm.chat_id IN (SELECT discussion_chat_id FROM chats WHERE discussion_chat_id IS NOT NULL)`,
			idA).Scan(&read, &unread); err != nil {
			t.Fatalf("строка членства владельца в группе: %v", err)
		}
		return
	}
	if _, unread := groupDialog(); unread == 0 {
		t.Fatal("до прочтения у владельца нет непрочитанного в группе")
	}
	rec = authedReq(t, h, http.MethodPost, "/chats/"+disc+"/threads/"+itoa(mirror)+"/read", tokenA, map[string]any{"read_max_id": mirror + 1})
	if rec.Code != http.StatusOK {
		t.Fatalf("участник читает тред комментариев: %d %s", rec.Code, rec.Body.String())
	}
	if read, unread := groupDialog(); read != mirror+1 || unread != 0 {
		t.Fatalf("диалог группы после треда: read=%d unread=%d; ждали %d/0", read, unread, mirror+1)
	}
}
