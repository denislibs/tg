package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// Ф7-Г (MC-06): отказ платной отправки называется кодами TG.
func TestWriteSendError_Paid(t *testing.T) {
	cases := []struct {
		err    error
		status int
		text   string
	}{
		{domain.ErrAllowPaymentRequired{Stars: 15}, http.StatusForbidden, "ALLOW_PAYMENT_REQUIRED_15"},
		{errors.Join(errors.New("send"), domain.ErrAllowPaymentRequired{Stars: 5}), http.StatusForbidden, "ALLOW_PAYMENT_REQUIRED_5"},
		{domain.ErrBalanceTooLow, http.StatusBadRequest, "BALANCE_TOO_LOW"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		writeSendError(rec, c.err, "x")
		var body domain.Error
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if rec.Code != c.status || body.Text != c.text {
			t.Errorf("%v → %d %q, want %d %q", c.err, rec.Code, body.Text, c.status, c.text)
		}
	}
}

func errText(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body domain.Error
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("тело ошибки не разбирается: %v (%s)", err, rec.Body.String())
	}
	return body.Text
}

// Платная группа: каждый пользовательский вход HTTP без суммы получает
// ALLOW_PAYMENT_REQUIRED_<N>, с суммой — проходит и списывает цену.
func TestPaidGroup_HTTPNeedsAllowance(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990130001")
	tokenB, idB := signUp(t, h, pool, "+79990130002")

	gid := itoa(createdPeerID(t, authedReq(t, h, http.MethodPost, "/groups", tokenA,
		map[string]any{"title": "Paid", "member_ids": []int64{idB}})))
	if rec := authedReq(t, h, http.MethodPut, "/chats/"+gid+"/charge_stars", tokenA, map[string]any{"charge_stars": 5}); rec.Code != http.StatusOK {
		t.Fatalf("charge_stars: %d %s", rec.Code, rec.Body.String())
	}
	if rec := authedReq(t, h, http.MethodPost, "/stars/topup", tokenB, map[string]any{"amount": 100}); rec.Code != http.StatusOK {
		t.Fatalf("пополнение: %d %s", rec.Code, rec.Body.String())
	}

	// Сообщение без суммы → 403 с требуемой суммой.
	rec := authedReq(t, h, http.MethodPost, "/chats/"+gid+"/messages", tokenB, map[string]any{"text": "a", "client_msg_id": "p1"})
	if rec.Code != http.StatusForbidden || errText(t, rec) != "ALLOW_PAYMENT_REQUIRED_5" {
		t.Fatalf("без суммы: %d %s", rec.Code, rec.Body.String())
	}
	// Опрос без суммы — то же (чек-лист — в usecase-тесте).
	rec = authedReq(t, h, http.MethodPost, "/chats/"+gid+"/polls", tokenB,
		map[string]any{"question": "q", "options": []string{"a", "b"}})
	if rec.Code != http.StatusForbidden || errText(t, rec) != "ALLOW_PAYMENT_REQUIRED_5" {
		t.Fatalf("опрос без суммы: %d %s", rec.Code, rec.Body.String())
	}
	// Отказ согласия не оставил строки опроса в БД (проверка идёт до её создания).
	var polls int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM polls`).Scan(&polls); err != nil || polls != 0 {
		t.Fatalf("после отказа в polls %d строк (err %v), want 0", polls, err)
	}
	// С суммой — проходит, списывает цену (потолок 7 → 5).
	rec = authedReq(t, h, http.MethodPost, "/chats/"+gid+"/messages", tokenB,
		map[string]any{"text": "a", "client_msg_id": "p1", "allow_paid_stars": 7})
	if rec.Code != http.StatusOK {
		t.Fatalf("с суммой: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/stars/balance", tokenB, nil)
	if st := decodeStars(t, rec); st.Balance.Amount != 95 {
		t.Fatalf("баланс после платной отправки = %d, want 95 (%s)", st.Balance.Amount, rec.Body.String())
	}
	// Опрос с суммой проходит.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+gid+"/polls", tokenB,
		map[string]any{"question": "q", "options": []string{"a", "b"}, "allow_paid_stars": 5})
	if rec.Code != http.StatusOK {
		t.Fatalf("опрос с суммой: %d %s", rec.Code, rec.Body.String())
	}
	// Нехватка баланса при данном согласии — 400 BALANCE_TOO_LOW.
	if rec := authedReq(t, h, http.MethodPut, "/chats/"+gid+"/charge_stars", tokenA, map[string]any{"charge_stars": 500}); rec.Code != http.StatusOK {
		t.Fatalf("charge_stars: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/chats/"+gid+"/messages", tokenB,
		map[string]any{"text": "b", "client_msg_id": "p2", "allow_paid_stars": 500})
	if rec.Code != http.StatusBadRequest || errText(t, rec) != "BALANCE_TOO_LOW" {
		t.Fatalf("нехватка баланса: %d %s", rec.Code, rec.Body.String())
	}
}

// MC-15: ответ ⭐-реакции — ПОЛНЫЙ агрегат глазами зрителя: платная ставка не
// стирает у клиента обычные реакции (tweb appReactionsManager.ts:966-972
// заменяет агрегат сообщения целиком).
func TestStarReaction_ResponseKeepsEmojiChips(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990130003")
	tokenB, idB := signUp(t, h, pool, "+79990130004")
	peerA := itoa(createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})))
	peerB := itoa(createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenB, map[string]int64{"user_id": idA})))

	rec := authedReq(t, h, http.MethodPost, "/chats/"+peerA+"/messages", tokenA, map[string]any{"text": "пост", "client_msg_id": "r1"})
	var sent struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sent)
	msg := "/chats/" + peerB + "/messages/" + itoa(sent.ID)

	// Боб ставит 👍, затем ⭐; Алиса (автор) тоже ставит ⭐ и должна увидеть 👍 Боба.
	if rec := authedReq(t, h, http.MethodPost, msg+"/reactions", tokenB, map[string]any{"emoji": "👍"}); rec.Code != http.StatusOK {
		t.Fatalf("👍: %d %s", rec.Code, rec.Body.String())
	}
	for _, tk := range []string{tokenA} {
		if rec := authedReq(t, h, http.MethodPost, "/stars/topup", tk, map[string]any{"amount": 50}); rec.Code != http.StatusOK {
			t.Fatalf("пополнение: %d %s", rec.Code, rec.Body.String())
		}
	}
	rec = authedReq(t, h, http.MethodPost, "/chats/"+peerA+"/messages/"+itoa(sent.ID)+"/star_reaction", tokenA,
		map[string]any{"count": 5, "anonymous": false})
	if rec.Code != http.StatusOK {
		t.Fatalf("⭐: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Updates []struct {
			Reactions struct {
				Results []struct {
					Reaction struct {
						Underscore string `json:"_"`
						Emoticon   string `json:"emoticon"`
					} `json:"reaction"`
					Count int `json:"count"`
				} `json:"results"`
			} `json:"reactions"`
		} `json:"updates"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Updates) != 1 {
		t.Fatalf("витрина: %v (%s)", err, rec.Body.String())
	}
	var paid, thumbs bool
	for _, r := range out.Updates[0].Reactions.Results {
		switch {
		case r.Reaction.Underscore == "reactionPaid" && r.Count == 5:
			paid = true
		case r.Reaction.Underscore == "reactionEmoji" && r.Reaction.Emoticon == "👍" && r.Count == 1:
			thumbs = true
		}
	}
	if !paid || !thumbs {
		t.Fatalf("агрегат неполный (paid=%v 👍=%v): %s", paid, thumbs, rec.Body.String())
	}
}

// Ревью-пункт «деньги»: ответ звёздной реакции не должен падать ПОСЛЕ коммита
// списания — клиент увидел бы ошибку и повторил запрос (двойная оплата). Сбой
// чтения полного агрегата заменяется минимальным: платный чип по агрегату,
// который уже есть.
func TestStarReactionAggregate_FallbackAfterCharge(t *testing.T) {
	full := domain.NewMessageReactions([]domain.MTReactionCount{
		domain.NewReactionCount(domain.NewReactionPaid(), 5, true),
		domain.NewReactionCount(domain.NewReactionEmoji("👍"), 1, false),
	}, nil)
	agg := domain.StarReactionAgg{Total: 5, Mine: 5}

	got := starReactionAggregate(full, nil, agg, true)
	if len(got.Results) != 2 {
		t.Fatalf("при успешном чтении агрегат отдаётся как есть: %+v", got.Results)
	}

	got = starReactionAggregate(domain.MessageReactions{}, errors.New("db down"), agg, true)
	if len(got.Results) != 1 || got.Results[0].Count != 5 || !got.PFlags["can_see_list"] {
		t.Fatalf("при сбое чтения — платный чип из уже известного агрегата (%+v)", got)
	}
}

// barrierStars сводит первые два AddBalance (от двух разных транзакций) в одну точку ПОСЛЕ
// выполнения: обе уже держат первую строку баланса, когда идут за второй. Без единого порядка
// блокировок встречные платные отправки (A→владелец B и B→владелец A) тогда
// неизбежно упираются друг в друга — deadlock 40P01.
type barrierStars struct {
	usecasechat.StarsRepo
	mu      sync.Mutex
	arrived int
	release chan struct{}
}

func (b *barrierStars) AddBalance(ctx context.Context, userID, delta int64) (int64, error) {
	bal, err := b.StarsRepo.AddBalance(ctx, userID, delta) // строка уже заблокирована транзакцией
	b.mu.Lock()
	b.arrived++
	n := b.arrived
	if n == 2 {
		close(b.release)
	}
	b.mu.Unlock()
	if n <= 2 {
		select {
		case <-b.release:
		case <-time.After(700 * time.Millisecond): // второй не пришёл — не виснем
		}
	}
	return bal, err
}

// Ревью-пункт «деньги»: блокировки балансов берутся в порядке возрастания user_id, и
// две одновременные встречные платные отправки не взаимоблокируются.
func TestPaidCharge_OppositeDirectionsDoNotDeadlock(t *testing.T) {
	pool := postgres.NewTestDB(t)
	uc := newChatUC(pool)
	h := NewRouter(newAuthUC(pool), uc, nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	tokenA, idA := signUp(t, h, pool, "+79990130011")
	tokenB, idB := signUp(t, h, pool, "+79990130012")

	mk := func(owner string, member int64) int64 {
		peer := createdPeerID(t, authedReq(t, h, http.MethodPost, "/groups", owner, map[string]any{"title": "Paid", "member_ids": []int64{member}}))
		if rec := authedReq(t, h, http.MethodPut, "/chats/"+itoa(peer)+"/charge_stars", owner, map[string]any{"charge_stars": 1}); rec.Code != http.StatusOK {
			t.Fatalf("charge_stars: %d %s", rec.Code, rec.Body.String())
		}
		return -peer
	}
	g1 := mk(tokenA, idB) // владелец A, платит B
	g2 := mk(tokenB, idA) // владелец B, платит A
	for _, tk := range []string{tokenA, tokenB} {
		if rec := authedReq(t, h, http.MethodPost, "/stars/topup", tk, map[string]any{"amount": 10}); rec.Code != http.StatusOK {
			t.Fatalf("пополнение: %d %s", rec.Code, rec.Body.String())
		}
	}
	uc.SetStars(&barrierStars{StarsRepo: pgadapter.NewStarsRepo(pool), release: make(chan struct{})})

	ctx := context.Background()
	errs := make(chan error, 2)
	go func() { // A платит владельцу B
		_, err := uc.Send(ctx, usecasechat.SendInput{ChatID: g2, SenderID: idA, Type: "text", Text: "a", ClientMsgID: "dl-a", AllowPaidStars: 1})
		errs <- err
	}()
	go func() { // B платит владельцу A
		_, err := uc.Send(ctx, usecasechat.SendInput{ChatID: g1, SenderID: idB, Type: "text", Text: "b", ClientMsgID: "dl-b", AllowPaidStars: 1})
		errs <- err
	}()
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatalf("встречная платная отправка упала (взаимоблокировка кошельков?): %v", err)
		}
	}
}
