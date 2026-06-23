# Clean Arch Slice 3 — Realtime (publisher + presence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the realtime publisher and presence into the Clean Architecture layers: `internal/realtime` → `internal/adapter/realtime/redis` (the `EventPublisher` / `RevocationNotifier` / device-close adapter), and `internal/presence` → `internal/usecase/presence` (online/last-seen logic with a `PresenceStore` port) + the Redis `PresenceStore` impl in the realtime adapter. Rewire WS delivery + fx. Behavior, API, and the suite stay green.

**Architecture:** Slice 3. `RedisPublisher` is a pure adapter (no logic change) — relocated. Presence has real logic (SETNX online-dedup, heartbeat self-heal, offline fan-out) → it becomes a `usecase/presence.Manager` depending on a `PresenceStore` port + a publisher + a `PartnersFunc`; the Redis presence ops (presKey/lastSeenKey, SetNX/Expire/Del/Exists/Get) become a `PresenceStore` adapter. The WS hub/conn/handler stay in `transport/ws` (delivery; relocated in slice 6) and already call usecases; the conn's `Presence` interface is now satisfied by `usecase/presence.Manager`.

**Tech Stack:** Go, fx, go-redis, gorilla/ws, miniredis.

---

## File Structure

```
backend/
  internal/adapter/realtime/redis/
    publisher.go       — RedisPublisher (PublishToUser, UserChannel, DeviceChannel, NotifyRevoked)  [moved from internal/realtime]
    publisher_test.go  — miniredis (moved)
    presencestore.go   — PresenceStore impl (SetOnlineNX/Refresh/SetOffline/IsOnline/LastSeen)
    presencestore_test.go
  internal/usecase/presence/
    presence.go        — Manager + ports (PresenceStore, Publisher, PartnersFunc)  [logic moved from internal/presence]
    presence_test.go   — fakes (moved/ported)
  internal/transport/ws/handler.go — MODIFY: Presence iface satisfied by usecase/presence.Manager (likely no change)
  internal/app/providers.go, server.go — MODIFY: provide adapter publisher + presence store + presence usecase
  DELETE: internal/realtime/  ·  internal/presence/
```

---

### Task 1: realtime adapter (publisher) — relocate

**Files:** Create `internal/adapter/realtime/redis/publisher.go` + `publisher_test.go`; (delete `internal/realtime/` in Task 4).

- [ ] **Step 1: Move the publisher**

Create `backend/internal/adapter/realtime/redis/publisher.go` — `package redis` — copy `internal/realtime/publisher.go` VERBATIM (the `RedisPublisher` struct, `NewRedisPublisher`, `UserChannel`, `DeviceChannel`, `PublishToUser`, `NotifyRevoked`), only changing the package clause to `package redis` and aliasing the go-redis import as `goredis "github.com/redis/go-redis/v9"` (the package is named `redis`, so the import must be aliased). It implements `usecasechat.EventPublisher`, `usecaseauth.RevocationNotifier`, and (Task 2) `presence.Publisher` structurally — no need to import those.

- [ ] **Step 2: Move the test**

Create `publisher_test.go` — port `internal/realtime/publisher_test.go` (miniredis publish→subscribe for `UserChannel`, and `NotifyRevoked`→`DeviceChannel`), `package redis`, go-redis aliased `goredis`.

- [ ] **Step 3: Run + commit**

Run: `cd backend && go test ./internal/adapter/realtime/redis/ -v` → PASS.
```bash
git add backend/internal/adapter/realtime/ && git commit -m "feat(backend): relocate redis realtime publisher to adapter layer"
```

---

### Task 2: presence usecase + PresenceStore adapter

**Files:** Create `internal/usecase/presence/{presence.go,presence_test.go}`, `internal/adapter/realtime/redis/{presencestore.go,presencestore_test.go}`.

- [ ] **Step 1: usecase/presence**

Create `backend/internal/usecase/presence/presence.go` — `package presence`. Define ports + Manager by porting the logic from `internal/presence/manager.go`:
```go
package presence

import (
	"context"
	"encoding/json"
	"time"
)

type Publisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

type PartnersFunc func(ctx context.Context, userID int64) ([]int64, error)

// PresenceStore abstracts the online/last-seen storage (Redis in prod).
type PresenceStore interface {
	SetOnlineNX(ctx context.Context, userID int64, ttl time.Duration) (set bool, err error) // true if transitioned offline→online
	Refresh(ctx context.Context, userID int64, ttl time.Duration) (existed bool, err error) // false if the key had expired
	SetOffline(ctx context.Context, userID int64, lastSeen int64) error
	IsOnline(ctx context.Context, userID int64) (bool, error)
	LastSeen(ctx context.Context, userID int64) (int64, error)
}

type Manager struct {
	store    PresenceStore
	pub      Publisher
	partners PartnersFunc
	ttl      time.Duration
}

func NewManager(store PresenceStore, pub Publisher, partners PartnersFunc, ttl time.Duration) *Manager {
	return &Manager{store: store, pub: pub, partners: partners, ttl: ttl}
}

func (m *Manager) Online(ctx context.Context, userID int64) error {
	set, err := m.store.SetOnlineNX(ctx, userID, m.ttl)
	if err != nil {
		return err
	}
	if !set {
		_, _ = m.store.Refresh(ctx, userID, m.ttl)
		return nil
	}
	return m.fanout(ctx, userID, true, 0)
}

func (m *Manager) Heartbeat(ctx context.Context, userID int64) error {
	existed, err := m.store.Refresh(ctx, userID, m.ttl)
	if err != nil {
		return err
	}
	if !existed {
		return m.Online(ctx, userID)
	}
	return nil
}

func (m *Manager) Offline(ctx context.Context, userID int64) error {
	now := time.Now().UnixMilli()
	_ = m.store.SetOffline(ctx, userID, now)
	return m.fanout(ctx, userID, false, now)
}

func (m *Manager) Snapshot(ctx context.Context, userID int64) (online bool, lastSeen int64) {
	online, _ = m.store.IsOnline(ctx, userID)
	lastSeen, _ = m.store.LastSeen(ctx, userID)
	return online, lastSeen
}

func (m *Manager) fanout(ctx context.Context, userID int64, online bool, lastSeen int64) error {
	partners, err := m.partners(ctx, userID)
	if err != nil {
		return err
	}
	frame, _ := json.Marshal(map[string]any{
		"t": "presence",
		"d": map[string]any{"user_id": userID, "online": online, "last_seen": lastSeen},
	})
	for _, p := range partners {
		_ = m.pub.PublishToUser(ctx, p, frame)
	}
	return nil
}
```

- [ ] **Step 2: usecase test (fakes)** — `presence_test.go`: in-memory fake `PresenceStore` (map of online + lastSeen, simulating SetOnlineNX/Refresh/SetOffline) + fake publisher + stub partners. Port the behaviors from `internal/presence/manager_test.go`: Online dedups the announce (second Online → no extra publish), Offline announces + records last-seen, Heartbeat re-establishes when expired.

- [ ] **Step 3: PresenceStore adapter (redis)**

Create `internal/adapter/realtime/redis/presencestore.go` — `package redis` — `PresenceStore` struct over `*goredis.Client` implementing the port, porting the Redis ops from `internal/presence/manager.go` (`presence:{id}` SETNX/EXPIRE/DEL/EXISTS, `lastseen:{id}` SET/GET):
```go
func (s *PresenceStore) SetOnlineNX(ctx, userID, ttl) (bool, error) // rdb.SetNX(presKey, "1", ttl)
func (s *PresenceStore) Refresh(ctx, userID, ttl) (bool, error)     // rdb.Expire(presKey, ttl)
func (s *PresenceStore) SetOffline(ctx, userID, lastSeen) error      // rdb.Del(presKey); rdb.Set(lastSeenKey, lastSeen, 0)
func (s *PresenceStore) IsOnline(ctx, userID) (bool, error)          // rdb.Exists(presKey) > 0
func (s *PresenceStore) LastSeen(ctx, userID) (int64, error)         // rdb.Get(lastSeenKey).Int64()
```
Constructor `NewPresenceStore(rdb *goredis.Client) *PresenceStore`.

- [ ] **Step 4: PresenceStore test (miniredis)** — round-trip: SetOnlineNX true then false (already set), IsOnline true, Refresh, SetOffline → IsOnline false + LastSeen set.

- [ ] **Step 5: Run + commit**

Run: `cd backend && go test ./internal/usecase/presence/ ./internal/adapter/realtime/redis/ -v` → PASS.
```bash
git add backend/internal/usecase/presence/ backend/internal/adapter/realtime/ && git commit -m "feat(backend): presence usecase + redis PresenceStore adapter"
```

---

### Task 3: Rewire fx + ws + delete legacy + verify

**Files:** Modify `internal/app/{providers.go,server.go,app.go}`, possibly `transport/ws/handler.go` (only if the Presence interface needs the import updated — it uses a local `Presence` interface so likely no change); delete `internal/realtime/`, `internal/presence/`; fix `ws/ws_integration_test.go`.

- [ ] **Step 1: fx providers/server**

In `internal/app`: import the new adapter (`rtredis "github.com/messenger-denis/backend/internal/adapter/realtime/redis"`) and usecase (`usecasepresence ".../internal/usecase/presence"`). In `server.go`'s Redis block:
```go
publisher := rtredis.NewRedisPublisher(p.Redis.Client)
p.ChatUC.SetPublisher(publisher)
p.AuthUC.SetRevocationNotifier(publisher)
presenceMgr := usecasepresence.NewManager(rtredis.NewPresenceStore(p.Redis.Client), publisher, p.ChatUC.ChatPartners, 35*time.Second)
hub := ws.NewHub(p.Ctx, p.Redis.Client)
...
wsHandler = ws.NewHandler(hub, p.AuthUC, p.ChatUC, presenceMgr)
```
Remove the old `internal/realtime` + `internal/presence` imports.

- [ ] **Step 2: ws handler** — `transport/ws/handler.go` takes `Presence` (its existing local interface with Online/Heartbeat/Offline). `usecasepresence.Manager` satisfies it. If `NewHandler`'s param type was a concrete `*presence.Manager`, change it to the local `Presence` interface (it already is per Slice C4). No behavior change.

- [ ] **Step 3: Delete legacy + fix tests**

```bash
cd backend && rm -rf internal/realtime internal/presence
```
Fix `transport/ws/ws_integration_test.go` (it built `realtime.NewRedisPublisher` + `presence.NewManager`) to use `rtredis.NewRedisPublisher` + `usecasepresence.NewManager(rtredis.NewPresenceStore(rdb), publisher, chatUC.ChatPartners, 35*time.Second)`. Any other refs to `internal/realtime`/`internal/presence` updated.

- [ ] **Step 4: Whole suite + race + vet**

Run: `cd backend && go build ./... && go test ./... -count=1 && go test -race -count=1 ./internal/transport/ws/ && go vet ./...`
Expected: all green, WS race-clean; `grep -rn "internal/realtime\|internal/presence" backend --include='*.go'` empty.

- [ ] **Step 5: Docker e2e** — pg+redis stack: connect two WS clients sharing a chat; assert B's presence frame reaches A on connect, and a sent message delivers live (same as before). (Or rely on the WS integration tests, which now exercise the relocated code.)

- [ ] **Step 6: Commit**
```bash
git add -A backend/ && git commit -m "refactor(backend): realtime publisher + presence on Clean Architecture; delete legacy"
```

---

## Self-Review Notes

- **Spec coverage:** publisher relocated to adapter layer (§3 adapter); presence logic → usecase with a `PresenceStore` port, Redis impl in adapter (§3 usecase+adapter); fx rewired (§5); legacy deleted, suite green (§6 Slice 3).
- **Behavior unchanged:** publisher is byte-identical (only package/import alias changed); presence Manager logic is a faithful port; the multi-replica online-flap self-heal is preserved; WS frames/timing unchanged; contract docs untouched.
- **Layering:** presence usecase imports only its ports + std; the Redis adapter implements the port; WS delivery depends on the usecase via a local `Presence` interface (no infra leak into the usecase).
- **Type consistency:** `rtredis.{NewRedisPublisher,NewPresenceStore,UserChannel,DeviceChannel}`, `usecasepresence.{Manager,NewManager,PresenceStore,Publisher,PartnersFunc}`, `ws.NewHandler(hub, authUC, chatUC, presence)` consistent.
```
