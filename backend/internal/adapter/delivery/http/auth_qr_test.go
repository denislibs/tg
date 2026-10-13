package http

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// memQRStore — usecaseauth.QRStore в памяти для тестов ручек.
type memQRStore struct {
	mu    sync.Mutex
	byKey map[string]domain.QRLogin
	tok   map[string]string
}

func newMemQRStore() *memQRStore {
	return &memQRStore{byKey: map[string]domain.QRLogin{}, tok: map[string]string{}}
}

func (s *memQRStore) GetByKey(_ context.Context, k string) (domain.QRLogin, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.byKey[k]
	if !ok {
		return domain.QRLogin{}, domain.ErrNotFound
	}
	return r, nil
}

func (s *memQRStore) Create(_ context.Context, k, th string, r domain.QRLogin, _ time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.byKey[k]; ok {
		return false, nil
	}
	s.byKey[k], s.tok[th] = r, k
	return true, nil
}

func (s *memQRStore) PeekToken(_ context.Context, th string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k, ok := s.tok[th]
	if !ok {
		return "", domain.ErrNotFound
	}
	return k, nil
}

func (s *memQRStore) ClaimToken(_ context.Context, th string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k, ok := s.tok[th]
	if !ok {
		return "", domain.ErrNotFound
	}
	delete(s.tok, th)
	return k, nil
}

func (s *memQRStore) PutByKey(_ context.Context, k string, r domain.QRLogin, _ time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byKey[k] = r
	return nil
}

func (s *memQRStore) DeleteByKey(_ context.Context, k string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.byKey, k)
	return nil
}

func loginKey(n int) string { return fmt.Sprintf("%064x", n) }

// doReq — запрос с заголовками; IP клиента задаёт ip (RemoteAddr).
func doReq(t *testing.T, h http.Handler, method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var rd *bytes.Reader
	if body != nil {
		buf, _ := json.Marshal(body)
		rd = bytes.NewReader(buf)
	} else {
		rd = bytes.NewReader(nil)
	}
	req := httptest.NewRequestWithContext(context.Background(), method, path, rd)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func exportReq(t *testing.T, h http.Handler, key string) *httptest.ResponseRecorder {
	t.Helper()
	hd := map[string]string{}
	if key != "" {
		hd["X-Login-Key"] = key
	}
	return doReq(t, h, http.MethodPost, "/auth/export_login_token", map[string]any{"except_ids": []int64{}, "platform": "web"}, hd)
}

func qrRouterNoDB() http.Handler {
	uc := usecaseauth.New(nil, nil, nil, nil, nil, "12345", func(string, ...any) {})
	uc.SetQRStore(newMemQRStore())
	return NewRouter(uc, nil, nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
}

func TestQRRoutes_OldRemoved(t *testing.T) {
	h := qrRouterNoDB()
	for _, c := range []struct{ method, path string }{
		{http.MethodPost, "/auth/qr/new"},
		{http.MethodGet, "/auth/qr/abc"},
		{http.MethodPost, "/auth/qr/confirm"},
	} {
		rec := doReq(t, h, c.method, c.path, nil, nil)
		if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s %s = %d, ожидалось 404/405 (ручка снята)", c.method, c.path, rec.Code)
		}
	}
}

func TestExportLoginToken_KeyValidation(t *testing.T) {
	h := qrRouterNoDB()
	for name, key := range map[string]string{
		"нет заголовка": "",
		"короткий":      "zz",
		"не hex":        strings.Repeat("g", 64),
		"верхний":       strings.ToUpper(loginKey(0xabcdef)),
		"длинный":       loginKey(1) + "0",
	} {
		rec := exportReq(t, h, key)
		var e wireError
		_ = json.Unmarshal(rec.Body.Bytes(), &e)
		if rec.Code != http.StatusBadRequest || e.Text != "LOGIN_KEY_INVALID" {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body.String())
		}
	}
}

var floodWaitRe = regexp.MustCompile(`^FLOOD_WAIT_[1-9][0-9]*$`)

func TestExportLoginToken_PerKeyRateLimit(t *testing.T) {
	h := qrRouterNoDB()
	for n := 1; n <= 5; n++ {
		if rec := exportReq(t, h, loginKey(1)); rec.Code != http.StatusOK {
			t.Fatalf("запрос %d: %d %s", n, rec.Code, rec.Body.String())
		}
	}
	rec := exportReq(t, h, loginKey(1))
	var e wireError
	_ = json.Unmarshal(rec.Body.Bytes(), &e)
	if rec.Code != 420 || !floodWaitRe.MatchString(e.Text) {
		t.Fatalf("6-й запрос: %d %s; want 420 FLOOD_WAIT_N", rec.Code, rec.Body.String())
	}
	// Другой ключ с того же IP не задет.
	if rec := exportReq(t, h, loginKey(2)); rec.Code != http.StatusOK {
		t.Fatalf("другой ключ: %d %s", rec.Code, rec.Body.String())
	}
}

// Отказ по IP не заводит ведро ключа: иначе перебор случайных ключей раздувал
// бы карту лимитера.
func TestExportLoginToken_IPLimitBeforeKeyBucket(t *testing.T) {
	uc := usecaseauth.New(nil, nil, nil, nil, nil, "12345", func(string, ...any) {})
	uc.SetQRStore(newMemQRStore())
	ah := NewAuthHandler(uc)
	call := func(n int) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/auth/export_login_token", strings.NewReader(`{"except_ids":[],"platform":"web"}`))
		req.Header.Set("X-Login-Key", loginKey(n))
		rec := httptest.NewRecorder()
		ah.ExportLoginToken(rec, req)
		return rec
	}
	for n := 1; n <= 50; n++ {
		if rec := call(n); rec.Code != http.StatusOK {
			t.Fatalf("запрос %d: %d %s", n, rec.Code, rec.Body.String())
		}
	}
	buckets := len(ah.qrLimiter.buckets)
	rec := call(1000)
	var e wireError
	_ = json.Unmarshal(rec.Body.Bytes(), &e)
	if rec.Code != 420 || !floodWaitRe.MatchString(e.Text) {
		t.Fatalf("51-й запрос с IP: %d %s", rec.Code, rec.Body.String())
	}
	if len(ah.qrLimiter.buckets) != buckets {
		t.Fatalf("отказ по IP завёл ведро ключа: %d → %d", buckets, len(ah.qrLimiter.buckets))
	}
}

func TestAcceptLoginToken_Auth(t *testing.T) {
	pool := postgres.NewTestDB(t)
	uc := newAuthUC(pool)
	uc.SetQRStore(newMemQRStore())
	h := routerFor(uc, pool)
	token, _ := loginViaHTTP(t, h, "+79992223300")

	// Без сессии — 401.
	if rec := doReq(t, h, http.MethodPost, "/auth/accept_login_token", map[string]string{"token": loginKey(9)}, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("без сессии: %d", rec.Code)
	}
	// Неизвестный код — 404 AUTH_TOKEN_EXPIRED.
	rec := postJSONAuth(t, h, "/auth/accept_login_token", map[string]string{"token": loginKey(9)}, token)
	var e wireError
	_ = json.Unmarshal(rec.Body.Bytes(), &e)
	if rec.Code != http.StatusNotFound || e.Text != "AUTH_TOKEN_EXPIRED" {
		t.Fatalf("неизвестный код: %d %s", rec.Code, rec.Body.String())
	}
}

type loginTokenWire struct {
	Underscore    string     `json:"_"`
	Token         string     `json:"token"`
	Expires       int64      `json:"expires"`
	Authorization signInWire `json:"authorization"`
}

func decodeLoginToken(t *testing.T, rec *httptest.ResponseRecorder) loginTokenWire {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("export: %d %s", rec.Code, rec.Body.String())
	}
	var out loginTokenWire
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("разбор: %v (%s)", err, rec.Body.String())
	}
	return out
}

// Полный путь: экспортёр рисует код, вошедшее устройство подтверждает, ТОЛЬКО
// экспортёр с тем же ключом получает сессию; посторонний с тем же QR — нет.
func TestQRLoginFlow_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	uc := newAuthUC(pool)
	uc.SetQRStore(newMemQRStore())
	h := routerFor(uc, pool)
	scanner, scannerID := loginViaHTTP(t, h, "+79992223344")

	issued := decodeLoginToken(t, exportReq(t, h, loginKey(1)))
	if issued.Underscore != "auth.loginToken" || issued.Token == "" || issued.Expires == 0 {
		t.Fatalf("export = %+v", issued)
	}
	qrToken := hexOfBase64(t, issued.Token)

	// Повторный опрос того же ключа — тот же код.
	again := decodeLoginToken(t, exportReq(t, h, loginKey(1)))
	if again.Token != issued.Token {
		t.Fatal("повторный опрос выпустил другой код")
	}

	rec := postJSONAuth(t, h, "/auth/accept_login_token", map[string]string{"token": qrToken}, scanner)
	if rec.Code != http.StatusOK {
		t.Fatalf("accept: %d %s", rec.Code, rec.Body.String())
	}
	var authz struct {
		Underscore string          `json:"_"`
		Hash       int64           `json:"hash"`
		PFlags     map[string]bool `json:"pFlags"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &authz)
	if authz.Underscore != "authorization" || authz.Hash == 0 || authz.PFlags["password_pending"] {
		t.Fatalf("accept = %s", rec.Body.String())
	}

	// Посторонний ключ с тем же QR сессии не получает.
	stranger := decodeLoginToken(t, exportReq(t, h, loginKey(2)))
	if stranger.Underscore != "auth.loginToken" || hexOfBase64(t, stranger.Token) == qrToken {
		t.Fatalf("посторонний ключ: %+v", stranger)
	}

	// Владелец ключа — сессия, вложенная в loginTokenSuccess.
	done := decodeLoginToken(t, exportReq(t, h, loginKey(1)))
	if done.Underscore != "auth.loginTokenSuccess" || done.Authorization.Underscore != "auth.authorization" ||
		done.Authorization.Token == "" || done.Authorization.User.ID != scannerID {
		t.Fatalf("после accept: %+v", done)
	}

	// Одноразово: следующий опрос — уже новый код.
	next := decodeLoginToken(t, exportReq(t, h, loginKey(1)))
	if next.Underscore != "auth.loginToken" || hexOfBase64(t, next.Token) == qrToken {
		t.Fatalf("второй опрос после выдачи: %+v", next)
	}
	// Подтвердить уже принятый код нельзя.
	rec = postJSONAuth(t, h, "/auth/accept_login_token", map[string]string{"token": qrToken}, scanner)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("повторный accept: %d", rec.Code)
	}
}

// except_ids экспортёра: тот же аккаунт подтвердить не может — 404.
func TestAcceptLoginToken_ExceptIDs_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	uc := newAuthUC(pool)
	uc.SetQRStore(newMemQRStore())
	h := routerFor(uc, pool)
	scanner, scannerID := loginViaHTTP(t, h, "+79992223355")

	rec := doReq(t, h, http.MethodPost, "/auth/export_login_token",
		map[string]any{"except_ids": []int64{scannerID}, "platform": "web"}, map[string]string{"X-Login-Key": loginKey(1)})
	qrToken := hexOfBase64(t, decodeLoginToken(t, rec).Token)

	rec = postJSONAuth(t, h, "/auth/accept_login_token", map[string]string{"token": qrToken}, scanner)
	var e wireError
	_ = json.Unmarshal(rec.Body.Bytes(), &e)
	if rec.Code != http.StatusNotFound || e.Text != "AUTH_TOKEN_EXPIRED" {
		t.Fatalf("except-аккаунт: %d %s", rec.Code, rec.Body.String())
	}
}
