package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// Список тем форума — контейнер `messages.forumTopics`. Строка несёт состояние
// чтения и ССЫЛКУ на последнее сообщение; само сообщение едет вектором
// `messages`, карточки авторов — вектором `users`. Прежде витрина везла
// выжимки (`last_text`, `last_type`, `last_at`) и склеенное сервером
// ПОДЗАПРОСОМ `last_sender_name`.

type forumTopicsWire struct {
	Underscore string `json:"_"`
	Count      int    `json:"count"`
	Topics     []struct {
		Underscore string          `json:"_"`
		PFlags     map[string]bool `json:"pFlags"`
		ID         int64           `json:"id"`
		Title      string          `json:"title"`
		TopMessage int64           `json:"top_message"`
		ReadInbox  int64           `json:"read_inbox_max_id"`
		Unread     int             `json:"unread_count"`
		FromID     struct {
			UserID int64 `json:"user_id"`
		} `json:"from_id"`
		NotifySettings struct {
			Underscore string `json:"_"`
			MuteUntil  *int   `json:"mute_until"`
		} `json:"notify_settings"`
	} `json:"topics"`
	Messages []struct {
		ID      int64  `json:"id"`
		Message string `json:"message"`
	} `json:"messages"`
	Chats []map[string]any `json:"chats"`
	Users []struct {
		ID        int64  `json:"id"`
		FirstName string `json:"first_name"`
	} `json:"users"`
}

func TestForumTopics_ContainerCarriesMessageNotSnapshot(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990080001")
	tokenB, idB := signUp(t, h, pool, "+79990080002")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Форум"})
	if rec.Code != http.StatusOK {
		t.Fatalf("создание группы: %d %s", rec.Code, rec.Body.String())
	}
	cid := itoa(createdPeerID(t, rec))

	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/members", tokenA,
		map[string]int64{"user_id": idB}); rec.Code != http.StatusOK {
		t.Fatalf("добавление участника: %d %s", rec.Code, rec.Body.String())
	}
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/forum", tokenA,
		map[string]any{"enabled": true}); rec.Code != http.StatusOK {
		t.Fatalf("включение тем: %d %s", rec.Code, rec.Body.String())
	}

	// Создание темы — messages.createForumTopic: Updates со служебкой
	// создания, номер темы — её id (tweb appMessagesManager.ts:10100-10101).
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/topics", tokenA,
		map[string]any{"title": "Баги", "icon_color": 3, "icon_emoji": "🐞"})
	if rec.Code != http.StatusOK {
		t.Fatalf("создание темы: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Underscore string `json:"_"`
		Updates    []struct {
			Underscore string `json:"_"`
			Message    struct {
				Underscore string `json:"_"`
				ID         int64  `json:"id"`
				Action     struct {
					Underscore string `json:"_"`
					Title      string `json:"title"`
					Emoji      string `json:"icon_emoji_emoticon"`
				} `json:"action"`
			} `json:"message"`
		} `json:"updates"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.Underscore != "updates" || len(created.Updates) != 1 ||
		created.Updates[0].Underscore != "updateNewMessage" ||
		created.Updates[0].Message.Action.Underscore != "messageActionTopicCreate" ||
		created.Updates[0].Message.Action.Title != "Баги" || created.Updates[0].Message.Action.Emoji != "🐞" {
		t.Fatalf("ответ создания темы = %s", rec.Body.String())
	}
	// Тема адресуется ОДНИМ числом — номером служебки создания.
	number := created.Updates[0].Message.ID
	topicID := itoa(number)

	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/topics", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("список тем: %d %s", rec.Code, rec.Body.String())
	}
	var list forumTopicsWire
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("список не разбирается: %v (%s)", err, rec.Body.String())
	}
	if list.Underscore != "messages.forumTopics" || list.Count != len(list.Topics) {
		t.Fatalf("контейнер = %s", rec.Body.String())
	}
	// General заводится вместе с форумом, поэтому тем две. General — id 1
	// (tweb GENERAL_TOPIC_ID), своих параметров root_msg_id/is_general нет.
	var mine, general int
	for _, tp := range list.Topics {
		if tp.Underscore != "forumTopic" {
			t.Fatalf("строка не конструктором: %s", rec.Body.String())
		}
		if tp.ID == 1 {
			general++
			continue
		}
		mine++
		if tp.ID != number || tp.Title != "Баги" || tp.FromID.UserID != idA || !tp.PFlags["my"] {
			t.Fatalf("строка темы = %s", rec.Body.String())
		}
	}
	if mine != 1 || general != 1 {
		t.Fatalf("тем %d своих и %d General: %s", mine, general, rec.Body.String())
	}
	for _, dead := range []string{`"root_msg_id"`, `"is_general"`} {
		if strings.Contains(rec.Body.String(), dead) {
			t.Fatalf("%s остался на проводе: %s", dead, rec.Body.String())
		}
	}
	// Векторы контейнера обязательны и едут даже пустыми.
	if list.Messages == nil || list.Chats == nil || list.Users == nil {
		t.Fatalf("векторы контейнера пропали: %s", rec.Body.String())
	}
	// Выжимок последнего сообщения в теле нет вовсе.
	for _, dead := range []string{`"last_text"`, `"last_type"`, `"last_at"`, `"last_sender_name"`, `"msg_count"`, `"pos"`} {
		if strings.Contains(rec.Body.String(), dead) {
			t.Fatalf("выжимка %s осталась на проводе: %s", dead, rec.Body.String())
		}
	}

	// Сообщение в теме пишет ДРУГОЙ участник: так автор темы и автор превью
	// различаются, и карточка второго может доехать только вектором `users`.
	// TL-форма inputReplyToMessage{reply_to_msg_id: тема, top_msg_id: тема}:
	// это не ответ на служебку, а просто сообщение темы.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenB,
		map[string]any{"text": "воспроизводится", "client_msg_id": "t1", "thread_root_id": number, "reply_to_id": number})
	if rec.Code != http.StatusOK {
		t.Fatalf("сообщение в тему: %d %s", rec.Code, rec.Body.String())
	}
	var sent struct {
		ReplyTo struct {
			PFlags map[string]bool `json:"pFlags"`
			MsgID  int64           `json:"reply_to_msg_id"`
			TopID  int64           `json:"reply_to_top_id"`
		} `json:"reply_to"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sent)
	if !sent.ReplyTo.PFlags["forum_topic"] || sent.ReplyTo.MsgID != number || sent.ReplyTo.TopID != 0 {
		t.Fatalf("A1-16: reply_to сообщения темы = %s", rec.Body.String())
	}
	// Сообщение в General: thread_root 1 — без треда.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenB,
		map[string]any{"text": "общее", "client_msg_id": "g1", "thread_root_id": 1, "reply_to_id": 1})
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), `"reply_to"`) {
		t.Fatalf("сообщение в General: %d %s", rec.Code, rec.Body.String())
	}
	// История General — только сообщения без треда (без темы и её служебки).
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/history?thread_root=1", tokenA, nil)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "воспроизводится") ||
		strings.Contains(rec.Body.String(), "messageActionTopicCreate") || !strings.Contains(rec.Body.String(), "общее") {
		t.Fatalf("история General: %d %s", rec.Code, rec.Body.String())
	}

	// Само сообщение приезжает ВЕКТОРОМ контейнера, а строка адресует его
	// числом `top_message`; автор — вектором `users`. Это и есть замена
	// выжимкам: подпись превью собирает клиент.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/topics", tokenA, nil)
	list = forumTopicsWire{}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	var top int64
	for _, tp := range list.Topics {
		if tp.ID == number {
			top = tp.TopMessage
		}
	}
	if top == 0 {
		t.Fatalf("ссылка на последнее сообщение не выведена: %s", rec.Body.String())
	}
	var found bool
	for _, m := range list.Messages {
		if m.ID == top {
			found = true
			if m.Message != "воспроизводится" {
				t.Fatalf("сообщение темы = %s", rec.Body.String())
			}
		}
	}
	if !found {
		t.Fatalf("сообщение темы не доехало вектором: %s", rec.Body.String())
	}
	var topicAuthor, msgAuthor bool
	for _, u := range list.Users {
		if u.ID == idA {
			topicAuthor = true
		}
		if u.ID == idB {
			msgAuthor = true
		}
	}
	if !topicAuthor || !msgAuthor {
		t.Fatalf("карточки авторов не доехали вектором (тема=%v, превью=%v): %s",
			topicAuthor, msgAuthor, rec.Body.String())
	}

	// Заглушённость — СРОК внутри notify_settings, а не булево поле рядом.
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/topics/"+topicID+"/mute", tokenA,
		map[string]any{"mute_until": 2147483647}); rec.Code != http.StatusOK {
		t.Fatalf("мьют темы: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/topics", tokenA, nil)
	list = forumTopicsWire{}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	for _, tp := range list.Topics {
		if tp.ID != number {
			continue
		}
		if tp.NotifySettings.Underscore != "peerNotifySettings" || tp.NotifySettings.MuteUntil == nil ||
			*tp.NotifySettings.MuteUntil != 2147483647 {
			t.Fatalf("мьют не сроком: %s", rec.Body.String())
		}
	}
	if strings.Contains(rec.Body.String(), `"muted"`) {
		t.Fatalf("булево поле muted осталось рядом: %s", rec.Body.String())
	}

	// messages.editForumTopic — PATCH по номеру; ответ — Updates со служебкой.
	rec = authedReq(t, h, http.MethodPatch, "/chats/"+cid+"/topics/"+topicID, tokenA,
		map[string]any{"title": "Баги 2", "closed": true})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "messageActionTopicEdit") ||
		!strings.Contains(rec.Body.String(), `"closed":true`) {
		t.Fatalf("правка темы: %d %s", rec.Code, rec.Body.String())
	}
	// Закреп — Updates с updatePinnedForumTopic; General не закрепляется.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/topics/"+topicID+"/pin", tokenA, map[string]any{"pinned": true})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "updatePinnedForumTopic") {
		t.Fatalf("закреп темы: %d %s", rec.Code, rec.Body.String())
	}
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/topics/1/pin", tokenA, map[string]any{"pinned": true}); rec.Code != http.StatusForbidden {
		t.Fatalf("закреп General: %d %s", rec.Code, rec.Body.String())
	}
	// Номера, который не служебка создания темы, нет — 404.
	if rec := authedReq(t, h, http.MethodPatch, "/chats/"+cid+"/topics/"+itoa(number+1), tokenA,
		map[string]any{"title": "x"}); rec.Code != http.StatusNotFound {
		t.Fatalf("правка по чужому номеру: %d %s", rec.Code, rec.Body.String())
	}
	// Прежние ручки close/hide удалены — их заменил PATCH.
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/topics/"+topicID+"/close", tokenA,
		map[string]any{"closed": false}); rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("старая ручка close жива: %d", rec.Code)
	}
}
