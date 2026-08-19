package http

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
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

	status, body := d.Dispatch(context.Background(), domain.UserRecord{ID: 55}, 1, http.MethodGet, "/me", nil)
	if status != http.StatusOK {
		t.Fatalf("status=%d body=%s", status, body)
	}
	if !strings.Contains(string(body), `"id":55`) {
		t.Fatalf("body missing injected user: %s", body)
	}

	// Несуществующий путь → 404.
	if s, _ := d.Dispatch(context.Background(), domain.UserRecord{ID: 55}, 1, http.MethodGet, "/nope", nil); s != http.StatusNotFound {
		t.Fatalf("want 404, got %d", s)
	}
}
