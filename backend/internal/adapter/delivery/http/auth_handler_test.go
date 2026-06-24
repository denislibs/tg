package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// newAuthUC builds the auth usecase from the postgres adapter (which satisfies
// all three repo ports) for use in delivery tests.
func newAuthUC(pool *pgxpool.Pool) *usecaseauth.Interactor {
	r := pgadapter.NewAuthRepo(pool)
	return usecaseauth.New(r, r, r, "12345", func(string, ...any) {})
}

// newChatUC builds the chat usecase from the postgres adapters for delivery tests.
func newChatUC(pool *pgxpool.Pool) *usecasechat.Interactor {
	return usecasechat.New(
		pgadapter.NewTxManager(pool),
		pgadapter.NewChatsRepo(pool),
		pgadapter.NewMessagesRepo(pool),
		pgadapter.NewUpdatesRepo(pool),
		pgadapter.NewReactionsRepo(pool),
		pgadapter.NewMediaAccessRepo(pool),
		pgadapter.NewGroupRepo(pool),
		pgadapter.NewInviteRepo(pool),
		pgadapter.NewChannelRepo(pool),
		pgadapter.NewSearchRepo(pool),
	)
}

func newTestRouter(t *testing.T) http.Handler {
	pool := postgres.NewTestDB(t)
	return NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil)
}

func postJSON(t *testing.T, h http.Handler, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	buf, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, path, bytes.NewReader(buf))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestAuthFlow_HTTP(t *testing.T) {
	h := newTestRouter(t)

	rec := postJSON(t, h, "/auth/request_code", map[string]string{"phone": "+79990000000"})
	if rec.Code != http.StatusOK {
		t.Fatalf("request_code status = %d, body=%s", rec.Code, rec.Body.String())
	}

	rec = postJSON(t, h, "/auth/sign_in", map[string]string{
		"phone": "+79990000000", "code": "12345", "device": "web", "platform": "browser",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("sign_in status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Token == "" {
		t.Fatal("expected non-empty token")
	}
}

func TestSignIn_WrongCode_HTTP(t *testing.T) {
	h := newTestRouter(t)
	_ = postJSON(t, h, "/auth/request_code", map[string]string{"phone": "+79991112233"})
	rec := postJSON(t, h, "/auth/sign_in", map[string]string{
		"phone": "+79991112233", "code": "99999",
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
