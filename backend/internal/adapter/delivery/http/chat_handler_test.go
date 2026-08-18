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

// Дыра, найдена ре-ревью (2026-08-15): prependForeignThreadRoot резолвит
// ?thread_root=<id> через GetByID — прямой PK-запрос, который не проверяет,
// состоит ли запрашивающий в чате найденного сообщения. Механизм задуман для
// форум-топиков/зеркал (root физически в ТОМ ЖЕ чате, что и сам запрос), но
// ничто не мешает клиенту передать thread_root=<id ЧУЖОГО сообщения из
// совершенно другого чата> — до фикса такое сообщение подшивалось бы первым
// в окно, даже если у читателя нет к нему доступа вовсе (например, приватная
// переписка третьих лиц). Проверяем: participant группы B, не имеющий
// отношения к приватному чату X↔Y, не видит секретный текст X→Y через
// ?thread_root=<id секретного сообщения>.
func TestGetHistory_ThreadRoot_ForeignChat_NotLeaked(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenX, _ := signUp(t, h, pool, "+79990001001")
	_, idY := signUp(t, h, pool, "+79990001002")
	tokenB, _ := signUp(t, h, pool, "+79990001003")

	// X и Y — приватный чат с секретным сообщением, B к нему отношения не имеет.
	rec := authedReq(t, h, http.MethodPost, "/chats", tokenX, map[string]int64{"user_id": idY})
	if rec.Code != http.StatusOK {
		t.Fatalf("create private chat: %d %s", rec.Code, rec.Body.String())
	}
	var xy struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &xy)

	const secretText = "совершенно секретный текст X и Y"
	rec = authedReq(t, h, http.MethodPost, "/chats/"+itoa(xy.ChatID)+"/messages", tokenX, map[string]any{
		"text": secretText, "client_msg_id": "s1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("secret message: %d %s", rec.Code, rec.Body.String())
	}
	var secret struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &secret)

	// B — участник обычной группы G, никак не связанной ни с X, ни с Y.
	rec = authedReq(t, h, http.MethodPost, "/groups", tokenB, map[string]any{
		"title": "Just a group",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", rec.Code, rec.Body.String())
	}
	var g struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &g)

	// B запрашивает историю G с thread_root, указывающим на ЧУЖОЕ (X↔Y) сообщение.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(g.ChatID)+"/history?thread_root="+itoa(secret.ID), tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("history: %d %s", rec.Code, rec.Body.String())
	}
	var hist struct {
		Messages []struct {
			ID   int64  `json:"id"`
			Text string `json:"text"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	for _, m := range hist.Messages {
		if m.ID == secret.ID || m.Text == secretText {
			t.Fatalf("секретное сообщение чужого чата утекло через thread_root: %s", rec.Body.String())
		}
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

// doGet делает GET /chats(+query) с токеном и декодирует ответ через body.
func doGet(t *testing.T, h http.Handler, token, query string) *httptest.ResponseRecorder {
	t.Helper()
	rec := authedReq(t, h, http.MethodGet, query, token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s: %d %s", query, rec.Code, rec.Body.String())
	}
	return rec
}

func decode(t *testing.T, rr *httptest.ResponseRecorder, out any) {
	t.Helper()
	if err := json.Unmarshal(rr.Body.Bytes(), out); err != nil {
		t.Fatalf("decode %s: %v", rr.Body.String(), err)
	}
}

// folder_id режет выборку на бэкенде: без него клиент не знает размера набора
// архива и его виртуальный список не создаёт дырок, то есть не догружается.
func TestListDialogsFolderID(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000040")
	_, idB := signUp(t, h, pool, "+79990000041")
	_, idC := signUp(t, h, pool, "+79990000042")
	_, idD := signUp(t, h, pool, "+79990000043")

	var chatIDs []int64
	for _, peer := range []int64{idB, idC, idD} {
		rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": peer})
		if rec.Code != http.StatusOK {
			t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
		}
		var created struct {
			ChatID int64 `json:"chat_id"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &created)
		chatIDs = append(chatIDs, created.ChatID)
	}

	// Архивируем третий чат — фикстура: 2 обычных + 1 архивный.
	rec := authedReq(t, h, http.MethodPost, "/chats/"+itoa(chatIDs[2])+"/archive", tokenA, map[string]bool{"archived": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("archive: %d %s", rec.Code, rec.Body.String())
	}

	t.Run("folder_id=1 — только архив и его count", func(t *testing.T) {
		rr := doGet(t, h, tokenA, "/chats?folder_id=1")
		var body struct {
			Chats []map[string]any `json:"chats"`
			Count int              `json:"count"`
			IsEnd bool             `json:"is_end"`
		}
		decode(t, rr, &body)
		if len(body.Chats) != 1 || body.Count != 1 || !body.IsEnd {
			t.Fatalf("chats=%d count=%d isEnd=%v, want 1 1 true", len(body.Chats), body.Count, body.IsEnd)
		}
		if body.Chats[0]["archived"] != true {
			t.Fatalf("отдан не архивный диалог: %v", body.Chats[0])
		}
	})

	t.Run("folder_id=0 — всё, кроме архива", func(t *testing.T) {
		rr := doGet(t, h, tokenA, "/chats?folder_id=0")
		var body struct {
			Chats []map[string]any `json:"chats"`
			Count int              `json:"count"`
		}
		decode(t, rr, &body)
		if len(body.Chats) != 2 || body.Count != 2 {
			t.Fatalf("chats=%d count=%d, want 2 2", len(body.Chats), body.Count)
		}
	})

	// Отсутствие параметра — прежний контракт: весь набор. Мутация «по
	// умолчанию FolderAll» краснит здесь.
	t.Run("без folder_id — весь набор", func(t *testing.T) {
		rr := doGet(t, h, tokenA, "/chats")
		var body struct {
			Count int `json:"count"`
		}
		decode(t, rr, &body)
		if body.Count != 3 {
			t.Fatalf("count=%d, want 3", body.Count)
		}
	})
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

// Пики волны голосового в витрине истории: media_waveform (наш
// documentAttributeAudio.waveform). Клиент строит волну прямо из сообщения —
// без него ему пришлось бы добирать мету медиа отдельным запросом. У медиа без
// пиков ключа нет вовсе.
func TestMessageJSON_VoiceWaveform(t *testing.T) {
	peaks := []byte{0x1f, 0x00, 0x2a, 0xff, 0x07}
	voice := messageJSON(domain.Message{
		ID: 1, ChatID: 2, Type: "voice",
		MediaDuration: 7, MediaSize: 4200, MediaName: "voice.ogg", MediaWaveform: peaks,
	})
	got, ok := voice["media_waveform"].([]byte)
	if !ok || string(got) != string(peaks) {
		t.Fatalf("media_waveform = %v (ok=%v), want %v", voice["media_waveform"], ok, peaks)
	}

	bare := messageJSON(domain.Message{ID: 1, ChatID: 2, Type: "photo", MediaWidth: 100, MediaHeight: 100})
	if _, ok := bare["media_waveform"]; ok {
		t.Fatalf("media_waveform must be absent without peaks: %v", bare["media_waveform"])
	}
}

// Признак гифки в витрине истории: media_animated (telegram
// documentAttributeAnimated → tweb doc.type === 'gif'). У обычного видео ключа
// нет — клиент рисует таймкод и кнопку play вместо бейджа «GIF».
func TestMessageJSON_MediaAnimated(t *testing.T) {
	gif := messageJSON(domain.Message{
		ID: 1, ChatID: 2, Type: "video",
		MediaWidth: 320, MediaHeight: 240, MediaMime: "video/mp4",
		MediaDuration: 3, MediaSize: 400000, MediaName: "cat.mp4", MediaAnimated: true,
	})
	if gif["media_animated"] != true {
		t.Fatalf("media_animated = %v, want true", gif["media_animated"])
	}

	video := messageJSON(domain.Message{
		ID: 1, ChatID: 2, Type: "video",
		MediaWidth: 1280, MediaHeight: 720, MediaMime: "video/mp4", MediaDuration: 61,
	})
	if _, ok := video["media_animated"]; ok {
		t.Fatalf("media_animated must be absent for a plain video: %v", video["media_animated"])
	}
}

// Признак спойлера в витрине истории: media_spoiler (telegram
// messageMedia.pFlags.spoiler → tweb wrapMediaSpoiler, bubbles.ts:8579).
// У обычного медиа ключа нет — оно показывается сразу, без заслонки.
func TestMessageJSON_MediaSpoiler(t *testing.T) {
	hidden := messageJSON(domain.Message{
		ID: 1, ChatID: 2, Type: "photo",
		MediaWidth: 1280, MediaHeight: 960, MediaMime: "image/jpeg",
		MediaName: "secret.jpg", MediaSpoiler: true,
	})
	if hidden["media_spoiler"] != true {
		t.Fatalf("media_spoiler = %v, want true", hidden["media_spoiler"])
	}

	plain := messageJSON(domain.Message{
		ID: 1, ChatID: 2, Type: "photo",
		MediaWidth: 1280, MediaHeight: 960, MediaMime: "image/jpeg",
	})
	if _, ok := plain["media_spoiler"]; ok {
		t.Fatalf("media_spoiler must be absent without the flag: %v", plain["media_spoiler"])
	}
}
