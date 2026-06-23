# Backend Plan B — Chats + Messages + History + Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private chats, message sending, paginated history, read state, and the `pts`-based update log + `GET /sync` difference endpoint — all over REST. This is the data + sync core that Plan C will later expose over WebSocket.

**Architecture:** Builds on Plan A (auth, devices, pgx pool, chi router, embedded migrations). New `internal/messaging` package holds repositories and services (one package to keep transactions across chats/messages/updates cycle-free). Repos accept a `Querier` interface so the same methods run on the pool or inside a `pgx.Tx`. `MessageService.Send` and `MarkRead` run multi-table writes in one transaction: allocate a per-chat `seq`, insert the message, and append a `pts`-incrementing row to the per-recipient update log. `GET /sync` mirrors Telegram's `getDifference` (slices + too_long resync).

**Tech Stack:** Same as Plan A — Go, chi/v5, pgx/v5, goose, testcontainers-go.

This plan implements spec sections §5.3 (update log pts/pts_count), §6 (chats/chat_members/messages/updates), §6a (History API), §8 (the REST surface that mirrors the future WS messages) of `docs/superpowers/specs/2026-06-23-messenger-backend-design.md`. Realtime delivery (WS/Redis fan-out), presence, typing, and reactions are Plan C.

---

## File Structure

```
backend/
  internal/store/postgres/migrations/0002_chats_messages.sql   — new tables
  internal/messaging/
    querier.go        — Querier interface (pool/tx), package doc
    chats_repo.go     — CreatePrivateChat, FindPrivateChat, GetChat, ListDialogs
    chats_repo_test.go
    messages_repo.go  — NextSeq, InsertMessage, FindByClientMsgID, GetMessage, GetHistory, CountMessages
    messages_repo_test.go
    updates_repo.go   — AppendUpdate, GetUserState, UpdatesSince
    updates_repo_test.go
    testutil_test.go  — seedUser helper for messaging tests
    service.go        — Service struct (pool + repos), CreatePrivateChat, ListDialogs
    message_service.go— Send, MarkRead (transactional)
    message_service_test.go
    sync_service.go   — GetDifference (assembles new_messages/other_updates/state)
    sync_service_test.go
  internal/transport/http/
    chat_handler.go   — POST /chats, GET /chats, POST/GET messages, read, sync
    chat_handler_test.go
    router.go         — MODIFY: mount messaging routes under auth, accept Service
  cmd/server/main.go  — MODIFY: construct messaging.Service, pass to router
```

Repos are thin SQL; services own transactions and business rules; transport is HTTP-only. Each file has one responsibility.

---

### Task 1: Migration 0002 + Querier interface

**Files:**
- Create: `backend/internal/store/postgres/migrations/0002_chats_messages.sql`
- Create: `backend/internal/messaging/querier.go`

- [ ] **Step 1: Write the migration**

Create `backend/internal/store/postgres/migrations/0002_chats_messages.sql`:
```sql
-- +goose Up
CREATE TABLE chats (
  id         BIGSERIAL PRIMARY KEY,
  type       TEXT NOT NULL,            -- 'private' | 'group' | 'channel' | 'saved'
  last_seq   BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_members (
  chat_id       BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member',
  last_read_seq BIGINT NOT NULL DEFAULT 0,
  unread_count  INT NOT NULL DEFAULT 0,
  muted         BOOLEAN NOT NULL DEFAULT false,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX idx_chat_members_user ON chat_members(user_id);

CREATE TABLE messages (
  id            BIGSERIAL PRIMARY KEY,
  chat_id       BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  seq           BIGINT NOT NULL,
  sender_id     BIGINT NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL DEFAULT 'text',
  text          TEXT NOT NULL DEFAULT '',
  reply_to_id   BIGINT,
  client_msg_id TEXT,
  edited_at     TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_id, seq)
);
CREATE UNIQUE INDEX idx_messages_client ON messages(chat_id, sender_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;

CREATE TABLE user_state (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pts     BIGINT NOT NULL DEFAULT 0,
  date    BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE updates (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pts        BIGINT NOT NULL,
  pts_count  INT NOT NULL DEFAULT 1,
  type       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pts)
);

-- +goose Down
DROP TABLE updates;
DROP TABLE user_state;
DROP TABLE messages;
DROP TABLE chat_members;
DROP TABLE chats;
```

- [ ] **Step 2: Write the Querier interface**

Create `backend/internal/messaging/querier.go`:
```go
// Package messaging implements chats, messages, the per-user update log (pts),
// and the sync/difference logic, over a Postgres store.
package messaging

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Querier is satisfied by both *pgxpool.Pool and pgx.Tx, so repository methods
// can run either standalone or inside a transaction.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}
```

- [ ] **Step 3: Verify migration applies and code builds**

Run:
```bash
cd backend && go build ./... && \
docker run --rm -d --name pb-mig -e POSTGRES_USER=m -e POSTGRES_PASSWORD=m -e POSTGRES_DB=m -p 0:5432 postgres:16-alpine >/dev/null && sleep 4 || true
```
Then rely on the testcontainers tests in later tasks to exercise migrations (they run `Migrate`, which now includes 0002). Stop the temp container if started: `docker stop pb-mig 2>/dev/null || true`.
Expected: `go build ./...` succeeds.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/store/postgres/migrations/0002_chats_messages.sql backend/internal/messaging/querier.go
git commit -m "feat(backend): migration for chats/messages/updates + Querier interface"
```

---

### Task 2: Chats repository

**Files:**
- Create: `backend/internal/messaging/chats_repo.go`
- Create: `backend/internal/messaging/testutil_test.go`
- Create: `backend/internal/messaging/chats_repo_test.go`

- [ ] **Step 1: Write the chats repository**

Create `backend/internal/messaging/chats_repo.go`:
```go
package messaging

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrNotFound = errors.New("not found")

type Chat struct {
	ID   int64
	Type string
}

// Dialog is one row of a user's chat list: the chat plus that user's read state
// and the chat's last message (may be zero if empty).
type Dialog struct {
	ChatID       int64
	Type         string
	LastReadSeq  int64
	UnreadCount  int
	Muted        bool
	LastSeq      int64
	LastText     string
	LastSenderID int64
	LastAt       time.Time
	HasLast      bool
}

type ChatsRepo struct{}

func NewChatsRepo() *ChatsRepo { return &ChatsRepo{} }

// FindPrivateChat returns the id of the existing private chat between two users, or ErrNotFound.
func (r *ChatsRepo) FindPrivateChat(ctx context.Context, q Querier, a, b int64) (int64, error) {
	var id int64
	err := q.QueryRow(ctx,
		`SELECT c.id FROM chats c
		 JOIN chat_members m1 ON m1.chat_id=c.id AND m1.user_id=$1
		 JOIN chat_members m2 ON m2.chat_id=c.id AND m2.user_id=$2
		 WHERE c.type='private' LIMIT 1`, a, b).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return id, err
}

// CreatePrivateChat creates a private chat with two members. Caller ensures it doesn't exist.
func (r *ChatsRepo) CreatePrivateChat(ctx context.Context, q Querier, a, b int64) (int64, error) {
	var chatID int64
	if err := q.QueryRow(ctx,
		`INSERT INTO chats (type) VALUES ('private') RETURNING id`).Scan(&chatID); err != nil {
		return 0, err
	}
	if _, err := q.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2),($1,$3)`,
		chatID, a, b); err != nil {
		return 0, err
	}
	return chatID, nil
}

// MemberIDs returns the user ids of a chat's members.
func (r *ChatsRepo) MemberIDs(ctx context.Context, q Querier, chatID int64) ([]int64, error) {
	rows, err := q.Query(ctx, `SELECT user_id FROM chat_members WHERE chat_id=$1`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// IsMember reports whether a user belongs to a chat.
func (r *ChatsRepo) IsMember(ctx context.Context, q Querier, chatID, userID int64) (bool, error) {
	var one int
	err := q.QueryRow(ctx,
		`SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2`, chatID, userID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// ListDialogs returns a user's chats with read state and last message, newest first.
func (r *ChatsRepo) ListDialogs(ctx context.Context, q Querier, userID int64) ([]Dialog, error) {
	rows, err := q.Query(ctx,
		`SELECT c.id, c.type, m.last_read_seq, m.unread_count, m.muted,
		        lm.seq, lm.text, lm.sender_id, lm.created_at
		 FROM chat_members m
		 JOIN chats c ON c.id = m.chat_id
		 LEFT JOIN LATERAL (
		   SELECT seq, text, sender_id, created_at FROM messages
		   WHERE chat_id = c.id AND deleted_at IS NULL
		   ORDER BY seq DESC LIMIT 1
		 ) lm ON true
		 WHERE m.user_id = $1
		 ORDER BY lm.created_at DESC NULLS LAST`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Dialog
	for rows.Next() {
		var d Dialog
		var seq *int64
		var text *string
		var senderID *int64
		var at *time.Time
		if err := rows.Scan(&d.ChatID, &d.Type, &d.LastReadSeq, &d.UnreadCount, &d.Muted,
			&seq, &text, &senderID, &at); err != nil {
			return nil, err
		}
		if seq != nil {
			d.HasLast = true
			d.LastSeq = *seq
			d.LastText = *text
			d.LastSenderID = *senderID
			d.LastAt = *at
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
```

- [ ] **Step 2: Write the test seed helper**

Create `backend/internal/messaging/testutil_test.go`:
```go
package messaging

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// seedUser inserts a user and returns its id.
func seedUser(t *testing.T, pool *pgxpool.Pool, phone string) int64 {
	t.Helper()
	var id int64
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (phone, display_name) VALUES ($1,$1) RETURNING id`, phone).Scan(&id)
	if err != nil {
		t.Fatalf("seedUser(%s): %v", phone, err)
	}
	return id
}
```

- [ ] **Step 3: Write the chats repo test**

Create `backend/internal/messaging/chats_repo_test.go`:
```go
package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestChatsRepo_CreateAndFindPrivate(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewChatsRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+700")
	b := seedUser(t, pool, "+701")

	if _, err := repo.FindPrivateChat(ctx, pool, a, b); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound before create, got %v", err)
	}
	chatID, err := repo.CreatePrivateChat(ctx, pool, a, b)
	if err != nil {
		t.Fatalf("CreatePrivateChat: %v", err)
	}
	found, err := repo.FindPrivateChat(ctx, pool, b, a) // order-independent
	if err != nil || found != chatID {
		t.Fatalf("FindPrivateChat = %d, %v; want %d", found, err, chatID)
	}

	ids, err := repo.MemberIDs(ctx, pool, chatID)
	if err != nil || len(ids) != 2 {
		t.Fatalf("MemberIDs = %v, %v", ids, err)
	}
	ok, _ := repo.IsMember(ctx, pool, chatID, a)
	if !ok {
		t.Fatal("expected a to be a member")
	}
	notMember := seedUser(t, pool, "+702")
	if ok, _ := repo.IsMember(ctx, pool, chatID, notMember); ok {
		t.Fatal("expected non-member to not be a member")
	}
}

func TestChatsRepo_ListDialogs(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewChatsRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+710")
	b := seedUser(t, pool, "+711")
	chatID, _ := repo.CreatePrivateChat(ctx, pool, a, b)

	dialogs, err := repo.ListDialogs(ctx, pool, a)
	if err != nil {
		t.Fatalf("ListDialogs: %v", err)
	}
	if len(dialogs) != 1 || dialogs[0].ChatID != chatID {
		t.Fatalf("unexpected dialogs: %+v", dialogs)
	}
	if dialogs[0].HasLast {
		t.Fatal("expected no last message in empty chat")
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/messaging/ -run 'ChatsRepo' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/messaging/chats_repo.go backend/internal/messaging/testutil_test.go backend/internal/messaging/chats_repo_test.go
git commit -m "feat(backend): chats repository (private chat, members, dialogs)"
```

---

### Task 3: Messages repository

**Files:**
- Create: `backend/internal/messaging/messages_repo.go`
- Create: `backend/internal/messaging/messages_repo_test.go`

- [ ] **Step 1: Write the messages repository**

Create `backend/internal/messaging/messages_repo.go`:
```go
package messaging

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type Message struct {
	ID          int64
	ChatID      int64
	Seq         int64
	SenderID    int64
	Type        string
	Text        string
	ReplyToID   *int64
	ClientMsgID *string
	CreatedAt   time.Time
	Deleted     bool
}

type MessagesRepo struct{}

func NewMessagesRepo() *MessagesRepo { return &MessagesRepo{} }

// NextSeq atomically increments and returns the chat's sequence counter.
func (r *MessagesRepo) NextSeq(ctx context.Context, q Querier, chatID int64) (int64, error) {
	var seq int64
	err := q.QueryRow(ctx,
		`UPDATE chats SET last_seq = last_seq + 1 WHERE id=$1 RETURNING last_seq`,
		chatID).Scan(&seq)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return seq, err
}

// FindByClientMsgID returns an existing message for idempotent sends, or ErrNotFound.
func (r *MessagesRepo) FindByClientMsgID(ctx context.Context, q Querier, chatID, senderID int64, clientMsgID string) (Message, error) {
	return r.scanOne(q.QueryRow(ctx,
		`SELECT id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, created_at, deleted_at
		 FROM messages WHERE chat_id=$1 AND sender_id=$2 AND client_msg_id=$3`,
		chatID, senderID, clientMsgID))
}

// Insert writes a new message row.
func (r *MessagesRepo) Insert(ctx context.Context, q Querier, m Message) (Message, error) {
	return r.scanOne(q.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 RETURNING id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, created_at, deleted_at`,
		m.ChatID, m.Seq, m.SenderID, m.Type, m.Text, m.ReplyToID, m.ClientMsgID))
}

// GetHistory returns up to limit messages around offsetSeq. addOffset>0 fetches
// older messages (seq < offsetSeq); addOffset<=0 fetches newer (seq > offsetSeq).
// offsetSeq==0 means "from the newest".
func (r *MessagesRepo) GetHistory(ctx context.Context, q Querier, chatID, offsetSeq int64, addOffset, limit int) ([]Message, error) {
	var rows pgx.Rows
	var err error
	switch {
	case offsetSeq == 0:
		rows, err = q.Query(ctx,
			`SELECT id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, created_at, deleted_at
			 FROM messages WHERE chat_id=$1 ORDER BY seq DESC LIMIT $2`, chatID, limit)
	case addOffset <= 0: // newer than offset
		rows, err = q.Query(ctx,
			`SELECT id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, created_at, deleted_at
			 FROM messages WHERE chat_id=$1 AND seq>$2 ORDER BY seq ASC LIMIT $3`, chatID, offsetSeq, limit)
	default: // older, inclusive of offset
		rows, err = q.Query(ctx,
			`SELECT id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, created_at, deleted_at
			 FROM messages WHERE chat_id=$1 AND seq<=$2 ORDER BY seq DESC LIMIT $3`, chatID, offsetSeq, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		m, err := r.scanRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// CountMessages returns the total number of messages in a chat.
func (r *MessagesRepo) CountMessages(ctx context.Context, q Querier, chatID int64) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM messages WHERE chat_id=$1`, chatID).Scan(&n)
	return n, err
}

// CountUnread returns messages in a chat with seq>afterSeq not sent by the user.
func (r *MessagesRepo) CountUnread(ctx context.Context, q Querier, chatID, userID, afterSeq int64) (int, error) {
	var n int
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM messages WHERE chat_id=$1 AND seq>$2 AND sender_id<>$3 AND deleted_at IS NULL`,
		chatID, afterSeq, userID).Scan(&n)
	return n, err
}

type scanner interface {
	Scan(dest ...any) error
}

func (r *MessagesRepo) scanRow(s scanner) (Message, error) { return r.scanInto(s) }
func (r *MessagesRepo) scanOne(row pgx.Row) (Message, error) {
	m, err := r.scanInto(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	return m, err
}
func (r *MessagesRepo) scanInto(s scanner) (Message, error) {
	var m Message
	var deletedAt *time.Time
	err := s.Scan(&m.ID, &m.ChatID, &m.Seq, &m.SenderID, &m.Type, &m.Text,
		&m.ReplyToID, &m.ClientMsgID, &m.CreatedAt, &deletedAt)
	m.Deleted = deletedAt != nil
	return m, err
}
```

- [ ] **Step 2: Write the messages repo test**

Create `backend/internal/messaging/messages_repo_test.go`:
```go
package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestMessagesRepo_SeqAndInsertAndHistory(t *testing.T) {
	pool := postgres.NewTestDB(t)
	chats := NewChatsRepo()
	msgs := NewMessagesRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+720")
	b := seedUser(t, pool, "+721")
	chatID, _ := chats.CreatePrivateChat(ctx, pool, a, b)

	// Insert 3 messages with monotonically increasing seq.
	for i := 1; i <= 3; i++ {
		seq, err := msgs.NextSeq(ctx, pool, chatID)
		if err != nil {
			t.Fatalf("NextSeq: %v", err)
		}
		if int(seq) != i {
			t.Fatalf("seq = %d, want %d", seq, i)
		}
		if _, err := msgs.Insert(ctx, pool, Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "m"}); err != nil {
			t.Fatalf("Insert: %v", err)
		}
	}

	n, _ := msgs.CountMessages(ctx, pool, chatID)
	if n != 3 {
		t.Fatalf("CountMessages = %d, want 3", n)
	}

	// Newest first from the end.
	hist, err := msgs.GetHistory(ctx, pool, chatID, 0, 0, 10)
	if err != nil || len(hist) != 3 || hist[0].Seq != 3 {
		t.Fatalf("history from end: %+v err=%v", hist, err)
	}

	// Older than seq 3 (inclusive): seq 3,2,1.
	older, _ := msgs.GetHistory(ctx, pool, chatID, 3, 1, 2)
	if len(older) != 2 || older[0].Seq != 3 || older[1].Seq != 2 {
		t.Fatalf("older window: %+v", older)
	}

	// Newer than seq 1: seq 2,3.
	newer, _ := msgs.GetHistory(ctx, pool, chatID, 1, -1, 10)
	if len(newer) != 2 || newer[0].Seq != 2 {
		t.Fatalf("newer window: %+v", newer)
	}
}

func TestMessagesRepo_FindByClientMsgID(t *testing.T) {
	pool := postgres.NewTestDB(t)
	chats := NewChatsRepo()
	msgs := NewMessagesRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+730")
	b := seedUser(t, pool, "+731")
	chatID, _ := chats.CreatePrivateChat(ctx, pool, a, b)

	cmid := "client-1"
	seq, _ := msgs.NextSeq(ctx, pool, chatID)
	if _, err := msgs.Insert(ctx, pool, Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "hi", ClientMsgID: &cmid}); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	got, err := msgs.FindByClientMsgID(ctx, pool, chatID, a, cmid)
	if err != nil || got.Text != "hi" {
		t.Fatalf("FindByClientMsgID = %+v, %v", got, err)
	}
	if _, err := msgs.FindByClientMsgID(ctx, pool, chatID, a, "missing"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/messaging/ -run 'MessagesRepo' -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/messaging/messages_repo.go backend/internal/messaging/messages_repo_test.go
git commit -m "feat(backend): messages repository (seq, insert, history, counts)"
```

---

### Task 4: Updates repository (pts log)

**Files:**
- Create: `backend/internal/messaging/updates_repo.go`
- Create: `backend/internal/messaging/updates_repo_test.go`

- [ ] **Step 1: Write the updates repository**

Create `backend/internal/messaging/updates_repo.go`:
```go
package messaging

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

type Update struct {
	Pts      int64
	PtsCount int
	Type     string
	Payload  json.RawMessage
}

type UserState struct {
	Pts  int64
	Date int64
}

type UpdatesRepo struct{}

func NewUpdatesRepo() *UpdatesRepo { return &UpdatesRepo{} }

// AppendUpdate bumps the user's pts by ptsCount and writes one update row at the
// resulting pts. Returns the new pts. payload must be valid JSON.
func (r *UpdatesRepo) AppendUpdate(ctx context.Context, q Querier, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error) {
	var newPts int64
	err := q.QueryRow(ctx,
		`INSERT INTO user_state (user_id, pts, date) VALUES ($1,$2,$3)
		 ON CONFLICT (user_id) DO UPDATE SET pts = user_state.pts + $2, date = $3
		 RETURNING pts`, userID, ptsCount, date).Scan(&newPts)
	if err != nil {
		return 0, err
	}
	_, err = q.Exec(ctx,
		`INSERT INTO updates (user_id, pts, pts_count, type, payload) VALUES ($1,$2,$3,$4,$5)`,
		userID, newPts, ptsCount, typ, payload)
	return newPts, err
}

// GetUserState returns a user's current pts/date (zero values if no state yet).
func (r *UpdatesRepo) GetUserState(ctx context.Context, q Querier, userID int64) (UserState, error) {
	var s UserState
	err := q.QueryRow(ctx, `SELECT pts, date FROM user_state WHERE user_id=$1`, userID).Scan(&s.Pts, &s.Date)
	if err == pgx.ErrNoRows {
		return UserState{}, nil
	}
	return s, err
}

// UpdatesSince returns updates with pts>sincePts, oldest first, up to limit.
func (r *UpdatesRepo) UpdatesSince(ctx context.Context, q Querier, userID, sincePts int64, limit int) ([]Update, error) {
	rows, err := q.Query(ctx,
		`SELECT pts, pts_count, type, payload FROM updates
		 WHERE user_id=$1 AND pts>$2 ORDER BY pts ASC LIMIT $3`, userID, sincePts, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Update
	for rows.Next() {
		var u Update
		if err := rows.Scan(&u.Pts, &u.PtsCount, &u.Type, &u.Payload); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
```

- [ ] **Step 2: Write the updates repo test**

Create `backend/internal/messaging/updates_repo_test.go`:
```go
package messaging

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestUpdatesRepo_AppendAndSince(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewUpdatesRepo()
	ctx := context.Background()
	u := seedUser(t, pool, "+740")

	s, _ := repo.GetUserState(ctx, pool, u)
	if s.Pts != 0 {
		t.Fatalf("initial pts = %d, want 0", s.Pts)
	}

	p1, err := repo.AppendUpdate(ctx, pool, u, 1, 100, "new_message", json.RawMessage(`{"a":1}`))
	if err != nil || p1 != 1 {
		t.Fatalf("AppendUpdate 1 = %d, %v", p1, err)
	}
	p2, _ := repo.AppendUpdate(ctx, pool, u, 1, 101, "read", json.RawMessage(`{"b":2}`))
	if p2 != 2 {
		t.Fatalf("AppendUpdate 2 = %d, want 2", p2)
	}

	state, _ := repo.GetUserState(ctx, pool, u)
	if state.Pts != 2 || state.Date != 101 {
		t.Fatalf("state = %+v, want pts=2 date=101", state)
	}

	ups, err := repo.UpdatesSince(ctx, pool, u, 0, 10)
	if err != nil || len(ups) != 2 || ups[0].Pts != 1 || ups[1].Type != "read" {
		t.Fatalf("UpdatesSince = %+v, %v", ups, err)
	}
	tail, _ := repo.UpdatesSince(ctx, pool, u, 1, 10)
	if len(tail) != 1 || tail[0].Pts != 2 {
		t.Fatalf("tail = %+v", tail)
	}
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/messaging/ -run 'UpdatesRepo' -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/messaging/updates_repo.go backend/internal/messaging/updates_repo_test.go
git commit -m "feat(backend): updates repository (pts log, user state, difference query)"
```

---

### Task 5: Service skeleton + CreatePrivateChat + ListDialogs

**Files:**
- Create: `backend/internal/messaging/service.go`
- Test: covered by Task 7's `message_service_test.go` (dialog assembly) and exercised here with a focused test in `service.go`'s companion.

- [ ] **Step 1: Write the service skeleton**

Create `backend/internal/messaging/service.go`:
```go
package messaging

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns transactions and business rules over the repositories.
type Service struct {
	pool    *pgxpool.Pool
	chats   *ChatsRepo
	msgs    *MessagesRepo
	updates *UpdatesRepo
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{
		pool:    pool,
		chats:   NewChatsRepo(),
		msgs:    NewMessagesRepo(),
		updates: NewUpdatesRepo(),
	}
}

// nowMillis is the server clock used for update dates.
func nowMillis() int64 { return time.Now().UnixMilli() }

// CreatePrivateChat returns the existing private chat between the two users, or creates one.
func (s *Service) CreatePrivateChat(ctx context.Context, me, other int64) (int64, error) {
	id, err := s.chats.FindPrivateChat(ctx, s.pool, me, other)
	if err == nil {
		return id, nil
	}
	if err != ErrNotFound {
		return 0, err
	}
	return s.chats.CreatePrivateChat(ctx, s.pool, me, other)
}

// ListDialogs returns the user's chat list.
func (s *Service) ListDialogs(ctx context.Context, userID int64) ([]Dialog, error) {
	return s.chats.ListDialogs(ctx, s.pool, userID)
}
```

- [ ] **Step 2: Write a focused service test**

Create `backend/internal/messaging/service_test.go`:
```go
package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestService_CreatePrivateChat_Idempotent(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+750")
	b := seedUser(t, pool, "+751")

	id1, err := s.CreatePrivateChat(ctx, a, b)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id2, err := s.CreatePrivateChat(ctx, b, a)
	if err != nil || id1 != id2 {
		t.Fatalf("expected same chat, got %d and %d (err %v)", id1, id2, err)
	}
	dialogs, _ := s.ListDialogs(ctx, a)
	if len(dialogs) != 1 {
		t.Fatalf("expected 1 dialog, got %d", len(dialogs))
	}
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd backend && go test ./internal/messaging/ -run 'Service_CreatePrivateChat' -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/messaging/service.go backend/internal/messaging/service_test.go
git commit -m "feat(backend): messaging service skeleton, create/list private chats"
```

---

### Task 6: Send + MarkRead (transactional)

**Files:**
- Create: `backend/internal/messaging/message_service.go`
- Create: `backend/internal/messaging/message_service_test.go`

- [ ] **Step 1: Write Send and MarkRead**

Create `backend/internal/messaging/message_service.go`:
```go
package messaging

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

// SendInput describes an outgoing message.
type SendInput struct {
	ChatID      int64
	SenderID    int64
	Type        string
	Text        string
	ReplyToID   *int64
	ClientMsgID string // optional; enables idempotency
}

// Send inserts a message and appends a new_message update to every member,
// bumping unread for everyone except the sender. Idempotent on ClientMsgID.
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
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		if in.ClientMsgID != "" {
			if existing, e := s.msgs.FindByClientMsgID(ctx, tx, in.ChatID, in.SenderID, in.ClientMsgID); e == nil {
				msg = existing
				return nil // duplicate send: return the original, no new updates
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
		return nil
	})
	return msg, err
}

// MarkRead advances a member's last_read_seq, recomputes unread, and appends a
// read update to all members (so senders see read receipts and other devices sync).
func (s *Service) MarkRead(ctx context.Context, chatID, userID, upToSeq int64) error {
	ok, err := s.chats.IsMember(ctx, s.pool, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return s.inTx(ctx, func(tx pgx.Tx) error {
		unread, e := s.msgs.CountUnread(ctx, tx, chatID, userID, upToSeq)
		if e != nil {
			return e
		}
		if _, e := tx.Exec(ctx,
			`UPDATE chat_members SET last_read_seq=GREATEST(last_read_seq,$3), unread_count=$4
			 WHERE chat_id=$1 AND user_id=$2`, chatID, userID, upToSeq, unread); e != nil {
			return e
		}
		members, e := s.chats.MemberIDs(ctx, tx, chatID)
		if e != nil {
			return e
		}
		payload, e := json.Marshal(map[string]any{
			"chat_id": chatID, "user_id": userID, "up_to_seq": upToSeq,
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
}

func (s *Service) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func messageUpdatePayload(m Message) map[string]any {
	return map[string]any{
		"chat_id": m.ChatID, "msg_id": m.ID, "seq": m.Seq,
		"sender_id": m.SenderID, "type": m.Type, "text": m.Text,
		"created_at": m.CreatedAt,
	}
}
```

- [ ] **Step 2: Write the message service test**

Create `backend/internal/messaging/message_service_test.go`:
```go
package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestService_Send_FanoutAndUnread(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+760")
	b := seedUser(t, pool, "+761")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)

	msg, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hello", ClientMsgID: "c1"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if msg.Seq != 1 || msg.Text != "hello" {
		t.Fatalf("unexpected message: %+v", msg)
	}

	// Both members got a new_message update (pts=1 each).
	for _, uid := range []int64{a, b} {
		st, _ := s.updates.GetUserState(ctx, pool, uid)
		if st.Pts != 1 {
			t.Fatalf("user %d pts = %d, want 1", uid, st.Pts)
		}
	}

	// Recipient b has unread=1; sender a has unread=0.
	dialogsB, _ := s.ListDialogs(ctx, b)
	if dialogsB[0].UnreadCount != 1 {
		t.Fatalf("b unread = %d, want 1", dialogsB[0].UnreadCount)
	}
	dialogsA, _ := s.ListDialogs(ctx, a)
	if dialogsA[0].UnreadCount != 0 {
		t.Fatalf("a unread = %d, want 0", dialogsA[0].UnreadCount)
	}
}

func TestService_Send_IdempotentClientMsgID(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+770")
	b := seedUser(t, pool, "+771")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)

	m1, _ := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "x", ClientMsgID: "dup"})
	m2, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "x", ClientMsgID: "dup"})
	if err != nil {
		t.Fatalf("second Send: %v", err)
	}
	if m1.ID != m2.ID || m1.Seq != m2.Seq {
		t.Fatalf("idempotency broken: %+v vs %+v", m1, m2)
	}
	n, _ := s.msgs.CountMessages(ctx, pool, chatID)
	if n != 1 {
		t.Fatalf("expected 1 message after duplicate send, got %d", n)
	}
}

func TestService_MarkRead(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+780")
	b := seedUser(t, pool, "+781")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	_, _ = s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "1"})
	_, _ = s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "2"})

	if d, _ := s.ListDialogs(ctx, b); d[0].UnreadCount != 2 {
		t.Fatalf("b unread before read = %d, want 2", d[0].UnreadCount)
	}
	if err := s.MarkRead(ctx, chatID, b, 2); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	d, _ := s.ListDialogs(ctx, b)
	if d[0].UnreadCount != 0 || d[0].LastReadSeq != 2 {
		t.Fatalf("after read: unread=%d lastRead=%d", d[0].UnreadCount, d[0].LastReadSeq)
	}
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/messaging/ -run 'Service_Send|Service_MarkRead' -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/messaging/message_service.go backend/internal/messaging/message_service_test.go
git commit -m "feat(backend): transactional Send + MarkRead with pts fan-out and unread"
```

---

### Task 7: History service + GetDifference (sync)

**Files:**
- Create: `backend/internal/messaging/sync_service.go`
- Create: `backend/internal/messaging/sync_service_test.go`

- [ ] **Step 1: Write history + difference**

Create `backend/internal/messaging/sync_service.go`:
```go
package messaging

import (
	"context"
	"encoding/json"
)

// syncLimit caps updates returned per /sync call (slice beyond this).
const syncLimit = 500

// tooLongThreshold: if the client is further behind than this, force a full resync.
const tooLongThreshold = 2000

// HistoryResult is one window of chat history.
type HistoryResult struct {
	Messages []Message
	Count    int
}

// GetHistory returns a window of messages plus the chat's total count.
func (s *Service) GetHistory(ctx context.Context, chatID, userID, offsetSeq int64, addOffset, limit int) (HistoryResult, error) {
	ok, err := s.chats.IsMember(ctx, s.pool, chatID, userID)
	if err != nil {
		return HistoryResult{}, err
	}
	if !ok {
		return HistoryResult{}, ErrNotFound
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	msgs, err := s.msgs.GetHistory(ctx, s.pool, chatID, offsetSeq, addOffset, limit)
	if err != nil {
		return HistoryResult{}, err
	}
	count, err := s.msgs.CountMessages(ctx, s.pool, chatID)
	if err != nil {
		return HistoryResult{}, err
	}
	return HistoryResult{Messages: msgs, Count: count}, nil
}

// Difference is the result of GetDifference: updates the client missed since its pts.
type Difference struct {
	NewMessages  []json.RawMessage `json:"new_messages"`
	OtherUpdates []json.RawMessage `json:"other_updates"`
	State        UserState         `json:"state"`
	Slice        bool              `json:"slice"`
	TooLong      bool              `json:"too_long"`
}

// GetDifference returns updates with pts>sincePts, split by kind. If the client is
// too far behind, TooLong is set so it can do a full resync (snapshot via ListDialogs).
func (s *Service) GetDifference(ctx context.Context, userID, sincePts int64) (Difference, error) {
	state, err := s.updates.GetUserState(ctx, s.pool, userID)
	if err != nil {
		return Difference{}, err
	}
	if state.Pts-sincePts > tooLongThreshold {
		return Difference{TooLong: true, State: state}, nil
	}
	ups, err := s.updates.UpdatesSince(ctx, s.pool, userID, sincePts, syncLimit)
	if err != nil {
		return Difference{}, err
	}
	d := Difference{State: state, NewMessages: []json.RawMessage{}, OtherUpdates: []json.RawMessage{}}
	for _, u := range ups {
		if u.Type == "new_message" {
			d.NewMessages = append(d.NewMessages, u.Payload)
		} else {
			d.OtherUpdates = append(d.OtherUpdates, u.Payload)
		}
	}
	if len(ups) == syncLimit {
		d.Slice = true
		d.State = UserState{Pts: ups[len(ups)-1].Pts, Date: state.Date}
	}
	return d, nil
}
```

- [ ] **Step 2: Write the sync service test**

Create `backend/internal/messaging/sync_service_test.go`:
```go
package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestService_GetHistory_Window(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+790")
	b := seedUser(t, pool, "+791")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	for i := 0; i < 5; i++ {
		_, _ = s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "m"})
	}
	res, err := s.GetHistory(ctx, chatID, a, 0, 0, 3)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if res.Count != 5 {
		t.Fatalf("count = %d, want 5", res.Count)
	}
	if len(res.Messages) != 3 || res.Messages[0].Seq != 5 {
		t.Fatalf("window = %+v", res.Messages)
	}

	// Non-member cannot read.
	stranger := seedUser(t, pool, "+792")
	if _, err := s.GetHistory(ctx, chatID, stranger, 0, 0, 10); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for non-member, got %v", err)
	}
}

func TestService_GetDifference(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+800")
	b := seedUser(t, pool, "+801")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	_, _ = s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "1"})
	_ = s.MarkRead(ctx, chatID, b, 1)

	// From scratch, b should see 1 new_message + 1 read update; state pts=2.
	d, err := s.GetDifference(ctx, b, 0)
	if err != nil {
		t.Fatalf("GetDifference: %v", err)
	}
	if len(d.NewMessages) != 1 || len(d.OtherUpdates) != 1 {
		t.Fatalf("diff = %d new, %d other", len(d.NewMessages), len(d.OtherUpdates))
	}
	if d.State.Pts != 2 || d.TooLong || d.Slice {
		t.Fatalf("state = %+v slice=%v tooLong=%v", d.State, d.Slice, d.TooLong)
	}

	// From pts=1, only the read update remains.
	d2, _ := s.GetDifference(ctx, b, 1)
	if len(d2.NewMessages) != 0 || len(d2.OtherUpdates) != 1 {
		t.Fatalf("tail diff = %d new, %d other", len(d2.NewMessages), len(d2.OtherUpdates))
	}
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/messaging/ -run 'Service_GetHistory|Service_GetDifference' -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/messaging/sync_service.go backend/internal/messaging/sync_service_test.go
git commit -m "feat(backend): history window + GetDifference (sync) service"
```

---

### Task 8: HTTP handlers + router wiring

**Files:**
- Create: `backend/internal/transport/http/chat_handler.go`
- Modify: `backend/internal/transport/http/router.go`
- Modify: `backend/cmd/server/main.go`
- Test: `backend/internal/transport/http/chat_handler_test.go`

- [ ] **Step 1: Write the chat handlers**

Create `backend/internal/transport/http/chat_handler.go`:
```go
package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/messaging"
)

type ChatHandler struct{ svc *messaging.Service }

func NewChatHandler(svc *messaging.Service) *ChatHandler { return &ChatHandler{svc: svc} }

func (h *ChatHandler) meID(r *http.Request) int64 {
	u, _ := UserFromContext(r.Context())
	return u.ID
}

type createChatBody struct {
	UserID int64 `json:"user_id"`
}

func (h *ChatHandler) CreatePrivate(w http.ResponseWriter, r *http.Request) {
	var body createChatBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == 0 {
		writeError(w, http.StatusBadRequest, "user_id is required")
		return
	}
	id, err := h.svc.CreatePrivateChat(r.Context(), h.meID(r), body.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create chat")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chat_id": id})
}

func (h *ChatHandler) ListDialogs(w http.ResponseWriter, r *http.Request) {
	dialogs, err := h.svc.ListDialogs(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list chats")
		return
	}
	out := make([]map[string]any, 0, len(dialogs))
	for _, d := range dialogs {
		row := map[string]any{
			"chat_id": d.ChatID, "type": d.Type,
			"last_read_seq": d.LastReadSeq, "unread": d.UnreadCount, "muted": d.Muted,
		}
		if d.HasLast {
			row["last_message"] = map[string]any{
				"seq": d.LastSeq, "text": d.LastText, "sender_id": d.LastSenderID, "at": d.LastAt,
			}
		}
		out = append(out, row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"chats": out})
}

type sendBody struct {
	Type        string `json:"type"`
	Text        string `json:"text"`
	ReplyToID   *int64 `json:"reply_to_id"`
	ClientMsgID string `json:"client_msg_id"`
}

func (h *ChatHandler) Send(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var body sendBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	msg, err := h.svc.Send(r.Context(), messaging.SendInput{
		ChatID: chatID, SenderID: h.meID(r), Type: body.Type, Text: body.Text,
		ReplyToID: body.ReplyToID, ClientMsgID: body.ClientMsgID,
	})
	if errors.Is(err, messaging.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "send failed")
		return
	}
	writeJSON(w, http.StatusOK, messageJSON(msg))
}

func (h *ChatHandler) History(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	offsetSeq := queryInt(r, "offset_id", 0)
	addOffset := int(queryInt(r, "add_offset", 0))
	limit := int(queryInt(r, "limit", 40))
	res, err := h.svc.GetHistory(r.Context(), chatID, h.meID(r), offsetSeq, addOffset, limit)
	if errors.Is(err, messaging.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "history failed")
		return
	}
	out := make([]map[string]any, 0, len(res.Messages))
	for _, m := range res.Messages {
		out = append(out, messageJSON(m))
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": out, "count": res.Count})
}

type readBody struct {
	UpToSeq int64 `json:"up_to_seq"`
}

func (h *ChatHandler) Read(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	var body readBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	err := h.svc.MarkRead(r.Context(), chatID, h.meID(r), body.UpToSeq)
	if errors.Is(err, messaging.ErrNotFound) {
		writeError(w, http.StatusForbidden, "not a member of this chat")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *ChatHandler) Sync(w http.ResponseWriter, r *http.Request) {
	sincePts := queryInt(r, "pts", 0)
	d, err := h.svc.GetDifference(r.Context(), h.meID(r), sincePts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sync failed")
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func messageJSON(m messaging.Message) map[string]any {
	return map[string]any{
		"id": m.ID, "chat_id": m.ChatID, "seq": m.Seq, "sender_id": m.SenderID,
		"type": m.Type, "text": m.Text, "reply_to_id": m.ReplyToID,
		"created_at": m.CreatedAt, "deleted": m.Deleted,
	}
}

func pathInt(w http.ResponseWriter, r *http.Request, key string) (int64, bool) {
	v, err := strconv.ParseInt(chi.URLParam(r, key), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid "+key)
		return 0, false
	}
	return v, true
}

func queryInt(r *http.Request, key string, def int64) int64 {
	if s := r.URL.Query().Get(key); s != "" {
		if v, err := strconv.ParseInt(s, 10, 64); err == nil {
			return v
		}
	}
	return def
}
```

- [ ] **Step 2: Wire routes into the router**

In `backend/internal/transport/http/router.go`, change `NewRouter` to also take the messaging service and mount the protected routes. Replace the function signature and the protected group:
```go
func NewRouter(authSvc *auth.Service, chatSvc *messaging.Service) http.Handler {
```
(add the import `"github.com/messenger-denis/backend/internal/messaging"`). Then in the protected group, after `pr.Get("/me", MeHandler)`, add:
```go
	r.Group(func(pr chi.Router) {
		pr.Use(AuthMiddleware(authSvc))
		pr.Get("/me", MeHandler)

		ch := NewChatHandler(chatSvc)
		pr.Post("/chats", ch.CreatePrivate)
		pr.Get("/chats", ch.ListDialogs)
		pr.Post("/chats/{chatID}/messages", ch.Send)
		pr.Get("/chats/{chatID}/history", ch.History)
		pr.Post("/chats/{chatID}/read", ch.Read)
		pr.Get("/sync", ch.Sync)
	})
```
Also update the existing `NewAuthHandler(svc)` reference: the auth handler still uses `authSvc`, so change `authH := NewAuthHandler(svc)` to `authH := NewAuthHandler(authSvc)`.

- [ ] **Step 3: Update main.go wiring**

In `backend/cmd/server/main.go`, after constructing the auth service, construct the messaging service and pass both to the router. Replace:
```go
	svc := auth.NewService(auth.NewRepo(pool), cfg.DevOTPCode, log.Printf)
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httptransport.NewRouter(svc),
```
with:
```go
	authSvc := auth.NewService(auth.NewRepo(pool), cfg.DevOTPCode, log.Printf)
	chatSvc := messaging.NewService(pool)
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httptransport.NewRouter(authSvc, chatSvc),
```
Add the import `"github.com/messenger-denis/backend/internal/messaging"`.

- [ ] **Step 4: Write the handler test**

Create `backend/internal/transport/http/chat_handler_test.go`:
```go
package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/messaging"
	"github.com/messenger-denis/backend/internal/store/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

// signUp creates a user via the auth flow and returns (token, userID).
func signUp(t *testing.T, h http.Handler, pool *pgxpool.Pool, phone string) (string, int64) {
	t.Helper()
	_ = postJSON(t, h, "/auth/request_code", map[string]string{"phone": phone})
	rec := postJSON(t, h, "/auth/sign_in", map[string]string{"phone": phone, "code": "12345"})
	var out struct {
		Token string `json:"token"`
		User  struct {
			ID int64 `json:"id"`
		} `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return out.Token, out.User.ID
}

func authedReq(t *testing.T, h http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		buf, _ := json.Marshal(body)
		rdr = bytes.NewReader(buf)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req := httptest.NewRequestWithContext(context.Background(), method, path, rdr)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func newMessagingRouter(t *testing.T) (http.Handler, *pgxpool.Pool) {
	pool := postgres.NewTestDB(t)
	authSvc := auth.NewService(auth.NewRepo(pool), "12345", func(string, ...any) {})
	chatSvc := messaging.NewService(pool)
	return NewRouter(authSvc, chatSvc), pool
}

func TestChatFlow_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000001")
	_, idB := signUp(t, h, pool, "+79990000002")

	// A creates a private chat with B.
	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	// A sends a message.
	path := "/chats/" + itoa(created.ChatID) + "/messages"
	rec = authedReq(t, h, http.MethodPost, path, tokenA, map[string]any{"text": "hello", "client_msg_id": "c1"})
	if rec.Code != http.StatusOK {
		t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
	}

	// History shows it.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(created.ChatID)+"/history?limit=10", tokenA, nil)
	var hist struct {
		Count    int `json:"count"`
		Messages []struct {
			Text string `json:"text"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	if hist.Count != 1 || len(hist.Messages) != 1 || hist.Messages[0].Text != "hello" {
		t.Fatalf("history = %+v", hist)
	}
}

func TestSync_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000003")
	tokenB, idB := signUp(t, h, pool, "+79990000004")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	var created struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	_ = authedReq(t, h, http.MethodPost, "/chats/"+itoa(created.ChatID)+"/messages", tokenA, map[string]any{"text": "hi"})

	// B syncs from pts=0 and sees one new_message.
	rec = authedReq(t, h, http.MethodGet, "/sync?pts=0", tokenB, nil)
	var diff struct {
		NewMessages []json.RawMessage `json:"new_messages"`
		State       struct {
			Pts int64 `json:"pts"`
		} `json:"state"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &diff)
	if len(diff.NewMessages) != 1 || diff.State.Pts != 1 {
		t.Fatalf("sync diff = %+v", diff)
	}
}

func itoa(v int64) string { return strconvFormat(v) }
```

Add a tiny helper at the bottom of the test file (kept local to avoid touching production code):
```go
func strconvFormat(v int64) string {
	return strconv.FormatInt(v, 10)
}
```
and add `"strconv"` to the test file's imports.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/transport/http/ -v && go build ./...`
Expected: PASS for all (existing auth/me tests still pass; new chat/sync tests pass), build clean.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/transport/http/ backend/cmd/server/main.go
git commit -m "feat(backend): REST handlers for chats, messages, history, read, sync"
```

---

### Task 9: Full-stack verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `cd backend && go test ./... && go vet ./...`
Expected: all packages PASS, vet clean.

- [ ] **Step 2: Manual end-to-end smoke test (isolated docker project, free ports)**

Use a self-contained compose stack (avoids host-port conflicts with other projects). Run:
```bash
cat > /tmp/plan-b-stack.yml <<'EOF'
name: plan-b-verify
services:
  pg:
    image: postgres:16-alpine
    environment: {POSTGRES_USER: messenger, POSTGRES_PASSWORD: messenger, POSTGRES_DB: messenger}
    healthcheck: {test: ["CMD-SHELL","pg_isready -U messenger"], interval: 3s, timeout: 3s, retries: 10}
  backend:
    build: /Users/denisurevic/Documents/messenger-denis/backend
    environment:
      HTTP_ADDR: ":8080"
      DATABASE_URL: "postgres://messenger:messenger@pg:5432/messenger?sslmode=disable"
      DEV_OTP_CODE: "12345"
    depends_on: {pg: {condition: service_healthy}}
    ports: ["18082:8080"]
EOF
docker compose -f /tmp/plan-b-stack.yml up -d --build
sleep 5
# Two users
curl -s -X POST localhost:18082/auth/request_code -d '{"phone":"+700"}' >/dev/null
TA=$(curl -s -X POST localhost:18082/auth/sign_in -d '{"phone":"+700","code":"12345"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl -s -X POST localhost:18082/auth/request_code -d '{"phone":"+701"}' >/dev/null
B=$(curl -s -X POST localhost:18082/auth/sign_in -d '{"phone":"+701","code":"12345"}')
echo "B sign_in: $B"
IDB=$(echo "$B" | sed 's/.*"id":\([0-9]*\).*/\1/')
# A creates chat with B and sends a message
CID=$(curl -s -X POST localhost:18082/chats -H "Authorization: Bearer $TA" -d "{\"user_id\":$IDB}" | sed 's/.*"chat_id":\([0-9]*\).*/\1/')
echo "chat: $CID"
curl -s -X POST localhost:18082/chats/$CID/messages -H "Authorization: Bearer $TA" -d '{"text":"hello"}'; echo
curl -s "localhost:18082/chats/$CID/history" -H "Authorization: Bearer $TA"; echo
docker compose -f /tmp/plan-b-stack.yml down -v
```
Expected: chat created, message sent (JSON with seq=1), history returns the message with count=1.

- [ ] **Step 3: Commit (if any verification tweaks were needed)**

No code changes expected here. If verification surfaced a bug, fix it under the relevant task and re-run.

---

## Self-Review Notes

- **Spec coverage:** §6 tables (chats/chat_members/messages/user_state/updates) — Task 1. §5.3 pts+pts_count log — Task 4; pts fan-out on send/read — Task 6. §6a History API (offset_id/add_offset/limit+count) — Tasks 3,7,8. §8 REST surface mirroring future WS (send_message/read/sync shapes) — Task 8. The `/sync` getDifference with slice/too_long — Task 7.
- **Out of scope (later plans):** WS transport + Redis fan-out + presence + typing + reactions (Plan C); media + web push (Plan D); groups/channels/stories/e2e (later phases). Read receipts/new_message are recorded in the update log now; Plan C only adds the *live push* of these same updates.
- **Type consistency:** `messaging.Service` constructed via `NewService(pool)`; `NewRouter(authSvc, chatSvc)` updated in both router.go and main.go and tests; `Querier` used uniformly by all repos; `Message`, `Dialog`, `Update`, `UserState`, `Difference`, `HistoryResult`, `SendInput` names consistent across repo/service/transport.
- **Transaction correctness:** `Send`/`MarkRead` allocate seq, insert, and append per-recipient pts updates inside one `pgx.Tx` via `inTx`; idempotency checked inside the tx before allocating seq (no seq wasted on duplicates).
- **Placeholder scan:** no TBD/TODO; all steps contain full code and exact commands.
```
