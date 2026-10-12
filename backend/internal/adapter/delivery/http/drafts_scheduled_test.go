package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Черновики и отложенные — витрины-СПИСКИ, у которых конструктор в схеме уже
// был: `Updates` у `messages.getAllDrafts` и `messages.Messages` у
// `messages.getScheduledHistory`. Прежде обе ехали безымянной картой с одним
// ключом (`{"drafts": …}`, `{"scheduled": …}`).

// updatesWire — контейнер `updates`: пачка кадров плюс векторы объектов.
type updatesWire struct {
	Underscore string `json:"_"`
	Updates    []struct {
		Underscore string `json:"_"`
		Peer       struct {
			Underscore string `json:"_"`
			UserID     int64  `json:"user_id"`
		} `json:"peer"`
		TopMsgID int64 `json:"top_msg_id"`
		Draft    struct {
			Underscore string `json:"_"`
			Message    string `json:"message"`
		} `json:"draft"`
	} `json:"updates"`
	Users []map[string]any `json:"users"`
	Chats []map[string]any `json:"chats"`
	Date  int64            `json:"date"`
}

func TestDrafts_ListAndSaveAreTheSameFrame(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990070001")
	_, idB := signUp(t, h, pool, "+79990070002")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("создание чата: %d %s", rec.Code, rec.Body.String())
	}
	created := createdPeerFrom(t, rec)
	// Приватный чат заводится первым сообщением — до него членства нет.
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+itoa(created)+"/messages", tokenA,
		map[string]any{"text": "привет", "client_msg_id": "d1"}); rec.Code != http.StatusOK {
		t.Fatalf("первое сообщение: %d %s", rec.Code, rec.Body.String())
	}

	// Сохранение — messages.saveDraft в форме TL → Bool (layer.d.ts:24059):
	// сам черновик уезжает кадром updateDraftMessage, ответ tweb не читает.
	rec = authedReq(t, h, http.MethodPut, "/chats/"+itoa(created)+"/draft", tokenA,
		map[string]any{"message": "недописанное"})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"boolTrue"`) {
		t.Fatalf("сохранение черновика: %d %s", rec.Code, rec.Body.String())
	}

	// Список — контейнер `updates` из тех же кадров.
	rec = authedReq(t, h, http.MethodGet, "/drafts", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("список черновиков: %d %s", rec.Code, rec.Body.String())
	}
	var list updatesWire
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("список не разбирается: %v (%s)", err, rec.Body.String())
	}
	if list.Underscore != "updates" || len(list.Updates) != 1 {
		t.Fatalf("список = %s", rec.Body.String())
	}
	u := list.Updates[0]
	if u.Underscore != "updateDraftMessage" || u.Draft.Message != "недописанное" || u.Peer.UserID != idB || u.TopMsgID != 0 {
		t.Fatalf("кадр списка = %s", rec.Body.String())
	}
	// Обязательные векторы контейнера едут ПУСТЫМИ, а не пропадают.
	if list.Users == nil || list.Chats == nil || list.Date == 0 {
		t.Fatalf("контейнер неполон: %s", rec.Body.String())
	}

	// Пустой текст снимает черновик.
	if rec = authedReq(t, h, http.MethodPut, "/chats/"+itoa(created)+"/draft", tokenA,
		map[string]any{"message": ""}); rec.Code != http.StatusOK {
		t.Fatalf("снятие черновика: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/drafts", tokenA, nil)
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil || len(list.Updates) != 0 {
		t.Fatalf("после снятия список = %s", rec.Body.String())
	}
}

// Ф-5 п. 3 (A3-32): черновики в двух темах форума и в General — по ключу
// треда; список и строки тем несут их с номером треда (tweb
// appDraftsManager.ts:44-69, dialogs.ts:1693-1697).
func TestDrafts_ForumTopicThreads(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990070011")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Форум"})
	if rec.Code != http.StatusOK {
		t.Fatalf("создание группы: %d %s", rec.Code, rec.Body.String())
	}
	cid := itoa(createdPeerID(t, rec))
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/forum", tokenA,
		map[string]any{"enabled": true}); rec.Code != http.StatusOK {
		t.Fatalf("включение тем: %d %s", rec.Code, rec.Body.String())
	}
	topic := func(title string) int64 {
		rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/topics", tokenA, map[string]any{"title": title})
		var up struct {
			Updates []struct {
				Message struct {
					ID int64 `json:"id"`
				} `json:"message"`
			} `json:"updates"`
		}
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &up) != nil || len(up.Updates) != 1 {
			t.Fatalf("создание темы: %d %s", rec.Code, rec.Body.String())
		}
		return up.Updates[0].Message.ID
	}
	a, b := topic("A"), topic("B")
	save := func(body map[string]any) {
		t.Helper()
		if rec := authedReq(t, h, http.MethodPut, "/chats/"+cid+"/draft", tokenA, body); rec.Code != http.StatusOK {
			t.Fatalf("черновик %v: %d %s", body, rec.Code, rec.Body.String())
		}
	}
	save(map[string]any{"message": "в A", "reply_to": map[string]any{"_": "inputReplyToMessage", "reply_to_msg_id": a}})
	save(map[string]any{"message": "в B", "reply_to": map[string]any{"_": "inputReplyToMessage", "reply_to_msg_id": b}})
	save(map[string]any{"message": "в General", "reply_to": map[string]any{"_": "inputReplyToMessage", "reply_to_msg_id": 1}})

	rec = authedReq(t, h, http.MethodGet, "/drafts", tokenA, nil)
	var list updatesWire
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil || len(list.Updates) != 3 {
		t.Fatalf("список = %s", rec.Body.String())
	}
	want := map[string]int64{"в A": a, "в B": b, "в General": 1}
	for _, u := range list.Updates {
		if want[u.Draft.Message] != u.TopMsgID {
			t.Fatalf("черновик %q: top_msg_id = %d, ждали %d", u.Draft.Message, u.TopMsgID, want[u.Draft.Message])
		}
	}

	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/topics", tokenA, nil)
	var topics struct {
		Topics []struct {
			ID    int64 `json:"id"`
			Draft *struct {
				Underscore string `json:"_"`
				Message    string `json:"message"`
			} `json:"draft"`
		} `json:"topics"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &topics); err != nil || len(topics.Topics) != 3 {
		t.Fatalf("темы = %s", rec.Body.String())
	}
	for _, tp := range topics.Topics {
		if tp.Draft == nil || tp.Draft.Underscore != "draftMessage" {
			t.Fatalf("у темы %d нет черновика: %s", tp.ID, rec.Body.String())
		}
	}

	// Тред не темы — TOPIC_ID_INVALID.
	rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/draft", tokenA,
		map[string]any{"message": "x", "reply_to": map[string]any{"reply_to_msg_id": a, "top_msg_id": 100500}})
	if rec.Code == http.StatusOK {
		t.Fatalf("черновик в несуществующей теме принят: %s", rec.Body.String())
	}
}

func TestScheduled_ListIsAMessagesContainer(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990070003")
	_, idB := signUp(t, h, pool, "+79990070004")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	created := createdPeerFrom(t, rec)
	// Приватный чат заводится первым сообщением — до него членства нет.
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+itoa(created)+"/messages", tokenA,
		map[string]any{"text": "привет", "client_msg_id": "s1"}); rec.Code != http.StatusOK {
		t.Fatalf("первое сообщение: %d %s", rec.Code, rec.Body.String())
	}

	// Отложенное — обычная отправка с schedule_date (tweb
	// appMessagesManager.ts:2741); ответ — контейнер updates с
	// updateNewScheduledMessage.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+itoa(created)+"/messages", tokenA, map[string]any{
		"text": "завтра", "client_msg_id": "s2", "schedule_date": time.Now().Add(time.Hour).Unix(),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("планирование: %d %s", rec.Code, rec.Body.String())
	}
	var sent struct {
		Underscore string `json:"_"`
		Updates    []struct {
			Underscore string `json:"_"`
			Message    struct {
				ID     int64           `json:"id"`
				PFlags map[string]bool `json:"pFlags"`
			} `json:"message"`
		} `json:"updates"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sent); err != nil || sent.Underscore != "updates" ||
		len(sent.Updates) != 1 || sent.Updates[0].Underscore != "updateNewScheduledMessage" ||
		!sent.Updates[0].Message.PFlags["is_scheduled"] {
		t.Fatalf("ответ постановки = %s", rec.Body.String())
	}
	schedID := sent.Updates[0].Message.ID

	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(created)+"/scheduled", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("список отложенных: %d %s", rec.Code, rec.Body.String())
	}
	// Тот же контейнер, что у истории: набор отдан целиком, поэтому
	// `messages.messages` — параметра count у него нет.
	var out struct {
		Underscore string `json:"_"`
		Messages   []struct {
			Underscore string `json:"_"`
			Message    string `json:"message"`
		} `json:"messages"`
		Users []struct {
			ID int64 `json:"id"`
		} `json:"users"`
		Chats []map[string]any `json:"chats"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("список не разбирается: %v (%s)", err, rec.Body.String())
	}
	if out.Underscore != "messages.messages" || len(out.Messages) != 1 ||
		out.Messages[0].Underscore != "message" || out.Messages[0].Message != "завтра" {
		t.Fatalf("список отложенных = %s", rec.Body.String())
	}
	// Карточка автора едет ВЕКТОРОМ контейнера — получатель списка обязан
	// уметь нарисовать подпись, ни о ком не спрашивая отдельно.
	if len(out.Users) != 1 || out.Users[0].ID != idA {
		t.Fatalf("автор в контейнере = %s", rec.Body.String())
	}
	if out.Chats == nil {
		t.Fatalf("вектор chats пропал: %s", rec.Body.String())
	}

	// Правка текста отложенного — editMessage с schedule_date; без изменений —
	// MESSAGE_NOT_MODIFIED (tweb appMessagesManager.ts:2226-2240).
	date := time.Now().Add(2 * time.Hour).Unix()
	rec = authedReq(t, h, http.MethodPatch, "/chats/"+itoa(created)+"/messages/"+itoa(schedID), tokenA,
		map[string]any{"text": "послезавтра", "schedule_date": date})
	if rec.Code != http.StatusOK {
		t.Fatalf("правка отложенного: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPatch, "/chats/"+itoa(created)+"/messages/"+itoa(schedID), tokenA,
		map[string]any{"text": "послезавтра", "schedule_date": date})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "MESSAGE_NOT_MODIFIED") {
		t.Fatalf("правка без изменений: %d %s", rec.Code, rec.Body.String())
	}

	// Публикация пачкой: ответ — updateDeleteScheduledMessages с номером опубликованного.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+itoa(created)+"/scheduled/send_now", tokenA,
		map[string]any{"id": []int64{schedID}})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"updateDeleteScheduledMessages"`) ||
		!strings.Contains(rec.Body.String(), `"sent_messages"`) {
		t.Fatalf("send_now: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(created)+"/scheduled", tokenA, nil)
	if strings.Contains(rec.Body.String(), "послезавтра") {
		t.Fatalf("опубликованное осталось в ленте отложенных: %s", rec.Body.String())
	}

	// Отложенный опрос (просьба C1): ручка опросов принимает schedule_date как
	// sendMedia{inputMediaPoll} у tweb (appMessagesManager.ts:4152-4166); ответ —
	// updates, опрос лежит в ленте отложенных.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+itoa(created)+"/polls", tokenA, map[string]any{
		"question": "Куда?", "options": []string{"сюда", "туда"}, "client_msg_id": "poll-1",
		"schedule_date": time.Now().Add(time.Hour).Unix(), "schedule_repeat_period": 86400,
	})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"updateNewScheduledMessage"`) ||
		!strings.Contains(rec.Body.String(), `"schedule_repeat_period":86400`) {
		t.Fatalf("отложенный опрос: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(created)+"/scheduled", tokenA, nil)
	if !strings.Contains(rec.Body.String(), "Куда?") {
		t.Fatalf("опроса нет в ленте отложенных: %s", rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/chats/"+itoa(created)+"/polls", tokenA, map[string]any{
		"question": "Q", "options": []string{"a", "b"}, "schedule_date": 1,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("опрос с прошедшей датой: %d %s", rec.Code, rec.Body.String())
	}
}
