package http

import (
	"encoding/json"
	"net/http"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

// Ф7-Г2: платная ⭐-реакция идемпотентна по random_id (TL messages.sendPaidReaction,
// tweb appReactionsManager.ts:960-970): повтор — подряд и параллельно — списывает один раз.
func TestStarReaction_RandomIDIdempotent(t *testing.T) {
	pool := postgres.NewTestDB(t)
	uc := newChatUC(pool)
	h := NewRouter(newAuthUC(pool), uc, nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	tokenA, idA := signUp(t, h, pool, "+79990140001")
	tokenB, idB := signUp(t, h, pool, "+79990140002")
	peerA := itoa(createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})))
	peerB := itoa(createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenB, map[string]int64{"user_id": idA})))
	rec := authedReq(t, h, http.MethodPost, "/chats/"+peerA+"/messages", tokenA, map[string]any{"text": "post", "client_msg_id": "i1"})
	var sent struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sent)
	if r := authedReq(t, h, http.MethodPost, "/stars/topup", tokenB, map[string]any{"amount": 50}); r.Code != http.StatusOK {
		t.Fatalf("пополнение: %d", r.Code)
	}
	balance := func() int64 {
		return decodeStars(t, authedReq(t, h, http.MethodGet, "/stars/balance", tokenB, nil)).Balance.Amount
	}
	path := "/chats/" + peerB + "/messages/" + itoa(sent.ID) + "/star_reaction"
	// random_id — long, на проводе строка (JS не держит int64 числом)
	body := map[string]any{"count": 2, "anonymous": false, "random_id": "7000000000000000001"}

	first := authedReq(t, h, http.MethodPost, path, tokenB, body)
	second := authedReq(t, h, http.MethodPost, path, tokenB, body)
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("первый %d (%s), повтор %d (%s)", first.Code, first.Body.String(), second.Code, second.Body.String())
	}
	var a, b struct {
		Updates []struct {
			Reactions struct {
				Results []struct{ Count int } `json:"results"`
			} `json:"reactions"`
		} `json:"updates"`
	}
	_ = json.Unmarshal(first.Body.Bytes(), &a)
	_ = json.Unmarshal(second.Body.Bytes(), &b)
	if len(a.Updates) != 1 || len(b.Updates) != 1 ||
		a.Updates[0].Reactions.Results[0].Count != 2 || b.Updates[0].Reactions.Results[0].Count != 2 {
		t.Fatalf("повтор вернул другой результат: %s / %s", first.Body.String(), second.Body.String())
	}
	if got := balance(); got != 48 {
		t.Fatalf("после двух одинаковых запросов баланс %d, want 48 (одно списание)", got)
	}

	// параллельные дубли одного нового ключа — тоже одно списание
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := authedReq(t, h, http.MethodPost, path, tokenB, map[string]any{"count": 3, "anonymous": false, "random_id": "7000000000000000002"})
			if r.Code != http.StatusOK {
				t.Errorf("параллельный дубль: %d %s", r.Code, r.Body.String())
			}
		}()
	}
	wg.Wait()
	if got := balance(); got != 45 {
		t.Fatalf("после 8 параллельных дублей баланс %d, want 45 (одно списание 3)", got)
	}

	// тот же ключ с другим count — отказ, не молчаливый повтор
	r := authedReq(t, h, http.MethodPost, path, tokenB, map[string]any{"count": 9, "random_id": "7000000000000000002"})
	if r.Code != http.StatusBadRequest {
		t.Fatalf("тот же random_id с другим count: %d %s, want 400", r.Code, r.Body.String())
	}
}
