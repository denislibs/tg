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
		RootMsgID  int64           `json:"root_msg_id"`
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

	// Созданная тема — та же СТРОКА, что едет в списке.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/topics", tokenA,
		map[string]any{"title": "Баги", "icon_color": 3, "icon_emoji": "🐞"})
	if rec.Code != http.StatusOK {
		t.Fatalf("создание темы: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Underscore string          `json:"_"`
		PFlags     map[string]bool `json:"pFlags"`
		ID         int64           `json:"id"`
		RootMsgID  int64           `json:"root_msg_id"`
		Title      string          `json:"title"`
		Emoji      string          `json:"icon_emoji_emoticon"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.Underscore != "forumTopic" || created.Title != "Баги" || created.Emoji != "🐞" {
		t.Fatalf("созданная тема = %s", rec.Body.String())
	}
	// «Мою» тему называет ФЛАГ — его отсутствие и есть «не моя».
	if !created.PFlags["my"] {
		t.Fatalf("своя тема без флага my: %s", rec.Body.String())
	}
	// Мьют и пометка «прочитано» адресуются КОРНЕМ темы (пара chat+root — ключ
	// её состояния), а не ключом строки.
	topicID := itoa(created.RootMsgID)

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
	// General заводится вместе с форумом, поэтому тем две.
	var mine, general int
	for _, tp := range list.Topics {
		if tp.Underscore != "forumTopic" {
			t.Fatalf("строка не конструктором: %s", rec.Body.String())
		}
		if tp.PFlags["is_general"] {
			general++
			continue
		}
		mine++
		if tp.Title != "Баги" || tp.FromID.UserID != idA {
			t.Fatalf("строка темы = %s", rec.Body.String())
		}
		if tp.RootMsgID == 0 {
			t.Fatalf("номер корня темы не выведен: %s", rec.Body.String())
		}
	}
	if mine != 1 || general != 1 {
		t.Fatalf("тем %d своих и %d General: %s", mine, general, rec.Body.String())
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
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenB,
		map[string]any{"text": "воспроизводится", "client_msg_id": "t1", "thread_root_id": created.RootMsgID})
	if rec.Code != http.StatusOK {
		t.Fatalf("сообщение в тему: %d %s", rec.Code, rec.Body.String())
	}

	// Само сообщение приезжает ВЕКТОРОМ контейнера, а строка адресует его
	// числом `top_message`; автор — вектором `users`. Это и есть замена
	// выжимкам: подпись превью собирает клиент.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/topics", tokenA, nil)
	list = forumTopicsWire{}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	var top int64
	for _, tp := range list.Topics {
		if !tp.PFlags["is_general"] {
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
		map[string]any{"muted": true}); rec.Code != http.StatusOK {
		t.Fatalf("мьют темы: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/topics", tokenA, nil)
	list = forumTopicsWire{}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	for _, tp := range list.Topics {
		if tp.PFlags["is_general"] {
			continue
		}
		if tp.NotifySettings.Underscore != "peerNotifySettings" || tp.NotifySettings.MuteUntil == nil {
			t.Fatalf("мьют не сроком: %s", rec.Body.String())
		}
	}
	if strings.Contains(rec.Body.String(), `"muted"`) {
		t.Fatalf("булево поле muted осталось рядом: %s", rec.Body.String())
	}
}
