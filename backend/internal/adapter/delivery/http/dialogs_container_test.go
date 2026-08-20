package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ответ /chats — КОНТЕЙНЕР схемы (решение Р1), а не плоский массив строк
// диалога. Проверяется то, чего в прежней форме не было В ПРИНЦИПЕ:
//
//   - последнее сообщение едет ОБЪЕКТОМ в векторе messages, а строка диалога
//     адресует его числом top_message (решение Р3);
//   - АВТОР последнего сообщения едет пиром в users — прежде сервер склеивал
//     его имя сам (last_sender_name), потому что пира в ответе не было вовсе;
//   - тело группы едет в chats конструктором `channel`, а не плоскими
//     title/username/photo внутри каждой строки.
func TestListDialogs_Container_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000200")
	tokenB, idB := signUp(t, h, pool, "+79990000201")

	// Группа, в которой ПОСЛЕДНЕЕ слово за собеседником: только так видно, что
	// автор превью приезжает пиром, а не строкой от сервера.
	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{
		"title": "Наша группа", "member_ids": []int64{idB},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", rec.Code, rec.Body.String())
	}
	var group struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &group)

	rec = authedReq(t, h, http.MethodPost, "/chats/"+itoa(group.PeerID)+"/messages", tokenB,
		map[string]any{"text": "привет всем"})
	if rec.Code != http.StatusOK {
		t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
	}
	var sent struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sent)
	if strings.Contains(rec.Body.String(), `"seq"`) {
		t.Fatalf("в ответе осталось второе число: %s", rec.Body.String())
	}

	body := getChats(t, h, tokenA, "")
	if len(body.Dialogs) != 1 {
		t.Fatalf("dialogs=%d, want 1", len(body.Dialogs))
	}
	d := body.Dialogs[0]

	if d.Underscore != "dialog" {
		t.Errorf("строка списка = %q; want конструктор dialog", d.Underscore)
	}
	// Ссылка на пир — конструктор, а не плоское число.
	if d.Peer.Underscore != "peerChannel" || -d.Peer.ChannelID != group.PeerID {
		t.Errorf("peer = %+v; want peerChannel(%d)", d.Peer, -group.PeerID)
	}
	// top_message адресует последнее сообщение ЧИСЛОМ — тем же, которым оно
	// адресуется везде (номер в чате).
	if d.TopMessage != sent.ID {
		t.Errorf("top_message = %d; want %d", d.TopMessage, sent.ID)
	}
	// …а сам объект едет вектором messages.
	if len(body.Messages) != 1 || int64(body.Messages[0]["id"].(float64)) != sent.ID {
		t.Fatalf("messages = %v; want последнее сообщение объектом", body.Messages)
	}
	// Вектор messages контейнера наполняет ТОТ ЖЕ конструктор, что и история:
	// временного проводного рендерера из delivery/http больше нет.
	if body.Messages[0]["_"] != "message" || body.Messages[0]["message"] != "привет всем" {
		t.Errorf("последнее сообщение = %v; want конструктор message", body.Messages[0])
	}

	// Тело группы — конструктор channel в chats. Ключ `chats` наконец означает
	// ЧАТЫ, а не строки диалогов.
	if len(body.Chats) != 1 {
		t.Fatalf("chats = %v; want тело группы", body.Chats)
	}
	if body.Chats[0]["_"] != "channel" || body.Chats[0]["title"] != "Наша группа" {
		t.Errorf("chats[0] = %v; want channel «Наша группа»", body.Chats[0])
	}
	if pf, _ := body.Chats[0]["pFlags"].(map[string]any); pf["megagroup"] != true {
		t.Errorf("вид чата не выражен флагом megagroup: %v", body.Chats[0]["pFlags"])
	}

	// АВТОР последнего сообщения — пир в users. Прежде его не было в ответе
	// вовсе, из-за чего имя в превью склеивал сервер (last_sender_name).
	var author map[string]any
	for _, u := range body.Users {
		if int64(u["id"].(float64)) == idB {
			author = u
		}
	}
	if author == nil {
		t.Fatalf("автора последнего сообщения (%d) нет в users: %v", idB, body.Users)
	}
	if author["_"] != "user" || author["first_name"] == "" {
		t.Errorf("автор = %v; want конструктор user с first_name", author)
	}

	// Того, что снято решениями Р3, Р4 и Р8, в СТРОКЕ ДИАЛОГА нет вовсе: ни
	// выжимки последнего сообщения с серверным именем автора, ни вида чата
	// строкой, ни булева мьюта. Проверяется по сырой строке, потому что
	// разобранная структура молча проглотила бы лишние ключи.
	rec = authedReq(t, h, http.MethodGet, "/chats", tokenA, nil)
	var envelope struct {
		Dialogs []json.RawMessage `json:"dialogs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("разбор контейнера: %v", err)
	}
	for _, gone := range []string{"sender_name", "display_name", "last_message", `"type"`, `"muted"`, "archived", "title"} {
		if strings.Contains(string(envelope.Dialogs[0]), gone) {
			t.Errorf("снятое поле %s осталось в строке диалога: %s", gone, envelope.Dialogs[0])
		}
	}
	// Булева «это всё» на уровне контейнера тоже нет: конец списка выражает
	// выбор конструктора (отсутствие count).
	if strings.Contains(rec.Body.String(), "is_end") {
		t.Errorf("is_end остался на проводе: %s", rec.Body.String())
	}
}

// Приватный диалог: тела чата нет вовсе — пир это собеседник, и он едет в
// users. Ровно решение №1 разбора пиров, доведённое до контейнера.
func TestListDialogs_PrivatePeerGoesToUsers_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000210")
	_, idB := signUp(t, h, pool, "+79990000211")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}

	body := getChats(t, h, tokenA, "")
	if len(body.Dialogs) != 1 || body.Dialogs[0].Peer.Underscore != "peerUser" {
		t.Fatalf("peer = %+v; want peerUser", body.Dialogs[0].Peer)
	}
	if body.Dialogs[0].Peer.UserID != idB {
		t.Errorf("peer user_id = %d; want %d", body.Dialogs[0].Peer.UserID, idB)
	}
	if len(body.Chats) != 0 {
		t.Errorf("у приватного диалога тела чата быть не должно: %v", body.Chats)
	}
	if len(body.Users) != 1 || int64(body.Users[0]["id"].(float64)) != idB {
		t.Errorf("users = %v; want собеседника", body.Users)
	}
	// Сообщений нет — вектор едет пустым, а не null: обязательный Vector<T>.
	if body.Messages == nil || len(body.Messages) != 0 {
		t.Errorf("messages = %v; want []", body.Messages)
	}
	if body.Dialogs[0].TopMessage != 0 {
		t.Errorf("top_message пустого чата = %d; want 0", body.Dialogs[0].TopMessage)
	}
}

// Мьют на срок доезжает СРОКОМ (решение Р4). Прежде витрина схлопывала его в
// булево ещё в SQL, и «заглушить на час» работало как «заглушить навсегда».
func TestListDialogs_MuteCarriesDeadline_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000220")
	_, idB := signUp(t, h, pool, "+79990000221")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	peer := itoa(created.PeerID)

	until := time.Now().Add(time.Hour).Unix()
	rec = authedReq(t, h, http.MethodPost, "/chats/"+peer+"/mute", tokenA,
		map[string]any{"muted": true, "until": until})
	if rec.Code != http.StatusOK {
		t.Fatalf("mute: %d %s", rec.Code, rec.Body.String())
	}

	ns := getChats(t, h, tokenA, "").Dialogs[0].NotifySettings
	if ns["_"] != "peerNotifySettings" {
		t.Fatalf("notify_settings = %v; want конструктор peerNotifySettings", ns)
	}
	got, ok := ns["mute_until"].(float64)
	if !ok || int64(got) != until {
		t.Fatalf("mute_until = %v; want %d — срок обязан доехать наружу", ns["mute_until"], until)
	}
	if int64(got) == domain.MuteUntilForever {
		t.Fatal("временный мьют схлопнулся в «навсегда»")
	}

	// «Навсегда» — тот же механизм, просто далёкий срок.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+peer+"/mute", tokenA, map[string]any{"muted": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("mute forever: %d %s", rec.Code, rec.Body.String())
	}
	ns = getChats(t, h, tokenA, "").Dialogs[0].NotifySettings
	if int64(ns["mute_until"].(float64)) != domain.MuteUntilForever {
		t.Fatalf("«навсегда» = %v; want %d", ns["mute_until"], domain.MuteUntilForever)
	}

	// Снятие — отсутствие переопределения, а не «замьючен=false».
	rec = authedReq(t, h, http.MethodPost, "/chats/"+peer+"/mute", tokenA, map[string]any{"muted": false})
	if rec.Code != http.StatusOK {
		t.Fatalf("unmute: %d %s", rec.Code, rec.Body.String())
	}
	ns = getChats(t, h, tokenA, "").Dialogs[0].NotifySettings
	if _, ok := ns["mute_until"]; ok {
		t.Fatalf("после снятия mute_until = %v; want отсутствие ключа", ns["mute_until"])
	}
}

// Пер-юзерная очистка истории обязана пережить перевод на контейнер: без
// `seq > cleared_max_seq` в LATERAL очищенная история вернулась бы в превью.
func TestListDialogs_ClearedHistoryStaysCleared_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000230")
	tokenB, idB := signUp(t, h, pool, "+79990000231")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	peerA := itoa(created.PeerID)

	rec = authedReq(t, h, http.MethodPost, "/chats/"+peerA+"/messages", tokenA, map[string]any{"text": "видно"})
	if rec.Code != http.StatusOK {
		t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
	}

	if rec := authedReq(t, h, http.MethodPost, "/chats/"+peerA+"/clear", tokenA, nil); rec.Code != http.StatusOK {
		t.Fatalf("clear: %d %s", rec.Code, rec.Body.String())
	}

	mine := getChats(t, h, tokenA, "")
	if mine.Dialogs[0].TopMessage != 0 || len(mine.Messages) != 0 {
		t.Fatalf("после очистки истории превью осталось: top_message=%d messages=%v",
			mine.Dialogs[0].TopMessage, mine.Messages)
	}
	// У ДРУГОЙ стороны очистка своя: её превью на месте.
	theirs := getChats(t, h, tokenB, "")
	if theirs.Dialogs[0].TopMessage == 0 || len(theirs.Messages) != 1 {
		t.Fatalf("чужая очистка задела собеседника: top_message=%d messages=%v",
			theirs.Dialogs[0].TopMessage, theirs.Messages)
	}
}

// Страница отдаёт последние сообщения ТОЛЬКО своей страницы, а не всего списка:
// иначе контейнер вырос бы до размера всей истории превью.
func TestListDialogs_MessagesOnlyForPage_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000240")
	for _, phone := range []string{"+79990000241", "+79990000242", "+79990000243"} {
		_, id := signUp(t, h, pool, phone)
		rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": id})
		var created struct {
			PeerID int64 `json:"peer_id"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &created)
		if rec := authedReq(t, h, http.MethodPost, "/chats/"+itoa(created.PeerID)+"/messages", tokenA,
			map[string]any{"text": "привет"}); rec.Code != http.StatusOK {
			t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
		}
	}

	full := getChats(t, h, tokenA, "")
	if len(full.Messages) != 3 {
		t.Fatalf("весь список: messages=%d, want 3", len(full.Messages))
	}
	page := getChats(t, h, tokenA, "?limit=1")
	if len(page.Dialogs) != 1 || len(page.Messages) != 1 {
		t.Fatalf("страница: dialogs=%d messages=%d, want 1 1", len(page.Dialogs), len(page.Messages))
	}
	if page.Messages[0]["id"] == nil || int64(page.Messages[0]["id"].(float64)) != page.Dialogs[0].TopMessage {
		t.Errorf("сообщение страницы не то, на которое ссылается её диалог: %v vs %d",
			page.Messages[0]["id"], page.Dialogs[0].TopMessage)
	}
}
