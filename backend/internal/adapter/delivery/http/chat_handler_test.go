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
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	// A sends a message.
	path := "/chats/" + itoa(created.PeerID) + "/messages"
	rec = authedReq(t, h, http.MethodPost, path, tokenA, map[string]any{"text": "hello", "client_msg_id": "c1"})
	if rec.Code != http.StatusOK {
		t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
	}

	// History shows it.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(created.PeerID)+"/history?limit=10", tokenA, nil)
	var hist struct {
		Count    int `json:"count"`
		Messages []struct {
			// Текст на проводе называется message — так он назван в схеме.
			Message string `json:"message"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	if hist.Count != 1 || len(hist.Messages) != 1 || hist.Messages[0].Message != "hello" {
		t.Fatalf("history = %+v", hist)
	}

	// GET /chats отдаёт собеседника приватного чата вектором users контейнера —
	// внутри строки диалога его больше нет (решение Р1): пир один на все ссылки,
	// а не копия в каждой строке.
	body := getChats(t, h, tokenA, "")
	if len(body.Dialogs) != 1 || body.Dialogs[0].Peer.Underscore != "peerUser" {
		t.Fatalf("expected one dialog addressed by peerUser, got %+v", body.Dialogs)
	}
	var peer map[string]any
	for _, u := range body.Users {
		if int64(u["id"].(float64)) == idB {
			peer = u
		}
	}
	if peer == nil || peer["_"] != "user" {
		t.Fatalf("собеседника %d нет в users: %v", idB, body.Users)
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
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &xy)

	const secretText = "совершенно секретный текст X и Y"
	rec = authedReq(t, h, http.MethodPost, "/chats/"+itoa(xy.PeerID)+"/messages", tokenX, map[string]any{
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
	gPeerID := createdPeerID(t, rec)

	// B запрашивает историю G с thread_root, указывающим на ЧУЖОЕ (X↔Y) сообщение.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(gPeerID)+"/history?thread_root="+itoa(secret.ID), tokenB, nil)
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
	// Сверяем ТЕКСТ, а не число: адрес сообщения стал по-пирным, и один и тот
	// же номер живёт в каждом чате — сравнение чисел из разных пиров больше
	// ничего не значит. Утечка проявилась бы содержимым.
	for _, m := range hist.Messages {
		if m.Text == secretText {
			t.Fatalf("секретное сообщение чужого чата утекло через thread_root: %s", rec.Body.String())
		}
	}
}

// dialogsContainer — ответ /chats в форме контейнера схемы. Конструктор `_`
// читается наравне с содержимым: именно он отвечает на вопрос «это всё?» —
// messages.dialogs идёт БЕЗ count, messages.dialogsSlice — с ним.
type dialogsContainer struct {
	Underscore string `json:"_"`
	Count      int    `json:"count"`
	Dialogs    []struct {
		Underscore string `json:"_"`
		Peer       struct {
			Underscore string `json:"_"`
			UserID     int64  `json:"user_id"`
			ChannelID  int64  `json:"channel_id"`
		} `json:"peer"`
		TopMessage     int64           `json:"top_message"`
		FolderID       int             `json:"folder_id"`
		UnreadCount    int             `json:"unread_count"`
		NotifySettings map[string]any  `json:"notify_settings"`
		PFlags         map[string]bool `json:"pFlags"`
	} `json:"dialogs"`
	Messages []map[string]any `json:"messages"`
	Chats    []map[string]any `json:"chats"`
	Users    []map[string]any `json:"users"`
}

// peerIDs — знаковые ключи пиров строк диалогов, в порядке выдачи. Ключ теперь
// выводится из КОНСТРУКТОРА пира, а не едет плоским числом: peerUser — сам id,
// peerChannel — он же со знаком минус (порт getPeerId).
func (c dialogsContainer) peerIDs() []int64 {
	out := make([]int64, 0, len(c.Dialogs))
	for _, d := range c.Dialogs {
		if d.Peer.Underscore == "peerUser" {
			out = append(out, d.Peer.UserID)
			continue
		}
		out = append(out, -d.Peer.ChannelID)
	}
	return out
}

// getChats делает GET /chats(+query) с токеном и декодирует контейнер;
// падает тестом, если код ответа не 200.
func getChats(t *testing.T, h http.Handler, token, query string) dialogsContainer {
	t.Helper()
	rec := authedReq(t, h, http.MethodGet, "/chats"+query, token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /chats%s: %d %s", query, rec.Code, rec.Body.String())
	}
	var out dialogsContainer
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

	// 1) выдача без параметров: список отдан ЦЕЛИКОМ, и это выражает сам
	// конструктор — count у messages.dialogs нет вовсе (tweb: isEnd = !count).
	full := getChats(t, h, tokenA, "")
	if full.Underscore != "messages.dialogs" || full.Count != 0 {
		t.Fatalf("весь список обязан ехать messages.dialogs без count: _=%q count=%d",
			full.Underscore, full.Count)
	}
	if len(full.Dialogs) != 3 {
		t.Fatalf("want 3 dialogs, got %d", len(full.Dialogs))
	}

	// 2) проход курсором по одному
	var walked []int64
	var cursor int64
	// Ограничитель итераций: без него регрессия курсора (напр. offset_peer_id
	// игнорируется) не роняет тест, а вешает его — в CI это таймаут всего
	// прогона вместо внятной ошибки.
	maxIter := len(full.Dialogs) + 2
	for iter := 0; ; iter++ {
		if iter >= maxIter {
			t.Fatalf("курсор не сходится за %d шагов, собрано: %v", maxIter, walked)
		}
		p := getChats(t, h, tokenA, fmt.Sprintf("?limit=1&offset_peer_id=%d", cursor))
		// Кусок обязан нести размер набора: без него клиент решит, что видел
		// весь список, и догрузка остановится на первой же странице.
		if p.Underscore != "messages.dialogsSlice" || p.Count != 3 {
			t.Fatalf("страница = %q count=%d; want messages.dialogsSlice 3", p.Underscore, p.Count)
		}
		if len(p.Dialogs) > 1 {
			t.Fatalf("limit=1 нарушен: %d", len(p.Dialogs))
		}
		walked = append(walked, p.peerIDs()...)
		// Конец выводит клиент — по размеру набора, как оригинал.
		if len(walked) >= p.Count || len(p.Dialogs) == 0 {
			break
		}
		cursor = walked[len(walked)-1]
	}

	// 3) совпадает с полной выдачей — порядок и состав
	want := full.peerIDs()
	if len(walked) != len(want) {
		t.Fatalf("прошли %v, полная выдача %v", walked, want)
	}
	for i := range walked {
		if walked[i] != want[i] {
			t.Fatalf("порядок разошёлся: %v vs %v", walked, want)
		}
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
			PeerID int64 `json:"peer_id"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &created)
		chatIDs = append(chatIDs, created.PeerID)
	}

	// Архивируем третий чат — фикстура: 2 обычных + 1 архивный.
	rec := authedReq(t, h, http.MethodPost, "/chats/"+itoa(chatIDs[2])+"/archive", tokenA, map[string]bool{"archived": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("archive: %d %s", rec.Code, rec.Body.String())
	}

	t.Run("folder_id=1 — только архив", func(t *testing.T) {
		body := getChats(t, h, tokenA, "?folder_id=1")
		if len(body.Dialogs) != 1 {
			t.Fatalf("dialogs=%d, want 1", len(body.Dialogs))
		}
		// Архив на проводе — folder_id=1, а не булево `archived`; общий список
		// ключа не несёт вовсе (у оригинала folder_id это flags.4?int).
		if body.Dialogs[0].FolderID != 1 {
			t.Fatalf("отдан не архивный диалог: folder_id=%d", body.Dialogs[0].FolderID)
		}
	})

	t.Run("folder_id=0 — всё, кроме архива, и без ключа folder_id", func(t *testing.T) {
		body := getChats(t, h, tokenA, "?folder_id=0")
		if len(body.Dialogs) != 2 {
			t.Fatalf("dialogs=%d, want 2", len(body.Dialogs))
		}
		for _, d := range body.Dialogs {
			if d.FolderID != 0 {
				t.Fatalf("общий список отдал folder_id=%d", d.FolderID)
			}
		}
	})

	// Отсутствие параметра — прежний контракт: весь набор. Мутация «по
	// умолчанию FolderAll» краснит здесь.
	t.Run("без folder_id — весь набор, архив вместе с остальными", func(t *testing.T) {
		body := getChats(t, h, tokenA, "")
		if len(body.Dialogs) != 3 {
			t.Fatalf("dialogs=%d, want 3", len(body.Dialogs))
		}
	})
}

func TestSync_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000003")
	tokenB, idB := signUp(t, h, pool, "+79990000004")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	_ = authedReq(t, h, http.MethodPost, "/chats/"+itoa(created.PeerID)+"/messages", tokenA, map[string]any{"text": "hi"})

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
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.PeerID)

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
	// Агрегат — конструктор messageReactions, тот же, что едет ВНУТРИ самого
	// сообщения: чип это `reactionCount` с объединением `Reaction` внутри.
	var listed struct {
		Underscore string `json:"_"`
		Results    []struct {
			Reaction struct {
				Emoticon string `json:"emoticon"`
			} `json:"reaction"`
			Count int `json:"count"`
		} `json:"results"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if listed.Underscore != "messageReactions" || len(listed.Results) != 1 ||
		listed.Results[0].Reaction.Emoticon != "🔥" || listed.Results[0].Count != 1 {
		t.Fatalf("reactions = %s", rec.Body.String())
	}

	// Remove it (emoji is URL-escaped by the client).
	rec = authedReq(t, h, http.MethodDelete, "/chats/"+cid+"/messages/"+mid+"/reactions/"+url.PathEscape("🔥"), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("remove reaction: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/messages/"+mid+"/reactions", tokenA, nil)
	listed.Results = nil
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Results) != 0 {
		t.Fatalf("expected no reactions after remove, got %s", rec.Body.String())
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
func mediaOf(t *testing.T, m domain.Message) domain.MessageMedia {
	t.Helper()
	wire, ok := m.ToWire(domain.MessageContext{Peer: domain.NewPeer(domain.ToPeerID(m.ChatID, true))}).(domain.MessageReal)
	if !ok {
		t.Fatalf("витрина отдала не message: %#v", wire)
	}
	if wire.Media == nil {
		t.Fatal("media отсутствует в витрине")
	}
	return wire.Media
}

// wireKeys — ключи витрины одного сообщения, как они реально уезжают.
func wireKeys(t *testing.T, m domain.Message) map[string]any {
	t.Helper()
	raw, err := json.Marshal(m.ToWire(domain.MessageContext{Peer: domain.NewPeer(domain.ToPeerID(m.ChatID, true))}))
	if err != nil {
		t.Fatalf("сериализация витрины: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("разбор витрины: %v", err)
	}
	return out
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
		photo, ok := md.(*domain.MessageMediaPhoto)
		if !ok || photo.Photo == nil {
			t.Fatalf("photo → %#v", md)
		}
		if photo.Photo.ID != 77 {
			t.Fatalf("photo.id = %d, want 77", photo.Photo.ID)
		}
		// i (stripped) → y (серверное превью, вписано в 1280) → w (оригинал).
		var got []string
		for _, sz := range photo.Photo.Sizes {
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
		if v := photo.Photo.Sizes[1].(domain.PhotoSizeReal); v.W != 1280 || v.H != 960 {
			t.Fatalf("ступень 'y' = %dx%d, want 1280x960", v.W, v.H)
		}
		if v := photo.Photo.Sizes[2].(domain.PhotoSizeReal); v.W != 1600 || v.H != 1200 || v.Size != 900000 {
			t.Fatalf("ступень 'w' = %dx%d/%d", v.W, v.H, v.Size)
		}
	})

	t.Run("audio — теги трека в documentAttributeAudio, имя файла отдельным атрибутом", func(t *testing.T) {
		md := mediaOf(t, msgWithMedia("audio", domain.MediaSource{
			Duration: 139, Size: 3300000, FileName: "track.mp3",
			Title: "Track One", Performer: "denis1488", Mime: "audio/mpeg",
		}))
		doc, ok := md.(*domain.MessageMediaDocument)
		if !ok || doc.Document == nil {
			t.Fatalf("audio → %#v", md)
		}
		a, ok := domain.MediaAudioAttr(md)
		if !ok || a.Title != "Track One" || a.Performer != "denis1488" || a.Duration != 139 {
			t.Fatalf("documentAttributeAudio = %#v", a)
		}
		if a.PFlags["voice"] {
			t.Fatalf("музыка не должна быть voice: %#v", a.PFlags)
		}
		if domain.MediaFileName(md) != "track.mp3" {
			t.Fatalf("documentAttributeFilename = %q", domain.MediaFileName(md))
		}
		if doc.Document.Size != 3300000 || doc.Document.MimeType != "audio/mpeg" {
			t.Fatalf("document = %#v", doc.Document)
		}
		// Файл без тегов: атрибут есть (длительность нужна), тегов в нём нет —
		// клиент подписывает бабл размером файла (tweb audio.ts).
		bare := mediaOf(t, msgWithMedia("audio", domain.MediaSource{Duration: 10, Size: 3300000}))
		if a, ok := domain.MediaAudioAttr(bare); !ok || a.Title != "" || a.Performer != "" {
			t.Fatalf("теги без тегов: %#v", a)
		}
	})

	t.Run("voice — pFlags.voice и волна в атрибуте, а не отдельным ключом", func(t *testing.T) {
		peaks := []byte{0x1f, 0x00, 0x2a, 0xff, 0x07}
		md := mediaOf(t, msgWithMedia("voice", domain.MediaSource{
			Duration: 7, Size: 4200, FileName: "voice.ogg", Waveform: peaks, Mime: "audio/ogg",
		}))
		a, ok := domain.MediaAudioAttr(md)
		if !ok || !a.PFlags["voice"] || string(a.Waveform) != string(peaks) {
			t.Fatalf("documentAttributeAudio = %#v", a)
		}
		// Не голосовое — волны нет вовсе, клиент считает её из файла.
		photo := mediaOf(t, msgWithMedia("photo", domain.MediaSource{Width: 100, Height: 100}))
		if domain.MediaHasAttribute(photo, domain.AttrAudio) {
			t.Fatalf("у фото не должно быть аудио-атрибута")
		}
	})

	t.Run("video — documentAttributeVideo с кадром и длительностью", func(t *testing.T) {
		md := mediaOf(t, msgWithMedia("video", domain.MediaSource{
			Width: 1280, Height: 720, Mime: "video/mp4", Duration: 61, Size: 9e6, HasThumb: true,
		}))
		a, ok := domain.MediaVideoAttr(md)
		if !ok || a.W != 1280 || a.H != 720 || a.Duration != 61 {
			t.Fatalf("documentAttributeVideo = %#v", a)
		}
		if a.PFlags["round_message"] {
			t.Fatalf("обычное видео не кружок")
		}
		if domain.MediaHasAttribute(md, domain.AttrAnimated) {
			t.Fatalf("обычное видео не гифка — атрибута animated быть не должно")
		}
		// thumbs документа — только превью, без ступени оригинала: сам файл
		// адресуется id документа, а кадр описан атрибутом.
		for _, sz := range md.(*domain.MessageMediaDocument).Document.Thumbs {
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
		if !domain.MediaHasAttribute(md, domain.AttrAnimated) {
			t.Fatalf("гифка без documentAttributeAnimated: %#v", md)
		}
		if a, ok := domain.MediaVideoAttr(md); !ok || a.Duration != 3 {
			t.Fatalf("documentAttributeVideo = %#v", a)
		}
	})

	t.Run("round — pFlags.round_message", func(t *testing.T) {
		md := mediaOf(t, msgWithMedia("round", domain.MediaSource{
			Width: 384, Height: 384, Mime: "video/mp4", Duration: 9,
		}))
		if a, ok := domain.MediaVideoAttr(md); !ok || !a.PFlags["round_message"] {
			t.Fatalf("кружок = %#v", md)
		}
	})

	t.Run("sticker — векторный контур доезжает до сообщения ступенью photoPathSize", func(t *testing.T) {
		outline := []byte{'M', '0', '0'}
		md := mediaOf(t, msgWithMedia("sticker", domain.MediaSource{
			Width: 512, Height: 512, Mime: "image/webp", Size: 30000, PathThumb: outline,
		}))
		if !domain.MediaHasAttribute(md, domain.AttrSticker) {
			t.Fatalf("стикер без documentAttributeSticker: %#v", md)
		}
		if string(domain.MediaPathThumb(md)) != string(outline) {
			t.Fatalf("контур не доехал: %#v", md)
		}
		// У не-стикера контура нет.
		plain := mediaOf(t, msgWithMedia("photo", domain.MediaSource{Width: 10, Height: 10}))
		if domain.MediaPathThumb(plain) != nil {
			t.Fatalf("контур у обычного фото: %#v", plain)
		}
	})

	t.Run("file — imageSize только у картинки, имя файла всегда", func(t *testing.T) {
		md := mediaOf(t, msgWithMedia("document", domain.MediaSource{
			Mime: "application/pdf", Size: 1024, FileName: "doc.pdf",
		}))
		if domain.MediaHasAttribute(md, domain.AttrImageSize) {
			t.Fatalf("у pdf нет кадра — imageSize быть не должно")
		}
		if domain.MediaFileName(md) != "doc.pdf" {
			t.Fatalf("documentAttributeFilename = %q", domain.MediaFileName(md))
		}
	})

	t.Run("спойлер — в media.pFlags, не отдельным ключом витрины", func(t *testing.T) {
		hidden := mediaOf(t, msgWithMedia("photo", domain.MediaSource{
			Width: 1280, Height: 960, Mime: "image/jpeg", Spoiler: true,
		}))
		if !hidden.(*domain.MessageMediaPhoto).PFlags["spoiler"] {
			t.Fatalf("spoiler = %#v", hidden)
		}
		plain := mediaOf(t, msgWithMedia("photo", domain.MediaSource{Width: 1280, Height: 960}))
		if plain.(*domain.MessageMediaPhoto).PFlags["spoiler"] {
			t.Fatalf("у обычного медиа заслонки быть не должно: %#v", plain)
		}
	})
}

// Шаг expand/contract завершён: плоских медиа-ключей в витрине больше нет
// вообще, вся мета едет ВНУТРИ `media`. Тест держит именно отсутствие — иначе
// плоский ключ легко вернётся «на минутку» под конкретного потребителя, а
// вместе с ним вернётся и второй источник истины, из-за которого расходились
// бокс, тип документа и превью.
func TestMessageJSON_NoFlatMediaKeys(t *testing.T) {
	msg := msgWithMedia("video", domain.MediaSource{
		Width: 1280, Height: 720, Mime: "video/mp4", Duration: 61, Size: 9e6,
		FileName: "clip.mp4", Blur: []byte{1, 2, 3}, HasThumb: true, Spoiler: true,
	})
	j := wireKeys(t, msg)

	if _, ok := j["media"]; !ok {
		t.Fatal("вложение в витрине отсутствует")
	}
	for _, k := range []string{"media_w", "media_h", "media_mime", "media_blur",
		"media_has_thumb", "media_duration", "media_size", "media_name", "media_waveform",
		"media_title", "media_performer", "media_animated", "media_spoiler"} {
		if v, ok := j[k]; ok {
			t.Fatalf("плоский ключ %q вернулся в витрину: %v", k, v)
		}
	}

	// Медиа нет — нет и самого ключа `media`.
	bare := wireKeys(t, domain.Message{ID: 1, ChatID: 2, Type: "text"})
	if _, ok := bare["media"]; ok {
		t.Fatalf("ключ media у сообщения без медиа: %v", bare["media"])
	}
}
