# Backend Plan C3 — Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add emoji reactions to messages: add/remove a reaction, read aggregated counts, and fan the change out live (via the `pts` update log + the realtime Publisher) to all chat members.

**Architecture:** A `reactions` table (migration 0003). New repo methods in `internal/messaging` (`AddReaction`, `RemoveReaction`, `ReactionsFor`, plus `GetMessageMeta` to resolve a message's chat). A transactional `Service.React` mirrors `Send`/`MarkRead`: verify the message is in the chat and the user is a member, mutate the reaction, append a `reaction` update to every member's `pts` log, and — after commit — publish a `reaction` frame. REST endpoints `POST/DELETE /chats/{chatID}/messages/{msgID}/reactions` plus `GET` for current counts.

**Tech Stack:** Same as Plan B/C — Go, chi/v5, pgx/v5, goose, testcontainers-go (the live publish reuses Plan C2's `messaging.Publisher`, tested here with a fake publisher).

Implements the reactions portion of spec §6/§8. Presence and force-closing a revoked socket are Plan C4. Enriching message history with reaction counts in one round-trip is a follow-up (this plan exposes a per-message `GET` endpoint).

---

## File Structure

```
backend/
  internal/store/postgres/migrations/0003_reactions.sql   — reactions table
  internal/messaging/
    messages_repo.go    — MODIFY: add GetMessageMeta (message_id -> chat_id)
    messages_repo_test.go — MODIFY: add a GetMessageMeta test
    reactions_repo.go   — AddReaction, RemoveReaction, ReactionsFor, ReactionCount
    reactions_repo_test.go
    reactions_service.go— React (transactional + live fan-out), ReactionsFor passthrough
    reactions_service_test.go
  internal/transport/http/
    chat_handler.go     — MODIFY: AddReaction, RemoveReaction, ListReactions handlers
    chat_handler_test.go— MODIFY: reaction flow test
    router.go           — MODIFY: mount reaction routes
```

---

### Task 1: Migration + reactions repo + GetMessageMeta

**Files:**
- Create: `backend/internal/store/postgres/migrations/0003_reactions.sql`
- Modify: `backend/internal/messaging/messages_repo.go`
- Modify: `backend/internal/messaging/messages_repo_test.go`
- Create: `backend/internal/messaging/reactions_repo.go`
- Create: `backend/internal/messaging/reactions_repo_test.go`

- [ ] **Step 1: Write the migration**

Create `backend/internal/store/postgres/migrations/0003_reactions.sql`:
```sql
-- +goose Up
CREATE TABLE reactions (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX idx_reactions_message ON reactions(message_id);

-- +goose Down
DROP TABLE reactions;
```

- [ ] **Step 2: Add GetMessageMeta to the messages repo**

In `backend/internal/messaging/messages_repo.go`, add:
```go
// GetMessageMeta resolves a message id to its chat id. Returns ErrNotFound if
// the message does not exist.
func (r *MessagesRepo) GetMessageMeta(ctx context.Context, q Querier, messageID int64) (chatID int64, err error) {
	err = q.QueryRow(ctx, `SELECT chat_id FROM messages WHERE id=$1`, messageID).Scan(&chatID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return chatID, err
}
```

- [ ] **Step 3: Add a GetMessageMeta test**

Append to `backend/internal/messaging/messages_repo_test.go`:
```go
func TestMessagesRepo_GetMessageMeta(t *testing.T) {
	pool := postgres.NewTestDB(t)
	chats := NewChatsRepo()
	msgs := NewMessagesRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+740")
	b := seedUser(t, pool, "+741")
	chatID, _ := chats.CreatePrivateChat(ctx, pool, a, b)
	seq, _ := msgs.NextSeq(ctx, pool, chatID)
	m, _ := msgs.Insert(ctx, pool, Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "x"})

	got, err := msgs.GetMessageMeta(ctx, pool, m.ID)
	if err != nil || got != chatID {
		t.Fatalf("GetMessageMeta = %d, %v; want %d", got, err, chatID)
	}
	if _, err := msgs.GetMessageMeta(ctx, pool, 999999); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}
```

- [ ] **Step 4: Write the reactions repo**

Create `backend/internal/messaging/reactions_repo.go`:
```go
package messaging

import "context"

// ReactionCount is an aggregated reaction tally for one emoji on a message.
type ReactionCount struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
}

type ReactionsRepo struct{}

func NewReactionsRepo() *ReactionsRepo { return &ReactionsRepo{} }

// Add records a user's reaction. Idempotent (no error if it already exists).
func (r *ReactionsRepo) Add(ctx context.Context, q Querier, messageID, userID int64, emoji string) error {
	_, err := q.Exec(ctx,
		`INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)
		 ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
		messageID, userID, emoji)
	return err
}

// Remove deletes a user's reaction. Idempotent.
func (r *ReactionsRepo) Remove(ctx context.Context, q Querier, messageID, userID int64, emoji string) error {
	_, err := q.Exec(ctx,
		`DELETE FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`,
		messageID, userID, emoji)
	return err
}

// ReactionsFor returns aggregated counts per emoji for a message, most popular first.
func (r *ReactionsRepo) ReactionsFor(ctx context.Context, q Querier, messageID int64) ([]ReactionCount, error) {
	rows, err := q.Query(ctx,
		`SELECT emoji, count(*) FROM reactions WHERE message_id=$1
		 GROUP BY emoji ORDER BY count(*) DESC, emoji ASC`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReactionCount
	for rows.Next() {
		var rc ReactionCount
		if err := rows.Scan(&rc.Emoji, &rc.Count); err != nil {
			return nil, err
		}
		out = append(out, rc)
	}
	return out, rows.Err()
}
```

- [ ] **Step 5: Write the reactions repo test**

Create `backend/internal/messaging/reactions_repo_test.go`:
```go
package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestReactionsRepo_AddRemoveAggregate(t *testing.T) {
	pool := postgres.NewTestDB(t)
	chats := NewChatsRepo()
	msgs := NewMessagesRepo()
	reacts := NewReactionsRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+760")
	b := seedUser(t, pool, "+761")
	chatID, _ := chats.CreatePrivateChat(ctx, pool, a, b)
	seq, _ := msgs.NextSeq(ctx, pool, chatID)
	m, _ := msgs.Insert(ctx, pool, Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "x"})

	// Two users react with 🔥; b also adds ❤️.
	if err := reacts.Add(ctx, pool, m.ID, a, "🔥"); err != nil {
		t.Fatalf("add a fire: %v", err)
	}
	_ = reacts.Add(ctx, pool, m.ID, b, "🔥")
	_ = reacts.Add(ctx, pool, m.ID, b, "❤️")
	// Duplicate add is a no-op.
	_ = reacts.Add(ctx, pool, m.ID, a, "🔥")

	counts, err := reacts.ReactionsFor(ctx, pool, m.ID)
	if err != nil {
		t.Fatalf("ReactionsFor: %v", err)
	}
	if len(counts) != 2 || counts[0].Emoji != "🔥" || counts[0].Count != 2 {
		t.Fatalf("counts = %+v; want 🔥:2 first", counts)
	}

	// Remove a's 🔥 → count drops to 1.
	if err := reacts.Remove(ctx, pool, m.ID, a, "🔥"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	counts, _ = reacts.ReactionsFor(ctx, pool, m.ID)
	for _, c := range counts {
		if c.Emoji == "🔥" && c.Count != 1 {
			t.Fatalf("🔥 count = %d after remove; want 1", c.Count)
		}
	}
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/messaging/ -run 'GetMessageMeta|ReactionsRepo' -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/store/postgres/migrations/0003_reactions.sql backend/internal/messaging/messages_repo.go backend/internal/messaging/messages_repo_test.go backend/internal/messaging/reactions_repo.go backend/internal/messaging/reactions_repo_test.go
git commit -m "feat(backend): reactions table + repo + GetMessageMeta"
```

---

### Task 2: Reactions service (transactional + live fan-out)

**Files:**
- Create: `backend/internal/messaging/reactions_service.go`
- Create: `backend/internal/messaging/reactions_service_test.go`

- [ ] **Step 1: Add the reactions repo to the Service and write React**

Create `backend/internal/messaging/reactions_service.go`:
```go
package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// ErrBadReaction is returned for an empty or oversized emoji.
var ErrBadReaction = errors.New("invalid reaction")

const maxEmojiLen = 32

// reactions is a package-level repo instance (stateless, like the others).
var reactionsRepo = NewReactionsRepo()

// React adds or removes a user's reaction to a message in a chat, then appends a
// reaction update to every member and publishes it live. The chatID must match
// the message's chat and the user must be a member.
func (s *Service) React(ctx context.Context, chatID, messageID, userID int64, emoji string, add bool) error {
	if emoji == "" || len(emoji) > maxEmojiLen || !utf8.ValidString(emoji) {
		return ErrBadReaction
	}
	msgChat, err := s.msgs.GetMessageMeta(ctx, s.pool, messageID)
	if err != nil {
		return err // ErrNotFound if the message is gone
	}
	if msgChat != chatID {
		return ErrNotFound
	}
	ok, err := s.chats.IsMember(ctx, s.pool, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}

	var members []int64
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		if add {
			if e := reactionsRepo.Add(ctx, tx, messageID, userID, emoji); e != nil {
				return e
			}
		} else {
			if e := reactionsRepo.Remove(ctx, tx, messageID, userID, emoji); e != nil {
				return e
			}
		}
		m, e := s.chats.MemberIDs(ctx, tx, chatID)
		if e != nil {
			return e
		}
		members = m
		action := "remove"
		if add {
			action = "add"
		}
		payload, e := json.Marshal(reactionPayload(chatID, messageID, userID, emoji, action))
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := s.updates.AppendUpdate(ctx, tx, uid, 1, date, "reaction", payload); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if s.publisher != nil {
		action := "remove"
		if add {
			action = "add"
		}
		f := frame("reaction", reactionPayload(chatID, messageID, userID, emoji, action))
		for _, uid := range members {
			_ = s.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
}

// ReactionsOf returns aggregated reaction counts for a message the user can see.
func (s *Service) ReactionsOf(ctx context.Context, chatID, messageID, userID int64) ([]ReactionCount, error) {
	msgChat, err := s.msgs.GetMessageMeta(ctx, s.pool, messageID)
	if err != nil {
		return nil, err
	}
	if msgChat != chatID {
		return nil, ErrNotFound
	}
	ok, err := s.chats.IsMember(ctx, s.pool, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	return reactionsRepo.ReactionsFor(ctx, s.pool, messageID)
}

func reactionPayload(chatID, messageID, userID int64, emoji, action string) map[string]any {
	return map[string]any{
		"chat_id": chatID, "msg_id": messageID, "user_id": userID,
		"emoji": emoji, "action": action,
	}
}
```

- [ ] **Step 2: Write the reactions service test**

Create `backend/internal/messaging/reactions_service_test.go`:
```go
package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestService_React_FanoutAndAggregate(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	pub := &fakePublisher{}
	s.SetPublisher(pub)
	ctx := context.Background()
	a := seedUser(t, pool, "+770")
	b := seedUser(t, pool, "+771")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	msg, _ := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	pub.frames = nil // ignore the send fan-out

	// b reacts 🔥.
	if err := s.React(ctx, chatID, msg.ID, b, "🔥", true); err != nil {
		t.Fatalf("React add: %v", err)
	}
	if pub.countFor(a) != 1 || pub.countFor(b) != 1 {
		t.Fatalf("reaction fan-out wrong: a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}
	counts, _ := s.ReactionsOf(ctx, chatID, msg.ID, a)
	if len(counts) != 1 || counts[0].Emoji != "🔥" || counts[0].Count != 1 {
		t.Fatalf("counts = %+v", counts)
	}

	// Remove it.
	if err := s.React(ctx, chatID, msg.ID, b, "🔥", false); err != nil {
		t.Fatalf("React remove: %v", err)
	}
	counts, _ = s.ReactionsOf(ctx, chatID, msg.ID, a)
	if len(counts) != 0 {
		t.Fatalf("expected no reactions after remove, got %+v", counts)
	}
}

func TestService_React_Rejects(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+780")
	b := seedUser(t, pool, "+781")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	msg, _ := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})

	// Empty emoji rejected.
	if err := s.React(ctx, chatID, msg.ID, a, "", true); err != ErrBadReaction {
		t.Fatalf("expected ErrBadReaction, got %v", err)
	}
	// Non-member rejected.
	stranger := seedUser(t, pool, "+782")
	if err := s.React(ctx, chatID, msg.ID, stranger, "🔥", true); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for non-member, got %v", err)
	}
	// Wrong chat id for the message rejected.
	if err := s.React(ctx, chatID+999, msg.ID, a, "🔥", true); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for mismatched chat, got %v", err)
	}
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/messaging/ -run 'Service_React' -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/messaging/reactions_service.go backend/internal/messaging/reactions_service_test.go
git commit -m "feat(backend): React service (add/remove, pts fan-out, live publish)"
```

---

### Task 3: HTTP endpoints + router

**Files:**
- Modify: `backend/internal/transport/http/chat_handler.go`
- Modify: `backend/internal/transport/http/router.go`
- Modify: `backend/internal/transport/http/chat_handler_test.go`

- [ ] **Step 1: Add the reaction handlers**

In `backend/internal/transport/http/chat_handler.go`, add (the `pathInt`, `messageJSON`, `writeJSON`, `writeError` helpers already exist; reuse them):
```go
type reactionBody struct {
	Emoji string `json:"emoji"`
}

func (h *ChatHandler) AddReaction(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	var body reactionBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Emoji == "" {
		writeError(w, http.StatusBadRequest, "emoji is required")
		return
	}
	h.react(w, r, chatID, msgID, body.Emoji, true)
}

func (h *ChatHandler) RemoveReaction(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	emoji := chi.URLParam(r, "emoji")
	h.react(w, r, chatID, msgID, emoji, false)
}

func (h *ChatHandler) react(w http.ResponseWriter, r *http.Request, chatID, msgID int64, emoji string, add bool) {
	err := h.svc.React(r.Context(), chatID, msgID, h.meID(r), emoji, add)
	if errors.Is(err, messaging.ErrBadReaction) {
		writeError(w, http.StatusBadRequest, "invalid reaction")
		return
	}
	if errors.Is(err, messaging.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "reaction failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *ChatHandler) ListReactions(w http.ResponseWriter, r *http.Request) {
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	counts, err := h.svc.ReactionsOf(r.Context(), chatID, msgID, h.meID(r))
	if errors.Is(err, messaging.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load reactions")
		return
	}
	if counts == nil {
		counts = []messaging.ReactionCount{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"reactions": counts})
}
```
(The `chi` import is already present in `chat_handler.go`.)

- [ ] **Step 2: Mount the routes**

In `backend/internal/transport/http/router.go`, inside the protected group where the other chat routes are mounted, add:
```go
		pr.Post("/chats/{chatID}/messages/{msgID}/reactions", ch.AddReaction)
		pr.Delete("/chats/{chatID}/messages/{msgID}/reactions/{emoji}", ch.RemoveReaction)
		pr.Get("/chats/{chatID}/messages/{msgID}/reactions", ch.ListReactions)
```

- [ ] **Step 3: Write the handler test**

Append to `backend/internal/transport/http/chat_handler_test.go`:
```go
func TestReactions_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000020")
	_, idB := signUp(t, h, pool, "+79990000021")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	var created struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.ChatID)

	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenA, map[string]any{"text": "hi"})
	var msg struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &msg)
	mid := itoa(msg.ID)

	// Add 🔥.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages/"+mid+"/reactions", tokenA, map[string]string{"emoji": "🔥"})
	if rec.Code != http.StatusOK {
		t.Fatalf("add reaction: %d %s", rec.Code, rec.Body.String())
	}

	// List shows 🔥:1.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/messages/"+mid+"/reactions", tokenA, nil)
	var listed struct {
		Reactions []struct {
			Emoji string `json:"emoji"`
			Count int    `json:"count"`
		} `json:"reactions"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Reactions) != 1 || listed.Reactions[0].Emoji != "🔥" || listed.Reactions[0].Count != 1 {
		t.Fatalf("reactions = %+v", listed.Reactions)
	}

	// Remove it (emoji is URL-escaped by the client).
	rec = authedReq(t, h, http.MethodDelete, "/chats/"+cid+"/messages/"+mid+"/reactions/"+url.PathEscape("🔥"), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("remove reaction: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/messages/"+mid+"/reactions", tokenA, nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Reactions) != 0 {
		t.Fatalf("expected no reactions after remove, got %+v", listed.Reactions)
	}
}
```
Add `"net/url"` to the imports of `chat_handler_test.go`.

- [ ] **Step 4: Run the tests and build**

Run: `cd backend && go build ./... && go test ./internal/transport/http/ -run 'Reactions_HTTP' -v && go test ./...`
Expected: build clean; reaction test passes; whole suite green.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/transport/http/chat_handler.go backend/internal/transport/http/router.go backend/internal/transport/http/chat_handler_test.go
git commit -m "feat(backend): reaction REST endpoints (add/remove/list)"
```

---

### Task 4: Full-stack verification

**Files:** none (verification only).

- [ ] **Step 1: Whole suite + vet**

Run: `cd backend && go test ./... && go vet ./...`
Expected: all PASS, vet clean.

- [ ] **Step 2: End-to-end over docker**

Run:
```bash
cat > /tmp/plan-c3-stack.yml <<'EOF'
name: plan-c3-verify
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
    ports: ["18085:8080"]
EOF
docker compose -f /tmp/plan-c3-stack.yml up -d --build
sleep 6
B="localhost:18085"
curl -s -X POST $B/auth/request_code -d '{"phone":"+700"}' >/dev/null
TA=$(curl -s -X POST $B/auth/sign_in -d '{"phone":"+700","code":"12345"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl -s -X POST $B/auth/request_code -d '{"phone":"+701"}' >/dev/null
IDB=$(curl -s -X POST $B/auth/sign_in -d '{"phone":"+701","code":"12345"}' | sed 's/.*"id":\([0-9]*\).*/\1/')
CID=$(curl -s -X POST $B/chats -H "Authorization: Bearer $TA" -d "{\"user_id\":$IDB}" | sed 's/.*"chat_id":\([0-9]*\).*/\1/')
MID=$(curl -s -X POST $B/chats/$CID/messages -H "Authorization: Bearer $TA" -d '{"text":"hi"}' | sed 's/.*"id":\([0-9]*\).*/\1/')
echo "add:  $(curl -s -X POST $B/chats/$CID/messages/$MID/reactions -H "Authorization: Bearer $TA" -d '{"emoji":"🔥"}')"
echo "list: $(curl -s $B/chats/$CID/messages/$MID/reactions -H "Authorization: Bearer $TA")"
docker compose -f /tmp/plan-c3-stack.yml down -v
```
Expected: add returns `{"ok":true}`; list returns `{"reactions":[{"emoji":"🔥","count":1}]}`.

- [ ] **Step 3:** No code changes expected.

---

## Self-Review Notes

- **Spec coverage:** reactions table (§6), add/remove + aggregate, `reaction` update in the pts log + live publish (§5/§8), membership/chat checks. REST endpoints mounted under auth.
- **Out of scope:** presence + force-close revoked socket (Plan C4); enriching `GET /history` with per-message reaction counts in one round-trip (follow-up — current API exposes a per-message `GET .../reactions`).
- **Consistency with C2:** `React` follows the exact `Send`/`MarkRead` shape — transactional mutate + per-member `pts` append, publish the frame only after commit; `frame()`, `inTx`, `messageUpdatePayload` patterns reused. The `reaction` update flows through the same `/sync` difference path (it lands in `other_updates`).
- **Validation:** emoji must be non-empty, ≤32 bytes, valid UTF-8 (`ErrBadReaction`); message must belong to the path chat and the user must be a member (`ErrNotFound`→404).
- **Idempotency:** `Add` uses `ON CONFLICT DO NOTHING`, `Remove` is a plain delete — both safe to repeat.
- **Type consistency:** `ReactionsRepo`/`ReactionCount`, `Service.React`/`ReactionsOf`, `ErrBadReaction`, `GetMessageMeta`, handlers `AddReaction`/`RemoveReaction`/`ListReactions` used consistently across repo/service/transport.
```
