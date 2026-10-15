package http

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
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

// Ф7-Г2: одновременные запросы на открытие платного медиа списывают цену один раз —
// отметка «уже оплачено» и сама разблокировка в одной транзакции, итог Unlock не отбрасывается.
func TestUnlockPaidMedia_ConcurrentChargesOnce(t *testing.T) {
	pool := postgres.NewTestDB(t)
	uc := newChatUC(pool)
	uc.SetPaidMedia(&barrierPaidMedia{PaidMediaRepo: pgadapter.NewPaidMediaRepo(pool), want: 4, release: make(chan struct{})})
	h := NewRouter(newAuthUC(pool), uc, nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	tokenA, idA := signUp(t, h, pool, "+79990140011")
	tokenB, idB := signUp(t, h, pool, "+79990140012")
	chatID, err := uc.CreatePrivateChat(context.Background(), idA, idB)
	if err != nil {
		t.Fatal(err)
	}
	price := int64(5)
	msg, err := uc.Send(context.Background(), usecasechat.SendInput{
		ChatID: chatID, SenderID: idA, Type: "photo", MediaID: ptrInt64(seedMedia(t, pool, idA, "image/jpeg")), PaidMediaPrice: &price, ClientMsgID: "pm1",
	})
	if err != nil {
		t.Fatalf("платное медиа не отправилось: %v", err)
	}
	if r := authedReq(t, h, http.MethodPost, "/stars/topup", tokenB, map[string]any{"amount": 50}); r.Code != http.StatusOK {
		t.Fatalf("пополнение: %d", r.Code)
	}
	balance := func(tk string) int64 {
		return decodeStars(t, authedReq(t, h, http.MethodGet, "/stars/balance", tk, nil)).Balance.Amount
	}

	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := uc.UnlockPaidMedia(context.Background(), msg.ID, idB); err != nil {
				t.Errorf("UnlockPaidMedia: %v", err)
			}
		}()
	}
	wg.Wait()
	if got := balance(tokenB); got != 45 {
		t.Fatalf("баланс покупателя %d, want 45 (одно списание 5)", got)
	}
	if got := balance(tokenA); got != 5 {
		t.Fatalf("баланс продавца %d, want 5 (одно начисление)", got)
	}
}

func ptrInt64(v int64) *int64 { return &v }

// barrierPaidMedia держит первых want вызывающих на проверке «уже оплачено», пока все не
// придут: пока запросы стоят на этой проверке, никто ещё не оплатил — обе ветки гонки
// (проверка снаружи транзакции и списание внутри) срабатывают гарантированно.
type barrierPaidMedia struct {
	usecasechat.PaidMediaRepo
	mu      sync.Mutex
	arrived int
	want    int
	release chan struct{}
}

func (b *barrierPaidMedia) UnlockedByIDs(ctx context.Context, userID int64, ids []int64) (map[int64]bool, error) {
	out, err := b.PaidMediaRepo.UnlockedByIDs(ctx, userID, ids)
	b.mu.Lock()
	b.arrived++
	if b.arrived == b.want {
		close(b.release)
	}
	b.mu.Unlock()
	select {
	case <-b.release:
	case <-time.After(700 * time.Millisecond):
	}
	return out, err
}
