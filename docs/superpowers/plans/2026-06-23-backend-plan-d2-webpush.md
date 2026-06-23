# Backend Plan D2 — Web Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver browser push notifications (Web Push / VAPID) when a message arrives for a user who has **no active WebSocket** (offline / app closed), respecting muted chats. Completes Phase 0.

**Architecture:** A `push_subscriptions` table holds per-device browser push subscriptions. The messaging service gains an optional `Notifier` (injected like the publisher); on `Send`, for each recipient other than the sender it calls `NotifyNewMessage`. A `push.Service` implements it: skip if the recipient is **online** (presence key in Redis) or has **muted** the chat, otherwise enqueue a job on a Redis Stream (`push:queue`). A `push.Worker` consumes the stream, enriches the job (sender name + unread badge), and sends an encrypted Web Push to each of the user's subscriptions via a `Sender` (webpush-go in prod, fake in tests), pruning subscriptions that return 404/410. VAPID keys come from config; push is disabled (gracefully) if they're unset.

**Tech Stack:** Go, **github.com/SherClockHolmes/webpush-go**, go-redis/v9 (Streams), pgx/v5, chi/v5, miniredis + testcontainers (tests).

Implements spec §11a (Web Push: subscriptions per device, queue + worker, push only when no active socket, payload contract, mute respect, prune 410). Phase 0 finishes here.

---

## File Structure

```
backend/
  internal/config/config.go        — MODIFY: VAPID settings (+test)
  internal/store/postgres/migrations/0005_push.sql — push_subscriptions
  internal/push/
    repo.go      — Subscription type, AddSubscription, SubscriptionsForUser, DeleteByEndpoint
    repo_test.go
    service.go   — Service (Notifier impl): NotifyNewMessage → presence/mute gate → enqueue
    service_test.go
    worker.go    — Worker: consume push:queue → enrich → Sender.Send → prune; Sender + Subscription
    worker_test.go
    webpush.go   — webpushSender (implements Sender via webpush-go)
  internal/messaging/
    message_service.go — MODIFY: Notifier interface + SetNotifier; Send notifies non-sender recipients
    publisher_test.go  — MODIFY: assert notifier called
  internal/transport/http/
    push_handler.go    — GET /push/vapid_public_key, POST /push/subscribe
    push_handler_test.go
    router.go          — MODIFY: mount push routes (nil-safe)
  cmd/server/main.go   — MODIFY: build push service + worker, wire notifier, start worker
  internal/openapi/openapi.yaml — MODIFY: document push endpoints
docs/contracts.md      — MODIFY: document push endpoints + payload
```

---

### Task 1: Config (VAPID) + migration + push repo

**Files:**
- Modify: `backend/internal/config/config.go` (+ `config_test.go`)
- Create: `backend/internal/store/postgres/migrations/0005_push.sql`
- Create: `backend/internal/push/repo.go`
- Create: `backend/internal/push/repo_test.go`

- [ ] **Step 1: Add VAPID settings to config**

In `backend/internal/config/config.go`, add fields and populate in `Load`:
```go
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string
```
```go
	c.VAPIDPublicKey = os.Getenv("VAPID_PUBLIC_KEY")
	c.VAPIDPrivateKey = os.Getenv("VAPID_PRIVATE_KEY")
	c.VAPIDSubject = getenv("VAPID_SUBJECT", "mailto:admin@example.com")
```

- [ ] **Step 2: Config test**

Append to `backend/internal/config/config_test.go`:
```go
func TestLoad_VAPIDSubjectDefault(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("VAPID_SUBJECT", "")
	c, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.VAPIDSubject != "mailto:admin@example.com" {
		t.Errorf("VAPIDSubject default = %q", c.VAPIDSubject)
	}
}
```

- [ ] **Step 3: Migration**

Create `backend/internal/store/postgres/migrations/0005_push.sql`:
```sql
-- +goose Up
CREATE TABLE push_subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  device_id  BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_subs_device ON push_subscriptions(device_id);

-- +goose Down
DROP TABLE push_subscriptions;
```

- [ ] **Step 4: Push repo**

Create `backend/internal/push/repo.go`:
```go
// Package push delivers Web Push notifications to offline users.
package push

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Subscription is a browser Web Push subscription.
type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

// AddSubscription upserts a subscription for a device (keyed by endpoint).
func (r *Repo) AddSubscription(ctx context.Context, deviceID int64, s Subscription) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth)
		 VALUES ($1,$2,$3,$4)
		 ON CONFLICT (endpoint) DO UPDATE SET device_id=$1, p256dh=$3, auth=$4`,
		deviceID, s.Endpoint, s.P256dh, s.Auth)
	return err
}

// SubscriptionsForUser returns all push subscriptions across a user's devices.
func (r *Repo) SubscriptionsForUser(ctx context.Context, userID int64) ([]Subscription, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
		 JOIN devices d ON d.id = ps.device_id WHERE d.user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Subscription
	for rows.Next() {
		var s Subscription
		if err := rows.Scan(&s.Endpoint, &s.P256dh, &s.Auth); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// DeleteByEndpoint removes a (likely expired) subscription.
func (r *Repo) DeleteByEndpoint(ctx context.Context, endpoint string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint=$1`, endpoint)
	return err
}
```

- [ ] **Step 5: Repo test**

Create `backend/internal/push/repo_test.go`:
```go
package push

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func seed(t *testing.T, pool interface {
	QueryRow(context.Context, string, ...any) interface {
		Scan(...any) error
	}
}) {
}

func TestRepo_SubscriptionLifecycle(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	var userID, deviceID int64
	_ = pool.QueryRow(ctx, `INSERT INTO users (phone, display_name) VALUES ('+700','+700') RETURNING id`).Scan(&userID)
	_ = pool.QueryRow(ctx, `INSERT INTO devices (user_id, token_hash) VALUES ($1,'h1') RETURNING id`, userID).Scan(&deviceID)

	sub := Subscription{Endpoint: "https://push/abc", P256dh: "p", Auth: "a"}
	if err := repo.AddSubscription(ctx, deviceID, sub); err != nil {
		t.Fatalf("add: %v", err)
	}
	// Upsert (same endpoint) does not duplicate.
	_ = repo.AddSubscription(ctx, deviceID, sub)

	subs, err := repo.SubscriptionsForUser(ctx, userID)
	if err != nil || len(subs) != 1 || subs[0].Endpoint != "https://push/abc" {
		t.Fatalf("subs = %+v, %v", subs, err)
	}
	if err := repo.DeleteByEndpoint(ctx, "https://push/abc"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	subs, _ = repo.SubscriptionsForUser(ctx, userID)
	if len(subs) != 0 {
		t.Fatalf("expected no subs after delete, got %d", len(subs))
	}
}
```
(Delete the unused `seed` stub if your linter complains — it's only there as a reminder; the real seeding is inline.)

- [ ] **Step 6: Run + commit**

Run: `cd backend && go test ./internal/config/ -run VAPID -v && go test ./internal/push/ -run Repo -v`
Expected: PASS.
```bash
git add backend/internal/config/ backend/internal/store/postgres/migrations/0005_push.sql backend/internal/push/repo.go backend/internal/push/repo_test.go
git commit -m "feat(backend): push_subscriptions table + repo + VAPID config"
```

---

### Task 2: messaging.Notifier hook

**Files:**
- Modify: `backend/internal/messaging/message_service.go`
- Modify: `backend/internal/messaging/publisher_test.go`

- [ ] **Step 1: Add the Notifier interface, field, setter, and call**

In `backend/internal/messaging/message_service.go`:

(a) Add the interface near `SendInput`:
```go
// Notifier is told about a new message for a recipient, so an offline recipient
// can be sent a push notification. Optional; never blocks delivery.
type Notifier interface {
	NotifyNewMessage(ctx context.Context, recipientID, chatID, msgID, seq, senderID int64, text string)
}
```

(b) Add `notifier Notifier` to the `Service` struct (in `service.go`) and a setter:
```go
// SetNotifier attaches a push notifier (optional).
func (s *Service) SetNotifier(n Notifier) { s.notifier = n }
```

(c) In `Send`, in the post-commit block where recipients are published to, also notify non-sender recipients. Change the publish loop:
```go
	if recipients != nil {
		f := frame("new_message", messageUpdatePayload(msg))
		for _, uid := range recipients {
			if s.publisher != nil {
				_ = s.publisher.PublishToUser(ctx, uid, f)
			}
			if s.notifier != nil && uid != in.SenderID {
				s.notifier.NotifyNewMessage(ctx, uid, msg.ChatID, msg.ID, msg.Seq, msg.SenderID, msg.Text)
			}
		}
	}
```
(Replace the existing `if s.publisher != nil && recipients != nil { ... }` block with the above.)

- [ ] **Step 2: Assert the notifier is called**

In `backend/internal/messaging/publisher_test.go`, add a fake notifier and a test:
```go
type fakeNotifier struct {
	mu        sync.Mutex
	recipients []int64
}

func (n *fakeNotifier) NotifyNewMessage(_ context.Context, recipientID, _, _, _, _ int64, _ string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.recipients = append(n.recipients, recipientID)
}

func TestSend_NotifiesNonSenderRecipients(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	nf := &fakeNotifier{}
	s.SetNotifier(nf)
	ctx := context.Background()
	a := seedUser(t, pool, "+840")
	b := seedUser(t, pool, "+841")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)

	if _, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	nf.mu.Lock()
	defer nf.mu.Unlock()
	if len(nf.recipients) != 1 || nf.recipients[0] != b {
		t.Fatalf("notifier recipients = %v; want [%d]", nf.recipients, b)
	}
}
```
(`sync` is already imported in publisher_test.go.)

- [ ] **Step 3: Run + commit**

Run: `cd backend && go test ./internal/messaging/ -run 'Send_Notifies|Send_Publishes' -v`
Expected: PASS.
```bash
git add backend/internal/messaging/message_service.go backend/internal/messaging/service.go backend/internal/messaging/publisher_test.go
git commit -m "feat(backend): messaging Notifier hook for offline push"
```

---

### Task 3: push.Service (presence/mute gate + enqueue)

**Files:**
- Create: `backend/internal/push/service.go`
- Create: `backend/internal/push/service_test.go`

- [ ] **Step 1: Write the service**

Create `backend/internal/push/service.go`:
```go
package push

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// QueueStream is the Redis Stream push jobs are enqueued on.
const QueueStream = "push:queue"

// Job is a queued push (enriched by the worker before sending).
type Job struct {
	RecipientID int64  `json:"recipient_id"`
	ChatID      int64  `json:"chat_id"`
	MsgID       int64  `json:"msg_id"`
	Seq         int64  `json:"seq"`
	SenderID    int64  `json:"sender_id"`
	Text        string `json:"text"`
}

// Service implements messaging.Notifier: it pushes only to offline, non-muted recipients.
type Service struct {
	rdb  *redis.Client
	pool *pgxpool.Pool
}

func NewService(rdb *redis.Client, pool *pgxpool.Pool) *Service {
	return &Service{rdb: rdb, pool: pool}
}

func (s *Service) NotifyNewMessage(ctx context.Context, recipientID, chatID, msgID, seq, senderID int64, text string) {
	// Online (has an active socket)? The WS layer already delivered it live.
	if n, _ := s.rdb.Exists(ctx, "presence:"+strconv.FormatInt(recipientID, 10)).Result(); n > 0 {
		return
	}
	// Muted this chat? Don't push.
	var muted bool
	if err := s.pool.QueryRow(ctx,
		`SELECT muted FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, recipientID).Scan(&muted); err != nil || muted {
		return
	}
	job := Job{RecipientID: recipientID, ChatID: chatID, MsgID: msgID, Seq: seq, SenderID: senderID, Text: text}
	payload, _ := json.Marshal(job)
	_ = s.rdb.XAdd(ctx, &redis.XAddArgs{Stream: QueueStream, Values: map[string]any{"job": payload}}).Err()
}
```

- [ ] **Step 2: Test (miniredis)**

Create `backend/internal/push/service_test.go`:
```go
package push

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/messenger-denis/backend/internal/store/postgres"
	"github.com/redis/go-redis/v9"
)

func setup(t *testing.T) (*Service, *miniredis.Miniredis, *redis.Client, int64, int64, int64) {
	t.Helper()
	pool := postgres.NewTestDB(t)
	mr, _ := miniredis.Run()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()
	var a, b, chatID int64
	_ = pool.QueryRow(ctx, `INSERT INTO users (phone, display_name) VALUES ('+700','+700') RETURNING id`).Scan(&a)
	_ = pool.QueryRow(ctx, `INSERT INTO users (phone, display_name) VALUES ('+701','+701') RETURNING id`).Scan(&b)
	_ = pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('private') RETURNING id`).Scan(&chatID)
	_, _ = pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2),($1,$3)`, chatID, a, b)
	return NewService(rdb, pool), mr, rdb, a, b, chatID
}

func streamLen(t *testing.T, rdb *redis.Client) int64 {
	n, _ := rdb.XLen(context.Background(), QueueStream).Result()
	return n
}

func TestService_EnqueuesWhenOffline(t *testing.T) {
	s, mr, rdb, a, b, chatID := setup(t)
	defer mr.Close()
	s.NotifyNewMessage(context.Background(), b, chatID, 10, 1, a, "hi")
	if streamLen(t, rdb) != 1 {
		t.Fatalf("expected 1 queued job, got %d", streamLen(t, rdb))
	}
}

func TestService_SkipsWhenOnline(t *testing.T) {
	s, mr, rdb, a, b, chatID := setup(t)
	defer mr.Close()
	mr.Set("presence:"+itoa(b), "1") // b is online
	s.NotifyNewMessage(context.Background(), b, chatID, 10, 1, a, "hi")
	if streamLen(t, rdb) != 0 {
		t.Fatalf("expected no queued job for online user, got %d", streamLen(t, rdb))
	}
}

func TestService_SkipsWhenMuted(t *testing.T) {
	s, mr, rdb, a, b, chatID := setup(t)
	defer mr.Close()
	_, _ = s.pool.Exec(context.Background(),
		`UPDATE chat_members SET muted=true WHERE chat_id=$1 AND user_id=$2`, chatID, b)
	s.NotifyNewMessage(context.Background(), b, chatID, 10, 1, a, "hi")
	if streamLen(t, rdb) != 0 {
		t.Fatalf("expected no queued job for muted chat, got %d", streamLen(t, rdb))
	}
}

func itoa(v int64) string { return strconvFormatInt(v) }
```
Add a tiny helper at the end of the file and the `strconv` import:
```go
func strconvFormatInt(v int64) string { return strconv.FormatInt(v, 10) }
```
(import `"strconv"`.)

- [ ] **Step 3: Run + commit**

Run: `cd backend && go test ./internal/push/ -run Service -v`
Expected: PASS.
```bash
git add backend/internal/push/service.go backend/internal/push/service_test.go
git commit -m "feat(backend): push service (online/mute gate + enqueue)"
```

---

### Task 4: Worker + webpush sender + HTTP endpoints + wiring

**Files:**
- Create: `backend/internal/push/worker.go`
- Create: `backend/internal/push/worker_test.go`
- Create: `backend/internal/push/webpush.go`
- Create: `backend/internal/transport/http/push_handler.go`
- Modify: `backend/internal/transport/http/router.go`
- Modify: `backend/cmd/server/main.go`
- Create: `backend/internal/transport/http/push_handler_test.go`

- [ ] **Step 1: Add the webpush dependency**

Run: `cd backend && go get github.com/SherClockHolmes/webpush-go@latest`

- [ ] **Step 2: Write the worker**

Create `backend/internal/push/worker.go`:
```go
package push

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const consumerGroup = "push-workers"

// Sender sends one encrypted Web Push. Returns the HTTP status from the push
// service (so the worker can prune 404/410).
type Sender interface {
	Send(ctx context.Context, sub Subscription, payload []byte) (status int, err error)
}

type Worker struct {
	rdb      *redis.Client
	pool     *pgxpool.Pool
	repo     *Repo
	sender   Sender
	consumer string
}

func NewWorker(rdb *redis.Client, pool *pgxpool.Pool, sender Sender) *Worker {
	return &Worker{rdb: rdb, pool: pool, repo: NewRepo(pool), sender: sender, consumer: "w1"}
}

// Run consumes the queue until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	_ = w.rdb.XGroupCreateMkStream(ctx, QueueStream, consumerGroup, "0").Err() // ignore BUSYGROUP
	for ctx.Err() == nil {
		if err := w.processBatch(ctx, 5*time.Second); err != nil && ctx.Err() == nil {
			time.Sleep(time.Second) // back off on transient errors
		}
	}
}

// processBatch reads and handles up to a few pending jobs. Exposed for tests.
func (w *Worker) processBatch(ctx context.Context, block time.Duration) error {
	res, err := w.rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group: consumerGroup, Consumer: w.consumer,
		Streams: []string{QueueStream, ">"}, Count: 10, Block: block,
	}).Result()
	if errors.Is(err, redis.Nil) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, stream := range res {
		for _, msg := range stream.Messages {
			w.handle(ctx, msg)
			w.rdb.XAck(ctx, QueueStream, consumerGroup, msg.ID)
		}
	}
	return nil
}

func (w *Worker) handle(ctx context.Context, msg redis.XMessage) {
	raw, _ := msg.Values["job"].(string)
	var job Job
	if json.Unmarshal([]byte(raw), &job) != nil {
		return
	}
	subs, err := w.repo.SubscriptionsForUser(ctx, job.RecipientID)
	if err != nil || len(subs) == 0 {
		return
	}
	payload, _ := json.Marshal(w.buildPayload(ctx, job))
	for _, sub := range subs {
		status, err := w.sender.Send(ctx, sub, payload)
		if err == nil && (status == http.StatusNotFound || status == http.StatusGone) {
			_ = w.repo.DeleteByEndpoint(ctx, sub.Endpoint)
		}
	}
}

// buildPayload enriches the job with sender name + unread badge for the client.
func (w *Worker) buildPayload(ctx context.Context, job Job) map[string]any {
	var senderName string
	_ = w.pool.QueryRow(ctx, `SELECT display_name FROM users WHERE id=$1`, job.SenderID).Scan(&senderName)
	var badge int
	if err := w.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(unread_count),0) FROM chat_members WHERE user_id=$1`,
		job.RecipientID).Scan(&badge); errors.Is(err, pgx.ErrNoRows) {
		badge = 0
	}
	return map[string]any{
		"chat_id": job.ChatID, "msg_id": job.MsgID, "seq": job.Seq,
		"sender": map[string]any{"name": senderName},
		"text":   job.Text, "badge": badge,
	}
}
```

- [ ] **Step 3: Worker test (fake sender + miniredis)**

Create `backend/internal/push/worker_test.go`:
```go
package push

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"
)

type fakeSender struct {
	mu     sync.Mutex
	sent   [][]byte
	status int
}

func (f *fakeSender) Send(_ context.Context, _ Subscription, payload []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, payload)
	if f.status == 0 {
		return http.StatusCreated, nil
	}
	return f.status, nil
}

func TestWorker_SendsAndPrunesGone(t *testing.T) {
	s, mr, rdb, a, b, chatID := setup(t)
	defer mr.Close()
	repo := NewRepo(s.pool)

	// Give b a device + subscription.
	var deviceID int64
	_ = s.pool.QueryRow(context.Background(), `INSERT INTO devices (user_id, token_hash) VALUES ($1,'hb') RETURNING id`, b).Scan(&deviceID)
	_ = repo.AddSubscription(context.Background(), deviceID, Subscription{Endpoint: "https://push/b", P256dh: "p", Auth: "x"})

	// Enqueue a job (b offline, not muted).
	s.NotifyNewMessage(context.Background(), b, chatID, 10, 1, a, "hello")

	sender := &fakeSender{status: http.StatusGone} // simulate expired subscription
	w := NewWorker(rdb, s.pool, sender)
	_ = rdb.XGroupCreateMkStream(context.Background(), QueueStream, consumerGroup, "0").Err()
	if err := w.processBatch(context.Background(), 100*time.Millisecond); err != nil {
		t.Fatalf("processBatch: %v", err)
	}

	sender.mu.Lock()
	n := len(sender.sent)
	sender.mu.Unlock()
	if n != 1 {
		t.Fatalf("expected 1 push sent, got %d", n)
	}
	// 410 Gone → subscription pruned.
	subs, _ := repo.SubscriptionsForUser(context.Background(), b)
	if len(subs) != 0 {
		t.Fatalf("expected subscription pruned after 410, got %d", len(subs))
	}
}
```

- [ ] **Step 4: webpush sender (prod)**

Create `backend/internal/push/webpush.go`:
```go
package push

import (
	"bytes"
	"context"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// WebPushSender sends notifications via the Web Push protocol (VAPID).
type WebPushSender struct {
	publicKey  string
	privateKey string
	subject    string
}

func NewWebPushSender(publicKey, privateKey, subject string) *WebPushSender {
	return &WebPushSender{publicKey: publicKey, privateKey: privateKey, subject: subject}
}

func (s *WebPushSender) Send(ctx context.Context, sub Subscription, payload []byte) (int, error) {
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		Subscriber:      s.subject,
		VAPIDPublicKey:  s.publicKey,
		VAPIDPrivateKey: s.privateKey,
		TTL:             60,
	})
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = bytes.NewBuffer(nil).ReadFrom(resp.Body)
	return resp.StatusCode, nil
}
```

- [ ] **Step 5: HTTP endpoints**

Create `backend/internal/transport/http/push_handler.go`:
```go
package http

import (
	"encoding/json"
	"net/http"

	"github.com/messenger-denis/backend/internal/push"
)

type PushHandler struct {
	repo      *push.Repo
	publicKey string
}

func NewPushHandler(repo *push.Repo, publicKey string) *PushHandler {
	return &PushHandler{repo: repo, publicKey: publicKey}
}

func (h *PushHandler) VAPIDPublicKey(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"public_key": h.publicKey})
}

type subscribeBody struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"`
	Auth     string `json:"auth"`
}

func (h *PushHandler) Subscribe(w http.ResponseWriter, r *http.Request) {
	deviceID, ok := DeviceIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	var body subscribeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" {
		writeError(w, http.StatusBadRequest, "endpoint, p256dh, auth required")
		return
	}
	if err := h.repo.AddSubscription(r.Context(), deviceID, push.Subscription{
		Endpoint: body.Endpoint, P256dh: body.P256dh, Auth: body.Auth,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not subscribe")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
```

- [ ] **Step 6: Mount routes + wire main**

(a) In `router.go`, add a `pushH *PushHandler` parameter (last) to `NewRouter`, and inside the protected group:
```go
		if pushH != nil {
			pr.Get("/push/vapid_public_key", pushH.VAPIDPublicKey)
			pr.Post("/push/subscribe", pushH.Subscribe)
		}
```
Update all `NewRouter(...)` callers (test helpers `newTestRouter`, `newMessagingRouter`, `newMediaRouter`) to pass `nil` for `pushH`.

(b) In `cmd/server/main.go`, after the Redis block (where `rdb` and `chatSvc` are available) and only when Redis is up and VAPID keys are set, build the push service + worker + handler:
```go
	var pushHandler *httptransport.PushHandler
	if redisOK && cfg.VAPIDPublicKey != "" && cfg.VAPIDPrivateKey != "" {
		pushSvc := push.NewService(rdb, pool)
		chatSvc.SetNotifier(pushSvc)
		sender := push.NewWebPushSender(cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey, cfg.VAPIDSubject)
		worker := push.NewWorker(rdb, pool, sender)
		go worker.Run(ctx)
		pushHandler = httptransport.NewPushHandler(push.NewRepo(pool), cfg.VAPIDPublicKey)
		log.Printf("web push enabled")
	} else {
		log.Printf("web push disabled (needs redis + VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)")
	}
```
To make `rdb` and a `redisOK` flag available outside the existing `if rdb, err := ...` block, refactor that block to assign to outer variables:
```go
	var rdb *redis.Client
	redisOK := false
	if c, err := redisstore.Connect(ctx, cfg.RedisURL); err != nil {
		log.Printf("redis unavailable, running without cache/realtime: %v", err)
	} else {
		rdb = c
		redisOK = true
		defer rdb.Close()
		// ... existing cache/publisher/presence/hub/wsHandler wiring ...
	}
```
Add the push handler as the new last arg to `httptransport.NewRouter(...)`. Add imports `"github.com/messenger-denis/backend/internal/push"` and `"github.com/redis/go-redis/v9"`.

- [ ] **Step 7: HTTP handler test**

Create `backend/internal/transport/http/push_handler_test.go`:
```go
package http

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/messaging"
	"github.com/messenger-denis/backend/internal/push"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestPush_SubscribeAndVAPID_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	authSvc := auth.NewService(auth.NewRepo(pool), "12345", func(string, ...any) {})
	chatSvc := messaging.NewService(pool)
	pushH := NewPushHandler(push.NewRepo(pool), "TEST_PUBLIC_KEY")
	h := NewRouter(authSvc, chatSvc, nil, nil, pushH)

	token, _ := signUp(t, h, pool, "+79990000050")

	rec := authedReq(t, h, http.MethodGet, "/push/vapid_public_key", token, nil)
	var key struct {
		PublicKey string `json:"public_key"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &key)
	if key.PublicKey != "TEST_PUBLIC_KEY" {
		t.Fatalf("vapid key = %q", key.PublicKey)
	}

	rec = authedReq(t, h, http.MethodPost, "/push/subscribe", token, map[string]string{
		"endpoint": "https://push/x", "p256dh": "p", "auth": "a",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("subscribe: %d %s", rec.Code, rec.Body.String())
	}
}
```
Note: this test constructs `NewRouter` with the new signature (5 handler args after the services). Ensure the existing `newTestRouter`/`newMessagingRouter`/`newMediaRouter` are updated to pass `nil` as the final `pushH` argument.

- [ ] **Step 8: Run + commit**

Run: `cd backend && go build ./... && go test ./internal/push/ -v && go test ./internal/transport/http/ -run 'Push_' -v && go test ./... && go vet ./...`
Expected: build clean; push + handler tests pass; whole suite green.
```bash
git add backend/internal/push/ backend/internal/transport/http/ backend/cmd/server/main.go backend/go.mod backend/go.sum
git commit -m "feat(backend): web push worker + sender + subscribe/vapid endpoints + wiring"
```

---

### Task 5: API docs + full-stack verification

**Files:**
- Modify: `backend/internal/openapi/openapi.yaml`
- Modify: `docs/contracts.md`

- [ ] **Step 1: Document the push endpoints in OpenAPI**

In `backend/internal/openapi/openapi.yaml`, add a `push` tag and these paths:
```yaml
  /push/vapid_public_key:
    get:
      tags: [push]
      summary: VAPID public key for the browser to subscribe with
      responses:
        "200":
          description: key
          content:
            application/json:
              schema: { type: object, properties: { public_key: { type: string } } }
  /push/subscribe:
    post:
      tags: [push]
      summary: Register the current device's Web Push subscription
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [endpoint, p256dh, auth]
              properties:
                endpoint: { type: string }
                p256dh: { type: string }
                auth: { type: string }
      responses:
        "200": { description: ok, content: { application/json: { schema: { $ref: "#/components/schemas/OK" } } } }
        "400": { description: missing fields, content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } } }
```

- [ ] **Step 2: Document push in contracts.md**

Add a "Web Push" section to `docs/contracts.md`:
```markdown
## Web Push

Push is sent only when a recipient has **no active WebSocket** and has **not muted**
the chat. Subscriptions are per device.

### GET /push/vapid_public_key · auth
- 200: `{ "public_key": "<base64 VAPID public key>" }`

### POST /push/subscribe · auth
Register the current device's browser push subscription.
- Request: `{ "endpoint": "https://fcm…", "p256dh": "<key>", "auth": "<key>" }`
- 200: `{ "ok": true }` · 400 missing fields

### Push payload (delivered to the Service Worker)
```json
{ "chat_id": 1, "msg_id": 10, "seq": 5,
  "sender": { "name": "Alice" }, "text": "hello", "badge": 3 }
```
The Service Worker checks for an active window, muted state, and passcode lock
before showing the notification; clicking it focuses/opens the chat.
```

- [ ] **Step 3: Whole suite + vet**

Run: `cd backend && go test ./... && go vet ./...`
Expected: all PASS, vet clean.

- [ ] **Step 4: End-to-end over docker (generate VAPID keys, subscribe, enqueue)**

```bash
# Generate a VAPID keypair for the test (using the webpush-go helper via a tiny program is ideal;
# for the smoke test, any valid pair works). If you have `npx web-push generate-vapid-keys`, use it.
# Otherwise this smoke focuses on: push enabled, subscribe ok, and (offline send) a job enqueued.
cat > /tmp/plan-d2-stack.yml <<'EOF'
name: plan-d2-verify
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
      VAPID_PUBLIC_KEY: "BFakePublicKeyForSmokeTestOnly_replace_with_real"
      VAPID_PRIVATE_KEY: "fakePrivateKeyForSmokeTestOnly"
    depends_on:
      pg: {condition: service_healthy}
      redis: {condition: service_healthy}
    ports: ["18089:8080"]
EOF
docker compose -f /tmp/plan-d2-stack.yml up -d --build
sleep 6
docker compose -f /tmp/plan-d2-stack.yml logs backend | grep -i "web push"
B="localhost:18089"
curl -s -X POST $B/auth/request_code -d '{"phone":"+700"}' >/dev/null
TOK=$(curl -s -X POST $B/auth/sign_in -d '{"phone":"+700","code":"12345"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
echo "vapid:     $(curl -s $B/push/vapid_public_key -H "Authorization: Bearer $TOK")"
echo "subscribe: $(curl -s -X POST $B/push/subscribe -H "Authorization: Bearer $TOK" -d '{"endpoint":"https://push/x","p256dh":"p","auth":"a"}')"
docker compose -f /tmp/plan-d2-stack.yml down -v
```
Expected: log "web push enabled"; vapid returns the public key; subscribe returns `{"ok":true}`. (Actual push delivery to a browser requires real VAPID keys + a browser; the worker job-processing path is covered by `TestWorker_SendsAndPrunesGone`.)

- [ ] **Step 5: Commit**

```bash
git add backend/internal/openapi/openapi.yaml docs/contracts.md
git commit -m "docs(backend): document web push endpoints (OpenAPI + contracts.md)"
```

---

## Self-Review Notes

- **Spec coverage:** §11a — `push_subscriptions` per device; push only when recipient offline (presence check) and not muted; Redis Stream queue + worker; payload `{chat_id,msg_id,seq,sender,text,badge}`; prune 404/410. VAPID public key + subscribe endpoints. Docs updated (OpenAPI + contracts.md).
- **Out of scope (later):** APNs/FCM for native mobile (same queue, different sender); `@mention` overriding mute; preview-hiding (`nopreview`) setting; per-chat snooze. The Sender interface makes adding APNs/FCM a new implementation, not a rewrite.
- **Non-blocking:** `Send` calls `notifier.NotifyNewMessage` synchronously but it is cheap (one Redis EXISTS + one row read + one XADD); delivery isn't blocked on actual push sending (that's the worker, off the request path). The notifier never returns an error to `Send`.
- **At-least-once:** the worker uses a Redis consumer group with XACK; a crash mid-send may redeliver (a duplicate push), which is acceptable. The `tag: chat_id` in the SW collapses duplicates.
- **Nil-safety:** push routes/worker only wired when Redis is up AND VAPID keys are set; otherwise the server runs without push (notifier stays nil → `Send` pushes nothing).
- **Type consistency:** `push.Repo`/`Subscription`/`Service`/`Job`/`Worker`/`Sender`/`WebPushSender`, `QueueStream`, `messaging.Notifier`/`SetNotifier`, `NewRouter(authSvc, chatSvc, wsHandler, mediaH, pushH)` updated across router/main/all test helpers, `NewPushHandler`/`VAPIDPublicKey`/`Subscribe`.
```
