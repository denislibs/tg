package http

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

// signUp creates a user via the auth flow and returns (token, userID).
func signUp(t *testing.T, h http.Handler, _ *pgxpool.Pool, phone string) (string, int64) {
	t.Helper()
	return loginViaHTTP(t, h, phone)
}

func authedReq(t *testing.T, h http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		buf, _ := json.Marshal(body)
		rdr = bytes.NewReader(buf)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req := httptest.NewRequestWithContext(context.Background(), method, path, rdr)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func newMessagingRouter(t *testing.T) (http.Handler, *pgxpool.Pool) {
	pool := postgres.NewTestDB(t)
	return NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil), pool
}

func TestChatFlow_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000001")
	_, idB := signUp(t, h, pool, "+79990000002")

	// A creates a private chat with B.
	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	// A sends a message.
	path := "/chats/" + itoa(created.ChatID) + "/messages"
	rec = authedReq(t, h, http.MethodPost, path, tokenA, map[string]any{"text": "hello", "client_msg_id": "c1"})
	if rec.Code != http.StatusOK {
		t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
	}

	// History shows it.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(created.ChatID)+"/history?limit=10", tokenA, nil)
	var hist struct {
		Count    int `json:"count"`
		Messages []struct {
			Text string `json:"text"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	if hist.Count != 1 || len(hist.Messages) != 1 || hist.Messages[0].Text != "hello" {
		t.Fatalf("history = %+v", hist)
	}

	// GET /chats includes the private-chat peer (B) so the UI can show a name.
	rec = authedReq(t, h, http.MethodGet, "/chats", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list chats: %d %s", rec.Code, rec.Body.String())
	}
	var dialogs struct {
		Chats []struct {
			ChatID int64 `json:"chat_id"`
			Peer   *struct {
				ID          int64  `json:"id"`
				DisplayName string `json:"display_name"`
			} `json:"peer"`
		} `json:"chats"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &dialogs)
	if len(dialogs.Chats) != 1 || dialogs.Chats[0].Peer == nil {
		t.Fatalf("expected one chat with a peer, got %s", rec.Body.String())
	}
	if dialogs.Chats[0].Peer.ID != idB {
		t.Fatalf("peer id = %d; want %d", dialogs.Chats[0].Peer.ID, idB)
	}
}

// getChats делает GET /chats(+query) с токеном и декодирует ответ в форму
// {chats, count, is_end}; падает тестом, если код ответа не 200.
func getChats(t *testing.T, h http.Handler, token, query string) struct {
	Chats []struct {
		ChatID int64 `json:"chat_id"`
	} `json:"chats"`
	Count int  `json:"count"`
	IsEnd bool `json:"is_end"`
} {
	t.Helper()
	rec := authedReq(t, h, http.MethodGet, "/chats"+query, token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /chats%s: %d %s", query, rec.Code, rec.Body.String())
	}
	var out struct {
		Chats []struct {
			ChatID int64 `json:"chat_id"`
		} `json:"chats"`
		Count int  `json:"count"`
		IsEnd bool `json:"is_end"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode /chats%s: %v", query, err)
	}
	return out
}

// Пагинация /chats: проход курсором обязан собрать ровно тот же набор в том же
// порядке, что и выдача без параметров, и ни разу не повторить чат.
func TestListDialogs_Pagination_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000030")
	_, idB := signUp(t, h, pool, "+79990000031")
	_, idC := signUp(t, h, pool, "+79990000032")
	_, idD := signUp(t, h, pool, "+79990000033")

	for _, peer := range []int64{idB, idC, idD} {
		rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": peer})
		if rec.Code != http.StatusOK {
			t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
		}
	}

	// 1) выдача без параметров: прежняя форма + count/is_end
	full := getChats(t, h, tokenA, "")
	if full.Count != 3 || !full.IsEnd {
		t.Fatalf("count=%d is_end=%v", full.Count, full.IsEnd)
	}
	if len(full.Chats) != 3 {
		t.Fatalf("want 3 chats, got %d", len(full.Chats))
	}

	// 2) проход курсором по одному
	var walked []int64
	var cursor int64
	// Ограничитель итераций: без него регрессия курсора (напр. offset_chat_id
	// игнорируется) не роняет тест, а вешает его — в CI это таймаут всего
	// прогона вместо внятной ошибки.
	maxIter := full.Count + 2
	for iter := 0; ; iter++ {
		if iter >= maxIter {
			t.Fatalf("курсор не сходится за %d шагов, собрано: %v", maxIter, walked)
		}
		p := getChats(t, h, tokenA, fmt.Sprintf("?limit=1&offset_chat_id=%d", cursor))
		if p.Count != 3 {
			t.Fatalf("count на странице=%d", p.Count)
		}
		if len(p.Chats) > 1 {
			t.Fatalf("limit=1 нарушен: %d", len(p.Chats))
		}
		for _, c := range p.Chats {
			walked = append(walked, c.ChatID)
		}
		if p.IsEnd {
			break
		}
		cursor = walked[len(walked)-1]
	}

	// 3) совпадает с полной выдачей — порядок и состав
	if len(walked) != len(full.Chats) {
		t.Fatalf("прошли %v, полная выдача %v", walked, full.Chats)
	}
	for i := range walked {
		if walked[i] != full.Chats[i].ChatID {
			t.Fatalf("порядок разошёлся: %v vs %v", walked, full.Chats)
		}
	}
}

func TestSync_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000003")
	tokenB, idB := signUp(t, h, pool, "+79990000004")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	var created struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	_ = authedReq(t, h, http.MethodPost, "/chats/"+itoa(created.ChatID)+"/messages", tokenA, map[string]any{"text": "hi"})

	// B syncs from pts=0 and sees one new_message.
	rec = authedReq(t, h, http.MethodGet, "/sync?pts=0", tokenB, nil)
	var diff struct {
		NewMessages []json.RawMessage `json:"new_messages"`
		State       struct {
			Pts int64 `json:"pts"`
		} `json:"state"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &diff)
	if len(diff.NewMessages) != 1 || diff.State.Pts != 1 {
		t.Fatalf("sync diff = %+v", diff)
	}
}

func itoa(v int64) string { return strconvFormat(v) }

func strconvFormat(v int64) string {
	return strconv.FormatInt(v, 10)
}

func TestReactions_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000020")
	_, idB := signUp(t, h, pool, "+79990000021")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	var created struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.ChatID)

	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenA, map[string]any{"text": "hi"})
	var msg struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &msg)
	mid := itoa(msg.ID)

	// Add 🔥.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages/"+mid+"/reactions", tokenA, map[string]string{"emoji": "🔥"})
	if rec.Code != http.StatusOK {
		t.Fatalf("add reaction: %d %s", rec.Code, rec.Body.String())
	}

	// List shows 🔥:1.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/messages/"+mid+"/reactions", tokenA, nil)
	var listed struct {
		Reactions []struct {
			Emoji string `json:"emoji"`
			Count int    `json:"count"`
		} `json:"reactions"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Reactions) != 1 || listed.Reactions[0].Emoji != "🔥" || listed.Reactions[0].Count != 1 {
		t.Fatalf("reactions = %+v", listed.Reactions)
	}

	// Remove it (emoji is URL-escaped by the client).
	rec = authedReq(t, h, http.MethodDelete, "/chats/"+cid+"/messages/"+mid+"/reactions/"+url.PathEscape("🔥"), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("remove reaction: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/messages/"+mid+"/reactions", tokenA, nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Reactions) != 0 {
		t.Fatalf("expected no reactions after remove, got %+v", listed.Reactions)
	}
}

// Контракт медиа-меты в JSON сообщения: теги трека едут как media_title /
// media_performer и отсутствуют у файла без тегов (клиент тогда подписывает бабл
// размером файла — tweb audio.ts).
func TestMessageJSON_AudioTags(t *testing.T) {
	j := messageJSON(domain.Message{
		ID: 1, ChatID: 2, Type: "audio",
		MediaDuration: 139, MediaSize: 3300000, MediaName: "track.mp3",
		MediaTitle: "Track One", MediaPerformer: "denis1488",
	})
	if j["media_title"] != "Track One" {
		t.Fatalf("media_title = %v", j["media_title"])
	}
	if j["media_performer"] != "denis1488" {
		t.Fatalf("media_performer = %v", j["media_performer"])
	}
	if j["media_duration"] != 139 {
		t.Fatalf("media_duration = %v", j["media_duration"])
	}

	bare := messageJSON(domain.Message{ID: 1, ChatID: 2, Type: "audio", MediaSize: 3300000})
	if _, ok := bare["media_title"]; ok {
		t.Fatalf("media_title must be absent without tags: %v", bare["media_title"])
	}
	if _, ok := bare["media_performer"]; ok {
		t.Fatalf("media_performer must be absent without tags: %v", bare["media_performer"])
	}
}
