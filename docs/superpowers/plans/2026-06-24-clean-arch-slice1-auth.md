# Clean Arch Slice 1 — Auth (reference slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate authentication & sessions to Clean Architecture — domain entities + pure helpers, a `usecase/auth` interactor depending only on port interfaces, postgres + redis adapters implementing those ports, and delivery (HTTP handlers, middleware, WS authenticator) + fx rewired to the usecase. The legacy `internal/auth` package is deleted. Behavior, API, and the test suite stay green.

**Architecture:** Slice 1 of the refactor (`docs/superpowers/specs/2026-06-24-clean-architecture-di-design.md`). Pure auth logic (phone normalize, code match, token gen/hash) moves to `internal/domain`. The auth interactor (`internal/usecase/auth`) defines ports (`UserRepo, DeviceRepo, CodeRepo, SessionCache, RevocationNotifier`) and contains the exact current logic on domain types. Adapters: `internal/adapter/repo/postgres` (auth repo) and `internal/adapter/cache/redis` (session cache). The HTTP delivery stays in `internal/transport/http` (shared middleware/context) but its auth/session/me handlers + middleware now call the usecase; `transport/ws` takes an `Authenticator` interface. Other features (chat/messaging/media/push) are untouched this slice.

**Tech Stack:** Go, go.uber.org/fx, pgx, go-redis, chi, gorilla/websocket, testcontainers/miniredis.

> Note: per the strangler approach, the physical relocation of `transport/http`→`adapter/delivery/http` and `transport/ws`→`adapter/delivery/ws` happens in the final slice; here those packages are the HTTP/WS delivery adapter in place.

---

## File Structure

```
backend/
  internal/domain/
    user.go            — User, Device, Session entities
    errors.go          — ErrNotFound, ErrInvalidCode (sentinels)
    phone.go           — NormalizePhone, CodeMatches
    token.go           — GenerateToken, HashToken
    *_test.go          — pure unit tests (ported from auth/code_test.go, token_test.go)
  internal/usecase/auth/
    ports.go           — UserRepo, DeviceRepo, CodeRepo, SessionCache, RevocationNotifier, CachedSession
    auth.go            — Interactor (RequestCode, SignIn, Authenticate, ListSessions, RevokeSession) + setters
    auth_test.go       — unit tests with fake ports (ported from auth/service_test.go)
  internal/adapter/repo/postgres/
    authrepo.go        — AuthRepo implementing UserRepo+DeviceRepo+CodeRepo (SQL ported from auth/repo.go)
    authrepo_test.go   — testcontainers (ported from auth/repo_test.go)
  internal/adapter/cache/redis/
    sessioncache.go    — SessionCache impl (ported from redisstore/session_cache.go)
    sessioncache_test.go — miniredis (ported)
  internal/transport/http/
    middleware.go      — MODIFY: Authenticator iface; UserFromContext returns domain.User
    auth_handler.go    — MODIFY: use usecase/auth
    me_handler.go, session_handler.go — MODIFY: use usecase/auth + domain.User
  internal/transport/ws/
    handler.go         — MODIFY: Authenticator iface instead of *auth.Service
  internal/app/
    providers.go, server.go — MODIFY: provide usecase/auth + adapters; wire into middleware/ws/router
  internal/transport/http/router.go — MODIFY: NewRouter takes the auth usecase (+ its handlers)
  DELETE: internal/auth/ (entire package)  ·  internal/store/redisstore/session_cache*.go (moved)
```

---

### Task 1: domain — auth entities, errors, pure helpers

**Files:**
- Create: `backend/internal/domain/user.go`, `errors.go`, `phone.go`, `token.go`
- Create: `backend/internal/domain/phone_test.go`, `token_test.go`

- [ ] **Step 1: Entities + errors**

`backend/internal/domain/user.go`:
```go
// Package domain holds the core entities, value objects, and errors. It has no
// dependency on any framework or infrastructure.
package domain

import "time"

type User struct {
	ID          int64
	Phone       string
	Username    *string
	DisplayName string
	AvatarURL   string
}

type Device struct {
	ID         int64
	UserID     int64
	Name       string
	Platform   string
	TokenHash  string
	LastActive time.Time
}

// Session is a resolved auth context (cached): who, on which device.
type Session struct {
	User     User
	DeviceID int64
}
```

`backend/internal/domain/errors.go`:
```go
package domain

import "errors"

var (
	ErrNotFound    = errors.New("not found")
	ErrInvalidCode = errors.New("invalid code")
)
```

- [ ] **Step 2: Pure helpers (port verbatim from the old auth package)**

`backend/internal/domain/phone.go` — copy the bodies of `NormalizePhone` and `CodeMatches` from the current `internal/auth/code.go` verbatim (same logic: strip non-digits keeping leading `+`; `CodeMatches` uses `crypto/subtle.ConstantTimeCompare`), in `package domain`.

`backend/internal/domain/token.go` — copy `GenerateToken` and `HashToken` from `internal/auth/token.go` verbatim, in `package domain`.

- [ ] **Step 3: Tests (port verbatim)**

`backend/internal/domain/phone_test.go` — port `TestNormalizePhone`, `TestCodeMatches` from `internal/auth/code_test.go` (package `domain`).
`backend/internal/domain/token_test.go` — port `TestGenerateToken`, `TestHashTokenStable` from `internal/auth/token_test.go` (package `domain`).

- [ ] **Step 4: Run + commit**

Run: `cd backend && go test ./internal/domain/ -v`
Expected: PASS.
```bash
git add backend/internal/domain/
git commit -m "feat(backend): domain auth entities, errors, pure helpers"
```

---

### Task 2: usecase/auth — ports + interactor

**Files:**
- Create: `backend/internal/usecase/auth/ports.go`, `auth.go`, `auth_test.go`

- [ ] **Step 1: Ports**

`backend/internal/usecase/auth/ports.go`:
```go
// Package auth is the authentication application logic (interactor + ports).
package auth

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type UserRepo interface {
	UpsertByPhone(ctx context.Context, phone string) (domain.User, error)
}

type DeviceRepo interface {
	Create(ctx context.Context, userID int64, name, platform, tokenHash string) (domain.Device, error)
	SessionByTokenHash(ctx context.Context, tokenHash string) (domain.User, int64, error)
	ListByUser(ctx context.Context, userID int64) ([]domain.Device, error)
	Delete(ctx context.Context, userID, deviceID int64) (tokenHash string, found bool, err error)
}

type CodeRepo interface {
	Save(ctx context.Context, phone, code string, expires time.Time) error
	Get(ctx context.Context, phone string) (string, error) // domain.ErrNotFound if absent/expired
	Delete(ctx context.Context, phone string) error
}

type SessionCache interface {
	GetSession(ctx context.Context, tokenHash string) (*domain.Session, error) // (nil,nil) on miss
	SetSession(ctx context.Context, tokenHash string, s domain.Session, ttl time.Duration) error
	DelSession(ctx context.Context, tokenHash string) error
}

type RevocationNotifier interface {
	NotifyRevoked(ctx context.Context, deviceID int64) error
}

const SessionCacheTTL = 30 * time.Minute
```

- [ ] **Step 2: Interactor**

`backend/internal/usecase/auth/auth.go` — the interactor holds the ports and mirrors the current `auth.Service` logic on domain types:
```go
package auth

import (
	"context"
	"errors"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

const codeTTL = 5 * time.Minute

type Interactor struct {
	users    UserRepo
	devices  DeviceRepo
	codes    CodeRepo
	devCode  string
	logf     func(string, ...any)
	cache    SessionCache       // optional
	revoker  RevocationNotifier // optional
}

func New(users UserRepo, devices DeviceRepo, codes CodeRepo, devCode string, logf func(string, ...any)) *Interactor {
	return &Interactor{users: users, devices: devices, codes: codes, devCode: devCode, logf: logf}
}

func (i *Interactor) SetCache(c SessionCache)              { i.cache = c }
func (i *Interactor) SetRevocationNotifier(n RevocationNotifier) { i.revoker = n }

func (i *Interactor) RequestCode(ctx context.Context, rawPhone string) error {
	phone := domain.NormalizePhone(rawPhone)
	if phone == "" {
		return errors.New("empty phone")
	}
	if err := i.codes.Save(ctx, phone, i.devCode, time.Now().Add(codeTTL)); err != nil {
		return err
	}
	i.logf("[dev-otp] phone=%s code=%s", phone, i.devCode)
	return nil
}

type SignInResult struct {
	Token string
	User  domain.User
}

func (i *Interactor) SignIn(ctx context.Context, rawPhone, suppliedCode, deviceName, platform string) (SignInResult, error) {
	phone := domain.NormalizePhone(rawPhone)
	stored, err := i.codes.Get(ctx, phone)
	if errors.Is(err, domain.ErrNotFound) {
		return SignInResult{}, domain.ErrInvalidCode
	}
	if err != nil {
		return SignInResult{}, err
	}
	if !domain.CodeMatches(stored, suppliedCode) {
		return SignInResult{}, domain.ErrInvalidCode
	}
	user, err := i.users.UpsertByPhone(ctx, phone)
	if err != nil {
		return SignInResult{}, err
	}
	token, hash, err := domain.GenerateToken()
	if err != nil {
		return SignInResult{}, err
	}
	if _, err := i.devices.Create(ctx, user.ID, deviceName, platform, hash); err != nil {
		return SignInResult{}, err
	}
	_ = i.codes.Delete(ctx, phone)
	return SignInResult{Token: token, User: user}, nil
}

func (i *Interactor) Authenticate(ctx context.Context, token string) (domain.User, int64, error) {
	hash := domain.HashToken(token)
	if i.cache != nil {
		if s, err := i.cache.GetSession(ctx, hash); err == nil && s != nil {
			return s.User, s.DeviceID, nil
		}
	}
	user, deviceID, err := i.devices.SessionByTokenHash(ctx, hash)
	if err != nil {
		return domain.User{}, 0, err
	}
	if i.cache != nil {
		_ = i.cache.SetSession(ctx, hash, domain.Session{User: user, DeviceID: deviceID}, SessionCacheTTL)
	}
	return user, deviceID, nil
}

func (i *Interactor) ListSessions(ctx context.Context, userID int64) ([]domain.Device, error) {
	return i.devices.ListByUser(ctx, userID)
}

func (i *Interactor) RevokeSession(ctx context.Context, userID, deviceID int64) (bool, error) {
	tokenHash, found, err := i.devices.Delete(ctx, userID, deviceID)
	if err != nil || !found {
		return false, err
	}
	if i.cache != nil {
		_ = i.cache.DelSession(ctx, tokenHash)
	}
	if i.revoker != nil {
		_ = i.revoker.NotifyRevoked(ctx, deviceID)
	}
	return true, nil
}
```

- [ ] **Step 3: Unit tests with fakes**

`backend/internal/usecase/auth/auth_test.go` — in-memory fake `UserRepo/DeviceRepo/CodeRepo/SessionCache/RevocationNotifier` (maps), and tests porting the behaviors from the old `auth/service_test.go`: `RequestAndSignIn` (happy path, Authenticate returns user+device), `WrongCode`→`domain.ErrInvalidCode`, `NoCodeRequested`→`ErrInvalidCode`, `AuthenticateUsesCache` (cache hit avoids repo), `RevokeSession` (deletes + evicts cache + notifies, token then fails), `ListSessions`. No DB — pure fakes.

- [ ] **Step 4: Run + commit**

Run: `cd backend && go test ./internal/usecase/auth/ -v`
Expected: PASS (fast, no Docker).
```bash
git add backend/internal/usecase/auth/
git commit -m "feat(backend): auth usecase interactor + ports + fake-driven unit tests"
```

---

### Task 3: postgres + redis adapters for auth

**Files:**
- Create: `backend/internal/adapter/repo/postgres/authrepo.go`, `authrepo_test.go`
- Create: `backend/internal/adapter/cache/redis/sessioncache.go`, `sessioncache_test.go`

- [ ] **Step 1: AuthRepo (postgres)**

`backend/internal/adapter/repo/postgres/authrepo.go` — `package postgres` (the adapter repo package; distinct from `store/postgres`). A single `AuthRepo` struct wrapping `*pgxpool.Pool` that implements `usecaseauth.UserRepo + DeviceRepo + CodeRepo`. Port the SQL from the current `internal/auth/repo.go` (`UpsertUserByPhone`→`UpsertByPhone`, `CreateDevice`→`Create`, `SessionByTokenHash`, `ListDevices`→`ListByUser`, `DeleteDevice`→`Delete`, code methods `Save/Get/Delete`), mapping rows to `domain.User`/`domain.Device`. Map `pgx.ErrNoRows`→`domain.ErrNotFound` (Get returns `domain.ErrNotFound` when absent/expired). Constructor `NewAuthRepo(pool) *AuthRepo`.

- [ ] **Step 2: AuthRepo test (testcontainers)**

`authrepo_test.go` — port `internal/auth/repo_test.go` behaviors against `store/postgres.NewTestDB(t)`: code lifecycle (save/get/delete + expiry→ErrNotFound), upsert idempotency, create device + SessionByTokenHash, ListByUser, Delete returns token hash. Assert errors are `domain.ErrNotFound`.

- [ ] **Step 3: SessionCache (redis)**

`backend/internal/adapter/cache/redis/sessioncache.go` — `package redis` — `SessionCache` implementing `usecaseauth.SessionCache`, storing `domain.Session` as JSON under `session:{hash}` (port from `redisstore/session_cache.go`; same key/TTL semantics). Constructor `NewSessionCache(rdb *goredis.Client) *SessionCache` (alias the go-redis import to `goredis` to avoid clashing with the package name `redis`).

- [ ] **Step 4: SessionCache test (miniredis)**

`sessioncache_test.go` — port `redisstore/session_cache_test.go`: round-trip + TTL expiry via `miniredis.FastForward`, using `domain.Session`.

- [ ] **Step 5: Run + commit**

Run: `cd backend && go test ./internal/adapter/... -v`
Expected: PASS.
```bash
git add backend/internal/adapter/
git commit -m "feat(backend): postgres auth repo + redis session cache adapters"
```

---

### Task 4: Rewire delivery (http middleware/handlers + ws) to the usecase

**Files:**
- Modify: `backend/internal/transport/http/middleware.go`, `auth_handler.go`, `me_handler.go`, `session_handler.go`, `router.go`
- Modify: `backend/internal/transport/ws/handler.go`

- [ ] **Step 1: Authenticator interface + middleware on domain.User**

In `transport/http/middleware.go`: define
```go
type Authenticator interface {
	Authenticate(ctx context.Context, token string) (domain.User, int64, error)
}
```
`AuthMiddleware(a Authenticator)`; store `domain.User` under `userKey`, deviceID under `deviceKey`. `UserFromContext` returns `domain.User`. Update imports (`internal/domain`).

- [ ] **Step 2: Auth/session/me handlers use the usecase**

- `auth_handler.go`: `AuthHandler` holds `*usecaseauth.Interactor`; `RequestCode`/`SignIn` call it; map `domain.ErrInvalidCode`→401. SignIn response unchanged (`token` + `user{id,phone,display_name}` from `domain.User`).
- `me_handler.go`: read `domain.User` from context; same JSON.
- `session_handler.go`: `SessionHandler` holds `*usecaseauth.Interactor`; `List/Revoke/Logout` call `ListSessions/RevokeSession`; map `[]domain.Device` to the same JSON (`id,name,platform,last_active,current`).

- [ ] **Step 3: Router takes the auth usecase**

`router.go`: `NewRouter(authUC *usecaseauth.Interactor, chatSvc *messaging.Service, wsHandler http.Handler, mediaH *MediaHandler, pushH *PushHandler)`. Use `AuthMiddleware(authUC)`, `NewAuthHandler(authUC)`, `NewSessionHandler(authUC)`. The chat/media/push/openapi routes are unchanged. Update the existing test helpers (`newTestRouter`, `newMessagingRouter`, `newMediaRouter`, and push_handler_test's direct `NewRouter`) to build the auth usecase from adapters (see Task 6 for the test wiring) — for now they construct `usecaseauth.New(postgresadapter.NewAuthRepo(pool), <same repo>, <same repo>, "12345", func(){})` (the AuthRepo satisfies all three ports, pass it three times).

- [ ] **Step 4: WS authenticator**

`transport/ws/handler.go`: replace the `*auth.Service` field/param with an `Authenticator` interface:
```go
type Authenticator interface {
	Authenticate(ctx context.Context, token string) (domain.User, int64, error)
}
```
`NewHandler(hub *Hub, auth Authenticator, chatSvc *messaging.Service, presence Presence)`; in `ServeHTTP` use `user.ID` from `domain.User`. (The ws conn still uses `chatSvc`.)

- [ ] **Step 5: Build**

Run: `cd backend && go build ./...`
Expected: compile errors only in `internal/app` (providers/server still reference old `auth.Service`) and old tests — fixed in Tasks 5–6. The `transport/*` packages compile.
(If `transport` references `messaging`/handlers that are unchanged, those still build.)

- [ ] **Step 6: Commit**

```bash
git add backend/internal/transport/
git commit -m "feat(backend): rewire http/ws delivery to the auth usecase + domain.User"
```

---

### Task 5: Rewire fx (app) to the usecase + adapters

**Files:**
- Modify: `backend/internal/app/providers.go`, `server.go`

- [ ] **Step 1: Providers**

In `providers.go`: replace `provideAuthService` with providers that build the adapter + usecase:
```go
func provideAuthRepo(pool *pgxpool.Pool) *pgadapter.AuthRepo { return pgadapter.NewAuthRepo(pool) }

func provideAuthUsecase(cfg *config.Config, repo *pgadapter.AuthRepo) *usecaseauth.Interactor {
	return usecaseauth.New(repo, repo, repo, cfg.DevOTPCode, log.Printf)
}
```
(import `pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"` and `usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"`.) Update `newSessionCache` to return the new `cacheredis.NewSessionCache(client)` (which implements `usecaseauth.SessionCache`). Remove the old redisstore session-cache usage.

- [ ] **Step 2: Server assembler**

In `server.go`: `serverParams.AuthSvc` becomes `AuthUC *usecaseauth.Interactor`. `p.AuthUC.SetCache(cacheredis.NewSessionCache(p.Redis.Client))`, `p.AuthUC.SetRevocationNotifier(publisher)` (the realtime publisher must implement `usecaseauth.RevocationNotifier` — it already has `NotifyRevoked(ctx, int64) error`, so it satisfies the interface structurally). `ws.NewHandler(hub, p.AuthUC, p.ChatSvc, presenceMgr)`. `httptransport.NewRouter(p.AuthUC, p.ChatSvc, wsHandler, mediaHandler, pushHandler)`. The `auth.SetNotifier` on chatSvc is unchanged (push still on messaging).

- [ ] **Step 3: Build + fx validate**

Run: `cd backend && go build ./... && go test ./internal/app/ -run GraphValidates -v`
Expected: app builds; graph validates. (Test packages elsewhere may still fail to compile until Task 6.)

- [ ] **Step 4: Commit**

```bash
git add backend/internal/app/
git commit -m "feat(backend): fx wires auth usecase + adapters"
```

---

### Task 6: Delete legacy auth, fix remaining tests, verify

**Files:**
- Delete: `backend/internal/auth/` (whole dir), `backend/internal/store/redisstore/session_cache.go` + `session_cache_test.go`
- Modify: test helpers referencing the old auth package

- [ ] **Step 1: Delete legacy**

```bash
cd backend && rm -rf internal/auth internal/store/redisstore/session_cache.go internal/store/redisstore/session_cache_test.go
```
(Keep `internal/store/redisstore/client.go` + `client_test.go` — the redis client wrapper is still used.)

- [ ] **Step 2: Fix transport/http test helpers**

Update `auth_handler_test.go`, `chat_handler_test.go`, `media_handler_test.go`, `me_handler_test.go`, `session_handler_test.go`, `push_handler_test.go` to construct the auth usecase instead of `auth.NewService`:
```go
import (
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
)
func newAuthUC(pool *pgxpool.Pool) *usecaseauth.Interactor {
	r := pgadapter.NewAuthRepo(pool)
	return usecaseauth.New(r, r, r, "12345", func(string, ...any) {})
}
```
Replace `auth.NewService(auth.NewRepo(pool), "12345", ...)` with `newAuthUC(pool)`; replace `NewRouter(authSvc, ...)` calls accordingly. Behavioral assertions unchanged. Any test that referenced `auth.User` now uses `domain.User`.

- [ ] **Step 3: Whole suite + vet**

Run: `cd backend && go build ./... && go test ./... -count=1 && go vet ./...`
Expected: all green; no references to the deleted `internal/auth` remain.

- [ ] **Step 4: Docker e2e (auth flow + sessions unchanged)**

Reuse the Slice 0 stack (`/tmp/slice0-stack.yml`): boot, then `request_code`→`sign_in`→`/me`→`/sessions`→`/auth/logout`→`/me`(401). All must behave exactly as before.

- [ ] **Step 5: Commit**

```bash
git add -A backend/
git commit -m "refactor(backend): delete legacy auth package; tests on new auth wiring"
```

---

## Self-Review Notes

- **Spec coverage:** domain entities + pure helpers (§3 domain) — Task 1. usecase interactor + ports (§3 usecase) — Task 2. postgres + redis adapters with mappers + domain-error translation (§3 adapter, §8) — Task 3. delivery rewired to usecase, domain errors mapped at HTTP boundary (§3 adapter/delivery, §8) — Task 4. fx wiring (§5) — Task 5. legacy deletion + green suite (§6 Slice 1) — Task 6.
- **Behavior unchanged:** the interactor is a line-for-line port of `auth.Service` on domain types; SQL is the same; HTTP/WS responses and status codes are identical; `contracts.md`/`openapi.yaml` untouched.
- **No infra leak inward:** adapters translate `pgx.ErrNoRows`→`domain.ErrNotFound`; the usecase imports only `domain`; `domain` imports nothing internal.
- **Strangler safety:** chat/messaging/media/push remain on their current code; only auth is migrated. Full suite stays green (Task 6). The publisher already satisfies `usecaseauth.RevocationNotifier` structurally (`NotifyRevoked(ctx,int64) error`).
- **Type consistency:** `domain.User/Device/Session`, `usecaseauth.Interactor/New/ports`, `pgadapter.AuthRepo/NewAuthRepo`, `cacheredis.NewSessionCache`, `Authenticator` (http + ws), `NewRouter(authUC, chatSvc, wsHandler, mediaH, pushH)` consistent across tasks.
```
