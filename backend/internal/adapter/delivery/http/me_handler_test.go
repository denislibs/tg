package http

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMe_RequiresToken(t *testing.T) {
	h := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/me", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", rec.Code)
	}
}

func TestMe_WithToken(t *testing.T) {
	h := newTestRouter(t)
	token, _ := loginViaHTTP(t, h, "+79990000000")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req)
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 with token, got %d body=%s", rec2.Code, rec2.Body.String())
	}
}
