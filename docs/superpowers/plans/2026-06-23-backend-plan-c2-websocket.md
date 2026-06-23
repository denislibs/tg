# Backend Plan C2 — WebSocket Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver messages and read-receipts live over WebSocket. A client connects to `/ws`, sends `send_message`/`read`/`typing` frames, and receives `new_message`/`read`/`typing`/`message_ack` frames in real time — across multiple backend replicas via Redis pub/sub.

**Architecture:** The `messaging.Service` gains an optional `Publisher` (injected like the C1 cache, nil-safe): after `Send`/`MarkRead` commit, it publishes the resulting frames to each recipient's Redis channel `user:{id}`. A `realtime.RedisPublisher` implements it. The WS layer (`transport/ws`) has a `Hub` that holds local connections per user and subscribes to `user:{id}` channels on Redis; incoming pub/sub messages are fanned out to that user's local sockets. Each `Conn` runs read/write pumps; the read pump dispatches frames to the same `messaging.Service` methods the REST layer uses. So one code path serves both REST (Plan B) and WS, and fan-out works whether sender and recipient are on the same replica or not.

**Tech Stack:** Go, **github.com/gorilla/websocket**, go-redis/v9, miniredis (test), gorilla/chi, pgx, testcontainers-go.

Implements spec §3.3/§5 (realtime delivery), §8 (WS frame protocol), §7 (Redis pub/sub fan-out). Presence/typing-presence and reactions are Plan C3. Force-closing a revoked device's live socket is deferred to C3 (C1 already invalidates the token for the next request/reconnect).

---

## File Structure

```
backend/
  internal/messaging/
    publisher.go       — Publisher interface + frame helper
    message_service.go — MODIFY: publish new_message/read frames post-commit; add Typing
    publisher_test.go  — fake-publisher tests for Send/MarkRead/Typing
  internal/realtime/
    publisher.go       — RedisPublisher (implements messaging.Publisher)
    publisher_test.go  — miniredis publish→subscribe test
  internal/transport/ws/
    hub.go             — Hub: per-user local conns + Redis subscribe/route; Sink interface
    hub_test.go        — miniredis fan-out test with a fake sink
    conn.go            — Conn (gorilla) + read/write pumps + frame dispatch
    frames.go          — Frame{t,d} types
    handler.go         — /ws HTTP handler (upgrade + auth + register)
    ws_integration_test.go — real WS client end-to-end
  internal/transport/http/router.go — MODIFY: mount GET /ws (outside auth middleware; ws auths via token query)
  cmd/server/main.go   — MODIFY: build RedisPublisher + Hub, wire into messaging service & router
```

---

### Task 1: messaging.Publisher + live publish in Send/MarkRead + Typing

**Files:**
- Create: `backend/internal/messaging/publisher.go`
- Modify: `backend/internal/messaging/message_service.go`
- Create: `backend/internal/messaging/publisher_test.go`

- [ ] **Step 1: Define the Publisher interface and frame helper**

Create `backend/internal/messaging/publisher.go`:
```go
package messaging

import (
	"context"
	"encoding/json"
)

// Publisher delivers a pre-encoded WS frame to a user's realtime channel.
// Implementations must be safe for concurrent use and must not block.
type Publisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

// frame encodes a WS envelope {t, d}. Errors are impossible for the maps we pass,
// so it returns just the bytes (empty on the unreachable error path).
func frame(t string, d any) []byte {
	b, err := json.Marshal(map[string]any{"t": t, "d": d})
	if err != nil {
		return nil
	}
	return b
}
```

- [ ] **Step 2: Wire the publisher into the service (Send/MarkRead) and add Typing**

In `backend/internal/messaging/message_service.go`:

(a) Add `"encoding/json"` is already imported. Add a publisher field to `Service`. Since `Service` is defined in `service.go`, add the field there instead — open `service.go` and add `publisher Publisher` to the struct and this setter:
```go
// SetPublisher attaches a realtime publisher (optional). When nil, the service
// records updates in the DB but pushes nothing live.
func (s *Service) SetPublisher(p Publisher) { s.publisher = p }
```

(b) In `message_service.go`, replace the `Send` method body so it captures recipients and publishes `new_message` frames AFTER the transaction commits (never on the idempotent duplicate path). Replace the existing `Send` with:
```go
// Send inserts a message, appends a new_message update to every member (bumping
// unread for non-senders), and — after commit — publishes a live new_message
// frame to each member. Idempotent on ClientMsgID (duplicates publish nothing).
func (s *Service) Send(ctx context.Context, in SendInput) (Message, error) {
	ok, err := s.chats.IsMember(ctx, s.pool, in.ChatID, in.SenderID)
	if err != nil {
		return Message{}, err
	}
	if !ok {
		return Message{}, ErrNotFound
	}
	if in.Type == "" {
		in.Type = "text"
	}

	var msg Message
	var recipients []int64 // non-nil only when a NEW message was inserted
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		if in.ClientMsgID != "" {
			if existing, e := s.msgs.FindByClientMsgID(ctx, tx, in.ChatID, in.SenderID, in.ClientMsgID); e == nil {
				msg = existing
				return nil
			} else if e != ErrNotFound {
				return e
			}
		}
		seq, e := s.msgs.NextSeq(ctx, tx, in.ChatID)
		if e != nil {
			return e
		}
		var cmid *string
		if in.ClientMsgID != "" {
			cmid = &in.ClientMsgID
		}
		msg, e = s.msgs.Insert(ctx, tx, Message{
			ChatID: in.ChatID, Seq: seq, SenderID: in.SenderID,
			Type: in.Type, Text: in.Text, ReplyToID: in.ReplyToID, ClientMsgID: cmid,
		})
		if e != nil {
			return e
		}
		members, e := s.chats.MemberIDs(ctx, tx, in.ChatID)
		if e != nil {
			return e
		}
		slices.Sort(members)
		payload, e := json.Marshal(messageUpdatePayload(msg))
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := s.updates.AppendUpdate(ctx, tx, uid, 1, date, "new_message", payload); e != nil {
				return e
			}
			if uid != in.SenderID {
				if _, e := tx.Exec(ctx,
					`UPDATE chat_members SET unread_count = unread_count + 1 WHERE chat_id=$1 AND user_id=$2`,
					in.ChatID, uid); e != nil {
					return e
				}
			}
		}
		recipients = members
		return nil
	})
	if err != nil {
		return Message{}, err
	}
	if s.publisher != nil && recipients != nil {
		f := frame("new_message", messageUpdatePayload(msg))
		for _, uid := range recipients {
			_ = s.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return msg, nil
}
```

(c) In `MarkRead`, capture members + effective seq and publish a `read` frame after commit. Replace the trailing part of `MarkRead` (the `inTx` call) so the closure stores `members`/`effective` in outer variables, then publishes after:

Replace the existing `return s.inTx(ctx, func(tx pgx.Tx) error { ... })` block in `MarkRead` with:
```go
	var members []int64
	var effective int64
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		var cur int64
		if e := tx.QueryRow(ctx,
			`SELECT last_read_seq FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
			chatID, userID).Scan(&cur); e != nil {
			return e
		}
		effective = upToSeq
		if cur > effective {
			effective = cur
		}
		unread, e := s.msgs.CountUnread(ctx, tx, chatID, userID, effective)
		if e != nil {
			return e
		}
		if _, e := tx.Exec(ctx,
			`UPDATE chat_members SET last_read_seq=$3, unread_count=$4
			 WHERE chat_id=$1 AND user_id=$2`, chatID, userID, effective, unread); e != nil {
			return e
		}
		m, e := s.chats.MemberIDs(ctx, tx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(m)
		members = m
		payload, e := json.Marshal(map[string]any{
			"chat_id": chatID, "user_id": userID, "up_to_seq": effective,
		})
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := s.updates.AppendUpdate(ctx, tx, uid, 1, date, "read", payload); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if s.publisher != nil {
		f := frame("read", map[string]any{"chat_id": chatID, "user_id": userID, "up_to_seq": effective})
		for _, uid := range members {
			_ = s.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
}
```
(The method signature `func (s *Service) MarkRead(ctx context.Context, chatID, userID, upToSeq int64) error` and its initial `IsMember` guard stay unchanged; only the body from `return s.inTx(...)` onward changes, and `err` must be declared — change the guard to assign to a named `err` if needed: the IsMember block already uses `ok, err := ...`, so reuse that `err`.)

(d) Add a `Typing` method at the end of `message_service.go`:
```go
// Typing publishes an ephemeral typing indicator to the other chat members.
// No DB write. No-op if the user isn't a member or no publisher is attached.
func (s *Service) Typing(ctx context.Context, chatID, userID int64) error {
	if s.publisher == nil {
		return nil
	}
	ok, err := s.chats.IsMember(ctx, s.pool, chatID, userID)
	if err != nil || !ok {
		return err
	}
	members, err := s.chats.MemberIDs(ctx, s.pool, chatID)
	if err != nil {
		return err
	}
	f := frame("typing", map[string]any{"chat_id": chatID, "user_id": userID})
	for _, uid := range members {
		if uid != userID {
			_ = s.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
}
```

- [ ] **Step 3: Write fake-publisher tests**

Create `backend/internal/messaging/publisher_test.go`:
```go
package messaging

import (
	"context"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

type capturedFrame struct {
	userID int64
	frame  []byte
}

type fakePublisher struct {
	mu     sync.Mutex
	frames []capturedFrame
}

func (p *fakePublisher) PublishToUser(_ context.Context, userID int64, f []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.frames = append(p.frames, capturedFrame{userID, append([]byte(nil), f...)})
	return nil
}

func (p *fakePublisher) countFor(userID int64) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	for _, f := range p.frames {
		if f.userID == userID {
			n++
		}
	}
	return n
}

func TestSend_PublishesToAllMembers(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	pub := &fakePublisher{}
	s.SetPublisher(pub)
	ctx := context.Background()
	a := seedUser(t, pool, "+810")
	b := seedUser(t, pool, "+811")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)

	if _, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi", ClientMsgID: "c1"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if pub.countFor(a) != 1 || pub.countFor(b) != 1 {
		t.Fatalf("expected 1 frame each; got a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}

	// Duplicate send publishes nothing extra.
	if _, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi", ClientMsgID: "c1"}); err != nil {
		t.Fatalf("dup Send: %v", err)
	}
	if pub.countFor(b) != 1 {
		t.Fatalf("duplicate published again: b=%d", pub.countFor(b))
	}
}

func TestMarkRead_PublishesRead(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	pub := &fakePublisher{}
	s.SetPublisher(pub)
	ctx := context.Background()
	a := seedUser(t, pool, "+820")
	b := seedUser(t, pool, "+821")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	_, _ = s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "1"})
	pub.frames = nil // reset after send

	if err := s.MarkRead(ctx, chatID, b, 1); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if pub.countFor(a) != 1 || pub.countFor(b) != 1 {
		t.Fatalf("read frame fan-out wrong: a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}
}

func TestTyping_PublishesToOthers(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	pub := &fakePublisher{}
	s.SetPublisher(pub)
	ctx := context.Background()
	a := seedUser(t, pool, "+830")
	b := seedUser(t, pool, "+831")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)

	if err := s.Typing(ctx, chatID, a); err != nil {
		t.Fatalf("Typing: %v", err)
	}
	if pub.countFor(b) != 1 || pub.countFor(a) != 0 {
		t.Fatalf("typing should go to others only: a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/messaging/ -run 'Send_Publishes|MarkRead_Publishes|Typing_Publishes' -v`
Expected: PASS. Also run the full messaging package to confirm Plan B tests still pass: `go test ./internal/messaging/`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/messaging/publisher.go backend/internal/messaging/message_service.go backend/internal/messaging/service.go backend/internal/messaging/publisher_test.go
git commit -m "feat(backend): messaging Publisher + live new_message/read/typing fan-out"
```

---

### Task 2: realtime.RedisPublisher

**Files:**
- Create: `backend/internal/realtime/publisher.go`
- Create: `backend/internal/realtime/publisher_test.go`

- [ ] **Step 1: Write the Redis publisher**

Create `backend/internal/realtime/publisher.go`:
```go
// Package realtime bridges the messaging service to Redis pub/sub for
// cross-replica delivery.
package realtime

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// UserChannel is the Redis pub/sub channel for a user's realtime frames.
func UserChannel(userID int64) string { return fmt.Sprintf("user:%d", userID) }

// RedisPublisher publishes frames to per-user Redis channels.
type RedisPublisher struct{ rdb *redis.Client }

func NewRedisPublisher(rdb *redis.Client) *RedisPublisher { return &RedisPublisher{rdb: rdb} }

func (p *RedisPublisher) PublishToUser(ctx context.Context, userID int64, frame []byte) error {
	return p.rdb.Publish(ctx, UserChannel(userID), frame).Err()
}
```

- [ ] **Step 2: Write the test**

Create `backend/internal/realtime/publisher_test.go`:
```go
package realtime

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestRedisPublisher_PublishToUser(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	sub := rdb.Subscribe(ctx, UserChannel(42))
	defer sub.Close()
	if _, err := sub.Receive(ctx); err != nil { // wait for subscription confirmation
		t.Fatalf("subscribe: %v", err)
	}
	ch := sub.Channel()

	pub := NewRedisPublisher(rdb)
	if err := pub.PublishToUser(ctx, 42, []byte(`{"t":"new_message"}`)); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case msg := <-ch:
		if msg.Payload != `{"t":"new_message"}` {
			t.Fatalf("unexpected payload: %q", msg.Payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive published frame")
	}
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd backend && go test ./internal/realtime/ -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/realtime/
git commit -m "feat(backend): redis publisher for per-user realtime channels"
```

---

### Task 3: WS Hub (Redis-subscribed fan-out to local connections)

**Files:**
- Create: `backend/internal/transport/ws/hub.go`
- Create: `backend/internal/transport/ws/hub_test.go`

- [ ] **Step 1: Write the hub**

Create `backend/internal/transport/ws/hub.go`:
```go
// Package ws implements the WebSocket gateway: a per-replica Hub that holds
// local connections and bridges them to Redis pub/sub for cross-replica fan-out.
package ws

import (
	"context"
	"strconv"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"
)

// Sink is anything a delivered frame can be written to (a Conn in production,
// a fake in tests).
type Sink interface {
	Send(frame []byte)
}

// Hub tracks this replica's connections per user and routes Redis-published
// frames on channel "user:{id}" to the matching local sinks.
type Hub struct {
	mu     sync.RWMutex
	conns  map[int64]map[Sink]struct{}
	rdb    *redis.Client
	pubsub *redis.PubSub
}

func NewHub(ctx context.Context, rdb *redis.Client) *Hub {
	h := &Hub{
		conns:  make(map[int64]map[Sink]struct{}),
		rdb:    rdb,
		pubsub: rdb.Subscribe(ctx), // no channels yet; added on demand
	}
	go h.run()
	return h
}

func userChannel(userID int64) string { return "user:" + strconv.FormatInt(userID, 10) }

func userIDFromChannel(ch string) (int64, bool) {
	const prefix = "user:"
	if !strings.HasPrefix(ch, prefix) {
		return 0, false
	}
	id, err := strconv.ParseInt(strings.TrimPrefix(ch, prefix), 10, 64)
	return id, err == nil
}

func (h *Hub) run() {
	for msg := range h.pubsub.Channel() {
		if userID, ok := userIDFromChannel(msg.Channel); ok {
			h.deliver(userID, []byte(msg.Payload))
		}
	}
}

// Register adds a sink for a user, subscribing to its Redis channel on the first
// connection.
func (h *Hub) Register(ctx context.Context, userID int64, s Sink) {
	h.mu.Lock()
	first := len(h.conns[userID]) == 0
	if first {
		h.conns[userID] = make(map[Sink]struct{})
	}
	h.conns[userID][s] = struct{}{}
	h.mu.Unlock()
	if first {
		_ = h.pubsub.Subscribe(ctx, userChannel(userID))
	}
}

// Unregister removes a sink, unsubscribing when the user has no more local conns.
func (h *Hub) Unregister(ctx context.Context, userID int64, s Sink) {
	h.mu.Lock()
	set := h.conns[userID]
	delete(set, s)
	last := len(set) == 0
	if last {
		delete(h.conns, userID)
	}
	h.mu.Unlock()
	if last {
		_ = h.pubsub.Unsubscribe(ctx, userChannel(userID))
	}
}

func (h *Hub) deliver(userID int64, frame []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for s := range h.conns[userID] {
		s.Send(frame)
	}
}

// Close shuts down the Redis subscription.
func (h *Hub) Close() error { return h.pubsub.Close() }
```

- [ ] **Step 2: Write the hub test (miniredis + fake sink)**

Create `backend/internal/transport/ws/hub_test.go`:
```go
package ws

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/messenger-denis/backend/internal/realtime"
	"github.com/redis/go-redis/v9"
)

type fakeSink struct{ ch chan []byte }

func newFakeSink() *fakeSink { return &fakeSink{ch: make(chan []byte, 4)} }
func (s *fakeSink) Send(frame []byte) { s.ch <- frame }

func TestHub_DeliversPublishedFrame(t *testing.T) {
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
	hub.Register(ctx, 7, sink)
	// Give the subscription a moment to register on miniredis.
	time.Sleep(100 * time.Millisecond)

	pub := realtime.NewRedisPublisher(pubRDB)
	if err := pub.PublishToUser(ctx, 7, []byte(`hello`)); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case got := <-sink.ch:
		if string(got) != "hello" {
			t.Fatalf("got %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("frame not delivered to sink")
	}

	// After unregister, no further delivery.
	hub.Unregister(ctx, 7, sink)
	time.Sleep(100 * time.Millisecond)
	_ = pub.PublishToUser(ctx, 7, []byte(`again`))
	select {
	case got := <-sink.ch:
		t.Fatalf("unexpected delivery after unregister: %q", got)
	case <-time.After(300 * time.Millisecond):
		// good: nothing delivered
	}
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd backend && go test ./internal/transport/ws/ -run TestHub -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/transport/ws/hub.go backend/internal/transport/ws/hub_test.go
git commit -m "feat(backend): ws hub with redis-subscribed per-user fan-out"
```

---

### Task 4: Conn + pumps + /ws handler + wiring + integration test

**Files:**
- Create: `backend/internal/transport/ws/frames.go`
- Create: `backend/internal/transport/ws/conn.go`
- Create: `backend/internal/transport/ws/handler.go`
- Modify: `backend/internal/transport/http/router.go`
- Modify: `backend/cmd/server/main.go`
- Create: `backend/internal/transport/ws/ws_integration_test.go`

- [ ] **Step 1: Add the gorilla/websocket dependency**

Run: `cd backend && go get github.com/gorilla/websocket@latest`
Expected: dependency added.

- [ ] **Step 2: Define frame types**

Create `backend/internal/transport/ws/frames.go`:
```go
package ws

import "encoding/json"

// Frame is the WS envelope: a type tag and an opaque JSON payload.
type Frame struct {
	T string          `json:"t"`
	D json.RawMessage `json:"d,omitempty"`
}

type sendMessageData struct {
	ChatID      int64  `json:"chat_id"`
	Type        string `json:"type"`
	Text        string `json:"text"`
	ReplyToID   *int64 `json:"reply_to_id"`
	ClientMsgID string `json:"client_msg_id"`
}

type readData struct {
	ChatID  int64 `json:"chat_id"`
	UpToSeq int64 `json:"up_to_seq"`
}

type typingData struct {
	ChatID int64 `json:"chat_id"`
}
```

- [ ] **Step 3: Write the connection and pumps**

Create `backend/internal/transport/ws/conn.go`:
```go
package ws

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/messaging"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 25 * time.Second
	maxMessageSize = 1 << 20 // 1 MiB
	sendBuffer     = 32
)

// Conn is one client WebSocket connection. It implements Sink.
type Conn struct {
	ws       *websocket.Conn
	hub      *Hub
	svc      *messaging.Service
	userID   int64
	deviceID int64
	send     chan []byte
}

func newConn(ws *websocket.Conn, hub *Hub, svc *messaging.Service, userID, deviceID int64) *Conn {
	return &Conn{ws: ws, hub: hub, svc: svc, userID: userID, deviceID: deviceID, send: make(chan []byte, sendBuffer)}
}

// Send queues a frame for the writer. Drops the frame if the buffer is full
// (a stuck client must not block fan-out).
func (c *Conn) Send(frame []byte) {
	select {
	case c.send <- frame:
	default:
	}
}

func (c *Conn) run(ctx context.Context) {
	c.hub.Register(ctx, c.userID, c)
	go c.writePump()
	c.readPump(ctx) // blocks until the connection closes
	c.hub.Unregister(ctx, c.userID, c)
	close(c.send)
}

func (c *Conn) readPump(ctx context.Context) {
	defer c.ws.Close()
	c.ws.SetReadLimit(maxMessageSize)
	_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
	c.ws.SetPongHandler(func(string) error {
		return c.ws.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
		var f Frame
		if json.Unmarshal(data, &f) != nil {
			continue
		}
		c.dispatch(ctx, f)
	}
}

func (c *Conn) dispatch(ctx context.Context, f Frame) {
	switch f.T {
	case "ping":
		c.Send([]byte(`{"t":"pong"}`))
	case "send_message":
		var d sendMessageData
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		msg, err := c.svc.Send(ctx, messaging.SendInput{
			ChatID: d.ChatID, SenderID: c.userID, Type: d.Type, Text: d.Text,
			ReplyToID: d.ReplyToID, ClientMsgID: d.ClientMsgID,
		})
		if err != nil {
			return
		}
		ack, _ := json.Marshal(map[string]any{
			"t": "message_ack",
			"d": map[string]any{"client_msg_id": d.ClientMsgID, "msg_id": msg.ID, "seq": msg.Seq, "created_at": msg.CreatedAt},
		})
		c.Send(ack)
	case "read":
		var d readData
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		_ = c.svc.MarkRead(ctx, d.ChatID, c.userID, d.UpToSeq)
	case "typing":
		var d typingData
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		_ = c.svc.Typing(ctx, d.ChatID, c.userID)
	}
}

func (c *Conn) writePump() {
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
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
```

- [ ] **Step 4: Write the /ws handler**

Create `backend/internal/transport/ws/handler.go`:
```go
package ws

import (
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/messaging"
)

// Handler upgrades HTTP to WebSocket, authenticates via the ?token= query
// parameter (browsers can't set headers on WS), and runs the connection.
type Handler struct {
	hub      *Hub
	authSvc  *auth.Service
	chatSvc  *messaging.Service
	upgrader websocket.Upgrader
}

func NewHandler(hub *Hub, authSvc *auth.Service, chatSvc *messaging.Service) *Handler {
	return &Handler{
		hub:     hub,
		authSvc: authSvc,
		chatSvc: chatSvc,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true }, // dev: allow all origins
		},
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	user, deviceID, err := h.authSvc.Authenticate(r.Context(), token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	wsConn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade already wrote the error
	}
	conn := newConn(wsConn, h.hub, h.chatSvc, user.ID, deviceID)
	conn.run(r.Context())
}
```

- [ ] **Step 5: Mount /ws in the router and wire main.go**

(a) In `backend/internal/transport/http/router.go`, change `NewRouter` to accept an optional WS handler and mount it OUTSIDE the auth middleware group (WS authenticates itself via the token query param). Change the signature to:
```go
func NewRouter(authSvc *auth.Service, chatSvc *messaging.Service, wsHandler http.Handler) http.Handler {
```
and near the top (after the health route, before the protected group) add:
```go
	if wsHandler != nil {
		r.Get("/ws", wsHandler.ServeHTTP)
	}
```
Update ALL existing callers of `NewRouter` to pass a third argument. In the test helpers `newTestRouter` (auth_handler_test.go) and `newMessagingRouter` (chat_handler_test.go), pass `nil` for the ws handler.

(b) In `backend/cmd/server/main.go`, after the messaging service is built and the Redis client is connected, build the publisher, hub, and ws handler. Where Redis connects (the C1 block), keep the `rdb` in scope. Replace the C1 redis block + router construction with:
```go
	authSvc := auth.NewService(auth.NewRepo(pool), cfg.DevOTPCode, log.Printf)
	chatSvc := messaging.NewService(pool)

	var wsHandler http.Handler
	if rdb, err := redisstore.Connect(ctx, cfg.RedisURL); err != nil {
		log.Printf("redis unavailable, running without cache/realtime: %v", err)
	} else {
		defer rdb.Close()
		authSvc.SetCache(redisstore.NewSessionCache(rdb))
		chatSvc.SetPublisher(realtime.NewRedisPublisher(rdb))
		hub := ws.NewHub(ctx, rdb)
		defer hub.Close()
		wsHandler = ws.NewHandler(hub, authSvc, chatSvc)
		log.Printf("session cache + realtime enabled (redis)")
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httptransport.NewRouter(authSvc, chatSvc, wsHandler),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
```
Add imports `"github.com/messenger-denis/backend/internal/realtime"` and `"github.com/messenger-denis/backend/internal/transport/ws"`.

**Important:** `WriteTimeout: 10s` on `http.Server` would kill long-lived WS connections. Remove `WriteTimeout` (set it to `0`) since WS writes are governed by the per-write deadline in the write pump. Change the `srv` above to omit `WriteTimeout` (or set `WriteTimeout: 0`). Keep `ReadHeaderTimeout` and `IdleTimeout`.

- [ ] **Step 6: Write the integration test (real WS client)**

Create `backend/internal/transport/ws/ws_integration_test.go`:
```go
package ws_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/messaging"
	"github.com/messenger-denis/backend/internal/realtime"
	"github.com/messenger-denis/backend/internal/store/postgres"
	"github.com/messenger-denis/backend/internal/transport/ws"
	"github.com/redis/go-redis/v9"
)

func TestWS_LiveDelivery(t *testing.T) {
	pool := postgres.NewTestDB(t)
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	authSvc := auth.NewService(auth.NewRepo(pool), "12345", func(string, ...any) {})
	chatSvc := messaging.NewService(pool)
	chatSvc.SetPublisher(realtime.NewRedisPublisher(rdb))
	hub := ws.NewHub(ctx, rdb)
	defer hub.Close()
	handler := ws.NewHandler(hub, authSvc, chatSvc)

	srv := httptest.NewServer(http.HandlerFunc(handler.ServeHTTP))
	defer srv.Close()

	// Seed two users + a chat directly via the services.
	_ = authSvc.RequestCode(ctx, "+700")
	ra, _ := authSvc.SignIn(ctx, "+700", "12345", "web", "browser")
	_ = authSvc.RequestCode(ctx, "+701")
	rb, _ := authSvc.SignIn(ctx, "+701", "12345", "web", "browser")
	chatID, _ := chatSvc.CreatePrivateChat(ctx, ra.User.ID, rb.User.ID)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	connA := dial(t, wsURL, ra.Token)
	defer connA.Close()
	connB := dial(t, wsURL, rb.Token)
	defer connB.Close()
	time.Sleep(150 * time.Millisecond) // let both register + subscribe

	// A sends a message.
	sendFrame(t, connA, "send_message", map[string]any{"chat_id": chatID, "text": "hi", "client_msg_id": "c1"})

	// A receives an ack; B receives a new_message.
	if got := readFrameType(t, connA); got != "message_ack" && got != "new_message" {
		t.Fatalf("A first frame = %q", got)
	}
	if got := readUntil(t, connB, "new_message"); got == nil {
		t.Fatal("B did not receive new_message")
	}
}

func dial(t *testing.T, wsURL, token string) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial(wsURL+"/?token="+token, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return c
}

func sendFrame(t *testing.T, c *websocket.Conn, typ string, d any) {
	t.Helper()
	raw, _ := json.Marshal(d)
	f, _ := json.Marshal(map[string]any{"t": typ, "d": json.RawMessage(raw)})
	if err := c.WriteMessage(websocket.TextMessage, f); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func readFrameType(t *testing.T, c *websocket.Conn) string {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var f struct {
		T string `json:"t"`
	}
	_ = json.Unmarshal(data, &f)
	return f.T
}

// readUntil reads frames until one with type typ arrives or it times out.
func readUntil(t *testing.T, c *websocket.Conn, typ string) []byte {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, data, err := c.ReadMessage()
		if err != nil {
			return nil
		}
		var f struct {
			T string `json:"t"`
		}
		_ = json.Unmarshal(data, &f)
		if f.T == typ {
			return data
		}
	}
	return nil
}
```

- [ ] **Step 7: Run the tests and build**

Run: `cd backend && go build ./... && go test ./internal/transport/ws/ -v && go test ./...`
Expected: build clean; WS hub + integration tests pass; whole suite green.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/transport/ws/ backend/internal/transport/http/router.go backend/cmd/server/main.go backend/go.mod backend/go.sum
git commit -m "feat(backend): /ws gateway — conn pumps, frame dispatch, live messaging"
```

---

### Task 5: Full-stack verification

**Files:** none (verification only).

- [ ] **Step 1: Whole suite + vet**

Run: `cd backend && go test ./... && go vet ./...`
Expected: all PASS, vet clean.

- [ ] **Step 2: Manual end-to-end over a real WS via the docker stack**

Use `websocat` if available, otherwise this Go-free check confirms the server accepts WS upgrades. Start the stack:
```bash
cat > /tmp/plan-c2-stack.yml <<'EOF'
name: plan-c2-verify
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
    ports: ["18084:8080"]
EOF
docker compose -f /tmp/plan-c2-stack.yml up -d --build
sleep 6
docker compose -f /tmp/plan-c2-stack.yml logs backend | grep -i "realtime enabled"
B="localhost:18084"
curl -s -X POST $B/auth/request_code -d '{"phone":"+700"}' >/dev/null
TOK=$(curl -s -X POST $B/auth/sign_in -d '{"phone":"+700","code":"12345"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
# Confirm the /ws endpoint performs a WebSocket upgrade (HTTP 101) with a valid token.
curl -s -o /dev/null -w 'ws upgrade status: %{http_code}\n' \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Version: 13" \
  "$B/ws?token=$TOK"
docker compose -f /tmp/plan-c2-stack.yml down -v
```
Expected: log shows "session cache + realtime enabled (redis)"; the `/ws` upgrade returns `101`. (The authoritative live-delivery proof is `TestWS_LiveDelivery` from Task 4.)

- [ ] **Step 3:** No code changes expected. Fix under the relevant task if verification fails.

---

## Self-Review Notes

- **Spec coverage:** §8 WS frames (auth via token query, send_message→message_ack, new_message, read, typing, ping/pong) — Tasks 1,4. §3.3/§5 realtime delivery via the same transactional service methods + post-commit publish — Task 1. §7 Redis pub/sub fan-out across replicas (`user:{id}` channels, per-user subscribe) — Tasks 2,3.
- **Out of scope (Plan C3):** presence (online/last_seen + heartbeat + presence fan-out), reactions (table + endpoints + live), force-closing a revoked device's live socket. Noted, not built here.
- **Same code path for REST + WS:** the WS dispatch calls `messaging.Service.Send`/`MarkRead`/`Typing` — the exact methods REST uses — so behavior (idempotency, unread, pts) is identical; only the transport differs.
- **Nil-safety:** publisher injected via `SetPublisher`; nil → DB-only (all Plan A/B/C1 tests keep passing). Hub/ws only constructed when Redis connects; if Redis is down the server still serves REST.
- **WS lifetime vs http.Server.WriteTimeout:** `WriteTimeout` is removed (set to 0) because it would terminate long-lived WS connections; per-write deadlines in the write pump bound individual writes instead. Read liveness is enforced by ping/pong + read deadline.
- **Backpressure:** `Conn.Send` drops frames when the per-conn buffer is full so one stuck client cannot block fan-out; the client recovers missed frames via `GET /sync` (the pts log persists everything regardless of live delivery).
- **Type consistency:** `Publisher`/`PublishToUser`, `realtime.UserChannel`, `ws.Hub`/`Sink`/`Register`/`Unregister`, `ws.NewHandler`, `NewRouter(authSvc, chatSvc, wsHandler)` updated consistently across messaging/realtime/ws/transport/main and all test helpers.
```
