package http

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasereport "github.com/messenger-denis/backend/internal/usecase/report"
)

// newF7vRouter — маршрутизатор с ботами (демо-бот отвечает на callback без
// движка Bot API) и жалобами.
func newF7vRouter(t *testing.T) (http.Handler, *pgxpool.Pool) {
	t.Helper()
	pool := postgres.NewTestDB(t)
	chatUC := newChatUC(pool)
	chatUC.SetBots(pgadapter.NewBotRepo(pool))
	reportUC := usecasereport.New(pgadapter.NewReportRepo(pool))
	return NewRouter(newAuthUC(pool), chatUC, nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, reportUC, nil, nil, nil), pool
}

// MC-03: клиент шлёт номер нажатой кнопки как msg_id (TL
// messages.getBotCallbackAnswer.msg_id, tweb appInlineBotsManager.ts:245-250).
// Сервер читал `id` и на каждом нажатии искал сообщение №0 → 404.
func TestBotCallback_MsgIDName(t *testing.T) {
	h, pool := newF7vRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000071")
	_, idBot := signUp(t, h, pool, "+79990000072")
	if _, err := pool.Exec(t.Context(), `UPDATE users SET is_bot = true WHERE id = $1`, idBot); err != nil {
		t.Fatalf("пометить бота: %v", err)
	}
	peer := createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idBot}))
	rec := authedReq(t, h, http.MethodPost, "/chats/"+itoa(peer)+"/messages", tokenA, map[string]any{"text": "/start"})
	var sent struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sent)
	if sent.ID == 0 {
		t.Fatalf("отправка: %d %s", rec.Code, rec.Body.String())
	}

	// data = base64("echo") — демо-бот отвечает тостом «Кнопка нажата».
	rec = authedReq(t, h, http.MethodPost, "/bots/"+itoa(idBot)+"/callback", tokenA,
		map[string]any{"peer_id": peer, "msg_id": sent.ID, "data": "ZWNobw=="})
	if rec.Code != http.StatusOK {
		t.Fatalf("callback с msg_id = %d %s; want 200", rec.Code, rec.Body.String())
	}

	// Несуществующий номер — 404 «message not found»: адрес кнопки проверяется.
	rec = authedReq(t, h, http.MethodPost, "/bots/"+itoa(idBot)+"/callback", tokenA,
		map[string]any{"peer_id": peer, "msg_id": sent.ID + 100, "data": "ZWNobw=="})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("callback на несуществующее сообщение = %d; want 404", rec.Code)
	}
}

// MC-05: жалоба на сообщения несёт id — ВЕКТОР серверных номеров (TL
// messages.report{id: Vector<int>}, tweb appMessagesManager.ts:7807-7827);
// на каждое сообщение — своя строка. Клиент слал msg_id, и жалоба молча
// превращалась в жалобу на чат.
func TestReport_VectorOfMessages(t *testing.T) {
	h, pool := newF7vRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000073")
	_, idB := signUp(t, h, pool, "+79990000074")
	peer := createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB}))
	var seqs []int64
	for _, text := range []string{"раз", "два"} {
		rec := authedReq(t, h, http.MethodPost, "/chats/"+itoa(peer)+"/messages", tokenA, map[string]any{"text": text})
		var sent struct {
			ID int64 `json:"id"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &sent)
		seqs = append(seqs, sent.ID)
	}
	count := func(withMsg bool) int {
		t.Helper()
		var n int
		q := `SELECT count(*) FROM reports WHERE msg_id IS NULL`
		if withMsg {
			q = `SELECT count(*) FROM reports WHERE msg_id IS NOT NULL`
		}
		if err := pool.QueryRow(t.Context(), q).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		return n
	}

	rec := authedReq(t, h, http.MethodPost, "/report", tokenA,
		map[string]any{"peer_id": peer, "id": seqs, "reason": "spam", "comment": "x"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("report = %d %s; want 204", rec.Code, rec.Body.String())
	}
	if got := count(true); got != 2 {
		t.Fatalf("строк с msg_id = %d; want 2 (по одной на сообщение)", got)
	}
	var chatRows int
	_ = pool.QueryRow(t.Context(), `SELECT count(*) FROM reports WHERE msg_id IN (SELECT id FROM messages)`).Scan(&chatRows)
	if chatRows != 2 {
		t.Fatalf("msg_id не ссылаются на внутренние ключи сообщений: %d", chatRows)
	}

	// id: [] — жалоба на чат.
	rec = authedReq(t, h, http.MethodPost, "/report", tokenA, map[string]any{"peer_id": peer, "id": []int64{}, "reason": "spam"})
	if rec.Code != http.StatusNoContent || count(false) != 1 {
		t.Fatalf("жалоба на чат: %d %s, строк без msg_id=%d; want 204 и 1", rec.Code, rec.Body.String(), count(false))
	}

	// Неизвестный номер — 404, и НИЧЕГО не записано (в том числе известные).
	before := count(true)
	rec = authedReq(t, h, http.MethodPost, "/report", tokenA,
		map[string]any{"peer_id": peer, "id": []int64{seqs[0], 9999}, "reason": "spam"})
	if rec.Code != http.StatusNotFound || count(true) != before {
		t.Fatalf("неизвестный номер: %d %s, строк %d→%d; want 404 без записи", rec.Code, rec.Body.String(), before, count(true))
	}

	// Больше 100 номеров — 400 до разбора адресов.
	many := make([]int64, 101)
	for n := range many {
		many[n] = int64(n + 1)
	}
	rec = authedReq(t, h, http.MethodPost, "/report", tokenA, map[string]any{"peer_id": peer, "id": many, "reason": "spam"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("101 номер = %d %s; want 400", rec.Code, rec.Body.String())
	}
}
