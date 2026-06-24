# QR Login — Plan QR-1: Backend

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-24-qr-login-design.md`. Backend repo at `/Users/denisurevic/Documents/messenger-denis/backend`. Branch `qr-login-qr1`.

**Goal:** Backend QR login — ephemeral Redis-backed records, three endpoints (`POST /auth/qr/new` public, `GET /auth/qr/{token}` public, `POST /auth/qr/confirm` Bearer), reusing the existing session-minting primitives. Merge + curl smoke on :38080.

**Architecture:** Extend `internal/usecase/auth` (new `QRStore` port + `domain.QRLogin` + three `Interactor` methods, `QRStore` injected at runtime like `SetCache`, nil ⇒ disabled). Redis adapter in `internal/adapter/cache/redis/qrstore.go`. HTTP methods on the existing `AuthHandler` (already wraps `authUC`, so `NewRouter` needs no new param). Session minting reuses `domain.GenerateToken` + `devices.Create` (same as `SignIn`).

**Tech Stack:** Go, chi, go-redis, miniredis (redis adapter test), testcontainers (not needed here — usecase tests use fakes), uber/fx.

---

## Task 1: domain.QRLogin + QRStore port + Interactor methods

**Files:**
- Modify: `backend/internal/domain/qrlogin.go` (Create)
- Modify: `backend/internal/usecase/auth/ports.go`
- Modify: `backend/internal/usecase/auth/auth.go`
- Test: `backend/internal/usecase/auth/qrlogin_test.go` (Create)

- [ ] **Step 1: Branch** — `cd backend && git checkout master && git checkout -b qr-login-qr1`.

- [ ] **Step 2: domain type** — create `backend/internal/domain/qrlogin.go`:
```go
package domain

import "time"

// QR login status values.
const (
	QRPending   = "pending"
	QRConfirmed = "confirmed"
)

// QRLogin is an ephemeral QR-login record (stored in Redis with a short TTL).
// While Status is QRPending only Platform/CreatedAt are set; once a logged-in
// device confirms, Status becomes QRConfirmed and SessionToken+User are filled.
type QRLogin struct {
	Status       string    `json:"status"`
	Platform     string    `json:"platform"`
	SessionToken string    `json:"session_token,omitempty"`
	User         User      `json:"user"`
	CreatedAt    time.Time `json:"created_at"`
}
```

- [ ] **Step 3: port + error** — in `backend/internal/usecase/auth/ports.go` add the `QRStore` interface and a TTL constant (append after `SessionCacheTTL`):
```go
// QRStore persists ephemeral QR-login records keyed by the token hash.
type QRStore interface {
	Put(ctx context.Context, tokenHash string, rec domain.QRLogin, ttl time.Duration) error
	Get(ctx context.Context, tokenHash string) (domain.QRLogin, error) // domain.ErrNotFound when absent/expired
	Delete(ctx context.Context, tokenHash string) error
}

const QRLoginTTL = 60 * time.Second
```
And add a sentinel error — in `backend/internal/usecase/auth/auth.go` add near the top (after the imports, before `const codeTTL`):
```go
// ErrQRUnavailable is returned when QR login is requested but no QRStore is
// configured (e.g. Redis is down).
var ErrQRUnavailable = errors.New("qr login unavailable")
```

- [ ] **Step 4: Interactor field + setter** — in `auth.go` add a `qr QRStore` field to the `Interactor` struct (after `revoker`):
```go
	qr      QRStore            // optional
```
and a setter next to `SetRevocationNotifier`:
```go
func (i *Interactor) SetQRStore(q QRStore) { i.qr = q }
```

- [ ] **Step 5: Write the failing test** — `backend/internal/usecase/auth/qrlogin_test.go`:
```go
package auth

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeQRStore is an in-memory QRStore keyed by token hash.
type fakeQRStore struct{ m map[string]domain.QRLogin }

func newFakeQRStore() *fakeQRStore { return &fakeQRStore{m: map[string]domain.QRLogin{}} }

func (s *fakeQRStore) Put(_ context.Context, h string, r domain.QRLogin, _ interface{ /*unused*/ }) error {
	return nil
}

func TestQRLogin_NewStatusConfirmFlow(t *testing.T) {
	users := newFakeUserRepo()
	devices := newFakeDeviceRepo(users)
	i := New(users, devices, nil, "12345", func(string, ...any) {})

	ctx := context.Background()
	// No QRStore configured → unavailable.
	if _, _, err := i.NewQRLogin(ctx, "web"); err != ErrQRUnavailable {
		t.Fatalf("NewQRLogin without store: got %v, want ErrQRUnavailable", err)
	}

	store := newFakeQRStoreTTL()
	i.SetQRStore(store)

	// Generate a pending record.
	token, _, err := i.NewQRLogin(ctx, "web")
	if err != nil {
		t.Fatalf("NewQRLogin: %v", err)
	}
	if token == "" {
		t.Fatal("expected a non-empty token")
	}
	st, err := i.QRStatus(ctx, token)
	if err != nil || st.Status != domain.QRPending {
		t.Fatalf("QRStatus pending: status=%q err=%v", st.Status, err)
	}

	// An authenticated user confirms.
	confirming := domain.User{ID: 7, Phone: "+700", DisplayName: "+700"}
	if err := i.ConfirmQRLogin(ctx, token, confirming); err != nil {
		t.Fatalf("ConfirmQRLogin: %v", err)
	}
	// A device/session was minted for the confirming user.
	if devices.nextID == 1 {
		t.Fatal("expected a device to be created on confirm")
	}

	// Desktop reads the result once → confirmed + a working session token; reading
	// again is gone (single-use).
	st, err = i.QRStatus(ctx, token)
	if err != nil {
		t.Fatalf("QRStatus after confirm: %v", err)
	}
	if st.Status != domain.QRConfirmed || st.SessionToken == "" || st.User.ID != 7 {
		t.Fatalf("confirmed status wrong: %+v", st)
	}
	if _, _, err := i.Authenticate(ctx, st.SessionToken); err != nil {
		t.Fatalf("minted session token should authenticate: %v", err)
	}
	if _, err := i.QRStatus(ctx, token); err != domain.ErrNotFound {
		t.Fatalf("second read should be ErrNotFound (single-use), got %v", err)
	}

	// Confirming an unknown token → ErrNotFound.
	if err := i.ConfirmQRLogin(ctx, "deadbeef", confirming); err != domain.ErrNotFound {
		t.Fatalf("confirm unknown token: got %v, want ErrNotFound", err)
	}
}
```
> Note: delete the half-stub `fakeQRStore` above and use a proper TTL-typed fake. Define it like this (replace the stub):
```go
import "time"

type fakeQRStoreTTL struct{ m map[string]domain.QRLogin }

func newFakeQRStoreTTL() *fakeQRStoreTTL { return &fakeQRStoreTTL{m: map[string]domain.QRLogin{}} }

func (s *fakeQRStoreTTL) Put(_ context.Context, h string, r domain.QRLogin, _ time.Duration) error {
	s.m[h] = r
	return nil
}
func (s *fakeQRStoreTTL) Get(_ context.Context, h string) (domain.QRLogin, error) {
	r, ok := s.m[h]
	if !ok {
		return domain.QRLogin{}, domain.ErrNotFound
	}
	return r, nil
}
func (s *fakeQRStoreTTL) Delete(_ context.Context, h string) error { delete(s.m, h); return nil }
```
Keep only `fakeQRStoreTTL` (remove the `fakeQRStore` stub entirely). `nil` is a valid `CodeRepo` here because the QR methods never touch codes.

- [ ] **Step 6: Run test to verify it fails** — `go test ./internal/usecase/auth/ -run TestQRLogin -v`. Expected: compile error / FAIL (methods undefined).

- [ ] **Step 7: Implement the three methods** — in `auth.go` add:
```go
// NewQRLogin creates a pending QR-login record and returns the raw token and
// its expiry. The raw token is only ever returned here; the store keys on its
// hash.
func (i *Interactor) NewQRLogin(ctx context.Context, platform string) (token string, expiresAt time.Time, err error) {
	if i.qr == nil {
		return "", time.Time{}, ErrQRUnavailable
	}
	token, hash, err := domain.GenerateToken()
	if err != nil {
		return "", time.Time{}, err
	}
	now := time.Now()
	rec := domain.QRLogin{Status: domain.QRPending, Platform: platform, CreatedAt: now}
	if err := i.qr.Put(ctx, hash, rec, QRLoginTTL); err != nil {
		return "", time.Time{}, err
	}
	return token, now.Add(QRLoginTTL), nil
}

// QRStatus returns the record for a token. A confirmed record is single-use: it
// is deleted on read so the desktop consumes the session token exactly once.
func (i *Interactor) QRStatus(ctx context.Context, token string) (domain.QRLogin, error) {
	if i.qr == nil {
		return domain.QRLogin{}, ErrQRUnavailable
	}
	hash := domain.HashToken(token)
	rec, err := i.qr.Get(ctx, hash)
	if err != nil {
		return domain.QRLogin{}, err // ErrNotFound ⇒ caller maps to "expired"
	}
	if rec.Status == domain.QRConfirmed {
		_ = i.qr.Delete(ctx, hash)
	}
	return rec, nil
}

// ConfirmQRLogin is called by an already-authenticated user (the scanning
// device). It mints a fresh session for that user and stores it on the record
// so the waiting desktop can read it.
func (i *Interactor) ConfirmQRLogin(ctx context.Context, token string, user domain.User) error {
	if i.qr == nil {
		return ErrQRUnavailable
	}
	hash := domain.HashToken(token)
	rec, err := i.qr.Get(ctx, hash)
	if err != nil {
		return err // ErrNotFound (absent/expired)
	}
	if rec.Status != domain.QRPending {
		return domain.ErrNotFound // already used
	}
	sessionToken, sessionHash, err := domain.GenerateToken()
	if err != nil {
		return err
	}
	if _, err := i.devices.Create(ctx, user.ID, "QR login", rec.Platform, sessionHash); err != nil {
		return err
	}
	rec.Status = domain.QRConfirmed
	rec.SessionToken = sessionToken
	rec.User = user
	return i.qr.Put(ctx, hash, rec, QRLoginTTL)
}
```

- [ ] **Step 8: Run tests to verify pass** — `go build ./... && go test ./internal/usecase/auth/ -run TestQRLogin -v`. Expected: PASS.

- [ ] **Step 9: Commit** — `git add -A && git commit -m "feat(qr-login): domain.QRLogin + QRStore port + Interactor (new/status/confirm)"`.

---

## Task 2: Redis QRStore adapter + fx/server wiring

**Files:**
- Create: `backend/internal/adapter/cache/redis/qrstore.go`
- Test: `backend/internal/adapter/cache/redis/qrstore_test.go`
- Modify: `backend/internal/app/providers.go`, `backend/internal/app/server.go`

- [ ] **Step 1: Write the failing test** — `backend/internal/adapter/cache/redis/qrstore_test.go` (use miniredis, mirroring the existing sessioncache test style):
```go
package redis

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestQRStore_PutGetDelete(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	store := NewQRStore(rdb)
	ctx := context.Background()

	rec := domain.QRLogin{Status: domain.QRPending, Platform: "web", CreatedAt: time.Now()}
	if err := store.Put(ctx, "hash1", rec, time.Minute); err != nil {
		t.Fatalf("Put: %v", err)
	}
	got, err := store.Get(ctx, "hash1")
	if err != nil || got.Status != domain.QRPending || got.Platform != "web" {
		t.Fatalf("Get: %+v err=%v", got, err)
	}
	// Unknown key → ErrNotFound.
	if _, err := store.Get(ctx, "nope"); err != domain.ErrNotFound {
		t.Fatalf("Get unknown: got %v, want ErrNotFound", err)
	}
	if err := store.Delete(ctx, "hash1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := store.Get(ctx, "hash1"); err != domain.ErrNotFound {
		t.Fatalf("Get after delete: got %v, want ErrNotFound", err)
	}
}
```

- [ ] **Step 2: Run to verify it fails** — `go test ./internal/adapter/cache/redis/ -run TestQRStore -v`. Expected: FAIL (NewQRStore undefined).

- [ ] **Step 3: Implement the adapter** — `backend/internal/adapter/cache/redis/qrstore.go`:
```go
package redis

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// QRStore stores QR-login records in Redis under "qrlogin:{tokenHash}". It
// implements the auth usecase's QRStore port.
type QRStore struct{ rdb *goredis.Client }

var _ usecaseauth.QRStore = (*QRStore)(nil)

func NewQRStore(rdb *goredis.Client) *QRStore { return &QRStore{rdb: rdb} }

func qrKey(tokenHash string) string { return "qrlogin:" + tokenHash }

func (s *QRStore) Put(ctx context.Context, tokenHash string, rec domain.QRLogin, ttl time.Duration) error {
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, qrKey(tokenHash), b, ttl).Err()
}

func (s *QRStore) Get(ctx context.Context, tokenHash string) (domain.QRLogin, error) {
	b, err := s.rdb.Get(ctx, qrKey(tokenHash)).Bytes()
	if errors.Is(err, goredis.Nil) {
		return domain.QRLogin{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.QRLogin{}, err
	}
	var rec domain.QRLogin
	if err := json.Unmarshal(b, &rec); err != nil {
		return domain.QRLogin{}, err
	}
	return rec, nil
}

func (s *QRStore) Delete(ctx context.Context, tokenHash string) error {
	return s.rdb.Del(ctx, qrKey(tokenHash)).Err()
}
```

- [ ] **Step 4: Run to verify pass** — `go test ./internal/adapter/cache/redis/ -run TestQRStore -v`. Expected: PASS.

- [ ] **Step 5: fx/server wiring** — in `backend/internal/app/providers.go`, next to `newSessionCache` (~line 148) add:
```go
func newQRStore(client *redis.Client) usecaseauth.QRStore {
	return cacheredis.NewQRStore(client)
}
```
In `backend/internal/app/server.go`, inside `if p.Redis.OK {` (right after `p.AuthUC.SetCache(redisSessionCache(p.Redis))`, ~line 49) add:
```go
		p.AuthUC.SetQRStore(redisQRStore(p.Redis))
```
and add the helper next to `redisSessionCache` (~line 117):
```go
// redisQRStore is a tiny helper so server.go doesn't import redisstore twice.
func redisQRStore(r RedisResult) usecaseauth.QRStore {
	return newQRStore(r.Client)
}
```

- [ ] **Step 6: Build + commit** — `go build ./... && go test ./internal/adapter/cache/redis/`. Then `git add -A && git commit -m "feat(qr-login): redis QRStore adapter + fx/server wiring"`.

---

## Task 3: HTTP endpoints + docs + merge + smoke

**Files:**
- Modify: `backend/internal/adapter/delivery/http/auth_handler.go`
- Modify: `backend/internal/adapter/delivery/http/router.go`
- Test: `backend/internal/adapter/delivery/http/auth_handler_test.go` (add a test)
- Modify: `docs/contracts.md`, `backend/internal/openapi/openapi.yaml`

- [ ] **Step 1: Handler methods** — in `auth_handler.go` add (after `SignIn`, before `writeJSON`):
```go
type qrNewBody struct {
	Platform string `json:"platform"`
}

func (h *AuthHandler) QRNew(w http.ResponseWriter, r *http.Request) {
	var body qrNewBody
	_ = json.NewDecoder(r.Body).Decode(&body) // platform optional
	token, expiresAt, err := h.svc.NewQRLogin(r.Context(), body.Platform)
	if errors.Is(err, usecaseauth.ErrQRUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "qr login unavailable")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not start qr login")
		return
	}
	// Build the scan URL from the request origin so a confirming device lands on
	// the SPA's /qr/{token} route. Fall back to Host when Origin is absent.
	origin := r.Header.Get("Origin")
	if origin == "" {
		scheme := "https"
		if r.TLS == nil {
			scheme = "http"
		}
		origin = scheme + "://" + r.Host
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token":      token,
		"url":        origin + "/qr/" + token,
		"expires_at": expiresAt.UTC().Format(time.RFC3339),
	})
}

func (h *AuthHandler) QRStatus(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	rec, err := h.svc.QRStatus(r.Context(), token)
	if errors.Is(err, domain.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "expired"})
		return
	}
	if errors.Is(err, usecaseauth.ErrQRUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "qr login unavailable")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "qr status failed")
		return
	}
	resp := map[string]any{"status": rec.Status}
	if rec.Status == domain.QRConfirmed {
		resp["session_token"] = rec.SessionToken
		resp["user"] = map[string]any{
			"id":           rec.User.ID,
			"phone":        rec.User.Phone,
			"display_name": rec.User.DisplayName,
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

type qrConfirmBody struct {
	Token string `json:"token"`
}

func (h *AuthHandler) QRConfirm(w http.ResponseWriter, r *http.Request) {
	var body qrConfirmBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Token == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}
	user, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	err := h.svc.ConfirmQRLogin(r.Context(), body.Token, user)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "invalid or expired token")
		return
	}
	if errors.Is(err, usecaseauth.ErrQRUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "qr login unavailable")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "qr confirm failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
```
Add the imports `"github.com/go-chi/chi/v5"` and `"time"` to `auth_handler.go`.

- [ ] **Step 2: Routes** — in `router.go`, after the public sign_in route (line 20) add:
```go
	r.Post("/auth/qr/new", authH.QRNew)
	r.Get("/auth/qr/{token}", authH.QRStatus)
```
and in the Bearer group (after the `sh := NewSessionHandler(authUC)` block, ~line 106) add:
```go
		pr.Post("/auth/qr/confirm", authH.QRConfirm)
```
(`authH` is already in scope from line 18.)

- [ ] **Step 3: Handler test** — append to `backend/internal/adapter/delivery/http/auth_handler_test.go` a test that drives the full flow through the router with a real `Interactor` + the in-memory fake QRStore. Reuse the existing test harness in that file (find how it builds the router/handler + an authed request — match it). The test must:
  1. Build an `Interactor` with `SetQRStore(<fake>)` (the fake from a small local struct, or reuse a miniredis-backed `cacheredis.NewQRStore`). Sign in a user to get a Bearer token + user id.
  2. `POST /auth/qr/new` → 200, capture `token`, assert `url` ends with `/qr/{token}`.
  3. `GET /auth/qr/{token}` → 200 `{"status":"pending"}`.
  4. `POST /auth/qr/confirm {token}` with the Bearer → 200 `{"ok":true}`.
  5. `GET /auth/qr/{token}` → 200 `{"status":"confirmed", session_token, user.id}` and a second GET → `{"status":"expired"}`.
  6. `GET /auth/qr/unknowntoken` → `{"status":"expired"}`.
  > If the existing test file sets up the Interactor without a QRStore, add `SetQRStore` in this test's setup. Keep it self-contained; do not change other tests.

- [ ] **Step 4: Run** — `go build ./... && go vet ./... && go test ./internal/adapter/delivery/http/ ./internal/usecase/auth/ ./internal/adapter/cache/redis/`. All green.

- [ ] **Step 5: Docs** — add the three endpoints to `docs/contracts.md` (REST section) and `backend/internal/openapi/openapi.yaml`:
  - `POST /auth/qr/new` (public) body `{platform?}` → `{token, url, expires_at}`; 503 when unavailable.
  - `GET /auth/qr/{token}` (public) → `{status: pending|confirmed|expired, session_token?, user?}`.
  - `POST /auth/qr/confirm` (Bearer) body `{token}` → `{ok}`; 404 invalid/expired, 503 unavailable.

- [ ] **Step 6: Full suite + commit + merge** — `cd backend && go test ./...` (all green; the MinIO presign test can flake on container startup — re-run in isolation if so). Commit `docs + tests`. Then `git checkout master && git merge --no-ff qr-login-qr1 -m "Merge qr-login-qr1: QR login backend (new/status/confirm)"`.

- [ ] **Step 7: Smoke (:38080)** — rebuild verify backend: `cd /Users/denisurevic/Documents/messenger-denis && docker compose -p msgrverify -f docker-compose.verify.yml up -d --build backend`. Then (avoid `GID`; use `QT`):
  - `QT=$(curl -s -X POST localhost:38080/api/auth/qr/new -H 'Content-Type: application/json' -d '{"platform":"web"}')` → has `token`,`url`,`expires_at`.
  - Extract the token; `GET /api/auth/qr/{token}` → `{"status":"pending"}`.
  - Sign in an existing user (request_code + sign_in OTP 12345) to get a Bearer; `POST /api/auth/qr/confirm {token}` with the Bearer → `{"ok":true}`.
  - `GET /api/auth/qr/{token}` → `{"status":"confirmed", session_token, user}`; the returned `session_token` works: `curl /api/me -H "Authorization: Bearer <session_token>"` → the confirming user. Second `GET` → `{"status":"expired"}`.

## Self-review
- Reuses `domain.GenerateToken`+`devices.Create` for minting (no new token machinery); Redis adapter mirrors `sessioncache.go`; `QRStore` injected at runtime (nil ⇒ 503, like push); `NewRouter` unchanged (AuthHandler already wraps authUC). Public new/status + Bearer confirm matches the spec; single-use confirmed record (deleted on read). ✓
