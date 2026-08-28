package http

import (
	"encoding/json"
	"net/http"
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
		Draft struct {
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

	// Сохранение отвечает ТЕМ ЖЕ кадром, что приезжает живым и что едет
	// списком: третьей формы одного черновика больше нет.
	rec = authedReq(t, h, http.MethodPut, "/chats/"+itoa(created)+"/draft", tokenA,
		map[string]any{"text": "недописанное"})
	if rec.Code != http.StatusOK {
		t.Fatalf("сохранение черновика: %d %s", rec.Code, rec.Body.String())
	}
	var saved struct {
		Underscore string `json:"_"`
		Draft      struct {
			Underscore string `json:"_"`
			Message    string `json:"message"`
		} `json:"draft"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &saved)
	if saved.Underscore != "updateDraftMessage" || saved.Draft.Message != "недописанное" {
		t.Fatalf("сохранение = %s", rec.Body.String())
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
	if u.Underscore != "updateDraftMessage" || u.Draft.Message != "недописанное" || u.Peer.UserID != idB {
		t.Fatalf("кадр списка = %s", rec.Body.String())
	}
	// Обязательные векторы контейнера едут ПУСТЫМИ, а не пропадают.
	if list.Users == nil || list.Chats == nil || list.Date == 0 {
		t.Fatalf("контейнер неполон: %s", rec.Body.String())
	}

	// Пустой текст снимает черновик — КОНСТРУКТОРОМ, а не null.
	rec = authedReq(t, h, http.MethodPut, "/chats/"+itoa(created)+"/draft", tokenA,
		map[string]any{"text": ""})
	_ = json.Unmarshal(rec.Body.Bytes(), &saved)
	if saved.Underscore != "updateDraftMessage" || saved.Draft.Underscore != "draftMessageEmpty" {
		t.Fatalf("снятие черновика = %s", rec.Body.String())
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

	rec = authedReq(t, h, http.MethodPost, "/chats/"+itoa(created)+"/scheduled", tokenA, map[string]any{
		"type": "text", "text": "завтра", "send_at": time.Now().Add(time.Hour).Unix(),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("планирование: %d %s", rec.Code, rec.Body.String())
	}

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
}
