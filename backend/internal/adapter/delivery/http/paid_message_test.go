package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
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
