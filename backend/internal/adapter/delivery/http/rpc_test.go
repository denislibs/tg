package http

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/adapter/delivery/netx"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestRouterRPCReplaysWithInjectedUser(t *testing.T) {
	r := chi.NewRouter()
	r.Group(func(pr chi.Router) {
		pr.Use(AuthMiddleware(authStub{okToken: "x"})) // trust-preset пропустит без заголовка
		pr.Get("/me", func(w http.ResponseWriter, req *http.Request) {
			u, _ := UserFromContext(req.Context())
			writeJSON(w, http.StatusOK, map[string]any{"id": u.ID})
		})
	})
	d := NewRouterRPC(r)

	status, body := d.Dispatch(context.Background(), domain.UserRecord{ID: 55}, 1, "203.0.113.5", http.MethodGet, "/me", nil)
	if status != http.StatusOK {
		t.Fatalf("status=%d body=%s", status, body)
	}
	if !strings.Contains(string(body), `"id":55`) {
		t.Fatalf("body missing injected user: %s", body)
	}

	// Несуществующий путь → 404.
	if s, _ := d.Dispatch(context.Background(), domain.UserRecord{ID: 55}, 1, "203.0.113.5", http.MethodGet, "/nope", nil); s != http.StatusNotFound {
		t.Fatalf("want 404, got %d", s)
	}
}

// Ф7-И1: IP клиента канала DNP едет в синтетический запрос. Без него
// httptest.NewRequest отдаёт всем RemoteAddr 192.0.2.1, и при DNP-ON все
// пользователи делят одно ведро «IP» (mepw-ip:, qraccept-ip:, ClientInfo).
func TestRouterRPC_CarriesSocketIP(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/ip", func(w http.ResponseWriter, req *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"ip": netx.ClientIP(req)})
	})
	d := NewRouterRPC(r)
	for _, ip := range []string{"203.0.113.5", "198.51.100.9"} {
		_, body := d.Dispatch(context.Background(), domain.UserRecord{ID: 1}, 1, ip, http.MethodGet, "/ip", nil)
		if !strings.Contains(string(body), `"ip":"`+ip+`"`) {
			t.Fatalf("ClientIP внутри ручки = %s, want %s", body, ip)
		}
	}
	// Пусто (тест, plain-conn) — прежнее поведение, заголовок не ставится.
	_, body := d.Dispatch(context.Background(), domain.UserRecord{ID: 1}, 1, "", http.MethodGet, "/ip", nil)
	if !strings.Contains(string(body), `"ip":"192.0.2.1"`) {
		t.Fatalf("без IP: %s", body)
	}
}

// Два пользователя через канал с разных IP не делят ведро mepw-ip:.
func TestRouterRPC_PasswordIPBucketsAreSeparate(t *testing.T) {
	pool := postgres.NewTestDB(t)
	pwh := NewPasswordHandler(newAuthUC(pool))
	r := chi.NewRouter()
	r.Post("/me/password/verify", pwh.Verify)
	d := NewRouterRPC(r)
	verify := func(uid int64, ip string) int {
		s, _ := d.Dispatch(context.Background(), domain.UserRecord{ID: uid}, uid, ip, http.MethodPost, "/me/password/verify", []byte(`{"password":"x"}`))
		return s
	}
	for n := 0; n < 5; n++ {
		if s := verify(1, "203.0.113.1"); s == 420 {
			t.Fatalf("попытка %d пользователя 1 получила 420 раньше срока", n+1)
		}
	}
	if s := verify(1, "203.0.113.1"); s != 420 {
		t.Fatalf("6-я попытка с IP пользователя 1 = %d, want 420", s)
	}
	if s := verify(2, "198.51.100.2"); s == 420 {
		t.Fatal("пользователь 2 с другого IP получил чужое ведро (все делят 192.0.2.1)")
	}
}
