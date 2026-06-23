# Clean Arch Slice 0 — fx Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the `uber/fx` DI container and move the application assembly out of `main.go` into an `internal/app` fx graph — wiring the **existing** services/handlers unchanged — with fx lifecycle hooks for the DB pool, Redis/MinIO connections, WS hub, push worker, and HTTP server. Behavior, the public API, and the entire existing test suite stay unchanged.

**Architecture:** This is Slice 0 of the Clean Architecture refactor (`docs/superpowers/specs/2026-06-24-clean-architecture-di-design.md`). It lands fx **before** any internal restructuring. fx provides the leaf resources (config, a cancellable app context, pgx pool, optional Redis, optional MinIO) with `OnStop` cleanup, and an `fx.Invoke` assembler that builds today's services/handlers (with the same optional Redis/MinIO/VAPID degradation) and registers the HTTP server + worker lifecycle. `main.go` collapses to `fx.New(app.Module).Run()`.

**Tech Stack:** Go, **go.uber.org/fx**, existing packages (auth, messaging, presence, push, realtime, media, transport/http, transport/ws, store/*).

This implements spec §5 (fx wiring + lifecycle) and §6 Slice 0. Existing services/handlers are NOT refactored here — later slices do that.

---

## File Structure

```
backend/
  cmd/server/main.go        — REWRITE: fx.New(app.Module).Run()
  internal/app/
    providers.go            — leaf providers (config, ctx, pool, redis, minio, auth svc, chat svc)
    server.go               — registerServer fx.Invoke (assembles handlers, router, server, lifecycle)
    app.go                  — app.Module = fx.Options(providers + invoke + logger)
    app_test.go             — fx.ValidateApp graph test
```

No existing package is modified except `cmd/server/main.go`. All current tests are untouched and must stay green.

---

### Task 1: Add fx + leaf providers

**Files:**
- Create: `backend/internal/app/providers.go`

- [ ] **Step 1: Add the dependency**

Run: `cd backend && go get go.uber.org/fx@latest`
Expected: `go.uber.org/fx` added to `go.mod`.

- [ ] **Step 2: Write the leaf providers**

Create `backend/internal/app/providers.go`:
```go
// Package app assembles the application with the uber/fx DI container.
package app

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/config"
	"github.com/messenger-denis/backend/internal/messaging"
	"github.com/messenger-denis/backend/internal/store/miniostore"
	"github.com/messenger-denis/backend/internal/store/postgres"
	"github.com/messenger-denis/backend/internal/store/redisstore"
	"github.com/redis/go-redis/v9"
	"go.uber.org/fx"
)

// RedisResult carries an optional Redis client (OK=false when Redis is unavailable,
// preserving the app's graceful-degradation behavior).
type RedisResult struct {
	Client *redis.Client
	OK     bool
}

// MinioResult carries an optional MinIO client.
type MinioResult struct {
	Client *miniostore.Client
	OK     bool
}

func provideConfig() (*config.Config, error) {
	return config.Load()
}

// provideAppContext returns a process-lifetime context cancelled on shutdown
// (used by background workers / the WS hub).
func provideAppContext(lc fx.Lifecycle) context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	lc.Append(fx.Hook{OnStop: func(context.Context) error { cancel(); return nil }})
	return ctx
}

func providePool(lc fx.Lifecycle, cfg *config.Config, ctx context.Context) (*pgxpool.Pool, error) {
	if err := postgres.Migrate(cfg.DatabaseURL); err != nil {
		return nil, err
	}
	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	lc.Append(fx.Hook{OnStop: func(context.Context) error { pool.Close(); return nil }})
	return pool, nil
}

func provideRedis(lc fx.Lifecycle, cfg *config.Config, ctx context.Context) RedisResult {
	c, err := redisstore.Connect(ctx, cfg.RedisURL)
	if err != nil {
		log.Printf("redis unavailable, running without cache/realtime: %v", err)
		return RedisResult{}
	}
	lc.Append(fx.Hook{OnStop: func(context.Context) error { return c.Close() }})
	return RedisResult{Client: c, OK: true}
}

func provideMinio(cfg *config.Config, ctx context.Context) MinioResult {
	mc, err := miniostore.Connect(cfg.MinioEndpoint, cfg.MinioAccessKey, cfg.MinioSecretKey, cfg.MinioBucket, cfg.MinioUseSSL)
	if err != nil {
		log.Printf("minio unavailable, media disabled: %v", err)
		return MinioResult{}
	}
	if err := mc.EnsureBucket(ctx); err != nil {
		log.Printf("minio bucket setup failed, media disabled: %v", err)
		return MinioResult{}
	}
	return MinioResult{Client: mc, OK: true}
}

func provideAuthService(cfg *config.Config, pool *pgxpool.Pool) *auth.Service {
	return auth.NewService(auth.NewRepo(pool), cfg.DevOTPCode, log.Printf)
}

func provideChatService(pool *pgxpool.Pool) *messaging.Service {
	return messaging.NewService(pool)
}
```

- [ ] **Step 3: Verify it builds**

Run: `cd backend && go build ./internal/app/ && go mod tidy`
Expected: builds (the package compiles even though `app.Module` isn't defined yet — providers are standalone funcs).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/app/providers.go backend/go.mod backend/go.sum
git commit -m "feat(backend): fx leaf providers (config, ctx, pool, optional redis/minio, services)"
```

---

### Task 2: Server assembler invoke

**Files:**
- Create: `backend/internal/app/server.go`

- [ ] **Step 1: Write the assembler**

Create `backend/internal/app/server.go`:
```go
package app

import (
	"context"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/config"
	"github.com/messenger-denis/backend/internal/media"
	"github.com/messenger-denis/backend/internal/messaging"
	"github.com/messenger-denis/backend/internal/presence"
	"github.com/messenger-denis/backend/internal/push"
	"github.com/messenger-denis/backend/internal/realtime"
	httptransport "github.com/messenger-denis/backend/internal/transport/http"
	"github.com/messenger-denis/backend/internal/transport/ws"
	"go.uber.org/fx"
)

// serverParams are the dependencies the assembler pulls from the fx graph.
type serverParams struct {
	fx.In

	LC      fx.Lifecycle
	Cfg     *config.Config
	Ctx     context.Context
	Pool    *pgxpool.Pool
	Redis   RedisResult
	Minio   MinioResult
	AuthSvc *auth.Service
	ChatSvc *messaging.Service
}

// registerServer wires the (optional) realtime/push/media features onto the
// services, builds the router + HTTP server, and registers lifecycle hooks.
// This mirrors the previous main.go assembly; later slices decompose it.
func registerServer(p serverParams) {
	var wsHandler http.Handler
	if p.Redis.OK {
		p.AuthSvc.SetCache(redisSessionCache(p.Redis))
		publisher := realtime.NewRedisPublisher(p.Redis.Client)
		p.ChatSvc.SetPublisher(publisher)
		p.AuthSvc.SetRevocationNotifier(publisher)
		presenceMgr := presence.NewManager(p.Redis.Client, publisher, p.ChatSvc.ChatPartners, 35*time.Second)
		hub := ws.NewHub(p.Ctx, p.Redis.Client)
		p.LC.Append(fx.Hook{OnStop: func(context.Context) error { return hub.Close() }})
		wsHandler = ws.NewHandler(hub, p.AuthSvc, p.ChatSvc, presenceMgr)
		log.Printf("session cache + realtime + presence enabled (redis)")
	}

	var pushHandler *httptransport.PushHandler
	if p.Redis.OK && p.Cfg.VAPIDPublicKey != "" && p.Cfg.VAPIDPrivateKey != "" {
		pushSvc := push.NewService(p.Redis.Client, p.Pool)
		p.ChatSvc.SetNotifier(pushSvc)
		sender := push.NewWebPushSender(p.Cfg.VAPIDPublicKey, p.Cfg.VAPIDPrivateKey, p.Cfg.VAPIDSubject)
		worker := push.NewWorker(p.Redis.Client, p.Pool, sender)
		p.LC.Append(fx.Hook{OnStart: func(context.Context) error { go worker.Run(p.Ctx); return nil }})
		pushHandler = httptransport.NewPushHandler(push.NewRepo(p.Pool), p.Cfg.VAPIDPublicKey)
		log.Printf("web push enabled")
	} else {
		log.Printf("web push disabled (needs redis + VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)")
	}

	var mediaHandler *httptransport.MediaHandler
	if p.Minio.OK {
		mediaHandler = httptransport.NewMediaHandler(media.NewService(media.NewRepo(p.Pool), p.Minio.Client), p.ChatSvc)
		log.Printf("media enabled (minio bucket %q)", p.Cfg.MinioBucket)
	}

	srv := &http.Server{
		Addr:              p.Cfg.HTTPAddr,
		Handler:           httptransport.NewRouter(p.AuthSvc, p.ChatSvc, wsHandler, mediaHandler, pushHandler),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	p.LC.Append(fx.Hook{
		OnStart: func(context.Context) error {
			ln, err := net.Listen("tcp", srv.Addr)
			if err != nil {
				return err
			}
			go func() {
				if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
					log.Fatalf("serve: %v", err)
				}
			}()
			log.Printf("listening on %s", p.Cfg.HTTPAddr)
			return nil
		},
		OnStop: func(ctx context.Context) error { return srv.Shutdown(ctx) },
	})
}

// redisSessionCache is a tiny helper so server.go doesn't import redisstore twice.
func redisSessionCache(r RedisResult) auth.SessionCache {
	return newSessionCache(r.Client)
}
```

- [ ] **Step 2: Add the session-cache helper**

The `auth.SetCache` needs a `redisstore.NewSessionCache(client)`. To keep imports tidy, add to `providers.go` (which already imports redisstore):
```go
func newSessionCache(client *redis.Client) auth.SessionCache {
	return redisstore.NewSessionCache(client)
}
```
(Add the `auth` import to `providers.go` if not present — it is, from `provideAuthService`.)

- [ ] **Step 3: Verify it builds**

Run: `cd backend && go build ./internal/app/`
Expected: builds.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/app/server.go backend/internal/app/providers.go
git commit -m "feat(backend): fx server assembler with lifecycle (hub/worker/http)"
```

---

### Task 3: app.Module + main.go rewrite

**Files:**
- Create: `backend/internal/app/app.go`
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Define the module**

Create `backend/internal/app/app.go`:
```go
package app

import (
	"go.uber.org/fx"
	"go.uber.org/fx/fxevent"
)

// Module is the full application dependency graph.
var Module = fx.Options(
	fx.Provide(
		provideConfig,
		provideAppContext,
		providePool,
		provideRedis,
		provideMinio,
		provideAuthService,
		provideChatService,
	),
	fx.Invoke(registerServer),
	// Keep our own log.Printf lines as the signal; silence fx's event log.
	fx.WithLogger(func() fxevent.Logger { return fxevent.NopLogger }),
)
```

- [ ] **Step 2: Rewrite main.go**

Replace `backend/cmd/server/main.go` entirely with:
```go
package main

import (
	"github.com/messenger-denis/backend/internal/app"
	"go.uber.org/fx"
)

func main() {
	fx.New(app.Module).Run()
}
```

- [ ] **Step 3: Verify it builds**

Run: `cd backend && go build ./... && go mod tidy`
Expected: builds clean; `cmd/server` no longer imports the individual services directly.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/app/app.go backend/cmd/server/main.go backend/go.mod backend/go.sum
git commit -m "feat(backend): app.Module + main.go boots via fx"
```

---

### Task 4: fx graph validation test

**Files:**
- Create: `backend/internal/app/app_test.go`

- [ ] **Step 1: Write the validation test**

Create `backend/internal/app/app_test.go`:
```go
package app

import (
	"testing"

	"go.uber.org/fx"
)

// TestModule_GraphValidates checks that every provider's dependencies are
// satisfiable and the invoke's params resolve — without running any provider
// (so no DB/Redis/MinIO is needed).
func TestModule_GraphValidates(t *testing.T) {
	if err := fx.ValidateApp(Module); err != nil {
		t.Fatalf("fx dependency graph is invalid: %v", err)
	}
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd backend && go test ./internal/app/ -v`
Expected: PASS (`ValidateApp` type-checks the graph; providers are not invoked).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/app/app_test.go
git commit -m "test(backend): fx graph validation (ValidateApp)"
```

---

### Task 5: Full suite + boots-via-fx verification

**Files:** none (verification only).

- [ ] **Step 1: Whole suite + vet (existing tests untouched, must stay green)**

Run: `cd backend && go test ./... && go vet ./...`
Expected: all packages PASS (the existing auth/messaging/ws/etc. tests are unchanged), vet clean.

- [ ] **Step 2: App boots via fx + behavior unchanged (docker, full stack)**

Run:
```bash
cat > /tmp/slice0-stack.yml <<'EOF'
name: slice0-verify
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
      DATABASE_URL: "postgres://messenger:messenger@pg:5432/messenger?sslmode=disable"
      REDIS_URL: "redis://redis:6379"
      DEV_OTP_CODE: "12345"
    depends_on:
      pg: {condition: service_healthy}
      redis: {condition: service_healthy}
    ports: ["18090:8080"]
EOF
docker compose -f /tmp/slice0-stack.yml up -d --build
sleep 6
docker compose -f /tmp/slice0-stack.yml logs backend | grep -iE "listening|realtime enabled"
B="localhost:18090"
echo "health: $(curl -s $B/health)"
curl -s -X POST $B/auth/request_code -d '{"phone":"+700"}' >/dev/null
echo "sign_in: $(curl -s -X POST $B/auth/sign_in -d '{"phone":"+700","code":"12345"}')"
echo "--- graceful stop (fx OnStop chain) ---"
docker compose -f /tmp/slice0-stack.yml stop backend
docker compose -f /tmp/slice0-stack.yml logs backend | tail -3
docker compose -f /tmp/slice0-stack.yml down -v
```
Expected: logs show `listening on :8080` and `session cache + realtime + presence enabled (redis)`; `/health` → `{"status":"ok"}`; sign_in returns a token. The stop completes cleanly (fx runs OnStop: server shutdown → hub close → pool/redis close → ctx cancel).

- [ ] **Step 3: No code changes expected.** If verification fails, fix under the relevant task and re-run.

---

## Self-Review Notes

- **Spec coverage:** §5 fx wiring + lifecycle (config/pool/redis/minio leaves with OnStop; hub OnStop; worker OnStart via app ctx; http.Server OnStart/OnStop) — Tasks 1–3. §6 Slice 0 (fx over existing code, suite green) — Tasks 4–5. `main.go` collapses to `fx.New(app.Module).Run()` — Task 3.
- **Behavior unchanged:** the assembler replicates the exact previous main.go logic (same optional Redis/MinIO/VAPID degradation, same log lines, same router construction, same timeouts). No service/handler internals touched; no test files changed → the public contract and the whole suite are preserved.
- **Shutdown order:** fx runs OnStop in reverse registration order → server.Shutdown, hub.Close, … pool.Close, ctx-cancel last — matching the previous `defer` ordering (cancel deferred first ran last).
- **Graceful degradation preserved:** optional resources are modeled as `RedisResult{OK}` / `MinioResult{OK}` value providers that never fail the graph; the assembler branches on `OK` exactly as before.
- **Testing seam:** `fx.ValidateApp` validates the graph with zero IO (providers not invoked), so the test runs anywhere; real boot is covered by the docker smoke. Existing integration tests remain the behavioral regression net.
- **Type consistency:** `RedisResult`/`MinioResult`, `provideConfig/provideAppContext/providePool/provideRedis/provideMinio/provideAuthService/provideChatService`, `serverParams`/`registerServer`, `app.Module`, `newSessionCache` used consistently. `NewRouter(authSvc, chatSvc, wsHandler, mediaHandler, pushHandler)` and all service constructors match their current signatures.
```
