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
	"strings"
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

// msgWithMedia — сообщение с вложением, собранным ровно тем же путём, каким его
// собирает read-модель истории (hydrateMedia → domain.BuildMessageMedia).
func msgWithMedia(kind string, s domain.MediaSource) domain.Message {
	s.Kind = kind
	mid := int64(77)
	s.MediaID = mid
	return domain.Message{ID: 1, ChatID: 2, Type: kind, MediaID: &mid,
		MediaSpoiler: s.Spoiler, Media: domain.BuildMessageMedia(s)}
}

// mediaOf достаёт вложение из витрины истории — именно как объект модели
// оригинала, а не как набор плоских ключей.
func mediaOf(t *testing.T, m domain.Message) *domain.MessageMedia {
	t.Helper()
	j := messageJSON(m)
	md, ok := j["media"].(*domain.MessageMedia)
	if !ok {
		t.Fatalf("media отсутствует или не MessageMedia: %#v", j["media"])
	}
	return md
}

// Контракт витрины истории: медиа едет ОДНИМ вложенным объектом в форме
// оригинала (messageMediaPhoto/messageMediaDocument), а тип документа выводится
// из атрибутов — плоских ключей media_* и подделанных флагов в витрине больше
// нет. По одному случаю на каждый тип медиа.
func TestMessageJSON_MediaShape(t *testing.T) {
	t.Run("photo — лестница размеров, без mime и имени файла", func(t *testing.T) {
		md := mediaOf(t, msgWithMedia("photo", domain.MediaSource{
			Width: 1600, Height: 1200, Mime: "image/jpeg", Size: 900000,
			Blur: []byte{1, 2, 3}, HasThumb: true, FileName: "pic.jpg",
		}))
		if md.Underscore != domain.MessageMediaPhotoTag || md.Photo == nil || md.Document != nil {
			t.Fatalf("photo → %#v", md)
		}
		if md.Photo.ID != 77 {
			t.Fatalf("photo.id = %d, want 77", md.Photo.ID)
		}
		// i (stripped) → y (серверное превью, вписано в 1280) → w (оригинал).
		var got []string
		for _, sz := range md.Photo.Sizes {
			switch v := sz.(type) {
			case domain.PhotoSizeReal:
				got = append(got, v.Underscore+"/"+v.Type)
			case domain.PhotoStrippedSize:
				got = append(got, v.Underscore+"/"+v.Type)
			case domain.PhotoPathSize:
				got = append(got, v.Underscore+"/"+v.Type)
			}
		}
		want := []string{"photoStrippedSize/i", "photoSize/y", "photoSize/w"}
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Fatalf("лестница = %v, want %v", got, want)
		}
		if v := md.Photo.Sizes[1].(domain.PhotoSizeReal); v.W != 1280 || v.H != 960 {
			t.Fatalf("ступень 'y' = %dx%d, want 1280x960", v.W, v.H)
		}
		if v := md.Photo.Sizes[2].(domain.PhotoSizeReal); v.W != 1600 || v.H != 1200 || v.Size != 900000 {
			t.Fatalf("ступень 'w' = %dx%d/%d", v.W, v.H, v.Size)
		}
	})

	t.Run("audio — теги трека в documentAttributeAudio, имя файла отдельным атрибутом", func(t *testing.T) {
		md := mediaOf(t, msgWithMedia("audio", domain.MediaSource{
			Duration: 139, Size: 3300000, FileName: "track.mp3",
			Title: "Track One", Performer: "denis1488", Mime: "audio/mpeg",
		}))
		if md.Underscore != domain.MessageMediaDocumentTag || md.Document == nil {
			t.Fatalf("audio → %#v", md)
		}
		a, ok := md.AudioAttr()
		if !ok || a.Title != "Track One" || a.Performer != "denis1488" || a.Duration != 139 {
			t.Fatalf("documentAttributeAudio = %#v", a)
		}
		if a.PFlags["voice"] {
			t.Fatalf("музыка не должна быть voice: %#v", a.PFlags)
		}
		if md.FileName() != "track.mp3" {
			t.Fatalf("documentAttributeFilename = %q", md.FileName())
		}
		if md.Document.Size != 3300000 || md.Document.MimeType != "audio/mpeg" {
			t.Fatalf("document = %#v", md.Document)
		}
		// Файл без тегов: атрибут есть (длительность нужна), тегов в нём нет —
		// клиент подписывает бабл размером файла (tweb audio.ts).
		bare := mediaOf(t, msgWithMedia("audio", domain.MediaSource{Duration: 10, Size: 3300000}))
		if a, ok := bare.AudioAttr(); !ok || a.Title != "" || a.Performer != "" {
			t.Fatalf("теги без тегов: %#v", a)
		}
	})

	t.Run("voice — pFlags.voice и волна в атрибуте, а не отдельным ключом", func(t *testing.T) {
		peaks := []byte{0x1f, 0x00, 0x2a, 0xff, 0x07}
		md := mediaOf(t, msgWithMedia("voice", domain.MediaSource{
			Duration: 7, Size: 4200, FileName: "voice.ogg", Waveform: peaks, Mime: "audio/ogg",
		}))
		a, ok := md.AudioAttr()
		if !ok || !a.PFlags["voice"] || string(a.Waveform) != string(peaks) {
			t.Fatalf("documentAttributeAudio = %#v", a)
		}
		// Не голосовое — волны нет вовсе, клиент считает её из файла.
		photo := mediaOf(t, msgWithMedia("photo", domain.MediaSource{Width: 100, Height: 100}))
		if photo.HasAttribute(domain.AttrAudio) {
			t.Fatalf("у фото не должно быть аудио-атрибута")
		}
	})

	t.Run("video — documentAttributeVideo с кадром и длительностью", func(t *testing.T) {
		md := mediaOf(t, msgWithMedia("video", domain.MediaSource{
			Width: 1280, Height: 720, Mime: "video/mp4", Duration: 61, Size: 9e6, HasThumb: true,
		}))
		a, ok := md.VideoAttr()
		if !ok || a.W != 1280 || a.H != 720 || a.Duration != 61 {
			t.Fatalf("documentAttributeVideo = %#v", a)
		}
		if a.PFlags["round_message"] {
			t.Fatalf("обычное видео не кружок")
		}
		if md.HasAttribute(domain.AttrAnimated) {
			t.Fatalf("обычное видео не гифка — атрибута animated быть не должно")
		}
		// thumbs документа — только превью, без ступени оригинала: сам файл
		// адресуется id документа, а кадр описан атрибутом.
		for _, sz := range md.Document.Thumbs {
			if v, ok := sz.(domain.PhotoSizeReal); ok && v.Type == domain.SizeTypeFull {
				t.Fatalf("в thumbs документа не должно быть ступени оригинала: %#v", v)
			}
		}
	})

	t.Run("gif — documentAttributeAnimated (из него оригинал выводит doc.type gif)", func(t *testing.T) {
		md := mediaOf(t, msgWithMedia("gif", domain.MediaSource{
			Width: 320, Height: 240, Mime: "video/mp4", Duration: 3, Size: 400000,
			FileName: "cat.mp4", Animated: true,
		}))
		if !md.HasAttribute(domain.AttrAnimated) {
			t.Fatalf("гифка без documentAttributeAnimated: %#v", md.Document.Attributes)
		}
		if a, ok := md.VideoAttr(); !ok || a.Duration != 3 {
			t.Fatalf("documentAttributeVideo = %#v", a)
		}
	})

	t.Run("round — pFlags.round_message", func(t *testing.T) {
		md := mediaOf(t, msgWithMedia("round", domain.MediaSource{
			Width: 384, Height: 384, Mime: "video/mp4", Duration: 9,
		}))
		if a, ok := md.VideoAttr(); !ok || !a.PFlags["round_message"] {
			t.Fatalf("кружок = %#v", md.Document.Attributes)
		}
	})

	t.Run("sticker — векторный контур доезжает до сообщения ступенью photoPathSize", func(t *testing.T) {
		outline := []byte{'M', '0', '0'}
		md := mediaOf(t, msgWithMedia("sticker", domain.MediaSource{
			Width: 512, Height: 512, Mime: "image/webp", Size: 30000, PathThumb: outline,
		}))
		if !md.HasAttribute(domain.AttrSticker) {
			t.Fatalf("стикер без documentAttributeSticker: %#v", md.Document.Attributes)
		}
		if string(md.PathThumb()) != string(outline) {
			t.Fatalf("контур не доехал: thumbs = %#v", md.Document.Thumbs)
		}
		// У не-стикера контура нет.
		plain := mediaOf(t, msgWithMedia("photo", domain.MediaSource{Width: 10, Height: 10}))
		if plain.PathThumb() != nil {
			t.Fatalf("контур у обычного фото: %#v", plain.Photo.Sizes)
		}
	})

	t.Run("file — imageSize только у картинки, имя файла всегда", func(t *testing.T) {
		md := mediaOf(t, msgWithMedia("document", domain.MediaSource{
			Mime: "application/pdf", Size: 1024, FileName: "doc.pdf",
		}))
		if md.HasAttribute(domain.AttrImageSize) {
			t.Fatalf("у pdf нет кадра — imageSize быть не должно")
		}
		if md.FileName() != "doc.pdf" {
			t.Fatalf("documentAttributeFilename = %q", md.FileName())
		}
	})

	t.Run("спойлер — в media.pFlags, не отдельным ключом витрины", func(t *testing.T) {
		hidden := mediaOf(t, msgWithMedia("photo", domain.MediaSource{
			Width: 1280, Height: 960, Mime: "image/jpeg", Spoiler: true,
		}))
		if !hidden.PFlags["spoiler"] {
			t.Fatalf("spoiler = %#v", hidden.PFlags)
		}
		plain := mediaOf(t, msgWithMedia("photo", domain.MediaSource{Width: 1280, Height: 960}))
		if plain.PFlags["spoiler"] {
			t.Fatalf("у обычного медиа заслонки быть не должно: %#v", plain.PFlags)
		}
	})
}

// Шаг expand/contract: витрина отдаёт ОБЕ формы разом — новый объект `media`
// и плоские ключи, ВЫВЕДЕННЫЕ ИЗ НЕГО (domain.LegacyFlatKeys). Второго
// источника меты нет: плоские ключи не считаются заново из строки media, а
// читаются из уже собранной модели — поэтому разъехаться они не могут, и
// удаление их половины (когда фронт переедет на `media`) ничего не меняет в
// самой модели. Тест держит именно эту связь, а не факт наличия ключей.
func TestMessageJSON_FlatKeysDerivedFromModel(t *testing.T) {
	msg := msgWithMedia("video", domain.MediaSource{
		Width: 1280, Height: 720, Mime: "video/mp4", Duration: 61, Size: 9e6,
		FileName: "clip.mp4", Blur: []byte{1, 2, 3}, HasThumb: true, Spoiler: true,
	})
	j := messageJSON(msg)
	md := j["media"].(*domain.MessageMedia)

	w, h := md.Dimensions()
	if j["media_w"] != w || j["media_h"] != h {
		t.Fatalf("media_w/h = %v/%v, модель говорит %d/%d", j["media_w"], j["media_h"], w, h)
	}
	if j["media_mime"] != md.Document.MimeType {
		t.Fatalf("media_mime = %v, модель говорит %q", j["media_mime"], md.Document.MimeType)
	}
	if j["media_name"] != md.FileName() {
		t.Fatalf("media_name = %v, модель говорит %q", j["media_name"], md.FileName())
	}
	if string(j["media_blur"].([]byte)) != string(md.StrippedThumb()) {
		t.Fatalf("media_blur разошёлся с stripped-ступенью модели")
	}
	if (j["media_spoiler"] == true) != md.PFlags["spoiler"] {
		t.Fatalf("media_spoiler = %v, модель говорит %v", j["media_spoiler"], md.PFlags["spoiler"])
	}
	a, _ := md.VideoAttr()
	if j["media_duration"] != int(a.Duration) {
		t.Fatalf("media_duration = %v, модель говорит %v", j["media_duration"], a.Duration)
	}
	// Медиа нет — плоских ключей тоже нет ни одного.
	bare := messageJSON(domain.Message{ID: 1, ChatID: 2, Type: "text"})
	for _, k := range []string{"media", "media_w", "media_h", "media_mime", "media_blur",
		"media_has_thumb", "media_duration", "media_size", "media_name", "media_waveform",
		"media_title", "media_performer", "media_animated", "media_spoiler"} {
		if _, ok := bare[k]; ok {
			t.Fatalf("ключ %q у сообщения без медиа: %v", k, bare[k])
		}
	}
}
