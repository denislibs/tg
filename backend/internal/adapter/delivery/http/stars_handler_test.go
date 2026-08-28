package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Баланс и история звёзд — конструкторы `payments.starsStatus` и
// `starsTransaction`. Прежде баланс ехал ГОЛЫМ ЧИСЛОМ под ключом `balance`, а
// вид операции — СТРОКОЙ `kind` из перечисления, одно значение которого
// (`paid_media`) не производилось вовсе.

type starsStatusWire struct {
	Underscore string `json:"_"`
	Balance    struct {
		Underscore string `json:"_"`
		Amount     int64  `json:"amount"`
		Nanos      int    `json:"nanos"`
	} `json:"balance"`
	History []struct {
		Underscore string          `json:"_"`
		PFlags     map[string]bool `json:"pFlags"`
		ID         string          `json:"id"`
		Amount     struct {
			Amount int64 `json:"amount"`
		} `json:"amount"`
		Date int64 `json:"date"`
		Peer struct {
			Underscore string `json:"_"`
		} `json:"peer"`
		Title string `json:"title"`
	} `json:"history"`
	Chats []map[string]any `json:"chats"`
	Users []map[string]any `json:"users"`
}

func decodeStars(t *testing.T, rec *httptest.ResponseRecorder) starsStatusWire {
	t.Helper()
	var out starsStatusWire
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("баланс не разбирается: %v (%s)", err, rec.Body.String())
	}
	return out
}

func TestStars_BalanceAndHistoryAreConstructors(t *testing.T) {
	h, pool := newMessagingRouter(t)
	token, _ := signUp(t, h, pool, "+79990100001")

	// Пустой баланс — тот же конструктор, а не другое тело.
	rec := authedReq(t, h, http.MethodGet, "/stars/balance", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("баланс: %d %s", rec.Code, rec.Body.String())
	}
	st := decodeStars(t, rec)
	if st.Underscore != "payments.starsStatus" || st.Balance.Underscore != "starsAmount" {
		t.Fatalf("баланс = %s", rec.Body.String())
	}
	// «Историю не просили» — ОТСУТСТВИЕ ключа, а не пустой вектор.
	if strings.Contains(rec.Body.String(), `"history"`) {
		t.Fatalf("незапрошенная история едет пустым вектором: %s", rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodPost, "/stars/topup", token, map[string]any{"amount": 500})
	if rec.Code != http.StatusOK {
		t.Fatalf("пополнение: %d %s", rec.Code, rec.Body.String())
	}
	st = decodeStars(t, rec)
	if st.Underscore != "payments.starsStatus" || st.Balance.Amount != 500 || st.Balance.Nanos != 0 {
		t.Fatalf("после пополнения = %s", rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodGet, "/stars/transactions", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("история: %d %s", rec.Code, rec.Body.String())
	}
	st = decodeStars(t, rec)
	// История едет ТЕМ ЖЕ конструктором, что и остаток, и остаток при ней есть.
	if st.Underscore != "payments.starsStatus" || st.Balance.Amount != 500 || len(st.History) != 1 {
		t.Fatalf("история = %s", rec.Body.String())
	}
	tx := st.History[0]
	if tx.Underscore != "starsTransaction" || tx.Amount.Amount != 500 || tx.ID == "" || tx.Date == 0 {
		t.Fatalf("строка истории = %s", rec.Body.String())
	}
	// Вторая сторона пополнения — КОНСТРУКТОР «не выражается»: магазина и
	// премиум-бота оригинала у нас нет вовсе.
	if tx.Peer.Underscore != "starsTransactionPeerUnsupported" {
		t.Fatalf("вторая сторона = %s", rec.Body.String())
	}
	// Пополнение подарком не является — флага нет.
	if tx.PFlags["gift"] {
		t.Fatalf("пополнение помечено подарком: %s", rec.Body.String())
	}
	// Вида операции строкой на проводе больше нет.
	if strings.Contains(rec.Body.String(), `"kind"`) {
		t.Fatalf("строковый вид операции остался: %s", rec.Body.String())
	}
}
