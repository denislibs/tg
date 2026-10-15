package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

// Б-10: розыгрыш не раздаёт звёзды и Premium из воздуха. Вклад stars × winners
// списывается с создателя в транзакции создания, приз платится из вклада,
// остаток возвращается, параллельные читатели закрывают розыгрыш один раз.

func giveawayRouter(t *testing.T, premiumGiveaways bool) (http.Handler, *pgxpool.Pool) {
	t.Helper()
	pool := postgres.NewTestDB(t)
	uc := newChatUC(pool)
	uc.SetGiveaways(pgadapter.NewGiveawaysRepo(pool))
	uc.SetPremiumRepo(pgadapter.NewPremiumRepo(pool))
	uc.SetPremiumGiveaways(premiumGiveaways)
	return NewRouter(newAuthUC(pool), uc, nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, true), pool
}

func starsBalance(t *testing.T, h http.Handler, token string) int64 {
	t.Helper()
	rec := authedReq(t, h, http.MethodGet, "/stars/balance", token, nil)
	var body struct {
		Balance struct {
			Amount int64 `json:"amount"`
		} `json:"balance"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("balance: %d %s", rec.Code, rec.Body.String())
	}
	return body.Balance.Amount
}

func giveawayCount(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM giveaways`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func newGiveawayChannel(t *testing.T, h http.Handler, token, username string) string {
	t.Helper()
	rec := authedReq(t, h, http.MethodPost, "/channels", token, map[string]any{
		"title": "Giveaways " + username, "username": username, "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	return itoa(createdPeerID(t, rec))
}

func createGiveaway(t *testing.T, h http.Handler, token, cid string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	if body["until_date"] == nil {
		body["until_date"] = time.Now().Add(time.Hour).UnixMilli()
	}
	return authedReq(t, h, http.MethodPost, "/channels/"+cid+"/giveaways", token, body)
}

func TestCreateGiveaway_RequiresDeposit(t *testing.T) {
	h, pool := giveawayRouter(t, false)
	owner, _ := signUp(t, h, pool, "+79990007601")
	cid := newGiveawayChannel(t, h, owner, "gvdeposit")

	// Потолок приза: 1e15 звёзд - отказ без списаний и без розыгрыша.
	rec := createGiveaway(t, h, owner, cid, map[string]any{"prize_kind": "stars", "stars": int64(1e15), "winners_count": 1})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("1e15 звёзд: %d %s; ждали 400", rec.Code, rec.Body.String())
	}
	// В пределах потолка, но баланса нет: BALANCE_TOO_LOW, розыгрыша и сообщения нет.
	rec = createGiveaway(t, h, owner, cid, map[string]any{"prize_kind": "stars", "stars": 1_000_000, "winners_count": 100})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "BALANCE_TOO_LOW") {
		t.Fatalf("без баланса: %d %s; ждали 400 BALANCE_TOO_LOW", rec.Code, rec.Body.String())
	}
	if n := giveawayCount(t, pool); n != 0 {
		t.Fatalf("розыгрышей после отказов = %d, want 0", n)
	}
	if b := starsBalance(t, h, owner); b != 0 {
		t.Fatalf("баланс = %d, want 0", b)
	}
}

func TestCreateGiveaway_DebitsCreatorExactly(t *testing.T) {
	h, pool := giveawayRouter(t, false)
	owner, _ := signUp(t, h, pool, "+79990007602")
	cid := newGiveawayChannel(t, h, owner, "gvdebit")
	if rec := authedReq(t, h, http.MethodPost, "/stars/topup", owner, map[string]any{"amount": 1000}); rec.Code != http.StatusOK {
		t.Fatalf("topup: %d", rec.Code)
	}

	rec := createGiveaway(t, h, owner, cid, map[string]any{"prize_kind": "stars", "stars": 100, "winners_count": 3})
	if rec.Code != http.StatusOK {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	if b := starsBalance(t, h, owner); b != 700 {
		t.Fatalf("баланс создателя = %d, want 700 (1000 - 100×3)", b)
	}
	if n := giveawayCount(t, pool); n != 1 {
		t.Fatalf("розыгрышей = %d, want 1", n)
	}
	var kind string
	var amount int64
	if err := pool.QueryRow(t.Context(),
		`SELECT kind, amount FROM star_transactions WHERE kind='giveaway_created'`).Scan(&kind, &amount); err != nil || amount != -300 {
		t.Fatalf("строка кошелька: %q %d %v; ждали -300", kind, amount, err)
	}
	// Не хватает на второй (700 < 100×8 ... 800): отказ, баланс не тронут.
	rec = createGiveaway(t, h, owner, cid, map[string]any{"prize_kind": "stars", "stars": 100, "winners_count": 8})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "BALANCE_TOO_LOW") {
		t.Fatalf("второй розыгрыш: %d %s", rec.Code, rec.Body.String())
	}
	if b := starsBalance(t, h, owner); b != 700 || giveawayCount(t, pool) != 1 {
		t.Fatalf("после отказа: баланс %d, розыгрышей %d", b, giveawayCount(t, pool))
	}
}

func TestCreateGiveaway_ConcurrentNoDoubleSpend(t *testing.T) {
	h, pool := giveawayRouter(t, false)
	owner, _ := signUp(t, h, pool, "+79990007603")
	cid := newGiveawayChannel(t, h, owner, "gvrace")
	authedReq(t, h, http.MethodPost, "/stars/topup", owner, map[string]any{"amount": 100})

	var wg sync.WaitGroup
	codes := make([]int, 8)
	for n := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[n] = createGiveaway(t, h, owner, cid, map[string]any{"prize_kind": "stars", "stars": 100, "winners_count": 1}).Code
		}()
	}
	wg.Wait()
	ok := 0
	for _, c := range codes {
		if c == http.StatusOK {
			ok++
		}
	}
	if ok != 1 {
		t.Fatalf("успешных созданий = %d (%v), want 1 при балансе на один розыгрыш", ok, codes)
	}
	if b := starsBalance(t, h, owner); b != 0 {
		t.Fatalf("баланс = %d, want 0", b)
	}
	if n := giveawayCount(t, pool); n != 1 {
		t.Fatalf("розыгрышей = %d, want 1", n)
	}
}

func TestGiveaway_PrizeFromDepositAndRefund(t *testing.T) {
	h, pool := giveawayRouter(t, false)
	owner, _ := signUp(t, h, pool, "+79990007604")
	guest, _ := signUp(t, h, pool, "+79990007605")
	cid := newGiveawayChannel(t, h, owner, "gvprize")
	authedReq(t, h, http.MethodPost, "/stars/topup", owner, map[string]any{"amount": 1000})
	if rec := authedReq(t, h, http.MethodPost, "/channels/join", guest, map[string]any{"username": "gvprize"}); rec.Code != http.StatusOK {
		t.Fatalf("join: %d", rec.Code)
	}
	rec := createGiveaway(t, h, owner, cid, map[string]any{
		"prize_kind": "stars", "stars": 100, "winners_count": 3,
		"until_date": time.Now().Add(2 * time.Second).UnixMilli(),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var gid int64
	if err := pool.QueryRow(t.Context(), `SELECT id FROM giveaways`).Scan(&gid); err != nil {
		t.Fatal(err)
	}
	if rec := authedReq(t, h, http.MethodPost, "/giveaways/"+itoa(gid)+"/participate", guest, nil); rec.Code != http.StatusOK {
		t.Fatalf("participate: %d %s", rec.Code, rec.Body.String())
	}
	time.Sleep(2500 * time.Millisecond)

	// Десять читателей одновременно после срока: розыгрыш закрывает один.
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			authedReq(t, h, http.MethodGet, "/giveaways/"+itoa(gid), guest, nil)
		}()
	}
	wg.Wait()

	if b := starsBalance(t, h, guest); b != 100 {
		t.Fatalf("баланс победителя = %d, want 100 (ровно один приз)", b)
	}
	// 1000 - 300 вклада + 200 возврата неразданных мест.
	if b := starsBalance(t, h, owner); b != 900 {
		t.Fatalf("баланс создателя = %d, want 900", b)
	}
	// Повторное чтение ничего не начисляет.
	authedReq(t, h, http.MethodGet, "/giveaways/"+itoa(gid), guest, nil)
	if b := starsBalance(t, h, guest); b != 100 {
		t.Fatalf("после повторного чтения победитель = %d, want 100", b)
	}
}

func TestCreateGiveaway_PremiumOnlyUnderDevPurchases(t *testing.T) {
	for _, dev := range []bool{false, true} {
		h, pool := giveawayRouter(t, dev)
		owner, _ := signUp(t, h, pool, "+79990007606")
		cid := newGiveawayChannel(t, h, owner, "gvpremium")
		rec := createGiveaway(t, h, owner, cid, map[string]any{"prize_kind": "premium", "months": 3, "winners_count": 1})
		want := http.StatusForbidden
		if dev {
			want = http.StatusOK
		}
		if rec.Code != want {
			t.Fatalf("premium-розыгрыш при dev=%v: %d %s; ждали %d", dev, rec.Code, rec.Body.String(), want)
		}
	}
}
