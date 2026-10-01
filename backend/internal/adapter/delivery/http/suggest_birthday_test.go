package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

// О-22: users.suggestBirthday — POST /users/{id}/suggest_birthday кладёт в
// личную переписку служебку messageActionSuggestBirthday с датой внутри; она
// же приезжает получателю историей (действие лежит в messages.action тем же
// объектом, что уезжает на провод).
func TestSuggestBirthday_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	h := NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, nil,
		NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	tokenA, idA := signUp(t, h, pool, "+79990000321")
	tokenB, idB := signUp(t, h, pool, "+79990000322")

	rec := authedReq(t, h, http.MethodPost, "/users/"+itoa(idB)+"/suggest_birthday", tokenA,
		map[string]any{"birthday": map[string]any{"_": "birthday", "day": 8, "month": 3}})
	if rec.Code != http.StatusOK {
		t.Fatalf("suggest: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"messageActionSuggestBirthday"`) {
		t.Fatalf("ответ без действия: %s", rec.Body.String())
	}

	// Получатель видит пилюлю в переписке с предложившим.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(idA)+"/history?limit=10", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("history: %d %s", rec.Code, rec.Body.String())
	}
	var hist struct {
		Messages []struct {
			Underscore string `json:"_"`
			Action     struct {
				Underscore string         `json:"_"`
				Birthday   map[string]any `json:"birthday"`
			} `json:"action"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	found := false
	for _, m := range hist.Messages {
		if m.Action.Underscore == "messageActionSuggestBirthday" {
			found = true
			b := m.Action.Birthday
			// Без года — ключа year нет, как в самом birthday.
			if b["_"] != "birthday" || b["day"] != float64(8) || b["month"] != float64(3) || b["year"] != nil {
				t.Fatalf("дата в действии = %v", b)
			}
		}
	}
	if !found {
		t.Fatalf("у получателя нет служебки: %s", rec.Body.String())
	}

	// Себе и кривую дату — нельзя.
	if rec := authedReq(t, h, http.MethodPost, "/users/"+itoa(idA)+"/suggest_birthday", tokenA,
		map[string]any{"birthday": map[string]any{"day": 8, "month": 3}}); rec.Code != http.StatusBadRequest {
		t.Fatalf("себе: %d, want 400", rec.Code)
	}
	if rec := authedReq(t, h, http.MethodPost, "/users/"+itoa(idB)+"/suggest_birthday", tokenA,
		map[string]any{"birthday": map[string]any{"day": 30, "month": 2}}); rec.Code != http.StatusBadRequest {
		t.Fatalf("30 февраля: %d, want 400", rec.Code)
	}
	if rec := authedReq(t, h, http.MethodPost, "/users/"+itoa(idB)+"/suggest_birthday", tokenA,
		map[string]any{}); rec.Code != http.StatusBadRequest {
		t.Fatalf("без даты: %d, want 400", rec.Code)
	}
}
