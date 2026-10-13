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
