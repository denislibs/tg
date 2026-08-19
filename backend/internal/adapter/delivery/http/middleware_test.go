package http

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// authStub implements the Authenticator interface for middleware tests.
type authStub struct{ okToken string }

func (a authStub) Authenticate(_ context.Context, token string) (domain.UserRecord, int64, error) {
	if token != a.okToken {
		return domain.UserRecord{}, 0, errors.New("bad token")
	}
	return domain.UserRecord{ID: 7}, 3, nil
}

func TestAuthMiddlewareTrustsPresetUser(t *testing.T) {
	var seen int64
	h := AuthMiddleware(authStub{okToken: "x"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, _ := UserFromContext(r.Context())
		seen = u.ID
		w.WriteHeader(http.StatusOK)
	}))

	// Preset user, NO Authorization header → middleware must skip re-auth.
	req := httptest.NewRequest(http.MethodGet, "/me", nil).
		WithContext(WithUser(context.Background(), domain.UserRecord{ID: 42}, 9))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || seen != 42 {
		t.Fatalf("preset user ignored: code=%d seen=%d", rec.Code, seen)
	}

	// No preset, no header → 401.
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/me", nil))
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 without auth, got %d", rec2.Code)
	}
}
