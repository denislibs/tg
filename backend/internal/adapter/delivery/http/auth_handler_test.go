package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// newAuthUC builds the auth usecase from the postgres adapter (which satisfies
// all three repo ports) for use in delivery tests.
func newAuthUC(pool *pgxpool.Pool) *usecaseauth.Interactor {
	r := pgadapter.NewAuthRepo(pool)
	return usecaseauth.New(r, r, r, r, "12345", func(string, ...any) {})
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
		pgadapter.NewJoinRequestRepo(pool),
	)
}

func newTestRouter(t *testing.T) http.Handler {
	pool := postgres.NewTestDB(t)
	return NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil)
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

// memQRStore is an in-memory usecaseauth.QRStore for the QR HTTP test.
type memQRStore struct{ m map[string]domain.QRLogin }

func newMemQRStore() *memQRStore { return &memQRStore{m: map[string]domain.QRLogin{}} }

func (s *memQRStore) Put(_ context.Context, h string, r domain.QRLogin, _ time.Duration) error {
	s.m[h] = r
	return nil
}

func (s *memQRStore) Get(_ context.Context, h string) (domain.QRLogin, error) {
	r, ok := s.m[h]
	if !ok {
		return domain.QRLogin{}, domain.ErrNotFound
	}
	return r, nil
}

func (s *memQRStore) Delete(_ context.Context, h string) error { delete(s.m, h); return nil }

func getReq(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func postJSONAuth(t *testing.T, h http.Handler, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	buf, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, path, bytes.NewReader(buf))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestQRLoginFlow_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	uc := newAuthUC(pool)
	uc.SetQRStore(newMemQRStore())
	h := NewRouter(uc, newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil)

	// Sign in a user → Bearer token.
	if rec := postJSON(t, h, "/auth/request_code", map[string]string{"phone": "+79992223344"}); rec.Code != http.StatusOK {
		t.Fatalf("request_code status = %d, body=%s", rec.Code, rec.Body.String())
	}
	rec := postJSON(t, h, "/auth/sign_in", map[string]string{
		"phone": "+79992223344", "code": "12345", "device": "phone", "platform": "android",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("sign_in status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var signin struct {
		Token string `json:"token"`
		User  struct {
			ID int64 `json:"id"`
		} `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &signin)
	if signin.Token == "" {
		t.Fatal("expected non-empty sign-in token")
	}

	// POST /auth/qr/new → 200, capture token, url suffix.
	rec = postJSON(t, h, "/auth/qr/new", map[string]string{"platform": "web"})
	if rec.Code != http.StatusOK {
		t.Fatalf("qr/new status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var qrNew struct {
		Token     string `json:"token"`
		URL       string `json:"url"`
		ExpiresAt string `json:"expires_at"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &qrNew)
	if qrNew.Token == "" {
		t.Fatal("expected non-empty qr token")
	}
	if !strings.HasSuffix(qrNew.URL, "/qr/"+qrNew.Token) {
		t.Fatalf("url %q should end with /qr/%s", qrNew.URL, qrNew.Token)
	}

	// GET /auth/qr/{token} → pending.
	rec = getReq(t, h, "/auth/qr/"+qrNew.Token)
	if rec.Code != http.StatusOK {
		t.Fatalf("qr status pending: code=%d body=%s", rec.Code, rec.Body.String())
	}
	var st struct {
		Status       string `json:"status"`
		SessionToken string `json:"session_token"`
		User         struct {
			ID int64 `json:"id"`
		} `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &st)
	if st.Status != "pending" {
		t.Fatalf("expected pending, got %q", st.Status)
	}

	// POST /auth/qr/confirm with Bearer → ok.
	rec = postJSONAuth(t, h, "/auth/qr/confirm", map[string]string{"token": qrNew.Token}, signin.Token)
	if rec.Code != http.StatusOK {
		t.Fatalf("qr/confirm status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var conf struct {
		OK bool `json:"ok"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &conf)
	if !conf.OK {
		t.Fatalf("expected ok=true, body=%s", rec.Body.String())
	}

	// GET /auth/qr/{token} → confirmed with session_token + user.id.
	rec = getReq(t, h, "/auth/qr/"+qrNew.Token)
	st = struct {
		Status       string `json:"status"`
		SessionToken string `json:"session_token"`
		User         struct {
			ID int64 `json:"id"`
		} `json:"user"`
	}{}
	_ = json.Unmarshal(rec.Body.Bytes(), &st)
	if st.Status != "confirmed" || st.SessionToken == "" || st.User.ID == 0 {
		t.Fatalf("expected confirmed with session+user, got %+v body=%s", st, rec.Body.String())
	}
	if st.User.ID != signin.User.ID {
		t.Fatalf("confirmed user id = %d, want %d", st.User.ID, signin.User.ID)
	}

	// Second GET → expired (single-use).
	rec = getReq(t, h, "/auth/qr/"+qrNew.Token)
	var exp struct {
		Status string `json:"status"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &exp)
	if exp.Status != "expired" {
		t.Fatalf("second read expected expired, got %q", exp.Status)
	}

	// Unknown token → expired.
	rec = getReq(t, h, "/auth/qr/bogus")
	exp.Status = ""
	_ = json.Unmarshal(rec.Body.Bytes(), &exp)
	if exp.Status != "expired" {
		t.Fatalf("unknown token expected expired, got %q", exp.Status)
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
