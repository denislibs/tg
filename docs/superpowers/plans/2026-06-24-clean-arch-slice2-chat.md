# Clean Arch Slice 2 — Chat / Message / Sync / Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the entire `internal/messaging` package (chats, messages, history, sync/pts, reactions, presence-partners, media-access) to Clean Architecture: domain entities, a `usecase/chat` interactor depending only on ports (incl. a `TxManager` for transactions), postgres adapters, and rewired delivery (HTTP chat/media handlers, WS conn) + fx. Legacy `internal/messaging` is deleted. Behavior, API, and the suite stay green.

**Architecture:** Slice 2 of the refactor. The novel piece is transactions without leaking pgx into the usecase: a `TxManager` port (`WithinTx(ctx, fn)`) whose adapter begins a pgx tx and stashes it in the context; repo adapters use a `querier(ctx)` helper that returns the ctx tx or the pool. Repo port methods take only `ctx` (no pgx `Querier`). `realtime.RedisPublisher` satisfies the usecase `EventPublisher` port; `push.Service` satisfies the `PushNotifier` port (both structurally — unchanged). `presence.Manager` already takes `chatSvc.ChatPartners`; it will take the usecase's `ChatPartners` method instead.

**Tech Stack:** Go, fx, pgx, go-redis, chi, gorilla/ws, testcontainers/miniredis.

> Other features (auth already migrated; media upload/download, push internals) stay on their current code this slice; only the messaging.Service surface moves. `transport/http` + `transport/ws` remain the delivery packages (relocated in the final slice).

---

## File Structure

```
backend/
  internal/domain/
    chat.go     — Chat, ChatMember, Dialog
    message.go  — Message
    update.go   — Update, UserState
    reaction.go — ReactionCount
    errors.go   — ADD ErrBadReaction
  internal/usecase/chat/
    ports.go    — ChatRepo, MessageRepo, UpdateRepo, ReactionRepo, MediaAccessRepo, TxManager, EventPublisher, PushNotifier; DTOs Difference, HistoryResult, SendInput
    chat.go     — Interactor: CreatePrivateChat, ListDialogs, ChatPartners
    message.go  — Send, MarkRead, GetHistory, Typing  (transactional via TxManager)
    sync.go     — GetDifference
    reaction.go — React, ReactionsOf, CanAccessMedia
    frame.go    — frame(t, d) []byte + payload builders
    *_test.go   — unit tests with fake ports (ported from messaging/*_test.go)
  internal/adapter/repo/postgres/
    tx.go         — TxManager (ctx tx) + querier(ctx) helper
    chatsrepo.go  messagesrepo.go  updatesrepo.go  reactionsrepo.go  mediaaccessrepo.go
    *_test.go     — testcontainers (ported)
  internal/transport/http/
    chat_handler.go, media_handler.go, router.go — MODIFY: use *usecasechat.Interactor
  internal/transport/ws/
    conn.go, handler.go — MODIFY: use *usecasechat.Interactor
  internal/app/providers.go, server.go — MODIFY
  DELETE: internal/messaging/ (whole package)
```

---

### Task 1: domain entities + error

**Files:** Create `backend/internal/domain/{chat.go,message.go,update.go,reaction.go}`; modify `errors.go`.

- [ ] **Step 1: Entities**

`chat.go`:
```go
package domain

import "time"

type Chat struct {
	ID      int64
	Type    string // private | group | channel | saved
	LastSeq int64
}

type ChatMember struct {
	ChatID, UserID int64
	Role           string
	LastReadSeq    int64
	UnreadCount    int
	Muted          bool
}

// Dialog is a chat-list read model: a chat + the viewer's read state + last message.
type Dialog struct {
	ChatID       int64
	Type         string
	LastReadSeq  int64
	UnreadCount  int
	Muted        bool
	HasLast      bool
	LastSeq      int64
	LastText     string
	LastSenderID int64
	LastAt       time.Time
}
```
`message.go`:
```go
package domain

import "time"

type Message struct {
	ID          int64
	ChatID      int64
	Seq         int64
	SenderID    int64
	Type        string
	Text        string
	ReplyToID   *int64
	MediaID     *int64
	ClientMsgID *string
	CreatedAt   time.Time
	Deleted     bool
}
```
`update.go`:
```go
package domain

import "encoding/json"

type Update struct {
	Pts      int64
	PtsCount int
	Type     string
	Payload  json.RawMessage
}

type UserState struct {
	Pts  int64 `json:"pts"`
	Date int64 `json:"date"`
}
```
`reaction.go`:
```go
package domain

type ReactionCount struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
}
```
- [ ] **Step 2: Error** — append to `errors.go`: `ErrBadReaction = errors.New("invalid reaction")`.

- [ ] **Step 3: Build + commit**

Run: `cd backend && go build ./internal/domain/`
```bash
git add backend/internal/domain/ && git commit -m "feat(backend): domain chat/message/update/reaction entities"
```

---

### Task 2: usecase/chat — ports

**Files:** Create `backend/internal/usecase/chat/ports.go`.

- [ ] **Step 1: Ports + DTOs**

`backend/internal/usecase/chat/ports.go`:
```go
// Package chat is the chat/message/sync/reactions application logic.
package chat

import (
	"context"
	"encoding/json"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// TxManager runs fn inside a transaction; the tx is carried in the returned ctx
// (repo adapters pick it up). Keeps pgx out of the usecase.
type TxManager interface {
	WithinTx(ctx context.Context, fn func(ctx context.Context) error) error
}

type ChatRepo interface {
	FindPrivate(ctx context.Context, a, b int64) (int64, error) // domain.ErrNotFound if none
	CreatePrivate(ctx context.Context, a, b int64) (int64, error)
	MemberIDs(ctx context.Context, chatID int64) ([]int64, error)
	IsMember(ctx context.Context, chatID, userID int64) (bool, error)
	ListDialogs(ctx context.Context, userID int64) ([]domain.Dialog, error)
	ChatPartners(ctx context.Context, userID int64) ([]int64, error)
	IncUnread(ctx context.Context, chatID, userID int64) error
	CurrentReadSeq(ctx context.Context, chatID, userID int64) (int64, error)
	SetRead(ctx context.Context, chatID, userID, seq int64, unread int) error
}

type MessageRepo interface {
	NextSeq(ctx context.Context, chatID int64) (int64, error)
	Insert(ctx context.Context, m domain.Message) (domain.Message, error)
	FindByClientMsgID(ctx context.Context, chatID, senderID int64, clientMsgID string) (domain.Message, error)
	GetHistory(ctx context.Context, chatID, offsetSeq int64, addOffset, limit int) ([]domain.Message, error)
	CountMessages(ctx context.Context, chatID int64) (int, error)
	CountUnread(ctx context.Context, chatID, userID, afterSeq int64) (int, error)
	MessageChatID(ctx context.Context, messageID int64) (int64, error)
}

type UpdateRepo interface {
	AppendUpdate(ctx context.Context, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error)
	GetUserState(ctx context.Context, userID int64) (domain.UserState, error)
	UpdatesSince(ctx context.Context, userID, sincePts int64, limit int) ([]domain.Update, error)
}

type ReactionRepo interface {
	Add(ctx context.Context, messageID, userID int64, emoji string) error
	Remove(ctx context.Context, messageID, userID int64, emoji string) error
	ReactionsFor(ctx context.Context, messageID int64) ([]domain.ReactionCount, error)
}

type MediaAccessRepo interface {
	OwnerID(ctx context.Context, mediaID int64) (int64, error) // domain.ErrNotFound if absent
	CanAccess(ctx context.Context, userID, mediaID int64) (bool, error)
}

type EventPublisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

type PushNotifier interface {
	NotifyNewMessage(ctx context.Context, recipientID, chatID, msgID, seq, senderID int64, text string)
}

// --- DTOs ---

type SendInput struct {
	ChatID, SenderID int64
	Type, Text       string
	ReplyToID        *int64
	ClientMsgID      string
	MediaID          *int64
}

type HistoryResult struct {
	Messages []domain.Message
	Count    int
}

type Difference struct {
	NewMessages  []json.RawMessage `json:"new_messages"`
	OtherUpdates []json.RawMessage `json:"other_updates"`
	State        domain.UserState  `json:"state"`
	Slice        bool              `json:"slice"`
	TooLong      bool              `json:"too_long"`
}

const (
	syncLimit        = 500
	tooLongThreshold = 2000
	maxEmojiLen      = 32
	presenceTTL      = 35 * time.Second // (kept here only if needed; presence stays in its package)
)
```

- [ ] **Step 2: Build + commit**

Run: `cd backend && go build ./internal/usecase/chat/`
```bash
git add backend/internal/usecase/chat/ports.go && git commit -m "feat(backend): chat usecase ports + DTOs"
```

---

### Task 3: usecase/chat — interactor (port logic)

**Files:** Create `chat.go, message.go, sync.go, reaction.go, frame.go` in `internal/usecase/chat/` + `*_test.go`.

- [ ] **Step 1: Interactor struct + frame helper**

`frame.go`: `frame(t string, d any) []byte` (JSON `{t,d}`, port from messaging) + `messageUpdatePayload(domain.Message) map[string]any` (chat_id,msg_id,seq,sender_id,type,text,media_id,created_at) + `reactionPayload(...)`.

`chat.go`: `Interactor` struct holding all ports + optional `publisher EventPublisher` and `notifier PushNotifier` (with `SetPublisher`/`SetNotifier`). Constructor `New(tx TxManager, chats ChatRepo, msgs MessageRepo, updates UpdateRepo, reactions ReactionRepo, mediaAccess MediaAccessRepo) *Interactor`. Methods `CreatePrivateChat`, `ListDialogs`, `ChatPartners` (port the logic from messaging `service.go`; `CreatePrivateChat` keeps the advisory-lock re-check inside `tx.WithinTx`).

- [ ] **Step 2: message.go** — `Send`, `MarkRead`, `GetHistory`, `Typing` ported from messaging `message_service.go` + `sync_service.go` (GetHistory). Transactions via `i.tx.WithinTx(ctx, func(ctx) error { ... })`; repos called with that ctx. Post-commit publish/notify as today. Media-ownership check in `Send` uses `mediaAccess.OwnerID`; map `domain.ErrNotFound`. Keep the `slices.Sort(members)`, GREATEST read marker, idempotency, `advanced` guard exactly as in the current code.

- [ ] **Step 3: sync.go** — `GetDifference` ported from messaging `sync_service.go` (clamp negative pts, slice/too_long, split new_message vs other).

- [ ] **Step 4: reaction.go** — `React`, `ReactionsOf`, `CanAccessMedia` ported from messaging `reactions_service.go` (emoji validation → `domain.ErrBadReaction`; membership/chat checks → `domain.ErrNotFound`; build reaction payload once; CanAccessMedia delegates to `mediaAccess.CanAccess`).

- [ ] **Step 5: Unit tests with fakes** — `*_test.go` with in-memory fake ports (incl. a fake `TxManager` whose `WithinTx` just calls `fn(ctx)`) + fake publisher/notifier. Port the behavioral tests from messaging: fan-out + unread, idempotency, MarkRead (incl. out-of-order no-regress), GetDifference, history window + non-member, React fan-out/aggregate/rejects, Typing to others, notifier called for non-sender, CreatePrivateChat idempotent, ChatPartners. No DB.

- [ ] **Step 6: Run + commit**

Run: `cd backend && go test ./internal/usecase/chat/ -v`
Expected: PASS (no Docker).
```bash
git add backend/internal/usecase/chat/ && git commit -m "feat(backend): chat usecase interactor + fake-driven unit tests"
```

---

### Task 4: postgres adapters (tx + repos)

**Files:** Create `tx.go, chatsrepo.go, messagesrepo.go, updatesrepo.go, reactionsrepo.go, mediaaccessrepo.go` + tests in `internal/adapter/repo/postgres/`.

- [ ] **Step 1: TxManager + querier helper**

`tx.go` (`package postgres`):
```go
package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ctxKey int

const txKey ctxKey = 0

// Querier is satisfied by *pgxpool.Pool and pgx.Tx.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconnCommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// TxManager begins a pgx transaction and carries it in the context.
type TxManager struct{ pool *pgxpool.Pool }

func NewTxManager(pool *pgxpool.Pool) *TxManager { return &TxManager{pool: pool} }

func (m *TxManager) WithinTx(ctx context.Context, fn func(context.Context) error) error {
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(context.WithValue(ctx, txKey, tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
```
Add a `querier(ctx, pool)` helper returning the ctx tx if present else the pool. Use the real pgconn type: import `github.com/jackc/pgx/v5/pgconn` and alias the CommandTag (replace `pgconnCommandTag` with `pgconn.CommandTag`). Put the helper in `tx.go`:
```go
func querier(ctx context.Context, pool *pgxpool.Pool) Querier {
	if tx, ok := ctx.Value(txKey).(pgx.Tx); ok {
		return tx
	}
	return pool
}
```

- [ ] **Step 2: Repos** — each repo struct holds `*pgxpool.Pool`; every method does `q := querier(ctx, r.pool)` then runs the SQL (ported verbatim from the matching `messaging/*_repo.go`), mapping rows to `domain.*` and `pgx.ErrNoRows`→`domain.ErrNotFound`. Implement the port methods from Task 2:
  - `ChatsRepo`: FindPrivate, CreatePrivate, MemberIDs, IsMember, ListDialogs (→`domain.Dialog`), ChatPartners, IncUnread (`UPDATE chat_members SET unread_count=unread_count+1 …`), CurrentReadSeq (`SELECT last_read_seq …`), SetRead (`UPDATE … SET last_read_seq=$3, unread_count=$4`). CreatePrivate keeps the `pg_advisory_xact_lock(hashtext(...))` (it runs inside a tx provided by TxManager).
  - `MessagesRepo`: NextSeq, Insert (incl. media_id), FindByClientMsgID, GetHistory, CountMessages, CountUnread, MessageChatID (from GetMessageMeta).
  - `UpdatesRepo`: AppendUpdate, GetUserState, UpdatesSince.
  - `ReactionsRepo`: Add, Remove, ReactionsFor.
  - `MediaAccessRepo`: OwnerID (`SELECT owner_id FROM media WHERE id=$1`), CanAccess (the `EXISTS(owner OR shares-chat-with-message)` query from messaging).
  Constructors `NewChatsRepo(pool)`, etc.

- [ ] **Step 3: Tests** — testcontainers tests porting the existing `messaging/*_repo_test.go` behaviors (seq/insert/history, reactions aggregate, updates pts, dialogs, partners, media access). For tx-spanning behavior, exercise via a `NewTxManager(pool).WithinTx`. Seed users/chats with small inline SQL helpers.

- [ ] **Step 4: Run + commit**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -v`
Expected: PASS.
```bash
git add backend/internal/adapter/repo/postgres/ && git commit -m "feat(backend): postgres chat/message/update/reaction/media-access repos + TxManager"
```

---

### Task 5: Rewire delivery (http + ws) to the chat usecase

**Files:** Modify `transport/http/{chat_handler.go,media_handler.go,router.go}`, `transport/ws/{conn.go,handler.go}`.

- [ ] **Step 1: chat_handler.go** — `ChatHandler` holds `*usecasechat.Interactor`; all handlers (CreatePrivate, ListDialogs, Send, History, Read, Sync, AddReaction, RemoveReaction, ListReactions) call it. `messageJSON` maps `domain.Message`. Dialog/Difference/ReactionCount JSON identical. Error mapping: `domain.ErrNotFound`→ existing 403/404 per route, `domain.ErrBadReaction`→400.

- [ ] **Step 2: media_handler.go** — `MediaHandler.access` field type becomes the chat usecase (or keep a local `MediaAccess` interface `CanAccessMedia(ctx,userID,mediaID)(bool,error)` satisfied by `*usecasechat.Interactor`). The media *service* is unchanged (slice 4); only the access-checker source changes.

- [ ] **Step 3: ws conn.go + handler.go** — `Conn.svc` and `Handler.chatSvc` become `*usecasechat.Interactor`; `dispatch` calls `svc.Send/MarkRead/Typing`; `Presence` interface unchanged. `SendInput` is now `usecasechat.SendInput`.

- [ ] **Step 4: router.go** — `NewRouter(authUC *usecaseauth.Interactor, chatUC *usecasechat.Interactor, wsHandler http.Handler, mediaH *MediaHandler, pushH *PushHandler)`. Update `NewChatHandler(chatUC)`. Build.

- [ ] **Step 5: Build** — `cd backend && go build ./...` (app + tests still broken until Tasks 6–7; transport compiles).
```bash
git add backend/internal/transport/ && git commit -m "feat(backend): rewire http/ws delivery to chat usecase"
```

---

### Task 6: Rewire fx + presence + delete legacy + tests + verify

**Files:** Modify `internal/app/{providers.go,server.go}`, `internal/presence/manager.go` (only its `partners` source), test helpers; delete `internal/messaging/`.

- [ ] **Step 1: fx providers** — provide the repos (`NewChatsRepo`/`NewMessagesRepo`/`NewUpdatesRepo`/`NewReactionsRepo`/`NewMediaAccessRepo`/`NewTxManager`) and `provideChatUsecase` = `usecasechat.New(tx, chats, msgs, updates, reactions, mediaAccess)`. Remove `provideChatService`.

- [ ] **Step 2: server.go** — `p.ChatSvc` → `p.ChatUC *usecasechat.Interactor`. `p.ChatUC.SetPublisher(publisher)` (realtime publisher satisfies `usecasechat.EventPublisher`), `p.ChatUC.SetNotifier(pushSvc)` (push.Service satisfies `usecasechat.PushNotifier`), `presence.NewManager(rdb, publisher, p.ChatUC.ChatPartners, 35*time.Second)`, `ws.NewHandler(hub, p.AuthUC, p.ChatUC, presenceMgr)`, media handler access = `p.ChatUC`, `NewRouter(p.AuthUC, p.ChatUC, …)`.

- [ ] **Step 3: Delete legacy** — `rm -rf backend/internal/messaging`. Fix `transport/http` + `transport/ws` test helpers + tests to build the chat usecase from adapters (a `newChatUC(pool)` helper mirroring `newAuthUC`), and replace `messaging.SendInput`→`usecasechat.SendInput`, `messaging.*` types → `domain.*` / `usecasechat.*`. Behavioral assertions unchanged.

- [ ] **Step 4: Whole suite + vet** — `cd backend && go build ./... && go test ./... -count=1 && go vet ./...`. Expected all green; `grep -rn "internal/messaging" backend --include='*.go'` empty. (Re-run a flaky miniostore test in isolation if needed.)

- [ ] **Step 5: Docker e2e** — reuse a pg+redis stack: boot, then create chat → send (REST + WS) → history → sync → read → react → list reactions; all behave as before.

- [ ] **Step 6: Commit**
```bash
git add -A backend/ && git commit -m "refactor(backend): chat/message/sync/reactions on Clean Architecture; delete legacy messaging"
```

---

## Self-Review Notes

- **Spec coverage:** domain entities (§3); usecase interactor + ports incl. infra-free transactions via `TxManager` (§3, addresses the pgx-leak risk in §10 YAGNI/over-abstraction by using one tx port, not per-repo Querier); postgres adapters with mappers + `pgx.ErrNoRows`→`domain.ErrNotFound` (§3,§8); delivery + fx rewired (§3,§5); legacy deleted, suite green (§6 Slice 2).
- **Behavior unchanged:** interactor logic is a faithful port of messaging.Service (same SQL, fan-out, idempotency, GREATEST read marker, pts slice/too_long, emoji rules); responses/status codes identical; contract docs untouched. The realtime publisher & push service satisfy the new ports structurally (no changes to them).
- **Transactions:** `Send/MarkRead/React/CreatePrivateChat` run in `TxManager.WithinTx`; repos use `querier(ctx)` (ctx tx or pool) so multi-repo writes share one tx exactly as before; advisory-lock create-private preserved.
- **Strangler safety:** auth (migrated) untouched; media upload/download + push internals stay on current code; only the messaging surface moves; full suite is the regression net.
- **Type consistency:** `domain.Chat/Message/Update/ReactionCount/Dialog/UserState`, `usecasechat.{Interactor,New,ports,SendInput,Difference,HistoryResult}`, postgres repos + `TxManager`/`querier`, delivery `NewRouter(authUC, chatUC, wsHandler, mediaH, pushH)`, `ws.NewHandler(hub, authUC, chatUC, presence)` consistent across tasks.
```
