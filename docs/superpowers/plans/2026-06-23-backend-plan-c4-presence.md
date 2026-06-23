# Backend Plan C4 — Presence + Force-Close Revoked Socket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Online presence + last-seen, tracked in Redis with a WS heartbeat and fanned out live to a user's chat partners. (2) When a session is revoked or logged out, the corresponding device's live WebSocket is closed immediately (not just invalidated for the next request).

**Architecture:** A `presence.Manager` keeps `presence:{id}` (TTL, refreshed by heartbeat) and `lastseen:{id}` in Redis, and publishes `presence` frames to chat partners (looked up via a new `messaging.Service.ChatPartners`). The WS `Conn` calls `Online` on connect, `Heartbeat` on its ping ticker, and `Offline` when the user's last local socket closes. For force-close, the `Hub` also subscribes to a `device:{id}` control channel and closes that device's sockets when a "close" message arrives; `auth.Service.RevokeSession` publishes that message through a `RevocationNotifier` (implemented by the realtime publisher).

**Tech Stack:** Same as Plan C — Go, go-redis/v9, gorilla/websocket, miniredis (test), testcontainers-go.

Implements spec §5.6 (presence/typing — typing already done in C2) and §9a's "revoke closes the live socket" note. This completes the Phase 0 realtime layer.

---

## File Structure

```
backend/
  internal/messaging/
    chats_repo.go       — MODIFY: add ChatPartners query
    service.go          — MODIFY: add ChatPartners passthrough
    chats_repo_test.go  — MODIFY: ChatPartners test
  internal/presence/
    manager.go          — Manager: Online/Heartbeat/Offline/Snapshot + partner fan-out
    manager_test.go
  internal/auth/
    service.go          — MODIFY: RevocationNotifier + SetRevocationNotifier; RevokeSession notifies
    service_test.go     — MODIFY: revoke-notifier test
  internal/realtime/
    publisher.go        — MODIFY: DeviceChannel + NotifyRevoked (implements auth.RevocationNotifier)
    publisher_test.go   — MODIFY: NotifyRevoked test
  internal/transport/ws/
    hub.go              — MODIFY: device tracking + device:{id} subscribe + close; Sink gains Close(); Unregister returns lastUser
    hub_test.go         — MODIFY: fakeSink.Close + new signatures + device-close test
    conn.go             — MODIFY: presence wiring, Close(), new hub signatures
    handler.go          — MODIFY: pass presence manager + deviceID
    ws_integration_test.go — MODIFY: presence + revoke-closes-socket tests
  cmd/server/main.go    — MODIFY: build presence.Manager, set RevocationNotifier, pass presence to ws handler
```

---

### Task 1: messaging.ChatPartners

**Files:**
- Modify: `backend/internal/messaging/chats_repo.go`
- Modify: `backend/internal/messaging/service.go`
- Modify: `backend/internal/messaging/chats_repo_test.go`

- [ ] **Step 1: Add the ChatPartners repo query**

In `backend/internal/messaging/chats_repo.go`, add:
```go
// ChatPartners returns the distinct user ids that share at least one chat with
// the given user (i.e. people who should see the user's presence).
func (r *ChatsRepo) ChatPartners(ctx context.Context, q Querier, userID int64) ([]int64, error) {
	rows, err := q.Query(ctx,
		`SELECT DISTINCT m2.user_id FROM chat_members m1
		 JOIN chat_members m2 ON m2.chat_id = m1.chat_id AND m2.user_id <> m1.user_id
		 WHERE m1.user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
```

- [ ] **Step 2: Add the service passthrough**

In `backend/internal/messaging/service.go`, add:
```go
// ChatPartners returns the user ids that share a chat with userID.
func (s *Service) ChatPartners(ctx context.Context, userID int64) ([]int64, error) {
	return s.chats.ChatPartners(ctx, s.pool, userID)
}
```

- [ ] **Step 3: Add the test**

Append to `backend/internal/messaging/chats_repo_test.go`:
```go
func TestChatsRepo_ChatPartners(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewChatsRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+770")
	b := seedUser(t, pool, "+771")
	c := seedUser(t, pool, "+772")
	_, _ = repo.CreatePrivateChat(ctx, pool, a, b)
	_, _ = repo.CreatePrivateChat(ctx, pool, a, c)

	partners, err := repo.ChatPartners(ctx, pool, a)
	if err != nil {
		t.Fatalf("ChatPartners: %v", err)
	}
	if len(partners) != 2 {
		t.Fatalf("expected 2 partners, got %v", partners)
	}
	// b has only a as a partner.
	bp, _ := repo.ChatPartners(ctx, pool, b)
	if len(bp) != 1 || bp[0] != a {
		t.Fatalf("b partners = %v; want [%d]", bp, a)
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/messaging/ -run 'ChatsRepo_ChatPartners' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/messaging/chats_repo.go backend/internal/messaging/service.go backend/internal/messaging/chats_repo_test.go
git commit -m "feat(backend): ChatPartners query for presence fan-out"
```

---

### Task 2: presence.Manager

**Files:**
- Create: `backend/internal/presence/manager.go`
- Create: `backend/internal/presence/manager_test.go`

- [ ] **Step 1: Write the presence manager**

Create `backend/internal/presence/manager.go`:
```go
// Package presence tracks online/last-seen state in Redis and fans presence
// changes out to a user's chat partners.
package presence

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// Publisher delivers a frame to a user's realtime channel (satisfied by the
// realtime.RedisPublisher).
type Publisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

// PartnersFunc returns the user ids that should see a user's presence.
type PartnersFunc func(ctx context.Context, userID int64) ([]int64, error)

type Manager struct {
	rdb      *redis.Client
	pub      Publisher
	partners PartnersFunc
	ttl      time.Duration
}

func NewManager(rdb *redis.Client, pub Publisher, partners PartnersFunc, ttl time.Duration) *Manager {
	return &Manager{rdb: rdb, pub: pub, partners: partners, ttl: ttl}
}

func presKey(userID int64) string     { return "presence:" + strconv.FormatInt(userID, 10) }
func lastSeenKey(userID int64) string { return "lastseen:" + strconv.FormatInt(userID, 10) }

// Online marks a user online. It fans out a presence(online) frame only on the
// transition from offline → online (SET NX), so multiple devices/replicas don't
// each re-announce.
func (m *Manager) Online(ctx context.Context, userID int64) error {
	set, err := m.rdb.SetNX(ctx, presKey(userID), "1", m.ttl).Result()
	if err != nil {
		return err
	}
	if !set { // already online elsewhere — just refresh the TTL
		m.rdb.Expire(ctx, presKey(userID), m.ttl)
		return nil
	}
	return m.fanout(ctx, userID, true, 0)
}

// Heartbeat refreshes the online TTL; if the key had expired it re-establishes
// presence (which re-announces online).
func (m *Manager) Heartbeat(ctx context.Context, userID int64) error {
	ok, err := m.rdb.Expire(ctx, presKey(userID), m.ttl).Result()
	if err != nil {
		return err
	}
	if !ok {
		return m.Online(ctx, userID)
	}
	return nil
}

// Offline marks a user offline, records last-seen, and fans out presence(offline).
func (m *Manager) Offline(ctx context.Context, userID int64) error {
	now := time.Now().UnixMilli()
	m.rdb.Del(ctx, presKey(userID))
	m.rdb.Set(ctx, lastSeenKey(userID), now, 0)
	return m.fanout(ctx, userID, false, now)
}

// Snapshot returns whether a user is currently online and their last-seen (ms).
func (m *Manager) Snapshot(ctx context.Context, userID int64) (online bool, lastSeen int64) {
	n, _ := m.rdb.Exists(ctx, presKey(userID)).Result()
	online = n > 0
	lastSeen, _ = m.rdb.Get(ctx, lastSeenKey(userID)).Int64()
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

- [ ] **Step 2: Write the test**

Create `backend/internal/presence/manager_test.go`:
```go
package presence

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

type fakePub struct {
	mu  sync.Mutex
	got map[int64]int
}

func newFakePub() *fakePub { return &fakePub{got: map[int64]int{}} }
func (p *fakePub) PublishToUser(_ context.Context, userID int64, _ []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.got[userID]++
	return nil
}
func (p *fakePub) count(userID int64) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.got[userID]
}

func newManager(t *testing.T) (*Manager, *fakePub, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	pub := newFakePub()
	// user 1's partner is user 2.
	partners := func(_ context.Context, userID int64) ([]int64, error) {
		if userID == 1 {
			return []int64{2}, nil
		}
		return nil, nil
	}
	return NewManager(rdb, pub, partners, 30*time.Second), pub, mr
}

func TestManager_OnlineDedupAndOffline(t *testing.T) {
	m, pub, mr := newManager(t)
	defer mr.Close()
	ctx := context.Background()

	// First Online → one presence frame to partner 2.
	if err := m.Online(ctx, 1); err != nil {
		t.Fatalf("online: %v", err)
	}
	// Second Online (e.g. another device) → no new announce.
	_ = m.Online(ctx, 1)
	if pub.count(2) != 1 {
		t.Fatalf("expected 1 online announce, got %d", pub.count(2))
	}
	if online, _ := m.Snapshot(ctx, 1); !online {
		t.Fatal("expected user 1 online")
	}

	// Offline → another presence frame + last-seen recorded.
	if err := m.Offline(ctx, 1); err != nil {
		t.Fatalf("offline: %v", err)
	}
	if pub.count(2) != 2 {
		t.Fatalf("expected offline announce, total=%d", pub.count(2))
	}
	online, lastSeen := m.Snapshot(ctx, 1)
	if online || lastSeen == 0 {
		t.Fatalf("after offline: online=%v lastSeen=%d", online, lastSeen)
	}
}

func TestManager_HeartbeatRefreshes(t *testing.T) {
	m, _, mr := newManager(t)
	defer mr.Close()
	ctx := context.Background()
	_ = m.Online(ctx, 1)

	mr.FastForward(20 * time.Second) // still within TTL
	if err := m.Heartbeat(ctx, 1); err != nil {
		t.Fatalf("heartbeat: %v", err)
	}
	mr.FastForward(20 * time.Second) // 40s total, but heartbeat reset the 30s TTL at 20s
	if online, _ := m.Snapshot(ctx, 1); !online {
		t.Fatal("expected still online after heartbeat refresh")
	}
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/presence/ -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/presence/
git commit -m "feat(backend): presence manager (online/last-seen + partner fan-out)"
```

---

### Task 3: auth RevocationNotifier + realtime NotifyRevoked

**Files:**
- Modify: `backend/internal/auth/service.go`
- Modify: `backend/internal/auth/service_test.go`
- Modify: `backend/internal/realtime/publisher.go`
- Modify: `backend/internal/realtime/publisher_test.go`

- [ ] **Step 1: Add the notifier hook to auth.Service**

In `backend/internal/auth/service.go`:

(a) Add the interface and a field + setter:
```go
// RevocationNotifier is told when a device session is revoked, so a live socket
// for that device can be closed. Optional.
type RevocationNotifier interface {
	NotifyRevoked(ctx context.Context, deviceID int64) error
}

// SetRevocationNotifier attaches a revocation notifier (optional).
func (s *Service) SetRevocationNotifier(n RevocationNotifier) { s.revoker = n }
```
Add `revoker RevocationNotifier` to the `Service` struct.

(b) In `RevokeSession`, after the cache eviction, notify:
```go
func (s *Service) RevokeSession(ctx context.Context, userID, deviceID int64) (bool, error) {
	tokenHash, found, err := s.repo.DeleteDevice(ctx, userID, deviceID)
	if err != nil || !found {
		return false, err
	}
	if s.cache != nil {
		_ = s.cache.DelSession(ctx, tokenHash)
	}
	if s.revoker != nil {
		_ = s.revoker.NotifyRevoked(ctx, deviceID)
	}
	return true, nil
}
```

- [ ] **Step 2: Add an auth test for the notifier**

Append to `backend/internal/auth/service_test.go`:
```go
type fakeRevoker struct{ revoked []int64 }

func (r *fakeRevoker) NotifyRevoked(_ context.Context, deviceID int64) error {
	r.revoked = append(r.revoked, deviceID)
	return nil
}

func TestService_RevokeNotifies(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(NewRepo(pool), "12345", func(string, ...any) {})
	rev := &fakeRevoker{}
	s.SetRevocationNotifier(rev)
	ctx := context.Background()

	_ = s.RequestCode(ctx, "+79991240000")
	res, _ := s.SignIn(ctx, "+79991240000", "12345", "web", "browser")
	_, deviceID, _ := s.Authenticate(ctx, res.Token)

	ok, err := s.RevokeSession(ctx, res.User.ID, deviceID)
	if err != nil || !ok {
		t.Fatalf("RevokeSession = %v, %v", ok, err)
	}
	if len(rev.revoked) != 1 || rev.revoked[0] != deviceID {
		t.Fatalf("notifier got %v; want [%d]", rev.revoked, deviceID)
	}
}
```

- [ ] **Step 3: Implement NotifyRevoked on the realtime publisher**

In `backend/internal/realtime/publisher.go`, add:
```go
// DeviceChannel is the Redis control channel for a device (close-on-revoke).
func DeviceChannel(deviceID int64) string { return fmt.Sprintf("device:%d", deviceID) }

// NotifyRevoked publishes a close signal on the device's control channel so the
// WS hub can drop that device's live socket. Implements auth.RevocationNotifier.
func (p *RedisPublisher) NotifyRevoked(ctx context.Context, deviceID int64) error {
	return p.rdb.Publish(ctx, DeviceChannel(deviceID), "close").Err()
}
```

- [ ] **Step 4: Test NotifyRevoked**

Append to `backend/internal/realtime/publisher_test.go`:
```go
func TestRedisPublisher_NotifyRevoked(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	sub := rdb.Subscribe(ctx, DeviceChannel(99))
	defer sub.Close()
	if _, err := sub.Receive(ctx); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	ch := sub.Channel()

	if err := NewRedisPublisher(rdb).NotifyRevoked(ctx, 99); err != nil {
		t.Fatalf("notify: %v", err)
	}
	select {
	case msg := <-ch:
		if msg.Payload != "close" {
			t.Fatalf("payload = %q", msg.Payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no close signal received")
	}
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/auth/ -run 'RevokeNotifies' -v && go test ./internal/realtime/ -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/auth/service.go backend/internal/auth/service_test.go backend/internal/realtime/publisher.go backend/internal/realtime/publisher_test.go
git commit -m "feat(backend): revocation notifier (auth) + device-close publish (realtime)"
```

---

### Task 4: Hub device tracking + close-on-revoke

**Files:**
- Modify: `backend/internal/transport/ws/hub.go`
- Modify: `backend/internal/transport/ws/hub_test.go`

- [ ] **Step 1: Extend the hub**

Replace `backend/internal/transport/ws/hub.go` with:
```go
// Package ws implements the WebSocket gateway: a per-replica Hub that holds
// local connections and bridges them to Redis pub/sub for cross-replica fan-out
// (user:{id} delivery) and device close-on-revoke (device:{id} control).
package ws

import (
	"context"
	"strconv"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"
)

// Sink is a connection a frame can be written to and that can be force-closed.
type Sink interface {
	Send(frame []byte)
	Close()
}

type Hub struct {
	mu          sync.RWMutex
	conns       map[int64]map[Sink]struct{} // by user id
	deviceConns map[int64]map[Sink]struct{} // by device id
	rdb         *redis.Client
	pubsub      *redis.PubSub
}

func NewHub(ctx context.Context, rdb *redis.Client) *Hub {
	h := &Hub{
		conns:       make(map[int64]map[Sink]struct{}),
		deviceConns: make(map[int64]map[Sink]struct{}),
		rdb:         rdb,
		pubsub:      rdb.Subscribe(ctx),
	}
	go h.run()
	return h
}

func userChannel(userID int64) string     { return "user:" + strconv.FormatInt(userID, 10) }
func deviceChannel(deviceID int64) string { return "device:" + strconv.FormatInt(deviceID, 10) }

func idFromChannel(ch, prefix string) (int64, bool) {
	if !strings.HasPrefix(ch, prefix) {
		return 0, false
	}
	id, err := strconv.ParseInt(strings.TrimPrefix(ch, prefix), 10, 64)
	return id, err == nil
}

func (h *Hub) run() {
	for msg := range h.pubsub.Channel() {
		if userID, ok := idFromChannel(msg.Channel, "user:"); ok {
			h.deliver(userID, []byte(msg.Payload))
		} else if deviceID, ok := idFromChannel(msg.Channel, "device:"); ok {
			h.closeDevice(deviceID)
		}
	}
}

// Register adds a sink under its user and device, subscribing to the relevant
// Redis channels on the first connection for each.
func (h *Hub) Register(ctx context.Context, userID, deviceID int64, s Sink) {
	h.mu.Lock()
	firstUser := len(h.conns[userID]) == 0
	if firstUser {
		h.conns[userID] = make(map[Sink]struct{})
	}
	h.conns[userID][s] = struct{}{}
	firstDevice := len(h.deviceConns[deviceID]) == 0
	if firstDevice {
		h.deviceConns[deviceID] = make(map[Sink]struct{})
	}
	h.deviceConns[deviceID][s] = struct{}{}
	h.mu.Unlock()
	if firstUser {
		_ = h.pubsub.Subscribe(ctx, userChannel(userID))
	}
	if firstDevice {
		_ = h.pubsub.Subscribe(ctx, deviceChannel(deviceID))
	}
}

// Unregister removes a sink and unsubscribes when a user/device has no more local
// connections. Returns whether this was the user's last local connection.
func (h *Hub) Unregister(ctx context.Context, userID, deviceID int64, s Sink) (lastUser bool) {
	h.mu.Lock()
	delete(h.conns[userID], s)
	lastUser = len(h.conns[userID]) == 0
	if lastUser {
		delete(h.conns, userID)
	}
	delete(h.deviceConns[deviceID], s)
	lastDevice := len(h.deviceConns[deviceID]) == 0
	if lastDevice {
		delete(h.deviceConns, deviceID)
	}
	h.mu.Unlock()
	if lastUser {
		_ = h.pubsub.Unsubscribe(ctx, userChannel(userID))
	}
	if lastDevice {
		_ = h.pubsub.Unsubscribe(ctx, deviceChannel(deviceID))
	}
	return lastUser
}

func (h *Hub) deliver(userID int64, frame []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for s := range h.conns[userID] {
		s.Send(frame)
	}
}

func (h *Hub) closeDevice(deviceID int64) {
	h.mu.RLock()
	sinks := make([]Sink, 0, len(h.deviceConns[deviceID]))
	for s := range h.deviceConns[deviceID] {
		sinks = append(sinks, s)
	}
	h.mu.RUnlock()
	// Close outside the lock: Close triggers the conn's readPump to exit, which
	// calls Unregister (needs the write lock) — closing under RLock would deadlock.
	for _, s := range sinks {
		s.Close()
	}
}

func (h *Hub) Close() error { return h.pubsub.Close() }
```

- [ ] **Step 2: Update the hub test (new signatures, fakeSink.Close, device-close test)**

In `backend/internal/transport/ws/hub_test.go`:

(a) Give `fakeSink` a `Close()` and a closed flag:
```go
type fakeSink struct {
	ch     chan []byte
	mu     sync.Mutex
	closed bool
}

func newFakeSink() *fakeSink { return &fakeSink{ch: make(chan []byte, 4)} }

func (s *fakeSink) Send(frame []byte) {
	select {
	case s.ch <- frame:
	default:
	}
}

func (s *fakeSink) Close() {
	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()
}

func (s *fakeSink) isClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}
```
Add `"sync"` to the test imports.

(b) Update the existing `TestHub_DeliversPublishedFrame` calls to the new signatures: `hub.Register(ctx, 7, 100, sink)` and `hub.Unregister(ctx, 7, 100, sink)` (use any device id, e.g. 100).

(c) Add a device-close test:
```go
func TestHub_ClosesDeviceOnRevoke(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	subRDB := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	pubRDB := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer subRDB.Close()
	defer pubRDB.Close()
	ctx := context.Background()

	hub := NewHub(ctx, subRDB)
	defer hub.Close()
	sink := newFakeSink()
	hub.Register(ctx, 7, 100, sink)
	time.Sleep(100 * time.Millisecond)

	// Publishing a close on the device channel must close the sink.
	if err := pubRDB.Publish(ctx, "device:100", "close").Err(); err != nil {
		t.Fatalf("publish: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if sink.isClosed() {
			return // success
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("sink was not closed on device-revoke signal")
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/transport/ws/ -run TestHub -v`
Expected: PASS (both TestHub_DeliversPublishedFrame and TestHub_ClosesDeviceOnRevoke).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/transport/ws/hub.go backend/internal/transport/ws/hub_test.go
git commit -m "feat(backend): hub device tracking + close socket on revoke"
```

---

### Task 5: Wire presence + close into Conn/handler/main + integration tests

**Files:**
- Modify: `backend/internal/transport/ws/conn.go`
- Modify: `backend/internal/transport/ws/handler.go`
- Modify: `backend/cmd/server/main.go`
- Modify: `backend/internal/transport/ws/ws_integration_test.go`

- [ ] **Step 1: Wire presence + Close into Conn**

In `backend/internal/transport/ws/conn.go`:

(a) Add a presence interface and a field to `Conn`. Add near the top:
```go
// Presence is the subset of presence.Manager the connection uses (kept as an
// interface so ws doesn't import presence).
type Presence interface {
	Online(ctx context.Context, userID int64) error
	Heartbeat(ctx context.Context, userID int64) error
	Offline(ctx context.Context, userID int64) error
}
```
Add `presence Presence` to the `Conn` struct and to `newConn`:
```go
func newConn(ws *websocket.Conn, hub *Hub, svc *messaging.Service, presence Presence, userID, deviceID int64) *Conn {
	return &Conn{ws: ws, hub: hub, svc: svc, presence: presence, userID: userID, deviceID: deviceID, send: make(chan []byte, sendBuffer)}
}
```

(b) Add a `Close` method so `Conn` satisfies `Sink`:
```go
// Close force-closes the underlying socket (used by the hub on revoke). The
// read pump then exits and run() cleans up.
func (c *Conn) Close() { _ = c.ws.Close() }
```

(c) Update `run` for the new hub signatures + presence lifecycle:
```go
func (c *Conn) run(ctx context.Context) {
	c.hub.Register(ctx, c.userID, c.deviceID, c)
	if c.presence != nil {
		_ = c.presence.Online(ctx, c.userID)
	}
	go c.writePump(ctx)
	c.readPump(ctx) // blocks until the connection closes
	lastUser := c.hub.Unregister(ctx, c.userID, c.deviceID, c)
	if c.presence != nil && lastUser {
		_ = c.presence.Offline(ctx, c.userID)
	}
	close(c.send)
}
```

(d) Change `writePump` to accept ctx and heartbeat on the ticker:
```go
func (c *Conn) writePump(ctx context.Context) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.ws.Close()
	}()
	for {
		select {
		case frame, ok := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.ws.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, frame); err != nil {
				return
			}
		case <-ticker.C:
			if c.presence != nil {
				_ = c.presence.Heartbeat(ctx, c.userID)
			}
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
```
(Add `"context"` to conn.go imports if not present — it already is.)

- [ ] **Step 2: Pass presence into the handler**

In `backend/internal/transport/ws/handler.go`:

(a) Add a `presence Presence` field to `Handler` and to `NewHandler`:
```go
func NewHandler(hub *Hub, authSvc *auth.Service, chatSvc *messaging.Service, presence Presence) *Handler {
	return &Handler{hub: hub, authSvc: authSvc, chatSvc: chatSvc, presence: presence,
		upgrader: websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}}
}
```
Add `presence Presence` to the `Handler` struct.

(b) In `ServeHTTP`, pass presence into `newConn`:
```go
	conn := newConn(wsConn, h.hub, h.chatSvc, h.presence, user.ID, deviceID)
	conn.run(r.Context())
```

- [ ] **Step 3: Wire presence + revocation notifier in main.go**

In `backend/cmd/server/main.go`, inside the Redis-available block, build the publisher once, set it as both the messaging publisher AND the auth revocation notifier, build the presence manager, and pass presence to the ws handler:
```go
	} else {
		defer rdb.Close()
		authSvc.SetCache(redisstore.NewSessionCache(rdb))
		publisher := realtime.NewRedisPublisher(rdb)
		chatSvc.SetPublisher(publisher)
		authSvc.SetRevocationNotifier(publisher)
		presenceMgr := presence.NewManager(rdb, publisher, chatSvc.ChatPartners, 35*time.Second)
		hub := ws.NewHub(ctx, rdb)
		defer hub.Close()
		wsHandler = ws.NewHandler(hub, authSvc, chatSvc, presenceMgr)
		log.Printf("session cache + realtime + presence enabled (redis)")
	}
```
Add the import `"github.com/messenger-denis/backend/internal/presence"`.

- [ ] **Step 4: Update the integration test + add presence/revoke tests**

In `backend/internal/transport/ws/ws_integration_test.go`:

(a) The existing `TestWS_LiveDelivery` builds the handler with `ws.NewHandler(hub, authSvc, chatSvc)` — update it to pass a presence manager (or `nil`). Use a real presence manager so we can also assert presence. Add a helper at the top of the test to build everything, or update inline: change the handler construction to:
```go
	publisher := realtime.NewRedisPublisher(rdb)
	chatSvc.SetPublisher(publisher)
	presenceMgr := presence.NewManager(rdb, publisher, chatSvc.ChatPartners, 35*time.Second)
	authSvc.SetRevocationNotifier(publisher)
	hub := ws.NewHub(ctx, rdb)
	defer hub.Close()
	handler := ws.NewHandler(hub, authSvc, chatSvc, presenceMgr)
```
Add imports `"github.com/messenger-denis/backend/internal/presence"` and `"github.com/messenger-denis/backend/internal/realtime"` (realtime may already be imported).

(b) Add a presence test: when B connects (after A is already connected and they share a chat), A receives a `presence` frame for B going online.
```go
func TestWS_Presence(t *testing.T) {
	env := newWSEnv(t)
	defer env.close()

	connA := dial(t, env.url, env.tokenA)
	defer connA.Close()
	time.Sleep(150 * time.Millisecond)
	// B comes online → A should get a presence(online) frame for B.
	connB := dial(t, env.url, env.tokenB)
	defer connB.Close()

	if data := readUntil(t, connA, "presence"); data == nil {
		t.Fatal("A did not receive B's presence")
	}
}

func TestWS_RevokeClosesSocket(t *testing.T) {
	env := newWSEnv(t)
	defer env.close()

	connA := dial(t, env.url, env.tokenA)
	defer connA.Close()
	time.Sleep(150 * time.Millisecond)

	// Revoke A's session → A's socket must close (next read errors).
	if _, err := env.authSvc.RevokeSession(env.ctx, env.userA, env.deviceA); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	_ = connA.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := connA.ReadMessage(); err == nil {
		t.Fatal("expected socket to be closed after revoke")
	}
}
```

(c) To support these, refactor the setup of `TestWS_LiveDelivery` into a shared `newWSEnv(t)` helper that returns an env struct with `url, tokenA, tokenB, userA, deviceA, ctx, authSvc` and a `close()` method, and have all three tests use it. Concretely, add:
```go
type wsEnv struct {
	url     string
	tokenA  string
	tokenB  string
	userA   int64
	deviceA int64
	chatID  int64
	ctx     context.Context
	authSvc *auth.Service
	chatSvc *messaging.Service
	srv     *httptest.Server
	hub     *ws.Hub
	mr      *miniredis.Miniredis
	rdb     *redis.Client
}

func (e *wsEnv) close() {
	e.srv.Close()
	e.hub.Close()
	e.rdb.Close()
	e.mr.Close()
}

func newWSEnv(t *testing.T) *wsEnv {
	t.Helper()
	pool := postgres.NewTestDB(t)
	mr, _ := miniredis.Run()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	authSvc := auth.NewService(auth.NewRepo(pool), "12345", func(string, ...any) {})
	chatSvc := messaging.NewService(pool)
	publisher := realtime.NewRedisPublisher(rdb)
	chatSvc.SetPublisher(publisher)
	authSvc.SetRevocationNotifier(publisher)
	presenceMgr := presence.NewManager(rdb, publisher, chatSvc.ChatPartners, 35*time.Second)
	hub := ws.NewHub(ctx, rdb)
	handler := ws.NewHandler(hub, authSvc, chatSvc, presenceMgr)
	srv := httptest.NewServer(http.HandlerFunc(handler.ServeHTTP))

	_ = authSvc.RequestCode(ctx, "+700")
	ra, _ := authSvc.SignIn(ctx, "+700", "12345", "web", "browser")
	_ = authSvc.RequestCode(ctx, "+701")
	rb, _ := authSvc.SignIn(ctx, "+701", "12345", "web", "browser")
	chatID, _ := chatSvc.CreatePrivateChat(ctx, ra.User.ID, rb.User.ID)
	_, deviceA, _ := authSvc.Authenticate(ctx, ra.Token)

	return &wsEnv{
		url:     "ws" + strings.TrimPrefix(srv.URL, "http"),
		tokenA:  ra.Token, tokenB: rb.Token,
		userA:   ra.User.ID, deviceA: deviceA, chatID: chatID,
		ctx:     ctx, authSvc: authSvc, chatSvc: chatSvc,
		srv:     srv, hub: hub, mr: mr, rdb: rdb,
	}
}
```
Then rewrite `TestWS_LiveDelivery` to use `env := newWSEnv(t); defer env.close()` and reference `env.url`, `env.tokenA`, `env.tokenB`, `env.chatID`. Keep its existing assertions (A gets ack/new_message, B gets new_message). Remove the now-duplicated inline setup.

- [ ] **Step 5: Run the tests and build**

Run: `cd backend && go build ./... && go test -race ./internal/transport/ws/ -count=1 -v && go test ./...`
Expected: build clean; all ws tests (hub, live delivery, presence, revoke-closes) pass under `-race`; whole suite green. If `TestWS_Presence`/`TestWS_RevokeClosesSocket` are timing-flaky, increase the registration sleeps/read deadlines (do not weaken assertions); re-run a few times.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/transport/ws/ backend/cmd/server/main.go
git commit -m "feat(backend): wire presence + revoke-close into ws gateway"
```

---

### Task 6: Full-stack verification

**Files:** none (verification only).

- [ ] **Step 1: Whole suite + race on ws + vet**

Run: `cd backend && go test ./... && go test -race -count=1 ./internal/transport/ws/ && go vet ./...`
Expected: all PASS, no data race, vet clean.

- [ ] **Step 2: End-to-end over docker**

Run:
```bash
cat > /tmp/plan-c4-stack.yml <<'EOF'
name: plan-c4-verify
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
    ports: ["18086:8080"]
EOF
docker compose -f /tmp/plan-c4-stack.yml up -d --build
sleep 6
docker compose -f /tmp/plan-c4-stack.yml logs backend | grep -i "presence enabled"
docker compose -f /tmp/plan-c4-stack.yml down -v
```
Expected: log shows "session cache + realtime + presence enabled (redis)". (Live presence + revoke-close are proven by the `-race` integration tests in Task 5.)

- [ ] **Step 3:** No code changes expected.

---

## Self-Review Notes

- **Spec coverage:** presence online/last-seen in Redis + WS heartbeat + fan-out to chat partners (§5.6); revoke/logout closes the live socket (§9a). Typing was already done in C2.
- **Multi-device / multi-replica caveat (documented):** `Online` de-dupes the "online" announce via `SET NX`; `Offline` fires only when a user's last *local* socket closes. With the same user connected on two replicas, one replica's disconnect can publish a transient `offline`; the other replica's next heartbeat (≤ ping period) re-establishes presence via `SET NX` and re-announces `online`. Acceptable for Phase 0; a `routes:{user}` reference-count set would tighten it later.
- **Deadlock avoidance:** `closeDevice` collects sinks under `RLock`, then calls `Close()` **outside** the lock — because `Close()` makes the read pump exit and call `Unregister`, which needs the write lock.
- **No import cycles:** `presence` defines its own `Publisher`/`PartnersFunc` (no messaging import); `ws` defines its own `Presence` interface (no presence import); `realtime.RedisPublisher` structurally satisfies `messaging.Publisher`, `presence.Publisher`, and `auth.RevocationNotifier`. `main` wires the one publisher into all three.
- **Single publisher instance:** built once in `main`, used as messaging publisher + presence publisher + auth revocation notifier — consistent channels.
- **Type consistency:** `Hub.Register(ctx, userID, deviceID, sink)`, `Unregister(...) lastUser bool`, `Sink{Send,Close}`, `newConn(ws, hub, svc, presence, userID, deviceID)`, `ws.NewHandler(hub, authSvc, chatSvc, presence)`, `presence.NewManager`, `auth.RevocationNotifier`, `realtime.DeviceChannel`/`NotifyRevoked` used consistently across all tasks and the main wiring.
```
