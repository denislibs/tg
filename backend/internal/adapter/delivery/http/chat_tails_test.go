package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

// Хвостовые витрины чата: у каждой был безымянный ключ-обёртка вокруг значения
// (`{"user_ids": …}`, `{"media": …}`, `{"id": …}`, `{"theme_id": …}`). Обёртка
// конструктора не имеет — записать её на проводе TL нечем.

func TestChatTails_ValuesTravelWithoutWrappers(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990110001")
	_, idB := signUp(t, h, pool, "+79990110002")

	peer := createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB}))
	cid := itoa(peer)

	rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenA,
		map[string]any{"text": "привет", "client_msg_id": "x1"})
	if rec.Code != http.StatusOK {
		t.Fatalf("сообщение: %d %s", rec.Code, rec.Body.String())
	}
	var sent struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sent)

	// Просмотревшие — ВЕКТОР объявленных строк, а не голые числа под именем поля.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/messages/"+itoa(sent.ID)+"/viewers", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("просмотревшие: %d %s", rec.Code, rec.Body.String())
	}
	var viewers []struct {
		Underscore string `json:"_"`
		UserID     int64  `json:"user_id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &viewers); err != nil {
		t.Fatalf("просмотревшие не вектор: %v (%s)", err, rec.Body.String())
	}
	for _, v := range viewers {
		if v.Underscore != "readParticipantDate" {
			t.Fatalf("строка просмотревших не конструктором: %s", rec.Body.String())
		}
	}

	// «Сообщение этой даты» — САМ номер, а не число под ключом `id`.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/message_by_date?date=1", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("сообщение по дате: %d %s", rec.Code, rec.Body.String())
	}
	var seq int64
	if err := json.Unmarshal(rec.Body.Bytes(), &seq); err != nil || seq == 0 {
		t.Fatalf("номер приехал не числом: %v (%s)", err, rec.Body.String())
	}

	// Участники видеочата — сам ВЕКТОР ключей.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/group_call", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("видеочат: %d %s", rec.Code, rec.Body.String())
	}
	var ids []int64
	if err := json.Unmarshal(rec.Body.Bytes(), &ids); err != nil {
		t.Fatalf("участники не вектор: %v (%s)", err, rec.Body.String())
	}

	// Тема чата: эхо запроса ответом не является — «получилось» конструктором.
	rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/theme", tokenA, map[string]any{"theme_id": "sunset"})
	if rec.Code != http.StatusOK {
		t.Fatalf("тема: %d %s", rec.Code, rec.Body.String())
	}
	if !isBoolTrue(rec.Body.Bytes()) {
		t.Fatalf("тема = %s; ожидался boolTrue", rec.Body.String())
	}

	// «Избранное» — тот же конструктор ключа, что у создания чата.
	if saved := createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/saved", tokenA, map[string]any{})); saved != idA {
		t.Fatalf("ключ «Избранного» = %d, ожидался %d", saved, idA)
	}
}

// Опрос уезжает САМИМ конструктором медиа: обёртки `{"media": …}` больше нет.
func TestChatTails_PollMediaHasNoWrapper(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990110003")
	_, idB := signUp(t, h, pool, "+79990110004")

	peer := createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB}))
	cid := itoa(peer)
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenA,
		map[string]any{"text": "привет", "client_msg_id": "p0"}); rec.Code != http.StatusOK {
		t.Fatalf("первое сообщение: %d %s", rec.Code, rec.Body.String())
	}

	rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/polls", tokenA, map[string]any{
		"question": "Кто?", "options": []string{"я", "не я"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("опрос: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Media struct {
			Poll struct {
				ID int64 `json:"id"`
			} `json:"poll"`
		} `json:"media"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.Media.Poll.ID == 0 {
		t.Fatalf("опрос не создан: %s", rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodPost, "/polls/"+itoa(created.Media.Poll.ID)+"/vote", tokenA,
		map[string]any{"options": []int{0}})
	if rec.Code != http.StatusOK {
		t.Fatalf("голос: %d %s", rec.Code, rec.Body.String())
	}
	var media struct {
		Underscore string `json:"_"`
		Media      any    `json:"media"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &media)
	if media.Underscore != "messageMediaPoll" {
		t.Fatalf("голос = %s; ожидался конструктор медиа в корне", rec.Body.String())
	}
	if media.Media != nil {
		t.Fatalf("обёртка `media` осталась: %s", rec.Body.String())
	}
}
