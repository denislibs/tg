# Clean Arch Slice 5 — Web Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox (`- [ ]`) steps.

**Goal:** Migrate Web Push to Clean Architecture: `usecase/push` (a `Notifier` implementing the chat `PushNotifier` port, and a `Worker`) depending on ports (`SubRepo, Queue, Sender, OnlineChecker, MuteChecker, Enricher`); adapters for postgres (subscriptions + enrichment + mute), redis (the Streams queue), and webpush (sender). Rewire the push handler + fx. Delete legacy `internal/push`. Behavior/API/suite unchanged.

**Architecture:** Slice 5. `push.Service.NotifyNewMessage` (presence+mute gate → enqueue) → `usecase/push.Notifier`; `push.Worker` (consume → enrich → send → prune 410) → `usecase/push.Worker`. The online check reuses the realtime `PresenceStore.IsOnline` (it satisfies `OnlineChecker`); mute + sender-name + unread-badge + subscriptions are postgres adapters; the queue is a redis-Streams adapter; the sender is the webpush adapter.

**Tech Stack:** Go, fx, go-redis (Streams), pgx, SherClockHolmes/webpush-go, miniredis/testcontainers.

---

## File Structure
```
backend/
  internal/domain/push.go              — PushSubscription
  internal/usecase/push/
    ports.go    — SubRepo, Queue, Sender, OnlineChecker, MuteChecker, Enricher; Job; QueuedJob
    notifier.go — Notifier (implements chat.PushNotifier): NotifyNewMessage
    worker.go   — Worker: Run, ProcessBatch, handle, buildPayload
    *_test.go   — fakes
  internal/adapter/repo/postgres/pushrepo.go (+test)  — SubRepo + MuteChecker + Enricher
  internal/adapter/queue/redis/pushqueue.go (+test)   — Queue (XAdd/XReadGroup/XAck)
  internal/adapter/push/webpush/sender.go (+test)     — Sender (moved from internal/push/webpush.go)
  internal/transport/http/push_handler.go — MODIFY: use usecasepush.SubRepo + vapid key
  internal/app/providers.go, server.go    — MODIFY
  DELETE: internal/push/
```

---

### Task 1: domain + usecase/push ports

**Files:** Create `internal/domain/push.go`; `internal/usecase/push/ports.go`.

- [ ] **Step 1: domain.PushSubscription**
```go
package domain

type PushSubscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}
```

- [ ] **Step 2: ports**

`internal/usecase/push/ports.go`:
```go
// Package push is the web-push application logic (notifier + worker + ports).
package push

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

const QueueStream = "push:queue"

// Job is enqueued on a new message for an offline, non-muted recipient.
type Job struct {
	RecipientID int64  `json:"recipient_id"`
	ChatID      int64  `json:"chat_id"`
	MsgID       int64  `json:"msg_id"`
	Seq         int64  `json:"seq"`
	SenderID    int64  `json:"sender_id"`
	Text        string `json:"text"`
}

// QueuedJob is a Job plus its queue id (for ack).
type QueuedJob struct {
	ID  string
	Job Job
}

type SubRepo interface {
	Add(ctx context.Context, deviceID int64, s domain.PushSubscription) error
	ForUser(ctx context.Context, userID int64) ([]domain.PushSubscription, error)
	DeleteByEndpoint(ctx context.Context, endpoint string) error
}

type Queue interface {
	Enqueue(ctx context.Context, j Job) error
	Consume(ctx context.Context, max int, blockMS int) ([]QueuedJob, error) // empty slice if none
	Ack(ctx context.Context, id string) error
}

// Sender sends one encrypted push; returns the HTTP status (for 404/410 pruning).
type Sender interface {
	Send(ctx context.Context, sub domain.PushSubscription, payload []byte) (status int, err error)
}

type OnlineChecker interface {
	IsOnline(ctx context.Context, userID int64) (bool, error)
}

type MuteChecker interface {
	IsMuted(ctx context.Context, chatID, userID int64) (bool, error) // also false if not a member
}

type Enricher interface {
	SenderName(ctx context.Context, userID int64) (string, error)
	UnreadBadge(ctx context.Context, userID int64) (int, error)
}
```

- [ ] **Step 3: Build + commit**

Run: `cd backend && go build ./internal/domain/ ./internal/usecase/push/`
```bash
git add backend/internal/domain/push.go backend/internal/usecase/push/ports.go && git commit -m "feat(backend): domain.PushSubscription + push usecase ports"
```

---

### Task 2: usecase/push notifier + worker

**Files:** Create `internal/usecase/push/{notifier.go,worker.go,notifier_test.go,worker_test.go}`.

- [ ] **Step 1: Notifier** — `notifier.go`: `Notifier{online OnlineChecker; mute MuteChecker; queue Queue}`, `NewNotifier(online, mute, queue)`. `NotifyNewMessage(ctx, recipientID, chatID, msgID, seq, senderID int64, text string)` ports `push.Service.NotifyNewMessage`: if `online.IsOnline` → return; if `mute.IsMuted` (or err) → return; else `queue.Enqueue(Job{...})`. (Implements `usecasechat.PushNotifier`.)

- [ ] **Step 2: Worker** — `worker.go`: `Worker{queue Queue; subs SubRepo; sender Sender; enrich Enricher}`, `NewWorker(...)`. `Run(ctx)` loops `ProcessBatch`; `ProcessBatch(ctx)` calls `queue.Consume`, for each job `handle` then `queue.Ack` only when handle returns true (ack poison/done, not transient). `handle` ports `push.Worker.handle` (load subs; if err→false; if none→true; build payload; send each; prune 404/410; true). `buildPayload` uses `enrich.SenderName` + `enrich.UnreadBadge` → the same `{chat_id,msg_id,seq,sender:{name},text,badge}` map.

- [ ] **Step 3: Unit tests (fakes)** — fakes for all ports (in-memory queue slice, fake sender with settable status, fake subs/enricher/online/mute). Port behaviors: NotifyNewMessage enqueues when offline+unmuted, skips when online, skips when muted; Worker sends to subs + prunes on 410 + acks (queue empties); transient sub-load error → not acked.

- [ ] **Step 4: Run + commit**

Run: `cd backend && go test ./internal/usecase/push/ -v` → PASS (no Docker).
```bash
git add backend/internal/usecase/push/ && git commit -m "feat(backend): push notifier + worker usecase + fakes"
```

---

### Task 3: adapters (postgres + redis queue + webpush)

**Files:** Create `internal/adapter/repo/postgres/pushrepo.go` (+test), `internal/adapter/queue/redis/pushqueue.go` (+test), `internal/adapter/push/webpush/sender.go` (+test).

- [ ] **Step 1: postgres pushrepo** — `package postgres`, one struct (or three) implementing `usecasepush.SubRepo` (Add/ForUser/DeleteByEndpoint — SQL ported from `internal/push/repo.go`, note the `ON CONFLICT (endpoint) DO UPDATE SET p256dh,auth` keeping device_id), `usecasepush.MuteChecker` (`SELECT muted FROM chat_members WHERE chat_id=$1 AND user_id=$2`; not-found→false), and `usecasepush.Enricher` (`SELECT display_name FROM users WHERE id=$1`; `SELECT COALESCE(SUM(unread_count),0) FROM chat_members WHERE user_id=$1`). Map to `domain.PushSubscription`. Constructor `NewPushRepo(pool)`. Use `querier(ctx, pool)`.

- [ ] **Step 2: postgres test** — testcontainers: subscription lifecycle (add/upsert/forUser/delete), IsMuted true/false, SenderName + UnreadBadge.

- [ ] **Step 3: redis queue** — `internal/adapter/queue/redis/pushqueue.go` `package redis` (go-redis aliased `goredis`): `Queue` over `*goredis.Client` implementing `usecasepush.Queue` using the Stream `usecasepush.QueueStream` + consumer group `push-workers`. `Enqueue`=XAdd `{job: json}`; `Consume`=ensure-group then `XReadGroup` (Count=max, Block=blockMS) → `[]QueuedJob` (parse `job`); `Ack`=XAck. Port the consumer-group + parse logic from `internal/push/worker.go`. `NewQueue(rdb)`.

- [ ] **Step 4: redis queue test** — miniredis: enqueue → consume returns the job → ack → XPending count 0.

- [ ] **Step 5: webpush sender** — `internal/adapter/push/webpush/sender.go` `package webpush`: move `internal/push/webpush.go`'s `WebPushSender` (Send via `webpush.SendNotificationWithContext`, `io.Copy(io.Discard,...)`) implementing `usecasepush.Sender` with `domain.PushSubscription`. `NewSender(pub, priv, subject)`. (No live test; a compile-time `var _ usecasepush.Sender` assertion is enough — keep any trivial existing test or omit.)

- [ ] **Step 6: Run + commit**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run Push -v && go test ./internal/adapter/queue/redis/ -v && go build ./internal/adapter/push/webpush/`
```bash
git add backend/internal/adapter/ && git commit -m "feat(backend): postgres push repo/mute/enricher + redis queue + webpush sender adapters"
```

---

### Task 4: Rewire handler + fx + delete legacy + verify

**Files:** Modify `transport/http/push_handler.go`, `internal/app/{providers.go,server.go}`; delete `internal/push`; fix `push_handler_test.go`.

- [ ] **Step 1: push handler** — `PushHandler{subs usecasepush.SubRepo; publicKey string}`; `NewPushHandler(subs usecasepush.SubRepo, publicKey string)`. `VAPIDPublicKey` returns the key; `Subscribe` validates endpoint/p256dh/auth then `subs.Add(deviceID, domain.PushSubscription{...})`. Responses identical.

- [ ] **Step 2: fx** — providers: `providePushRepo(pool) *pgadapter.PushRepo`. In `server.go` push block (when `redisOK && VAPID set`):
```go
pushRepo := pgadapter.NewPushRepo(p.Pool)
queue := queueredis.NewQueue(p.Redis.Client)
notifier := usecasepush.NewNotifier(rtredis.NewPresenceStore(p.Redis.Client), pushRepo, queue)
p.ChatUC.SetNotifier(notifier)
sender := webpushadapter.NewSender(p.Cfg.VAPIDPublicKey, p.Cfg.VAPIDPrivateKey, p.Cfg.VAPIDSubject)
worker := usecasepush.NewWorker(queue, pushRepo, sender, pushRepo) // pushRepo is also the Enricher
p.LC.Append(fx.Hook{OnStart: func(context.Context) error { go worker.Run(p.Ctx); return nil }})
pushHandler = httptransport.NewPushHandler(pushRepo, p.Cfg.VAPIDPublicKey)
```
(`PresenceStore` satisfies `OnlineChecker`; `pushRepo` satisfies `SubRepo`+`MuteChecker`+`Enricher`.) Imports: `usecasepush`, `queueredis "...adapter/queue/redis"`, `webpushadapter "...adapter/push/webpush"`, `rtredis` (already imported).

- [ ] **Step 3: Delete legacy + fix tests**

```bash
cd backend && rm -rf internal/push
```
Fix `transport/http/push_handler_test.go`: build `NewPushHandler(pgadapter.NewPushRepo(pool), "TEST_PUBLIC_KEY")`. Replace `push.*` types. Behavioral assertions unchanged.

- [ ] **Step 4: Whole suite + vet**

Run: `cd backend && go build ./... && go test ./... -count=1 && go vet ./...`
Expected green; `grep -rn "messenger-denis/backend/internal/push\b" backend --include='*.go'` empty (the new homes are `usecase/push` + `adapter/...`).

- [ ] **Step 5: Docker e2e** — pg+redis stack with VAPID keys set: boot logs "web push enabled"; `/push/vapid_public_key` returns key; `/push/subscribe` → ok. (Worker job path covered by the usecase worker test.)

- [ ] **Step 6: Commit**
```bash
git add -A backend/ && git commit -m "refactor(backend): web push on Clean Architecture; delete legacy push"
```

---

## Self-Review Notes

- **Spec coverage:** domain.PushSubscription (§3); push usecase (notifier+worker) + ports (§3); postgres/redis-queue/webpush adapters (§3); handler + fx rewired (§5); legacy deleted, suite green (§6 Slice 5).
- **Behavior unchanged:** notifier gate (online→skip, muted→skip, else enqueue) + worker (consume, enrich sender-name/badge, send, prune 404/410, ack-on-success) are faithful ports; payload `{chat_id,msg_id,seq,sender:{name},text,badge}` identical; subscribe/vapid responses identical; contract docs untouched.
- **Port reuse:** `OnlineChecker` is the realtime `PresenceStore.IsOnline` (no duplicate presence logic); `pushRepo` implements three ports (SubRepo+MuteChecker+Enricher) — acceptable cohesion (all push-support queries over the same tables), not speculative.
- **Worker lifecycle:** started via fx `OnStart` on the app context (cancelled on shutdown), same as before; at-least-once via consumer-group + ack-on-success.
- **Type consistency:** `usecasepush.{Notifier,Worker,SubRepo,Queue,Sender,OnlineChecker,MuteChecker,Enricher,Job,QueuedJob,QueueStream}`, `pgadapter.NewPushRepo`, `queueredis.NewQueue`, `webpushadapter.NewSender`, `rtredis.NewPresenceStore`, `NewPushHandler(subs, publicKey)` consistent.
```
