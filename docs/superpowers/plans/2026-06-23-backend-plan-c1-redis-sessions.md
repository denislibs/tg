# Backend Plan C1 — Redis Foundation + Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce Redis to the backend, add a Redis-backed session-token cache to the auth middleware (so we don't hit Postgres on every request), and add session-management endpoints: list a user's devices, revoke a specific session, and log out the current session.

**Architecture:** A new `internal/store/redisstore` package wraps `go-redis` (Connect + a `SessionCache` implementation). The `auth` package gains a `SessionCache` interface (implemented by `redisstore`, injected via `SetCache`, nil-safe so existing tests keep working). `Authenticate` becomes cache-aware and now also resolves the **device id**, which the middleware injects into the request context. New service methods `ListSessions`, `RevokeSession`, and the `/sessions` + `/auth/logout` HTTP endpoints round it out. Revoking a session deletes the `devices` row and evicts its cache key. Redis is tested with `miniredis` (in-memory, no Docker); Postgres-touching code keeps using `testcontainers-go`.

**Tech Stack:** Go, chi/v5, pgx/v5, **github.com/redis/go-redis/v9**, **github.com/alicebob/miniredis/v2** (test), testcontainers-go.

Implements spec §9a (session management + Redis token cache) and the Redis introduction from §7 of `docs/superpowers/specs/2026-06-23-messenger-backend-design.md`. WebSocket realtime, presence, typing, reactions, and pub/sub fan-out are Plan C2.

---

## File Structure

```
backend/
  internal/store/redisstore/
    client.go         — Connect(ctx, url) *redis.Client
    client_test.go    — miniredis ping
    session_cache.go  — SessionCache implementing auth.SessionCache (session:{hash})
    session_cache_test.go
  internal/auth/
    cache.go          — SessionCache interface + CachedSession type, sessionCacheTTL
    repo.go           — MODIFY: add SessionByTokenHash, ListDevices, DeleteDevice; Device gains LastActive
    repo_test.go      — MODIFY: add tests for the new repo methods
    service.go        — MODIFY: cache field + SetCache; cache-aware Authenticate (returns deviceID);
                        ListSessions, RevokeSession, Logout
    service_test.go   — MODIFY: cache hit/miss + revoke tests (fake cache)
  internal/transport/http/
    middleware.go     — MODIFY: Authenticate now returns deviceID; inject into context; DeviceIDFromContext
    session_handler.go— GET /sessions, DELETE /sessions/{id}, POST /auth/logout
    session_handler_test.go
    router.go         — MODIFY: mount session routes
  cmd/server/main.go  — MODIFY: connect Redis, build cache, authSvc.SetCache(cache)
```

---

### Task 1: Redis client wrapper

**Files:**
- Create: `backend/internal/store/redisstore/client.go`
- Create: `backend/internal/store/redisstore/client_test.go`

- [ ] **Step 1: Add dependencies**

Run:
```bash
cd backend && go get github.com/redis/go-redis/v9@latest github.com/alicebob/miniredis/v2@latest
```
Expected: both added to `go.mod`.

- [ ] **Step 2: Write the failing test**

Create `backend/internal/store/redisstore/client_test.go`:
```go
package redisstore

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
)

func TestConnect_Ping(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()

	c, err := Connect(context.Background(), "redis://"+mr.Addr())
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer c.Close()
	if err := c.Ping(context.Background()).Err(); err != nil {
		t.Fatalf("ping: %v", err)
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && go test ./internal/store/redisstore/ -run TestConnect -v`
Expected: FAIL — `Connect` undefined.

- [ ] **Step 4: Write the client**

Create `backend/internal/store/redisstore/client.go`:
```go
package redisstore

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// Connect parses a redis:// URL and returns a connected client.
func Connect(ctx context.Context, url string) (*redis.Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	client := redis.NewClient(opt)
	if err := client.Ping(ctx).Err(); err != nil {
		client.Close()
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return client, nil
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && go test ./internal/store/redisstore/ -run TestConnect -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/store/redisstore/client.go backend/internal/store/redisstore/client_test.go backend/go.mod backend/go.sum
git commit -m "feat(backend): redis client wrapper (Connect)"
```

---

### Task 2: Auth session-cache interface + Redis implementation

**Files:**
- Create: `backend/internal/auth/cache.go`
- Create: `backend/internal/store/redisstore/session_cache.go`
- Create: `backend/internal/store/redisstore/session_cache_test.go`

- [ ] **Step 1: Write the cache interface in auth**

Create `backend/internal/auth/cache.go`:
```go
package auth

import (
	"context"
	"time"
)

// SessionCacheTTL is how long a resolved session stays cached.
const SessionCacheTTL = 30 * time.Minute

// CachedSession is what we store under a token hash: enough to authorize a
// request without touching Postgres.
type CachedSession struct {
	User     User  `json:"user"`
	DeviceID int64 `json:"device_id"`
}

// SessionCache is a fast lookup from a token hash to its session. Implementations
// must treat a cache miss as (nil, nil), never an error.
type SessionCache interface {
	GetSession(ctx context.Context, tokenHash string) (*CachedSession, error)
	SetSession(ctx context.Context, tokenHash string, s CachedSession, ttl time.Duration) error
	DelSession(ctx context.Context, tokenHash string) error
}
```

- [ ] **Step 2: Write the Redis implementation**

Create `backend/internal/store/redisstore/session_cache.go`:
```go
package redisstore

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/messenger-denis/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

// SessionCache stores auth sessions in Redis under "session:{tokenHash}".
type SessionCache struct{ rdb *redis.Client }

func NewSessionCache(rdb *redis.Client) *SessionCache { return &SessionCache{rdb: rdb} }

func key(tokenHash string) string { return "session:" + tokenHash }

func (c *SessionCache) GetSession(ctx context.Context, tokenHash string) (*auth.CachedSession, error) {
	b, err := c.rdb.Get(ctx, key(tokenHash)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, nil // miss
	}
	if err != nil {
		return nil, err
	}
	var s auth.CachedSession
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func (c *SessionCache) SetSession(ctx context.Context, tokenHash string, s auth.CachedSession, ttl time.Duration) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return c.rdb.Set(ctx, key(tokenHash), b, ttl).Err()
}

func (c *SessionCache) DelSession(ctx context.Context, tokenHash string) error {
	return c.rdb.Del(ctx, key(tokenHash)).Err()
}
```

- [ ] **Step 3: Write the implementation test**

Create `backend/internal/store/redisstore/session_cache_test.go`:
```go
package redisstore

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/messenger-denis/backend/internal/auth"
)

func TestSessionCache_RoundTrip(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	c, _ := Connect(context.Background(), "redis://"+mr.Addr())
	defer c.Close()
	cache := NewSessionCache(c)
	ctx := context.Background()

	// Miss returns (nil, nil).
	got, err := cache.GetSession(ctx, "h1")
	if err != nil || got != nil {
		t.Fatalf("miss = %v, %v; want nil,nil", got, err)
	}

	want := auth.CachedSession{User: auth.User{ID: 7, Phone: "+700", DisplayName: "Bob"}, DeviceID: 3}
	if err := cache.SetSession(ctx, "h1", want, time.Minute); err != nil {
		t.Fatalf("set: %v", err)
	}
	got, err = cache.GetSession(ctx, "h1")
	if err != nil || got == nil || got.User.ID != 7 || got.DeviceID != 3 {
		t.Fatalf("get = %+v, %v", got, err)
	}

	if err := cache.DelSession(ctx, "h1"); err != nil {
		t.Fatalf("del: %v", err)
	}
	got, _ = cache.GetSession(ctx, "h1")
	if got != nil {
		t.Fatal("expected miss after delete")
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/store/redisstore/ -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/auth/cache.go backend/internal/store/redisstore/session_cache.go backend/internal/store/redisstore/session_cache_test.go
git commit -m "feat(backend): session cache interface + redis implementation"
```

---

### Task 3: Auth repo — sessions by token, list devices, delete device

**Files:**
- Modify: `backend/internal/auth/repo.go`
- Modify: `backend/internal/auth/repo_test.go`

- [ ] **Step 1: Extend the Device type and add repo methods**

In `backend/internal/auth/repo.go`, add a `LastActive` field to the `Device` struct (add the import `"time"` if not present):
```go
type Device struct {
	ID         int64
	UserID     int64
	Name       string
	Platform   string
	TokenHash  string
	LastActive time.Time
}
```

Then add these methods at the end of the file:
```go
// SessionByTokenHash resolves a token hash to its user and device id, and
// lazily touches last_active. Returns ErrNotFound if unknown.
func (r *Repo) SessionByTokenHash(ctx context.Context, tokenHash string) (User, int64, error) {
	var u User
	var deviceID int64
	err := r.pool.QueryRow(ctx,
		`SELECT u.id, u.phone, u.username, u.display_name, u.avatar_url, d.id
		 FROM users u JOIN devices d ON d.user_id=u.id WHERE d.token_hash=$1`,
		tokenHash).Scan(&u.ID, &u.Phone, &u.Username, &u.DisplayName, &u.AvatarURL, &deviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, 0, ErrNotFound
	}
	if err != nil {
		return User{}, 0, err
	}
	_, _ = r.pool.Exec(ctx, `UPDATE devices SET last_active=now() WHERE id=$1`, deviceID)
	return u, deviceID, nil
}

// ListDevices returns a user's devices, most recently active first.
func (r *Repo) ListDevices(ctx context.Context, userID int64) ([]Device, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, name, platform, last_active FROM devices
		 WHERE user_id=$1 ORDER BY last_active DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Device
	for rows.Next() {
		var d Device
		if err := rows.Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.LastActive); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DeleteDevice removes a user's device by id and returns its token hash (so the
// caller can evict the cache). found is false if no such device exists.
func (r *Repo) DeleteDevice(ctx context.Context, userID, deviceID int64) (tokenHash string, found bool, err error) {
	err = r.pool.QueryRow(ctx,
		`DELETE FROM devices WHERE id=$1 AND user_id=$2 RETURNING token_hash`,
		deviceID, userID).Scan(&tokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return tokenHash, true, nil
}
```

- [ ] **Step 2: Add repo tests**

Append to `backend/internal/auth/repo_test.go`:
```go
func TestRepo_SessionListDelete(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	u, _ := repo.UpsertUserByPhone(ctx, "+790")
	d1, _ := repo.CreateDevice(ctx, u.ID, "web", "browser", "hash-1")
	_, _ = repo.CreateDevice(ctx, u.ID, "phone", "ios", "hash-2")

	// SessionByTokenHash resolves user + device.
	gotUser, gotDevice, err := repo.SessionByTokenHash(ctx, "hash-1")
	if err != nil || gotUser.ID != u.ID || gotDevice != d1.ID {
		t.Fatalf("SessionByTokenHash = %v, %d, %v", gotUser, gotDevice, err)
	}
	if _, _, err := repo.SessionByTokenHash(ctx, "missing"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}

	// ListDevices returns both.
	devices, err := repo.ListDevices(ctx, u.ID)
	if err != nil || len(devices) != 2 {
		t.Fatalf("ListDevices = %v, %v", devices, err)
	}

	// DeleteDevice returns the token hash and removes it.
	th, found, err := repo.DeleteDevice(ctx, u.ID, d1.ID)
	if err != nil || !found || th != "hash-1" {
		t.Fatalf("DeleteDevice = %q, %v, %v", th, found, err)
	}
	if _, _, err := repo.SessionByTokenHash(ctx, "hash-1"); err != ErrNotFound {
		t.Fatalf("expected device gone, got %v", err)
	}
	// Deleting a non-existent / other-user device reports not found.
	if _, found, _ := repo.DeleteDevice(ctx, u.ID, 99999); found {
		t.Fatal("expected found=false for unknown device")
	}
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/auth/ -run 'Repo_SessionListDelete' -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/auth/repo.go backend/internal/auth/repo_test.go
git commit -m "feat(backend): repo SessionByTokenHash, ListDevices, DeleteDevice"
```

---

### Task 4: Auth service — cache-aware auth + session management

**Files:**
- Modify: `backend/internal/auth/service.go`
- Modify: `backend/internal/auth/service_test.go`

- [ ] **Step 1: Make the service cache-aware and add session methods**

In `backend/internal/auth/service.go`:

(a) Add a `cache` field and a setter. Change the struct and `NewService` is unchanged (cache stays nil by default); add:
```go
// SetCache attaches a session cache (optional). When nil, Authenticate always
// resolves via Postgres.
func (s *Service) SetCache(c SessionCache) { s.cache = c }
```
Add `cache SessionCache` to the `Service` struct fields.

(b) Replace the existing `Authenticate` method with the cache-aware version that also returns the device id:
```go
// Authenticate resolves a raw token to its user and device id, using the cache
// when available and falling back to Postgres (then populating the cache).
func (s *Service) Authenticate(ctx context.Context, token string) (User, int64, error) {
	hash := HashToken(token)
	if s.cache != nil {
		if cs, err := s.cache.GetSession(ctx, hash); err == nil && cs != nil {
			return cs.User, cs.DeviceID, nil
		}
	}
	user, deviceID, err := s.repo.SessionByTokenHash(ctx, hash)
	if err != nil {
		return User{}, 0, err
	}
	if s.cache != nil {
		_ = s.cache.SetSession(ctx, hash, CachedSession{User: user, DeviceID: deviceID}, SessionCacheTTL)
	}
	return user, deviceID, nil
}
```

(c) Add session-management methods at the end of the file:
```go
// ListSessions returns the user's devices.
func (s *Service) ListSessions(ctx context.Context, userID int64) ([]Device, error) {
	return s.repo.ListDevices(ctx, userID)
}

// RevokeSession deletes a user's device and evicts its cached session. Returns
// false if the device does not belong to the user / does not exist.
func (s *Service) RevokeSession(ctx context.Context, userID, deviceID int64) (bool, error) {
	tokenHash, found, err := s.repo.DeleteDevice(ctx, userID, deviceID)
	if err != nil || !found {
		return false, err
	}
	if s.cache != nil {
		_ = s.cache.DelSession(ctx, tokenHash)
	}
	return true, nil
}
```

Add `"context"` to imports if not already present (it is, from RequestCode).

- [ ] **Step 2: Update the service test for the new Authenticate signature and add cache/revoke tests**

In `backend/internal/auth/service_test.go`, the existing `TestService_RequestAndSignIn` calls `s.Authenticate(ctx, res.Token)` expecting `(User, error)`. Update that call site to the 3-value form:
```go
	got, _, err := s.Authenticate(ctx, res.Token)
	if err != nil || got.ID != res.User.ID {
		t.Fatalf("Authenticate = %+v, %v", got, err)
	}
```

Then append a fake-cache test:
```go
// fakeCache is an in-memory SessionCache for tests, counting lookups.
type fakeCache struct {
	m    map[string]auth.CachedSession
	gets int
}

func newFakeCache() *fakeCache { return &fakeCache{m: map[string]auth.CachedSession{}} }

func (f *fakeCache) GetSession(_ context.Context, h string) (*auth.CachedSession, error) {
	f.gets++
	if s, ok := f.m[h]; ok {
		return &s, nil
	}
	return nil, nil
}
func (f *fakeCache) SetSession(_ context.Context, h string, s auth.CachedSession, _ time.Duration) error {
	f.m[h] = s
	return nil
}
func (f *fakeCache) DelSession(_ context.Context, h string) error {
	delete(f.m, h)
	return nil
}

func TestService_AuthenticateUsesCache(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	cache := newFakeCache()
	s := NewService(repo, "12345", func(string, ...any) {})
	s.SetCache(cache)
	ctx := context.Background()

	_ = s.RequestCode(ctx, "+79991230000")
	res, err := s.SignIn(ctx, "+79991230000", "12345", "web", "browser")
	if err != nil {
		t.Fatalf("SignIn: %v", err)
	}
	// First auth: cache miss → populated.
	if _, _, err := s.Authenticate(ctx, res.Token); err != nil {
		t.Fatalf("auth 1: %v", err)
	}
	if len(cache.m) != 1 {
		t.Fatalf("cache not populated: %d entries", len(cache.m))
	}
	// Second auth: served from cache.
	if _, _, err := s.Authenticate(ctx, res.Token); err != nil {
		t.Fatalf("auth 2: %v", err)
	}
}

func TestService_RevokeSession(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	cache := newFakeCache()
	s := NewService(repo, "12345", func(string, ...any) {})
	s.SetCache(cache)
	ctx := context.Background()

	_ = s.RequestCode(ctx, "+79991230001")
	res, _ := s.SignIn(ctx, "+79991230001", "12345", "web", "browser")
	_, deviceID, _ := s.Authenticate(ctx, res.Token) // populates cache

	sessions, err := s.ListSessions(ctx, res.User.ID)
	if err != nil || len(sessions) != 1 {
		t.Fatalf("ListSessions = %v, %v", sessions, err)
	}

	ok, err := s.RevokeSession(ctx, res.User.ID, deviceID)
	if err != nil || !ok {
		t.Fatalf("RevokeSession = %v, %v", ok, err)
	}
	// Token no longer authenticates and cache was evicted.
	if _, _, err := s.Authenticate(ctx, res.Token); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound after revoke, got %v", err)
	}
	if len(cache.m) != 0 {
		t.Fatalf("cache not evicted: %d entries", len(cache.m))
	}
}
```
Note: this test file already imports `context` and `postgres`; add `"time"` and `"github.com/messenger-denis/backend/internal/auth"` to its imports. The fakeCache uses `auth.CachedSession` because the test is in package `auth`? It is in package `auth` (same package as service_test.go from Plan A). If so, reference `CachedSession` without the `auth.` qualifier and DROP the `auth` import. **Check the package clause of service_test.go**: Plan A created it as `package auth`. Therefore use unqualified `CachedSession`, `User`, `ErrNotFound`, and do NOT import the auth package. Only add `"time"` to imports.

Corrected fakeCache for `package auth`:
```go
type fakeCache struct {
	m    map[string]CachedSession
	gets int
}

func newFakeCache() *fakeCache { return &fakeCache{m: map[string]CachedSession{}} }

func (f *fakeCache) GetSession(_ context.Context, h string) (*CachedSession, error) {
	f.gets++
	if s, ok := f.m[h]; ok {
		return &s, nil
	}
	return nil, nil
}
func (f *fakeCache) SetSession(_ context.Context, h string, s CachedSession, _ time.Duration) error {
	f.m[h] = s
	return nil
}
func (f *fakeCache) DelSession(_ context.Context, h string) error {
	delete(f.m, h)
	return nil
}
```
And in the two new test funcs use `NewService(repo, ...)` etc. unqualified, and expect `ErrNotFound` unqualified. Use this `package auth` version.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/auth/ -run 'Service' -v`
Expected: PASS (existing RequestAndSignIn/WrongCode/NoCodeRequested + new AuthenticateUsesCache + RevokeSession).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/auth/service.go backend/internal/auth/service_test.go
git commit -m "feat(backend): cache-aware Authenticate + ListSessions/RevokeSession"
```

---

### Task 5: Middleware device context + session handlers + wiring

**Files:**
- Modify: `backend/internal/transport/http/middleware.go`
- Create: `backend/internal/transport/http/session_handler.go`
- Modify: `backend/internal/transport/http/router.go`
- Modify: `backend/cmd/server/main.go`
- Test: `backend/internal/transport/http/session_handler_test.go`

- [ ] **Step 1: Update the middleware for the new Authenticate signature + device context**

In `backend/internal/transport/http/middleware.go`:

(a) Add a device context key next to `userKey`:
```go
const userKey ctxKey = 0
const deviceKey ctxKey = 1
```

(b) In `AuthMiddleware`, update the Authenticate call and inject the device id:
```go
			user, deviceID, err := svc.Authenticate(r.Context(), token)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "invalid token")
				return
			}
			ctx := context.WithValue(r.Context(), userKey, user)
			ctx = context.WithValue(ctx, deviceKey, deviceID)
			next.ServeHTTP(w, r.WithContext(ctx))
```

(c) Add an accessor at the end of the file:
```go
// DeviceIDFromContext returns the authenticated device id, if any.
func DeviceIDFromContext(ctx context.Context) (int64, bool) {
	id, ok := ctx.Value(deviceKey).(int64)
	return id, ok
}
```

- [ ] **Step 2: Write the session handlers**

Create `backend/internal/transport/http/session_handler.go`:
```go
package http

import (
	"net/http"

	"github.com/messenger-denis/backend/internal/auth"
)

type SessionHandler struct{ svc *auth.Service }

func NewSessionHandler(svc *auth.Service) *SessionHandler { return &SessionHandler{svc: svc} }

func (h *SessionHandler) List(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	current, _ := DeviceIDFromContext(r.Context())
	devices, err := h.svc.ListSessions(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list sessions")
		return
	}
	out := make([]map[string]any, 0, len(devices))
	for _, d := range devices {
		out = append(out, map[string]any{
			"id": d.ID, "name": d.Name, "platform": d.Platform,
			"last_active": d.LastActive, "current": d.ID == current,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": out})
}

func (h *SessionHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	deviceID, ok := pathInt(w, r, "deviceID")
	if !ok {
		return
	}
	revoked, err := h.svc.RevokeSession(r.Context(), user.ID, deviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not revoke session")
		return
	}
	if !revoked {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *SessionHandler) Logout(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	deviceID, ok := DeviceIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	if _, err := h.svc.RevokeSession(r.Context(), user.ID, deviceID); err != nil {
		writeError(w, http.StatusInternalServerError, "logout failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
```

- [ ] **Step 3: Mount the routes**

In `backend/internal/transport/http/router.go`, inside the protected group (after the chat routes), add:
```go
		sh := NewSessionHandler(authSvc)
		pr.Get("/sessions", sh.List)
		pr.Delete("/sessions/{deviceID}", sh.Revoke)
		pr.Post("/auth/logout", sh.Logout)
```

- [ ] **Step 4: Wire Redis into main.go**

In `backend/cmd/server/main.go`, after connecting Postgres and before building the auth service, connect Redis and attach the cache. Add imports `"github.com/messenger-denis/backend/internal/store/redisstore"`. Replace the auth-service construction:
```go
	authSvc := auth.NewService(auth.NewRepo(pool), cfg.DevOTPCode, log.Printf)
```
with:
```go
	authSvc := auth.NewService(auth.NewRepo(pool), cfg.DevOTPCode, log.Printf)
	if rdb, err := redisstore.Connect(ctx, cfg.RedisURL); err != nil {
		log.Printf("redis unavailable, running without session cache: %v", err)
	} else {
		defer rdb.Close()
		authSvc.SetCache(redisstore.NewSessionCache(rdb))
		log.Printf("session cache enabled (redis)")
	}
```

- [ ] **Step 5: Write the session handler test**

Create `backend/internal/transport/http/session_handler_test.go`:
```go
package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestSessions_ListAndLogout(t *testing.T) {
	h, pool := newMessagingRouter(t)
	token, _ := signUp(t, h, pool, "+79990000010")

	// List shows one current session.
	rec := authedReq(t, h, http.MethodGet, "/sessions", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	var listed struct {
		Sessions []struct {
			ID      int64 `json:"id"`
			Current bool  `json:"current"`
		} `json:"sessions"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Sessions) != 1 || !listed.Sessions[0].Current {
		t.Fatalf("sessions = %+v", listed.Sessions)
	}

	// Logout, then the token is rejected.
	rec = authedReq(t, h, http.MethodPost, "/auth/logout", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("logout: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/me", token, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 after logout, got %d", rec.Code)
	}
}

func TestSessions_RevokeOther(t *testing.T) {
	h, pool := newMessagingRouter(t)
	// Same phone signs in twice → two devices/sessions.
	tokenA, _ := signUp(t, h, pool, "+79990000011")
	tokenB, _ := signUp(t, h, pool, "+79990000011")

	rec := authedReq(t, h, http.MethodGet, "/sessions", tokenA, nil)
	var listed struct {
		Sessions []struct {
			ID      int64 `json:"id"`
			Current bool  `json:"current"`
		} `json:"sessions"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(listed.Sessions))
	}
	// Find the non-current (session B) and revoke it from A.
	var other int64
	for _, s := range listed.Sessions {
		if !s.Current {
			other = s.ID
		}
	}
	rec = authedReq(t, h, http.MethodDelete, "/sessions/"+itoa(other), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke: %d %s", rec.Code, rec.Body.String())
	}
	// Token B no longer works.
	rec = authedReq(t, h, http.MethodGet, "/me", tokenB, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected B revoked (401), got %d", rec.Code)
	}
}
```
Note: `newMessagingRouter`, `signUp`, `authedReq`, `itoa` already exist in `chat_handler_test.go` (same package). The router built there uses an auth service **without** a cache (cache nil), which is fine — these tests exercise the Postgres path and still verify revoke/logout behavior.

- [ ] **Step 6: Run the tests and build**

Run: `cd backend && go build ./... && go test ./internal/transport/http/ -v`
Expected: build clean; all HTTP tests pass (existing auth/me/chat/sync + new sessions).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/transport/http/ backend/cmd/server/main.go
git commit -m "feat(backend): session endpoints (/sessions, /auth/logout) + redis cache wiring"
```

---

### Task 6: Full-stack verification (with Redis)

**Files:** none (verification only).

- [ ] **Step 1: Whole suite**

Run: `cd backend && go test ./... && go vet ./...`
Expected: all packages PASS, vet clean.

- [ ] **Step 2: End-to-end with Redis (isolated docker project)**

Run:
```bash
cat > /tmp/plan-c1-stack.yml <<'EOF'
name: plan-c1-verify
services:
  pg:
    image: postgres:16-alpine
    environment: {POSTGRES_USER: messenger, POSTGRES_PASSWORD: messenger, POSTGRES_DB: messenger}
    healthcheck: {test: ["CMD-SHELL","pg_isready -U messenger"], interval: 3s, timeout: 3s, retries: 10}
  redis:
    image: redis:7-alpine
    healthcheck: {test: ["CMD","redis-cli","ping"], interval: 3s, timeout: 3s, retries: 10}
  backend:
    build: /Users/denisurevic/Documents/messenger-denis/backend
    environment:
      HTTP_ADDR: ":8080"
      DATABASE_URL: "postgres://messenger:messenger@pg:5432/messenger?sslmode=disable"
      REDIS_URL: "redis://redis:6379"
      DEV_OTP_CODE: "12345"
    depends_on:
      pg: {condition: service_healthy}
      redis: {condition: service_healthy}
    ports: ["18083:8080"]
EOF
docker compose -f /tmp/plan-c1-stack.yml up -d --build
sleep 6
docker compose -f /tmp/plan-c1-stack.yml logs backend | grep -i "session cache enabled"
B="localhost:18083"
curl -s -X POST $B/auth/request_code -d '{"phone":"+700"}' >/dev/null
TOK=$(curl -s -X POST $B/auth/sign_in -d '{"phone":"+700","code":"12345"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
echo "sessions: $(curl -s $B/sessions -H "Authorization: Bearer $TOK")"
echo "me:       $(curl -s $B/me -H "Authorization: Bearer $TOK")"
echo "logout:   $(curl -s -X POST $B/auth/logout -H "Authorization: Bearer $TOK")"
echo "me after: $(curl -s -o /dev/null -w '%{http_code}' $B/me -H "Authorization: Bearer $TOK")"
docker compose -f /tmp/plan-c1-stack.yml down -v
```
Expected: log shows "session cache enabled (redis)"; `/sessions` lists one session with `current:true`; `/me` returns the user; logout returns `{"ok":true}`; `/me after` prints `401`.

- [ ] **Step 3: No code changes expected.** If verification surfaced a bug, fix it under the relevant task and re-run.

---

## Self-Review Notes

- **Spec coverage:** §9a session endpoints (GET /sessions, DELETE /sessions/{id}, POST /auth/logout) — Tasks 3,4,5. Redis token cache (`session:{token_hash}`, populate on miss, evict on revoke/logout, TTL) — Tasks 1,2,4,5. §7 Redis introduction — Task 1.
- **Out of scope (Plan C2):** WS hub, pub/sub fan-out, presence, typing, live reactions, and forcibly closing a revoked device's WS connection. C1 makes the token invalid immediately (cache evicted + row deleted); C2 will additionally drop the live socket.
- **Nil-cache safety:** `SetCache` is optional; `Authenticate` works with a nil cache (always Postgres), so all Plan A/B test helpers that build `auth.NewService` without a cache keep compiling and passing unchanged.
- **Signature change:** `Authenticate` now returns `(User, int64, error)`. The only caller is the middleware (updated in Task 5) and `service_test.go` (updated in Task 4). Verified no other call sites.
- **last_active tradeoff:** with the cache, `last_active` only updates on a cache miss (≤ once per TTL), not on every request — acceptable and intended (avoids a DB write per request); documented in `SessionByTokenHash`.
- **Type consistency:** `CachedSession`, `SessionCache`, `SetCache`, `SessionByTokenHash`, `ListDevices`, `DeleteDevice`, `RevokeSession`, `ListSessions`, `DeviceIDFromContext` used consistently across cache/repo/service/transport.
```
