# Groups & Channels — Plan A2: Backend channels + search

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Spec: `docs/superpowers/specs/2026-06-24-groups-channels-design.md`. Builds on Plan A1 (merged).

**Goal:** Channels that scale to millions of subscribers — create, subscribe, admin-only posting via a **per-channel `pts` + `channel_updates` log + one `PUBLISH channel:{id}`** (no per-subscriber fan-out), `GET /channels/{id}/difference` catch-up, WS live delivery via a channel topic, plus public `@username` + `GET /search` and join-by-username.

**Architecture:** Reuse A1's `GroupRepo.CreateMultiMember(type='channel')` + membership (subscribers = role `subscriber`). Channel posts go in the existing `messages` table (so `GET /chats/{id}/history` already serves channel history) but delivery is **O(1) per post**: insert message → bump `chats.channel_pts` → append a `channel_updates` row → `PUBLISH channel:{id}` once. NO per-user `updates` rows, NO per-subscriber publishes. Live delivery: a client opens a channel → WS `subscribe_channel {chat_id}` → the Hub subscribes the Redis topic `channel:{id}` and routes posts to that conn; offline/closed clients catch up via `GET /channels/{id}/difference?pts=`.

**Tech Stack:** Go, chi, pgx, go-redis, gorilla/websocket, testcontainers + miniredis. Backend repo, branch `groups-channels-a2`. Commits end with the Co-Authored-By trailer.

**Verified facts:**
- Migration 0006 (A1) already created `channel_updates(id,channel_id,pts,pts_count,payload jsonb,created_at)` + `chats.channel_pts` + `chats.username citext unique` + `is_public`.
- `MessageRepo`: `NextSeq(ctx,chatID)`, `Insert(ctx,m)`, `GetHistory`. `chat.Interactor` has `tx TxManager`, `msgs MessageRepo`, `chats ChatRepo`, `groups GroupRepo`, `publisher EventPublisher`.
- realtime `RedisPublisher.PublishToUser(userID,frame)` + `UserChannel`. WS `Hub`: single `pubsub`, `run()` routes by channel prefix (`user:`/`device:`), `Register/Unregister`, `deliver(userID,frame)`, `Sink`. WS `Conn.dispatch` switch handles `ping/send_message/read/typing`.
- `domain.Rights` + `HasRight`; `Interactor.requireRight(ctx,chatID,userID,right)` (added in A1).

---

## Task 1: ChannelRepo (per-channel pts + updates log)

**Files:** Create `backend/internal/adapter/repo/postgres/channelrepo.go` + `channelrepo_test.go`; add `ChannelRepo` port to `usecase/chat/ports.go`.

- [ ] **Step 1: Port** — add to `ports.go`:

```go
type ChannelRepo interface {
	// AppendUpdate bumps the channel's pts by 1 and records the update; returns the new pts.
	AppendUpdate(ctx context.Context, channelID int64, payload json.RawMessage) (int64, error)
	UpdatesSince(ctx context.Context, channelID, sincePts int64, limit int) ([]domain.ChannelUpdate, error)
	CurrentPts(ctx context.Context, channelID int64) (int64, error)
}
```
Add `domain.ChannelUpdate` to `domain/chat.go`:
```go
type ChannelUpdate struct {
	Pts      int64
	PtsCount int
	Payload  []byte
}
```

- [ ] **Step 2: Failing test** — `channelrepo_test.go` (reuse `NewTestDB(t)` + `seedUser`):

```go
package postgres

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestChannelRepo_AppendAndSince(t *testing.T) {
	pool := NewTestDB(t)
	ctx := context.Background()
	u := seedUser(t, pool, "+7100")
	g := NewGroupRepo(pool)
	chID, _ := g.CreateMultiMember(ctx, "channel", "News", "", "", true, u)
	r := NewChannelRepo(pool)

	p1, err := r.AppendUpdate(ctx, chID, json.RawMessage(`{"msg_id":1}`))
	if err != nil || p1 != 1 { t.Fatalf("append1: pts=%d err=%v", p1, err) }
	p2, _ := r.AppendUpdate(ctx, chID, json.RawMessage(`{"msg_id":2}`))
	if p2 != 2 { t.Fatalf("append2 pts=%d", p2) }

	cur, _ := r.CurrentPts(ctx, chID)
	if cur != 2 { t.Fatalf("current pts=%d", cur) }

	ups, err := r.UpdatesSince(ctx, chID, 1, 100)
	if err != nil { t.Fatal(err) }
	if len(ups) != 1 || ups[0].Pts != 2 { t.Fatalf("since(1)=%+v", ups) }
	_ = domain.ChannelUpdate{}
}
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement `channelrepo.go`** — `AppendUpdate` bumps `chats.channel_pts` and inserts atomically (single statement with the bumped value; relies on the caller's tx or row lock). Use `UPDATE ... RETURNING channel_pts` then insert:

```go
package postgres

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/domain"
)

type ChannelRepo struct{ pool *pgxpool.Pool }

func NewChannelRepo(pool *pgxpool.Pool) *ChannelRepo { return &ChannelRepo{pool: pool} }

func (r *ChannelRepo) AppendUpdate(ctx context.Context, channelID int64, payload json.RawMessage) (int64, error) {
	q := querier(ctx, r.pool)
	var pts int64
	// atomically bump and read the channel pts (row-locked by the UPDATE)
	if err := q.QueryRow(ctx,
		`UPDATE chats SET channel_pts = channel_pts + 1 WHERE id=$1 RETURNING channel_pts`,
		channelID).Scan(&pts); err != nil {
		return 0, err
	}
	if _, err := q.Exec(ctx,
		`INSERT INTO channel_updates (channel_id, pts, pts_count, payload) VALUES ($1,$2,1,$3)`,
		channelID, pts, []byte(payload)); err != nil {
		return 0, err
	}
	return pts, nil
}

func (r *ChannelRepo) UpdatesSince(ctx context.Context, channelID, sincePts int64, limit int) ([]domain.ChannelUpdate, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT pts, pts_count, payload FROM channel_updates
		 WHERE channel_id=$1 AND pts>$2 ORDER BY pts ASC LIMIT $3`, channelID, sincePts, limit)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []domain.ChannelUpdate
	for rows.Next() {
		var u domain.ChannelUpdate
		if err := rows.Scan(&u.Pts, &u.PtsCount, &u.Payload); err != nil { return nil, err }
		out = append(out, u)
	}
	return out, rows.Err()
}

func (r *ChannelRepo) CurrentPts(ctx context.Context, channelID int64) (int64, error) {
	var pts int64
	err := querier(ctx, r.pool).QueryRow(ctx, `SELECT channel_pts FROM chats WHERE id=$1`, channelID).Scan(&pts)
	return pts, err
}

var _ = domain.ChannelUpdate{}
```
(Add `var _ usecasechat.ChannelRepo = (*ChannelRepo)(nil)` with the proper import, mirroring sibling repos.)

- [ ] **Step 5: Run — expect PASS.** `cd backend && go test ./internal/adapter/repo/postgres/ -run TestChannelRepo -v`

- [ ] **Step 6: Commit** (create branch first)

```bash
cd /Users/denisurevic/Documents/messenger-denis && git checkout -b groups-channels-a2
git add backend/internal/adapter/repo/postgres/channelrepo.go backend/internal/adapter/repo/postgres/channelrepo_test.go backend/internal/usecase/chat/ports.go backend/internal/domain/chat.go
git commit -m "feat(repo): ChannelRepo (per-channel pts + channel_updates log)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: SearchRepo (public chats + users)

**Files:** Create `backend/internal/adapter/repo/postgres/searchrepo.go` + `searchrepo_test.go`; add `SearchRepo` port.

- [ ] **Step 1: Port** — add to `ports.go`:

```go
type SearchRepo interface {
	SearchChats(ctx context.Context, q string, limit int) ([]domain.ChatCard, error) // public only
	SearchUsers(ctx context.Context, q string, limit int) ([]domain.UserCard, error)
	PublicChatByUsername(ctx context.Context, username string) (int64, error) // domain.ErrNotFound
}
```

- [ ] **Step 2: Failing test** — `searchrepo_test.go`:

```go
package postgres

import (
	"context"
	"testing"
)

func TestSearchRepo(t *testing.T) {
	pool := NewTestDB(t)
	ctx := context.Background()
	u := seedUser(t, pool, "+7200")
	g := NewGroupRepo(pool)
	_, _ = g.CreateMultiMember(ctx, "channel", "Go News Daily", "", "gonews", true, u)
	_, _ = g.CreateMultiMember(ctx, "channel", "Private Thing", "", "", false, u) // not public
	r := NewSearchRepo(pool)

	chats, err := r.SearchChats(ctx, "gonews", 10)
	if err != nil { t.Fatal(err) }
	if len(chats) != 1 || chats[0].Username != "gonews" { t.Fatalf("by username: %+v", chats) }

	byTitle, _ := r.SearchChats(ctx, "Go New", 10)
	if len(byTitle) != 1 { t.Fatalf("by title: %+v", byTitle) }

	id, err := r.PublicChatByUsername(ctx, "gonews")
	if err != nil || id == 0 { t.Fatalf("resolve username: %d %v", id, err) }
	if _, err := r.PublicChatByUsername(ctx, "nope"); err == nil { t.Fatal("expected not found") }
}
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement `searchrepo.go`** — `ILIKE` prefix on username + title (public only); users by username/display_name:

```go
package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/domain"
)

type SearchRepo struct{ pool *pgxpool.Pool }

func NewSearchRepo(pool *pgxpool.Pool) *SearchRepo { return &SearchRepo{pool: pool} }

func (r *SearchRepo) SearchChats(ctx context.Context, q string, limit int) ([]domain.ChatCard, error) {
	like := q + "%"
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT id, type, title, COALESCE(username,''), about, member_count, is_public
		   FROM chats
		  WHERE is_public = true AND (username ILIKE $1 OR title ILIKE $2)
		  ORDER BY member_count DESC LIMIT $3`, like, q+"%", limit)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []domain.ChatCard
	for rows.Next() {
		var c domain.ChatCard
		if err := rows.Scan(&c.ID, &c.Type, &c.Title, &c.Username, &c.About, &c.MemberCount, &c.IsPublic); err != nil { return nil, err }
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *SearchRepo) SearchUsers(ctx context.Context, q string, limit int) ([]domain.UserCard, error) {
	like := q + "%"
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT id, COALESCE(username,''), display_name, COALESCE(avatar_url,'')
		   FROM users WHERE username ILIKE $1 OR display_name ILIKE $2 LIMIT $3`, like, q+"%", limit)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []domain.UserCard
	for rows.Next() {
		var u domain.UserCard
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.AvatarURL); err != nil { return nil, err }
		out = append(out, u)
	}
	return out, rows.Err()
}

func (r *SearchRepo) PublicChatByUsername(ctx context.Context, username string) (int64, error) {
	var id int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id FROM chats WHERE username=$1 AND is_public=true`, username).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) { return 0, domain.ErrNotFound }
	return id, err
}

var _ usecasechatSearchRepoAssert = (*SearchRepo)(nil)
```
(Replace the assert line with a proper `var _ usecasechat.SearchRepo = (*SearchRepo)(nil)` + the chat usecase import, mirroring siblings.)

- [ ] **Step 5: Run — expect PASS.** `cd backend && go test ./internal/adapter/repo/postgres/ -run TestSearchRepo -v`

- [ ] **Step 6: Commit**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add backend/internal/adapter/repo/postgres/searchrepo.go backend/internal/adapter/repo/postgres/searchrepo_test.go backend/internal/usecase/chat/ports.go
git commit -m "feat(repo): SearchRepo (public chats by username/title, users, resolve username)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Channel publisher + WS topic subscription

**Files:** Modify `backend/internal/adapter/realtime/redis/publisher.go`, `backend/internal/adapter/delivery/ws/hub.go`, `backend/internal/adapter/delivery/ws/conn.go`; modify `hub_test.go` (extend).

**Context:** Add `channel:{id}` topic publishing + Hub routing + per-conn channel subscription driven by WS frames `subscribe_channel`/`unsubscribe_channel`.

- [ ] **Step 1: Publisher** — in `publisher.go` add:

```go
// ChannelTopic is the Redis pub/sub topic for a channel's posts.
func ChannelTopic(channelID int64) string { return fmt.Sprintf("channel:%d", channelID) }

func (p *RedisPublisher) PublishToChannel(ctx context.Context, channelID int64, frame []byte) error {
	return p.rdb.Publish(ctx, ChannelTopic(channelID), frame).Err()
}
```

- [ ] **Step 2: Hub channel routing** — in `hub.go`:
  1. Add a `channelSubs map[int64]map[Sink]struct{}` field (+ init in the constructor) protected by the existing mutex.
  2. `channelTopic(id int64) string { return "channel:" + strconv.FormatInt(id, 10) }`.
  3. In `run()`, after the `user:`/`device:` checks, add: `else if chID, ok := idFromChannel(msg.Channel, "channel:"); ok { h.deliverChannel(chID, []byte(msg.Payload)) }`.
  4. Methods:
  ```go
  func (h *Hub) SubscribeChannel(ctx context.Context, channelID int64, s Sink) {
  	h.mu.Lock()
  	subs := h.channelSubs[channelID]
  	if subs == nil { subs = map[Sink]struct{}{}; h.channelSubs[channelID] = subs }
  	first := len(subs) == 0
  	subs[s] = struct{}{}
  	h.mu.Unlock()
  	if first { _ = h.pubsub.Subscribe(ctx, channelTopic(channelID)) }
  }
  func (h *Hub) UnsubscribeChannel(ctx context.Context, channelID int64, s Sink) {
  	h.mu.Lock()
  	subs := h.channelSubs[channelID]
  	if subs != nil {
  		delete(subs, s)
  		if len(subs) == 0 { delete(h.channelSubs, channelID); h.mu.Unlock(); _ = h.pubsub.Unsubscribe(ctx, channelTopic(channelID)); return }
  	}
  	h.mu.Unlock()
  }
  func (h *Hub) deliverChannel(channelID int64, frame []byte) {
  	h.mu.RLock()
  	subs := h.channelSubs[channelID]
  	sinks := make([]Sink, 0, len(subs))
  	for s := range subs { sinks = append(sinks, s) }
  	h.mu.RUnlock()
  	for _, s := range sinks { s.Send(frame) }
  }
  ```
  (Match the existing mutex type — if the hub uses `sync.Mutex` not RWMutex, use `Lock`/`Unlock` in `deliverChannel` too. Read the file.)
  5. In `Unregister`, also drop the sink from all `channelSubs` (so a disconnecting conn doesn't leak channel subscriptions). Add a loop removing `s` from every channel set + unsubscribe empties.

- [ ] **Step 3: Conn frames** — in `conn.go` `dispatch`, add cases:

```go
	case "subscribe_channel":
		var d struct{ ChatID int64 `json:"chat_id"` }
		if json.Unmarshal(f.D, &d) == nil && d.ChatID != 0 {
			c.hub.SubscribeChannel(ctx, d.ChatID, c) // c is the Sink (Conn implements Send)
		}
	case "unsubscribe_channel":
		var d struct{ ChatID int64 `json:"chat_id"` }
		if json.Unmarshal(f.D, &d) == nil && d.ChatID != 0 {
			c.hub.UnsubscribeChannel(ctx, d.ChatID, c)
		}
```
(Confirm `Conn` already satisfies `Sink` — it's registered via `Register(...,c)`. The `Conn` has access to `c.hub`. Read conn.go to match field names; if the hub isn't held on Conn, thread it in.)

- [ ] **Step 4: Test** — extend `hub_test.go`: subscribe a fake sink to channel 5, publish via the hub's pubsub path (or call `deliverChannel` directly through a published `channel:5` message using the existing test harness/miniredis), assert the sink received the frame; unsubscribe → no delivery. Mirror the existing user-delivery test style.

- [ ] **Step 5: Run** `cd backend && go build ./... && go test ./internal/adapter/delivery/ws/... ./internal/adapter/realtime/...` — green.

- [ ] **Step 6: Commit**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add backend/internal/adapter/realtime/redis/publisher.go backend/internal/adapter/delivery/ws/hub.go backend/internal/adapter/delivery/ws/conn.go backend/internal/adapter/delivery/ws/hub_test.go
git commit -m "feat(ws): channel topic publish + Hub channel subscriptions + subscribe_channel frames

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Channel usecase (create/post/difference/join) + search/peers

**Files:** Create `backend/internal/usecase/chat/channel.go` + `channel_test.go`; modify `chat.go` (add `channels ChannelRepo`, `search SearchRepo`, optional `ChannelPublisher`); modify `internal/app/providers.go` + `app.go`.

**Context:** Wire `channels`/`search` repos into the Interactor (New trailing params, update all call sites + fx). Add a `ChannelPublisher` port (`PublishToChannel`) set like `SetPublisher` (the RedisPublisher implements it).

- [ ] **Step 1: Ports + wiring** — in `ports.go` add `ChannelPublisher interface { PublishToChannel(ctx, channelID int64, frame []byte) error }`. In `chat.go`: add fields `channels ChannelRepo`, `search SearchRepo`, `chPub ChannelPublisher`; New() trailing params for channels+search; `SetChannelPublisher(p ChannelPublisher)`. Update `providers.go` (pass `NewChannelRepo`/`NewSearchRepo`; call `SetChannelPublisher(redisPublisher)` where `SetPublisher` is already called) + `app.go` fx providers + test call sites (nil where unused).

- [ ] **Step 2: Failing test** — `channel_test.go` (fakes; extend the in-package fakes with `fakeChannelRepo`/`fakeSearchRepo`, a recording `fakeChannelPublisher`):

```go
package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestCreateChannel_CreatorIsCreator(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	id, err := i.CreateChannel(context.Background(), 7, "News", "", "news", true)
	if err != nil { t.Fatal(err) }
	m, _ := fg.GetMember(context.Background(), id, 7)
	if m.Role != domain.RoleCreator { t.Fatalf("role=%q", m.Role) }
}

func TestPostToChannel_RequiresPostRight_AndPublishes(t *testing.T) {
	i, fg, _, fpub := newChannelTestInteractor(t)
	id, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	_ = fg.AddMember(context.Background(), id, 8, domain.RoleSubscriber, 0)
	// subscriber cannot post
	if _, err := i.PostToChannel(context.Background(), id, 8, "hi", ""); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("subscriber post = %v", err)
	}
	// creator posts → published once to the channel topic
	msg, err := i.PostToChannel(context.Background(), id, 7, "hello world", "c1")
	if err != nil { t.Fatal(err) }
	if msg.Seq == 0 { t.Fatal("no seq") }
	if fpub.count != 1 { t.Fatalf("publishes=%d, want 1", fpub.count) }
}

func TestGetChannelDifference(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	id, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	_, _ = i.PostToChannel(context.Background(), id, 7, "a", "")
	_, _ = i.PostToChannel(context.Background(), id, 7, "b", "")
	ups, err := i.GetChannelDifference(context.Background(), id, 7, 1, 100)
	if err != nil { t.Fatal(err) }
	if len(ups) != 1 { t.Fatalf("diff since 1 = %d", len(ups)) }
}

func TestJoinPublicChannel(t *testing.T) {
	i, fg, fs, _ := newChannelTestInteractor(t)
	id, _ := i.CreateChannel(context.Background(), 7, "News", "", "news", true)
	fs.usernames["news"] = id
	if err := i.JoinPublic(context.Background(), "news", 9); err != nil { t.Fatal(err) }
	if _, err := fg.GetMember(context.Background(), id, 9); err != nil { t.Fatal("joiner not subscriber") }
}
```
Provide `newChannelTestInteractor` + the fakes in `channel_test.go`.

- [ ] **Step 3: Implement `channel.go`**:

```go
package chat

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

func (i *Interactor) CreateChannel(ctx context.Context, creatorID int64, title, about, username string, isPublic bool) (int64, error) {
	var chatID int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		id, e := i.groups.CreateMultiMember(ctx, "channel", title, about, username, isPublic, creatorID)
		if e != nil { return e }
		chatID = id
		return i.groups.AddMember(ctx, id, creatorID, domain.RoleCreator, domain.AllRights)
	})
	return chatID, err
}

// PostToChannel inserts a channel message and delivers it O(1): bump channel_pts,
// append a channel_update, then PUBLISH once to channel:{id}. No per-subscriber fan-out.
func (i *Interactor) PostToChannel(ctx context.Context, channelID, actorID int64, text, clientMsgID string) (domain.Message, error) {
	if err := i.requireRight(ctx, channelID, actorID, domain.RightPostMessages); err != nil {
		return domain.Message{}, err
	}
	var msg domain.Message
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		seq, e := i.msgs.NextSeq(ctx, channelID)
		if e != nil { return e }
		m, e := i.msgs.Insert(ctx, domain.Message{
			ChatID: channelID, Seq: seq, SenderID: actorID, Type: "text", Text: text, ClientMsgID: clientMsgID,
		})
		if e != nil { return e }
		msg = m
		payload, _ := json.Marshal(map[string]any{
			"chat_id": channelID, "msg_id": m.ID, "seq": m.Seq, "sender_id": actorID,
			"type": "text", "text": text, "media_id": nil, "created_at": m.CreatedAt,
		})
		_, e = i.channels.AppendUpdate(ctx, channelID, payload)
		return e
	})
	if err != nil { return domain.Message{}, err }
	// publish once after commit
	if i.chPub != nil {
		frame, _ := json.Marshal(map[string]any{"t": "new_message", "d": map[string]any{
			"chat_id": channelID, "msg_id": msg.ID, "seq": msg.Seq, "sender_id": actorID,
			"type": "text", "text": text, "media_id": nil, "created_at": msg.CreatedAt,
		}})
		_ = i.chPub.PublishToChannel(ctx, channelID, frame)
	}
	return msg, nil
}

func (i *Interactor) GetChannelDifference(ctx context.Context, channelID, userID, sincePts int64, limit int) ([]domain.ChannelUpdate, error) {
	ok, err := i.chats.IsMember(ctx, channelID, userID)
	if err != nil { return nil, err }
	if !ok { return nil, domain.ErrForbidden }
	if limit <= 0 || limit > 100 { limit = 100 }
	return i.channels.UpdatesSince(ctx, channelID, sincePts, limit)
}

func (i *Interactor) JoinPublic(ctx context.Context, username string, userID int64) error {
	id, err := i.search.PublicChatByUsername(ctx, username)
	if err != nil { return err }
	return i.groups.AddMember(ctx, id, userID, domain.RoleSubscriber, 0)
}

func (i *Interactor) SearchChats(ctx context.Context, q string, limit int) ([]domain.ChatCard, error) {
	if limit <= 0 || limit > 50 { limit = 20 }
	return i.search.SearchChats(ctx, q, limit)
}

func (i *Interactor) SearchUsers(ctx context.Context, q string, limit int) ([]domain.UserCard, error) {
	if limit <= 0 || limit > 50 { limit = 20 }
	return i.search.SearchUsers(ctx, q, limit)
}
```
> Confirm `domain.Message` field names (`ClientMsgID`, `CreatedAt`) from `domain/chat.go`; adjust if different. `IsMember` is on `ChatRepo` (A1/existing).

- [ ] **Step 4: Run — expect PASS.** `cd backend && go build ./... && go test ./internal/usecase/chat/... -run 'Channel'`

- [ ] **Step 5: Commit**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add backend/internal/usecase/chat/channel.go backend/internal/usecase/chat/channel_test.go backend/internal/usecase/chat/chat.go backend/internal/usecase/chat/ports.go backend/internal/usecase/chat/fakes_test.go backend/internal/app/providers.go backend/internal/app/app.go
git commit -m "feat(usecase): channels (create/post O(1)/difference/join-public) + search

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: HTTP handlers + router

**Files:** Modify `backend/internal/adapter/delivery/http/group_handler.go` (add channel handlers there, or a new `channel_handler.go`); `router.go`; `channel_handler_test.go`.

- [ ] **Step 1: Handlers** — add (new file `channel_handler.go`, `ChannelHandler{uc *usecasechat.Interactor}` reusing the same `mapErr` shape):

```go
func (h *ChannelHandler) Create(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct{ Title, About, Username string `json:"-"`; IsPublic bool `json:"is_public"` }
	// decode with proper tags:
	var body struct {
		Title    string `json:"title"`
		About    string `json:"about"`
		Username string `json:"username"`
		IsPublic bool   `json:"is_public"`
	}
	_ = b
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Title) == "" {
		writeError(w, http.StatusBadRequest, "title required"); return
	}
	id, err := h.uc.CreateChannel(r.Context(), user.ID, body.Title, body.About, body.Username, body.IsPublic)
	if err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]any{"chat_id": id})
}

func (h *ChannelHandler) Post(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID"); if !ok { return }
	var body struct{ Text, ClientMsgID string }
	var bb struct {
		Text        string `json:"text"`
		ClientMsgID string `json:"client_msg_id"`
	}
	_ = body
	_ = json.NewDecoder(r.Body).Decode(&bb)
	msg, err := h.uc.PostToChannel(r.Context(), chatID, user.ID, bb.Text, bb.ClientMsgID)
	if err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]any{"id": msg.ID, "chat_id": msg.ChatID, "seq": msg.Seq, "created_at": msg.CreatedAt})
}

func (h *ChannelHandler) Difference(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID"); if !ok { return }
	pts, _ := strconv.ParseInt(r.URL.Query().Get("pts"), 10, 64)
	ups, err := h.uc.GetChannelDifference(r.Context(), chatID, user.ID, pts, 100)
	if err != nil { h.mapErr(w, err); return }
	raw := make([]json.RawMessage, 0, len(ups))
	var maxPts int64 = pts
	for _, u := range ups { raw = append(raw, json.RawMessage(u.Payload)); if u.Pts > maxPts { maxPts = u.Pts } }
	writeJSON(w, http.StatusOK, map[string]any{"updates": raw, "pts": maxPts, "slice": len(ups) == 100})
}

func (h *ChannelHandler) Join(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var body struct{ Username string `json:"username"` }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Username == "" { writeError(w, http.StatusBadRequest, "username required"); return }
	if err := h.uc.JoinPublic(r.Context(), body.Username, user.ID); err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *ChannelHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	chats, _ := h.uc.SearchChats(r.Context(), q, 20)
	users, _ := h.uc.SearchUsers(r.Context(), q, 20)
	co := make([]map[string]any, 0, len(chats))
	for _, c := range chats { co = append(co, map[string]any{"id": c.ID, "type": c.Type, "title": c.Title, "username": c.Username, "member_count": c.MemberCount}) }
	uo := make([]map[string]any, 0, len(users))
	for _, u := range users { uo = append(uo, map[string]any{"id": u.ID, "username": u.Username, "display_name": u.DisplayName, "avatar_url": u.AvatarURL}) }
	writeJSON(w, http.StatusOK, map[string]any{"chats": co, "users": uo})
}
```
(Clean up the throwaway `b`/`body` decode scaffolding — use a single tagged struct per handler. The duplication above is illustrative; the implementer should write ONE clean tagged struct each.)

- [ ] **Step 2: Router** — Bearer group:
```go
		chh := NewChannelHandler(chatUC)
		pr.Post("/channels", chh.Create)
		pr.Post("/channels/{chatID}/messages", chh.Post)
		pr.Get("/channels/{chatID}/difference", chh.Difference)
		pr.Post("/channels/join", chh.Join)
		pr.Get("/search", chh.Search)
```

- [ ] **Step 3: Test** — `channel_handler_test.go` (reuse the integration harness): create channel → 200; subscriber post → 403; creator post → 200 + seq; difference returns posts; search finds the public channel by username; join public → 200 + membership (card member_count grows).

- [ ] **Step 4: Run** `cd backend && go build ./... && go test ./internal/adapter/delivery/http/... -run 'Channel'`

- [ ] **Step 5: Commit**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add backend/internal/adapter/delivery/http/channel_handler.go backend/internal/adapter/delivery/http/channel_handler_test.go backend/internal/adapter/delivery/http/router.go
git commit -m "feat(http): channel endpoints (create/post/difference/join) + GET /search

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Docs + full suite + merge + smoke

- [ ] **Step 1: contracts.md + openapi** — add a "## Channels" section: `POST /channels`, `POST /channels/{id}/messages` (POST_MESSAGES right; O(1) delivery note), `GET /channels/{id}/difference?pts=` (→ `{updates, pts, slice}`), `POST /channels/join {username}`, `GET /search?q=` (→ `{chats, users}`), and the WS frames `subscribe_channel`/`unsubscribe_channel`. Note the scalability model (per-channel pts + topic, no per-subscriber fan-out). Mirror in openapi.yaml.

- [ ] **Step 2: Full suite** — `cd backend && go build ./... && go vet ./... && go test ./...` — all green (Docker). Report summary. STOP + report if any FAILURE.

- [ ] **Step 3: Commit + merge**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add docs/contracts.md backend/internal/openapi/openapi.yaml
git commit -m "docs: channels + search API (contracts + openapi)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git checkout master && git merge --no-ff groups-channels-a2 -m "Merge groups-channels-a2: backend channels (scalable post/difference/topic) + search"
```

- [ ] **Step 4: Smoke (curl on :38080)** — rebuild verify backend; create a public channel (A), post as A (200 + seq), subscriber B joins by username, `GET /channels/{id}/difference?pts=0` returns the posts, B (subscriber) post → 403, `GET /search?q=` finds the channel + a user. (Use `CH` not `GID`/`GRP` — `GID` is a zsh-readonly var.)

---

## Self-Review (author checklist — completed)

- **Scale model honored:** post = 1 message insert + 1 pts bump + 1 channel_updates row + **1** publish; NO per-subscriber rows/publishes. Catch-up via `channel_updates` pull. ✓
- **Reuse:** channel history = existing `GET /chats/{id}/history`; membership/mute/card = A1 `GroupRepo`; read receipts = existing. Only *new-post delivery* is channel-specific. ✓
- **WS topic:** Hub subscribes `channel:{id}` lazily (first local subscriber) and drops on last/Unregister; client opts in via `subscribe_channel`. ✓
- **Permissions:** post gated by POST_MESSAGES via `requireRight`; difference gated by membership. ✓
- **Wiring:** New() trailing params + fx + all call sites (mirror A1's approach which touched providers.go, app.go, test constructors). ✓
- **Placeholders:** complete repo/usecase code; handler structs shown with a note to use one clean tagged struct each; tests reuse the established harness. ✓
```
