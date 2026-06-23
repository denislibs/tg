# Backend Clean Architecture + DI (fx) — Design

**Date:** 2026-06-24
**Status:** implemented
**Scope:** Refactor the existing, fully-working Phase 0 backend (`backend/`) to canonical Clean Architecture with a `uber/fx` DI container. **Behavior and the public API are unchanged** (`docs/contracts.md` / `openapi.yaml` stay identical).

## Outcome

Implemented across slices 0–6 with no behavior/API change (full suite + race + docker e2e green; `contracts.md`/`openapi.yaml` unchanged). All features migrated to usecases (ports) with adapter implementations: auth, chat/message/sync/reactions, realtime publisher + presence, media, and push. Delivery lives at `internal/adapter/delivery/{http,ws}`. `internal/store/{postgres,redisstore}` serve as the infra/db + infra/redis layer (connection, migrations, redis client) while repositories live in `internal/adapter/repo/postgres`. Layer purity is verified by grep: `internal/domain` imports nothing from this module, and non-test `internal/usecase` files import only domain/their own ports (no adapter/app/store). The fx graph was tidied (dead `providePushRepo` removed; the push repo is built directly in the server assembler).

## 1. Goal

Restructure the backend into canonical Clean Architecture (entities → usecases → interface-adapters → frameworks) wired by a `uber/fx` DI container, so that:
- Business rules are independent of pgx/redis/minio (testable with fast unit tests + fakes).
- Domain entities are decoupled from DB rows (explicit mappers).
- Dependency assembly + lifecycle (workers, graceful shutdown) is centralized in fx.

This is a **strangler refactor** of working, tested code: the existing integration tests are the regression net; the full suite stays green and the public contract unchanged at every step.

## 2. Decisions (from brainstorming)

- **Full canonical Clean Architecture** (not just ports-lite).
- **DI container: `uber/fx`** — chosen for lifecycle hooks (WS hub, push worker, presence loop, graceful shutdown all fit `OnStart`/`OnStop`).
- **Migration: incremental / strangler**, tests green every step, behavior identical.

## 3. Layers & the dependency rule

Dependencies point strictly **inward**: `domain ← usecase ← adapter ← infra`. Inner layers know nothing of outer layers.

1. **domain** — pure entities, value objects, domain errors. No `pgx`/`json`/redis tags, no framework imports.
   - Entities: `User, Device, Session, Chat, ChatMember, Message, Update, Reaction, Media`.
   - Value objects: `Phone, Seq, Pts` (and small helpers/validation).
   - Errors: `ErrNotFound, ErrInvalidCode, ErrForbidden, ErrBadInput, ErrTooLarge` (sentinel errors used across usecases).
2. **usecase** — interactors (application business rules) + the **port interfaces** they depend on (repositories, publisher, cache, storage, notifier, presence). Interactors orchestrate domain logic and ports; they never import adapters or infra.
   - Interactors map 1:1 to today's service methods: `Authenticate, RequestCode, SignIn, ListSessions, RevokeSession`; `CreatePrivateChat, ListDialogs, Send, MarkRead, GetHistory, GetDifference, Typing, React, ReactionsOf, ChatPartners, CanAccessMedia`; `Presence(Online/Heartbeat/Offline)`; `CreateUpload, GetMedia`; `NotifyNewMessage`.
   - Ports (examples): `UserRepo, DeviceRepo, ChatRepo, MessageRepo, UpdateRepo, ReactionRepo, MediaRepo, PushSubRepo`; `SessionCache, EventPublisher, PresenceStore, RevocationNotifier, ObjectStorage, PushQueue, PushSender`.
3. **adapter** — implement ports on infrastructure, plus delivery adapters:
   - `repo/postgres` — port impls + **entity↔row mappers** + embedded migrations.
   - `cache/redis`, `realtime/redis` (publisher + pub/sub), `storage/minio`, `push/webpush`.
   - `delivery/http` — chi handlers translating HTTP DTOs ↔ usecase inputs/outputs; central domain-error→status mapping.
   - `delivery/ws` — hub + conn + JSON frame dispatch → usecases.
4. **infra (frameworks)** — pgxpool, go-redis, minio client, chi, gorilla/websocket, config loader, `app/` fx modules, `cmd/server/main.go`.

**Key change vs today:** domain entities are separated from DB rows via mappers; business rules depend only on ports; everything swappable.

## 4. Package layout

```
backend/
  cmd/server/main.go               — fx.New(app.Module).Run()
  internal/
    domain/                        — entities, value objects, errors (pure)
    usecase/
      auth/  chat/  message/  sync/  reaction/  presence/  media/  push/
        # each package: interactor(s) + the port interfaces it needs
    adapter/
      repo/postgres/               — port impls + mappers + migrations (embed)
      cache/redis/                 — SessionCache impl
      realtime/redis/              — EventPublisher + PresenceStore + pub/sub
      storage/minio/               — ObjectStorage impl
      push/webpush/                — PushSender impl
      delivery/http/               — chi handlers + DTOs + error mapping + openapi/swagger
      delivery/ws/                 — hub, conn, frames
    infra/
      config/  db/  redis/  minio/  httpserver/
    app/                           — fx modules (Config/DB/Redis/Minio/Repo/Usecase/Delivery/Worker/Server)
```

## 5. DI with `uber/fx`

- `internal/app` exposes one `fx.Module` per area: `ConfigModule, DBModule, RedisModule, MinioModule, RepoModule, UsecaseModule, DeliveryModule, WorkerModule, ServerModule`, composed into `app.Module`.
- Port→impl binding via `fx.Provide` + `fx.Annotate(NewXxx, fx.As(new(port.Xxx)))`.
- **Lifecycle (`fx.Lifecycle` OnStart/OnStop):**
  - DB pool / redis client / minio client: `OnStop` closes them.
  - WS hub: `OnStop` closes the Redis subscription.
  - Push worker & presence sweeper: `OnStart` launches the goroutine with a fx-managed cancellable context; `OnStop` cancels and waits.
  - `http.Server`: `OnStart` runs `ListenAndServe` (in a goroutine), `OnStop` runs `Shutdown`.
- Graceful, partial degradation preserved: if Redis/MinIO/VAPID are absent, those modules provide no-op/nil-guarded implementations (the app still serves REST) — implemented as fx-provided optional bindings, not panics.
- `main.go` collapses to `fx.New(app.Module).Run()` (fx handles SIGINT/SIGTERM and the OnStop chain).

## 6. Migration strategy (strangler; suite green every step)

Each slice is its own implementation plan; merged only when `go test ./...` is green and a docker e2e smoke passes; the public contract is never changed.

- **Slice 0 — skeleton + fx over current code:** add `domain` (initial entities/errors) and an fx graph that wires the **existing** services/handlers as-is. Goal: app boots via fx, tests green. (fx lands before internals are refactored.)
- **Slice 1 — auth (reference slice):** `domain.User/Session/Device`; `usecase/auth` + ports; `adapter/repo/postgres` (auth tables) with mappers; `adapter/delivery/http` (auth + sessions). Reviewed as the template the rest follow.
- **Slice 2 — chat / message / sync.**
- **Slice 3 — realtime (ws + redis publisher + presence).**
- **Slice 4 — media (minio).**
- **Slice 5 — push (webpush + queue/worker).**
- **Slice 6 — delete legacy packages, finalize fx graph & docs.**

At each slice the existing integration tests (HTTP/WS/repo) are re-pointed at the new construction; **behavioral assertions are unchanged** — they are the regression guard. New fast unit tests (usecase + fakes) are added alongside.

## 7. Testing strategy

- **domain** — pure unit tests (value-object validation, entity invariants).
- **usecase** — unit tests with fake ports (no DB/Redis) — the main new win; fast and exhaustive on business rules.
- **adapter (postgres/redis/minio/webpush)** — integration tests with testcontainers / miniredis (the existing tests, re-homed to the adapter layer).
- **delivery (http/ws)** — handler/gateway tests driving usecases (real or faked).
- **fx wiring** — `fxtest` test that asserts `app.Module` builds and starts/stops cleanly.

## 8. Error handling

- Sentinel domain errors live in `domain`. Usecases return them.
- `adapter/delivery/http` maps `domain.Err* → HTTP status` in one place (e.g. `ErrNotFound→404/403` per route, `ErrInvalidCode→401`, `ErrBadInput→400`, `ErrTooLarge→413`). WS dispatch maps similarly (ignore/ack as today).
- Adapters translate infrastructure errors (e.g. `pgx.ErrNoRows`) into domain errors at the boundary; inner layers never see `pgx`/`redis` errors.

## 9. Non-goals / constraints

- **No behavior or API change.** `docs/contracts.md` and `openapi.yaml` remain authoritative and unchanged; any diff there is a bug.
- No new features (groups/channels/stories/etc. are separate future phases).
- No performance regressions; lifecycle/shutdown semantics preserved (cancellable worker ctx, race-clean WS).
- Keep partial-degradation behavior (runs without Redis/MinIO/VAPID).

## 10. Risks & mitigations

- **Regression in working code** → strangler + green suite per slice + unchanged contract + docker e2e smoke per slice.
- **fx runtime-DI opacity** → one `fxtest` wiring test; keep modules small and per-area; provider functions are plain constructors.
- **Over-abstraction (YAGNI)** → ports only for things with a real second implementation or a real test seam (repos, cache, publisher, storage, sender); no speculative interfaces.
- **Big surface** → decomposed into 7 slice-plans; each independently shippable and reviewable.
