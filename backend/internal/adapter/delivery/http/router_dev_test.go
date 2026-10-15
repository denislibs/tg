package http

import (
	"net/http"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

// Б-10: dev-начисление звёзд и мок Premium монтируются только под DEV_PURCHASES;
// в проде этих маршрутов нет вовсе (ответ — общий 404 роутера).
func TestRouter_DevPurchasesRoutes(t *testing.T) {
	pool := postgres.NewTestDB(t)
	build := func(dev bool) http.Handler {
		return NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, dev)
	}
	devRouter, prodRouter := build(true), build(false)
	token, _ := loginViaHTTP(t, devRouter, "+79990040010")

	routes := []struct{ method, path string }{
		{http.MethodPost, "/stars/topup"},
		{http.MethodPost, "/me/premium"},
		{http.MethodPost, "/me/premium/checkout"},
	}
	for _, rt := range routes {
		if rec := authedReq(t, prodRouter, rt.method, rt.path, token, map[string]any{"amount": 100}); rec.Code != http.StatusNotFound {
			t.Errorf("прод: %s %s = %d, want 404", rt.method, rt.path, rec.Code)
		}
		if rec := authedReq(t, devRouter, rt.method, rt.path, token, map[string]any{"amount": 100}); rec.Code == http.StatusNotFound {
			t.Errorf("dev: %s %s = 404, маршрут должен быть смонтирован", rt.method, rt.path)
		}
	}
	// Остальные ручки звёзд и подписки Premium флагом не затронуты.
	for _, rt := range []struct{ method, path string }{
		{http.MethodGet, "/stars/balance"},
		{http.MethodGet, "/stars/transactions"},
		{http.MethodGet, "/me/premium/subscription"},
	} {
		if rec := authedReq(t, prodRouter, rt.method, rt.path, token, nil); rec.Code == http.StatusNotFound {
			t.Errorf("прод: %s %s = 404, маршрут не должен зависеть от флага", rt.method, rt.path)
		}
	}
}
