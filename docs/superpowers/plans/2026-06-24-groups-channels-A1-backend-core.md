# Groups & Channels — Plan A1: Backend multi-member core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Spec: `docs/superpowers/specs/2026-06-24-groups-channels-design.md`.

**Goal:** Backend foundation for multi-member chats focused on **groups**: schema (chats/members extensions, invite_links, channel_updates), granular permissions, and group lifecycle — create, members (add/kick/leave), admins (promote/demote + rights), edit info, per-chat mute, invite links, chat card, and a batch `GET /users`. (Channels' posting/difference/search = Plan A2.)

**Architecture:** Extend the existing `internal/usecase/chat` package + `adapter/repo/postgres` + `adapter/delivery/http`, following established patterns (TxManager carries the tx in ctx; repos use `querier(ctx, pool)`; handlers use `UserFromContext`/`writeJSON`/`writeError`/`pathInt`). Roles stay TEXT in `chat_members.role` (`creator|admin|member|subscriber`), plus a new `rights int` bitmask. Clean-arch layering preserved (domain ← usecase ← adapter).

**Tech Stack:** Go, chi, pgx, goose migrations, testcontainers-go (PG). Backend repo, branch `groups-channels-a1`. Commits end with the Co-Authored-By trailer.

**Verified existing facts:**
- `chat_members(chat_id,user_id,role TEXT default 'member',last_read_seq,unread_count,muted bool,joined_at, PK(chat_id,user_id))`, index on `(user_id)`.
- `chats(id,type,last_seq,created_at)`. `users` already has `id,phone,username,display_name,avatar_url`.
- `usecase/chat` Interactor has `tx TxManager`, `chats ChatRepo`, `msgs MessageRepo`, `updates UpdateRepo`, publisher/notifier; `CreatePrivateChat` shows the tx pattern.
- Handlers: `UserFromContext(ctx)→(domain.User,ok)`, `DeviceIDFromContext`, `pathInt(w,r,name)`, `writeJSON`, `writeError`. Router groups authed routes under `AuthMiddleware`.

---

## Task 1: Migration 0006 + domain + permission bitmask

**Files:** Create `backend/internal/store/postgres/migrations/0006_groups_channels.sql`; modify `backend/internal/domain/chat.go`; create `backend/internal/domain/rights.go` + `backend/internal/domain/rights_test.go`.

- [ ] **Step 1: Migration** — `0006_groups_channels.sql`:

```sql
-- +goose Up
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE chats
  ADD COLUMN title           TEXT NOT NULL DEFAULT '',
  ADD COLUMN username        CITEXT,
  ADD COLUMN about           TEXT NOT NULL DEFAULT '',
  ADD COLUMN photo_media_id  BIGINT,
  ADD COLUMN creator_id      BIGINT,
  ADD COLUMN member_count    INT NOT NULL DEFAULT 0,
  ADD COLUMN is_public       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN channel_pts     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN pinned_msg_id   BIGINT;
CREATE UNIQUE INDEX idx_chats_username ON chats (username) WHERE username IS NOT NULL;

ALTER TABLE chat_members
  ADD COLUMN rights INT NOT NULL DEFAULT 0;

CREATE TABLE channel_updates (
  id         BIGSERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  pts        BIGINT NOT NULL,
  pts_count  INT NOT NULL DEFAULT 1,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_channel_updates ON channel_updates (channel_id, pts);

CREATE TABLE invite_links (
  id          BIGSERIAL PRIMARY KEY,
  chat_id     BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  created_by  BIGINT NOT NULL,
  expires_at  TIMESTAMPTZ,
  usage_limit INT,
  uses        INT NOT NULL DEFAULT 0,
  revoked     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invite_links_chat ON invite_links (chat_id);

-- +goose Down
DROP TABLE invite_links;
DROP TABLE channel_updates;
ALTER TABLE chat_members DROP COLUMN rights;
DROP INDEX IF EXISTS idx_chats_username;
ALTER TABLE chats
  DROP COLUMN title, DROP COLUMN username, DROP COLUMN about, DROP COLUMN photo_media_id,
  DROP COLUMN creator_id, DROP COLUMN member_count, DROP COLUMN is_public,
  DROP COLUMN channel_pts, DROP COLUMN pinned_msg_id;
```

- [ ] **Step 2: domain rights** — create `backend/internal/domain/rights.go`:

```go
package domain

// Admin rights bitmask for group/channel members (role 'admin'). The creator
// implicitly has all rights.
type Rights int

const (
	RightPostMessages   Rights = 1 << 0
	RightEditMessages   Rights = 1 << 1
	RightDeleteMessages Rights = 1 << 2
	RightBanUsers       Rights = 1 << 3
	RightInviteUsers    Rights = 1 << 4
	RightPinMessages    Rights = 1 << 5
	RightChangeInfo     Rights = 1 << 6
	RightManageAdmins   Rights = 1 << 7

	AllRights Rights = RightPostMessages | RightEditMessages | RightDeleteMessages |
		RightBanUsers | RightInviteUsers | RightPinMessages | RightChangeInfo | RightManageAdmins
)

// Roles stored in chat_members.role.
const (
	RoleCreator    = "creator"
	RoleAdmin      = "admin"
	RoleMember     = "member"     // group member (may post)
	RoleSubscriber = "subscriber" // channel subscriber (read-only)
)

// Has reports whether a (role, rights) pair grants r. Creator → always true.
func HasRight(role string, rights Rights, r Rights) bool {
	if role == RoleCreator {
		return true
	}
	if role == RoleAdmin {
		return rights&r == r
	}
	return false
}
```

- [ ] **Step 3: domain entities** — in `backend/internal/domain/chat.go` add:

```go
// Member is a full membership row (role + admin rights + mute).
type Member struct {
	ChatID, UserID int64
	Role           string
	Rights         Rights
	Muted          bool
}

// ChatCard is the read model for a group/channel info screen.
type ChatCard struct {
	ID          int64
	Type        string
	Title       string
	Username    string
	About       string
	PhotoMediaID *int64
	CreatorID   int64
	MemberCount int
	IsPublic    bool
	MyRole      string
	MyRights    Rights
	Muted       bool
}

// InviteLink is a join token for a chat.
type InviteLink struct {
	ID         int64
	ChatID     int64
	Token      string
	CreatedBy  int64
	UsageLimit *int
	Uses       int
	Revoked    bool
}

// UserCard is a minimal public user record (batch lookups, sender names).
type UserCard struct {
	ID          int64
	Username    string
	DisplayName string
	AvatarURL   string
}
```

- [ ] **Step 4: rights unit test** — `backend/internal/domain/rights_test.go`:

```go
package domain

import "testing"

func TestHasRight(t *testing.T) {
	if !HasRight(RoleCreator, 0, RightBanUsers) {
		t.Fatal("creator must have every right")
	}
	if !HasRight(RoleAdmin, RightPostMessages|RightPinMessages, RightPinMessages) {
		t.Fatal("admin with the bit set must pass")
	}
	if HasRight(RoleAdmin, RightPostMessages, RightBanUsers) {
		t.Fatal("admin without the bit must fail")
	}
	if HasRight(RoleMember, AllRights, RightPostMessages) {
		t.Fatal("plain member has no admin rights")
	}
}
```

- [ ] **Step 5: Run** `cd backend && go test ./internal/domain/... && go build ./...` — pass + clean (the migration is embedded; build proves it compiles into the binary).

- [ ] **Step 6: Commit**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git checkout -b groups-channels-a1 2>/dev/null || git checkout groups-channels-a1
git add backend/internal/store/postgres/migrations/0006_groups_channels.sql backend/internal/domain/
git commit -m "feat(domain): groups/channels schema (0006) + rights bitmask + entities

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: GroupRepo — membership, roles, card, mute, counts

**Files:** Create `backend/internal/adapter/repo/postgres/grouprepo.go` + `grouprepo_test.go`; add port methods to `backend/internal/usecase/chat/ports.go`.

**Context:** A new `GroupRepo` struct in the postgres adapter holding `pool` (mirror `ChatsRepo`). All methods use `querier(ctx, r.pool)`. Add the corresponding interface (`GroupRepo`) to `usecase/chat/ports.go`.

- [ ] **Step 1: Port interface** — add to `usecase/chat/ports.go`:

```go
type GroupRepo interface {
	CreateMultiMember(ctx context.Context, typ, title, about, username string, isPublic bool, creatorID int64) (int64, error)
	AddMember(ctx context.Context, chatID, userID int64, role string, rights domain.Rights) error
	RemoveMember(ctx context.Context, chatID, userID int64) error
	GetMember(ctx context.Context, chatID, userID int64) (domain.Member, error) // domain.ErrNotFound if not a member
	SetRole(ctx context.Context, chatID, userID int64, role string, rights domain.Rights) error
	SetMuted(ctx context.Context, chatID, userID int64, muted bool) error
	Card(ctx context.Context, chatID, viewerID int64) (domain.ChatCard, error) // domain.ErrNotFound if no chat
	EditInfo(ctx context.Context, chatID int64, title, about, username string) error
	UsersByIDs(ctx context.Context, ids []int64) ([]domain.UserCard, error)
}
```

- [ ] **Step 2: Failing test** — `grouprepo_test.go` (mirror `chatrepos_test.go`'s testcontainers harness — reuse its `newTestPool(t)`/`insertUser` helpers; if they're unexported in that file, add a shared `repotest_test.go` helper OR duplicate minimally):

```go
package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestGroupRepo_CreateAndMembership(t *testing.T) {
	pool := newTestPool(t) // existing helper from chatrepos_test.go
	ctx := context.Background()
	u1 := insertUser(t, pool, "+7001")
	u2 := insertUser(t, pool, "+7002")
	r := NewGroupRepo(pool)

	chatID, err := r.CreateMultiMember(ctx, "group", "My Group", "about", "", false, u1)
	if err != nil { t.Fatal(err) }
	if err := r.AddMember(ctx, chatID, u1, domain.RoleCreator, domain.AllRights); err != nil { t.Fatal(err) }
	if err := r.AddMember(ctx, chatID, u2, domain.RoleMember, 0); err != nil { t.Fatal(err) }

	m, err := r.GetMember(ctx, chatID, u2)
	if err != nil || m.Role != domain.RoleMember { t.Fatalf("member: %+v %v", m, err) }

	card, err := r.Card(ctx, chatID, u1)
	if err != nil { t.Fatal(err) }
	if card.Title != "My Group" || card.MemberCount != 2 || card.MyRole != domain.RoleCreator {
		t.Fatalf("card: %+v", card)
	}

	if err := r.SetRole(ctx, chatID, u2, domain.RoleAdmin, domain.RightPostMessages); err != nil { t.Fatal(err) }
	m2, _ := r.GetMember(ctx, chatID, u2)
	if m2.Role != domain.RoleAdmin || m2.Rights != domain.RightPostMessages { t.Fatalf("promote: %+v", m2) }

	if err := r.SetMuted(ctx, chatID, u2, true); err != nil { t.Fatal(err) }
	m3, _ := r.GetMember(ctx, chatID, u2)
	if !m3.Muted { t.Fatal("mute not set") }

	if err := r.RemoveMember(ctx, chatID, u2); err != nil { t.Fatal(err) }
	if _, err := r.GetMember(ctx, chatID, u2); err == nil { t.Fatal("expected not-member after remove") }
	card2, _ := r.Card(ctx, chatID, u1)
	if card2.MemberCount != 1 { t.Fatalf("count after remove = %d", card2.MemberCount) }

	cards, err := r.UsersByIDs(ctx, []int64{u1, u2})
	if err != nil || len(cards) != 2 { t.Fatalf("usersByIDs: %v %d", err, len(cards)) }
}
```

- [ ] **Step 3: Run — expect FAIL** (`NewGroupRepo` undefined). `cd backend && go test ./internal/adapter/repo/postgres/ -run TestGroupRepo`

- [ ] **Step 4: Implement `grouprepo.go`** — member_count is maintained here (AddMember `+1`, RemoveMember `-1`, both guarded so re-add/re-remove don't double-count):

```go
package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/messenger-denis/backend/internal/domain"
)

type GroupRepo struct{ pool PgxPool }

func NewGroupRepo(pool PgxPool) *GroupRepo { return &GroupRepo{pool: pool} }

func (r *GroupRepo) CreateMultiMember(ctx context.Context, typ, title, about, username string, isPublic bool, creatorID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var id int64
	var u any
	if username == "" { u = nil } else { u = username }
	err := q.QueryRow(ctx,
		`INSERT INTO chats (type, title, about, username, is_public, creator_id)
		 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		typ, title, about, u, isPublic, creatorID).Scan(&id)
	return id, err
}

func (r *GroupRepo) AddMember(ctx context.Context, chatID, userID int64, role string, rights domain.Rights) error {
	q := querier(ctx, r.pool)
	ct, err := q.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id, role, rights)
		 VALUES ($1,$2,$3,$4) ON CONFLICT (chat_id,user_id) DO NOTHING`,
		chatID, userID, role, int(rights))
	if err != nil { return err }
	if ct.RowsAffected() == 1 {
		_, err = q.Exec(ctx, `UPDATE chats SET member_count = member_count + 1 WHERE id=$1`, chatID)
	}
	return err
}

func (r *GroupRepo) RemoveMember(ctx context.Context, chatID, userID int64) error {
	q := querier(ctx, r.pool)
	ct, err := q.Exec(ctx, `DELETE FROM chat_members WHERE chat_id=$1 AND user_id=$2`, chatID, userID)
	if err != nil { return err }
	if ct.RowsAffected() == 1 {
		_, err = q.Exec(ctx, `UPDATE chats SET member_count = GREATEST(member_count - 1, 0) WHERE id=$1`, chatID)
	}
	return err
}

func (r *GroupRepo) GetMember(ctx context.Context, chatID, userID int64) (domain.Member, error) {
	q := querier(ctx, r.pool)
	var m domain.Member
	var rights int
	err := q.QueryRow(ctx,
		`SELECT chat_id, user_id, role, rights, muted FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID).Scan(&m.ChatID, &m.UserID, &m.Role, &rights, &m.Muted)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Member{}, domain.ErrNotFound
	}
	m.Rights = domain.Rights(rights)
	return m, err
}

func (r *GroupRepo) SetRole(ctx context.Context, chatID, userID int64, role string, rights domain.Rights) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET role=$3, rights=$4 WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, role, int(rights))
	return err
}

func (r *GroupRepo) SetMuted(ctx context.Context, chatID, userID int64, muted bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET muted=$3 WHERE chat_id=$1 AND user_id=$2`, chatID, userID, muted)
	return err
}

func (r *GroupRepo) EditInfo(ctx context.Context, chatID int64, title, about, username string) error {
	var u any
	if username == "" { u = nil } else { u = username }
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET title=$2, about=$3, username=$4 WHERE id=$1`, chatID, title, about, u)
	return err
}

func (r *GroupRepo) Card(ctx context.Context, chatID, viewerID int64) (domain.ChatCard, error) {
	q := querier(ctx, r.pool)
	var c domain.ChatCard
	var username *string
	var rights int
	var role *string
	var muted *bool
	err := q.QueryRow(ctx,
		`SELECT c.id, c.type, c.title, COALESCE(c.username,''), c.about, c.photo_media_id,
		        COALESCE(c.creator_id,0), c.member_count, c.is_public,
		        m.role, COALESCE(m.rights,0), m.muted
		   FROM chats c
		   LEFT JOIN chat_members m ON m.chat_id=c.id AND m.user_id=$2
		  WHERE c.id=$1`,
		chatID, viewerID).Scan(&c.ID, &c.Type, &c.Title, &c.Username, &c.About, &c.PhotoMediaID,
		&c.CreatorID, &c.MemberCount, &c.IsPublic, &role, &rights, &muted)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ChatCard{}, domain.ErrNotFound
	}
	if err != nil { return domain.ChatCard{}, err }
	if username != nil { c.Username = *username }
	if role != nil { c.MyRole = *role }
	c.MyRights = domain.Rights(rights)
	if muted != nil { c.Muted = *muted }
	return c, nil
}

func (r *GroupRepo) UsersByIDs(ctx context.Context, ids []int64) ([]domain.UserCard, error) {
	if len(ids) == 0 { return []domain.UserCard{}, nil }
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT id, COALESCE(username,''), display_name, COALESCE(avatar_url,'') FROM users WHERE id = ANY($1)`, ids)
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
```
> `PgxPool` and `querier` already exist in the postgres adapter (used by other repos). If the test helpers `newTestPool`/`insertUser` aren't exported across files in the package, they ARE in-package (same `package postgres`) so they're directly callable from `grouprepo_test.go`.

- [ ] **Step 5: Run — expect PASS.** `cd backend && go test ./internal/adapter/repo/postgres/ -run TestGroupRepo -v` (needs Docker).

- [ ] **Step 6: Commit**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add backend/internal/adapter/repo/postgres/grouprepo.go backend/internal/adapter/repo/postgres/grouprepo_test.go backend/internal/usecase/chat/ports.go
git commit -m "feat(repo): GroupRepo (membership/roles/card/mute/counts/users-batch)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: InviteRepo (invite links)

**Files:** Create `backend/internal/adapter/repo/postgres/inviterepo.go` + `inviterepo_test.go`; add `InviteRepo` port to `usecase/chat/ports.go`.

- [ ] **Step 1: Port** — add to `ports.go`:

```go
type InviteRepo interface {
	Create(ctx context.Context, chatID, createdBy int64, token string, usageLimit *int) (domain.InviteLink, error)
	GetByToken(ctx context.Context, token string) (domain.InviteLink, error) // domain.ErrNotFound
	List(ctx context.Context, chatID int64) ([]domain.InviteLink, error)
	IncUses(ctx context.Context, id int64) error
	Revoke(ctx context.Context, chatID int64, token string) error
}
```

- [ ] **Step 2: Failing test** — `inviterepo_test.go`:

```go
package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestInviteRepo(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	u := insertUser(t, pool, "+7010")
	g := NewGroupRepo(pool)
	chatID, _ := g.CreateMultiMember(ctx, "group", "G", "", "", false, u)
	r := NewInviteRepo(pool)

	link, err := r.Create(ctx, chatID, u, "tok123", nil)
	if err != nil || link.Token != "tok123" { t.Fatalf("create: %+v %v", link, err) }
	got, err := r.GetByToken(ctx, "tok123")
	if err != nil || got.ChatID != chatID { t.Fatalf("get: %+v %v", got, err) }
	if err := r.IncUses(ctx, link.ID); err != nil { t.Fatal(err) }
	list, _ := r.List(ctx, chatID)
	if len(list) != 1 || list[0].Uses != 1 { t.Fatalf("list: %+v", list) }
	if err := r.Revoke(ctx, chatID, "tok123"); err != nil { t.Fatal(err) }
	if _, err := r.GetByToken(ctx, "tok123"); err == nil { t.Fatal("revoked token should not resolve") }
}
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement `inviterepo.go`** (GetByToken excludes revoked):

```go
package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/messenger-denis/backend/internal/domain"
)

type InviteRepo struct{ pool PgxPool }

func NewInviteRepo(pool PgxPool) *InviteRepo { return &InviteRepo{pool: pool} }

func scanLink(row pgx.Row) (domain.InviteLink, error) {
	var l domain.InviteLink
	err := row.Scan(&l.ID, &l.ChatID, &l.Token, &l.CreatedBy, &l.UsageLimit, &l.Uses, &l.Revoked)
	return l, err
}

func (r *InviteRepo) Create(ctx context.Context, chatID, createdBy int64, token string, usageLimit *int) (domain.InviteLink, error) {
	l, err := scanLink(querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO invite_links (chat_id, created_by, token, usage_limit)
		 VALUES ($1,$2,$3,$4) RETURNING id, chat_id, token, created_by, usage_limit, uses, revoked`,
		chatID, createdBy, token, usageLimit))
	return l, err
}

func (r *InviteRepo) GetByToken(ctx context.Context, token string) (domain.InviteLink, error) {
	l, err := scanLink(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id, chat_id, token, created_by, usage_limit, uses, revoked
		   FROM invite_links WHERE token=$1 AND revoked=false`, token))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.InviteLink{}, domain.ErrNotFound
	}
	return l, err
}

func (r *InviteRepo) List(ctx context.Context, chatID int64) ([]domain.InviteLink, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT id, chat_id, token, created_by, usage_limit, uses, revoked
		   FROM invite_links WHERE chat_id=$1 AND revoked=false ORDER BY id DESC`, chatID)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []domain.InviteLink
	for rows.Next() {
		l, err := scanLink(rows)
		if err != nil { return nil, err }
		out = append(out, l)
	}
	return out, rows.Err()
}

func (r *InviteRepo) IncUses(ctx context.Context, id int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE invite_links SET uses = uses + 1 WHERE id=$1`, id)
	return err
}

func (r *InviteRepo) Revoke(ctx context.Context, chatID int64, token string) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE invite_links SET revoked=true WHERE chat_id=$1 AND token=$2`, chatID, token)
	return err
}
```

- [ ] **Step 5: Run — expect PASS.** `cd backend && go test ./internal/adapter/repo/postgres/ -run TestInviteRepo -v`

- [ ] **Step 6: Commit**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add backend/internal/adapter/repo/postgres/inviterepo.go backend/internal/adapter/repo/postgres/inviterepo_test.go backend/internal/usecase/chat/ports.go
git commit -m "feat(repo): InviteRepo (create/get/list/uses/revoke)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Groups usecase (interactor) with permission checks

**Files:** Create `backend/internal/usecase/chat/group.go` + `group_test.go`; modify `chat.go` (Interactor struct + constructor to hold `groups GroupRepo`, `invites InviteRepo`).

**Context:** Add a Groups façade on the existing `*Interactor`. Wire `groups`/`invites` into the struct + `New(...)`. Permission checks use `domain.HasRight`. Token generation uses `crypto/rand`.

- [ ] **Step 1: Wire repos into the Interactor** — in `chat.go` add fields `groups GroupRepo` and `invites InviteRepo` to `Interactor`, and extend `New(...)` to accept + assign them. Update the construction site in `internal/app/providers.go` (`usecasechat.New(...)`) to pass the new `NewGroupRepo(pool)` and `NewInviteRepo(pool)` (find via `grep -rn "usecasechat.New(" backend/internal`).

- [ ] **Step 2: Failing test** — `group_test.go` (fake-driven, in-package; mirror `interactor_test.go`/`fakes_test.go` style — extend the existing fakes with a `fakeGroupRepo`/`fakeInviteRepo` implementing the new ports, in-memory):

```go
package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestCreateGroup_AddsCreator(t *testing.T) {
	i, fg := newGroupTestInteractor(t)
	id, err := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	if err != nil { t.Fatal(err) }
	m, _ := fg.GetMember(context.Background(), id, 7)
	if m.Role != domain.RoleCreator { t.Fatalf("creator role = %q", m.Role) }
}

func TestAddMember_RequiresInviteRight(t *testing.T) {
	i, fg := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	_ = fg.AddMember(context.Background(), id, 8, domain.RoleMember, 0) // plain member
	// member 8 (no INVITE_USERS) tries to add 9 → forbidden
	if err := i.AddMember(context.Background(), id, 8, 9); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	// creator 7 can add 9
	if err := i.AddMember(context.Background(), id, 7, 9); err != nil { t.Fatalf("creator add: %v", err) }
}

func TestPromoteAdmin_RequiresManageAdmins(t *testing.T) {
	i, fg := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	_ = fg.AddMember(context.Background(), id, 8, domain.RoleMember, 0)
	if err := i.PromoteAdmin(context.Background(), id, 8, 8, domain.RightPostMessages); !errors.Is(err, domain.ErrForbidden) {
		t.Fatal("non-manager must not promote")
	}
	if err := i.PromoteAdmin(context.Background(), id, 7, 8, domain.RightPostMessages); err != nil {
		t.Fatalf("creator promote: %v", err)
	}
	m, _ := fg.GetMember(context.Background(), id, 8)
	if m.Role != domain.RoleAdmin || m.Rights != domain.RightPostMessages { t.Fatalf("promoted: %+v", m) }
}

func TestJoinByToken(t *testing.T) {
	i, fg := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	link, _ := i.CreateInvite(context.Background(), id, 7, nil)
	if err := i.JoinByToken(context.Background(), link.Token, 9); err != nil { t.Fatal(err) }
	if _, err := fg.GetMember(context.Background(), id, 9); err != nil { t.Fatal("joiner not a member") }
}
```
Provide `newGroupTestInteractor(t)` + `fakeGroupRepo`/`fakeInviteRepo` in `group_test.go` (in-memory maps; a `tokenGen` that returns a deterministic token in tests — see Step 3's `tokenGen` seam).

- [ ] **Step 3: Implement `group.go`**:

```go
package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"

	"github.com/messenger-denis/backend/internal/domain"
)

// tokenGen is overridable in tests.
var tokenGen = func() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (i *Interactor) requireRight(ctx context.Context, chatID, userID int64, r domain.Rights) error {
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil {
		return domain.ErrForbidden // not a member ⇒ forbidden
	}
	if !domain.HasRight(m.Role, m.Rights, r) {
		return domain.ErrForbidden
	}
	return nil
}

func (i *Interactor) CreateGroup(ctx context.Context, creatorID int64, title, about, username string, isPublic bool) (int64, error) {
	var chatID int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		id, e := i.groups.CreateMultiMember(ctx, "group", title, about, username, isPublic, creatorID)
		if e != nil { return e }
		chatID = id
		return i.groups.AddMember(ctx, id, creatorID, domain.RoleCreator, domain.AllRights)
	})
	return chatID, err
}

func (i *Interactor) AddMember(ctx context.Context, chatID, actorID, userID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil { return err }
	return i.groups.AddMember(ctx, chatID, userID, domain.RoleMember, 0)
}

// RemoveMember kicks userID (needs BAN_USERS) or self-leave (actor == userID).
func (i *Interactor) RemoveMember(ctx context.Context, chatID, actorID, userID int64) error {
	if actorID != userID {
		if err := i.requireRight(ctx, chatID, actorID, domain.RightBanUsers); err != nil { return err }
	}
	return i.groups.RemoveMember(ctx, chatID, userID)
}

func (i *Interactor) PromoteAdmin(ctx context.Context, chatID, actorID, userID int64, rights domain.Rights) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightManageAdmins); err != nil { return err }
	return i.groups.SetRole(ctx, chatID, userID, domain.RoleAdmin, rights)
}

func (i *Interactor) DemoteAdmin(ctx context.Context, chatID, actorID, userID int64) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightManageAdmins); err != nil { return err }
	return i.groups.SetRole(ctx, chatID, userID, domain.RoleMember, 0)
}

func (i *Interactor) EditInfo(ctx context.Context, chatID, actorID int64, title, about, username string) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightChangeInfo); err != nil { return err }
	return i.groups.EditInfo(ctx, chatID, title, about, username)
}

func (i *Interactor) SetMute(ctx context.Context, chatID, userID int64, muted bool) error {
	return i.groups.SetMuted(ctx, chatID, userID, muted)
}

func (i *Interactor) ChatCard(ctx context.Context, chatID, viewerID int64) (domain.ChatCard, error) {
	return i.groups.Card(ctx, chatID, viewerID)
}

func (i *Interactor) UsersByIDs(ctx context.Context, ids []int64) ([]domain.UserCard, error) {
	return i.groups.UsersByIDs(ctx, ids)
}

func (i *Interactor) CreateInvite(ctx context.Context, chatID, actorID int64, usageLimit *int) (domain.InviteLink, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil { return domain.InviteLink{}, err }
	return i.invites.Create(ctx, chatID, actorID, tokenGen(), usageLimit)
}

func (i *Interactor) ListInvites(ctx context.Context, chatID, actorID int64) ([]domain.InviteLink, error) {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil { return nil, err }
	return i.invites.List(ctx, chatID)
}

func (i *Interactor) RevokeInvite(ctx context.Context, chatID, actorID int64, token string) error {
	if err := i.requireRight(ctx, chatID, actorID, domain.RightInviteUsers); err != nil { return err }
	return i.invites.Revoke(ctx, chatID, token)
}

func (i *Interactor) JoinByToken(ctx context.Context, token string, userID int64) error {
	link, err := i.invites.GetByToken(ctx, token)
	if err != nil { return err }
	return i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if e := i.groups.AddMember(ctx, link.ChatID, userID, domain.RoleMember, 0); e != nil { return e }
		return i.invites.IncUses(ctx, link.ID)
	})
}
```

- [ ] **Step 4: Run — expect PASS.** `cd backend && go test ./internal/usecase/chat/... -run 'Group|AddMember|Promote|JoinByToken'`

- [ ] **Step 5: Commit**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add backend/internal/usecase/chat/group.go backend/internal/usecase/chat/group_test.go backend/internal/usecase/chat/chat.go backend/internal/app/providers.go
git commit -m "feat(usecase): groups (create/members/admins/edit/mute/invite/join) + permission checks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: HTTP handlers + router wiring

**Files:** Create `backend/internal/adapter/delivery/http/group_handler.go` + `group_handler_test.go`; modify `router.go` (+ the chat handler construction if needed).

**Context:** New `GroupHandler` wrapping `*usecasechat.Interactor`. JSON bodies; map `domain.ErrForbidden`→403, `domain.ErrNotFound`→404. Mirror existing handler style (`UserFromContext`, `pathInt`, `writeJSON`, `writeError`). Routes mounted in the Bearer group.

- [ ] **Step 1: Handlers** — `group_handler.go` (representative set; follow the pattern for each):

```go
package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

type GroupHandler struct{ uc *usecasechat.Interactor }

func NewGroupHandler(uc *usecasechat.Interactor) *GroupHandler { return &GroupHandler{uc: uc} }

func (h *GroupHandler) mapErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		writeError(w, http.StatusInternalServerError, "server error")
	}
}

func (h *GroupHandler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct{ Title, About, Username string; IsPublic bool }
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || strings.TrimSpace(b.Title) == "" {
		writeError(w, http.StatusBadRequest, "title required"); return
	}
	id, err := h.uc.CreateGroup(r.Context(), user.ID, b.Title, b.About, b.Username, b.IsPublic)
	if err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]any{"chat_id": id})
}

func (h *GroupHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID"); if !ok { return }
	var b struct{ UserID int64 `json:"user_id"` }
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.UserID == 0 { writeError(w, http.StatusBadRequest, "user_id required"); return }
	if err := h.uc.AddMember(r.Context(), chatID, user.ID, b.UserID); err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID"); if !ok { return }
	uid, ok := pathInt(w, r, "userID"); if !ok { return }
	if err := h.uc.RemoveMember(r.Context(), chatID, user.ID, uid); err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) PromoteAdmin(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID"); if !ok { return }
	var b struct{ UserID int64 `json:"user_id"`; Rights int `json:"rights"` }
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.UserID == 0 { writeError(w, http.StatusBadRequest, "user_id required"); return }
	if err := h.uc.PromoteAdmin(r.Context(), chatID, user.ID, b.UserID, domain.Rights(b.Rights)); err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) DemoteAdmin(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID"); if !ok { return }
	uid, ok := pathInt(w, r, "userID"); if !ok { return }
	if err := h.uc.DemoteAdmin(r.Context(), chatID, user.ID, uid); err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) EditInfo(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID"); if !ok { return }
	var b struct{ Title, About, Username string }
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil { writeError(w, http.StatusBadRequest, "bad body"); return }
	if err := h.uc.EditInfo(r.Context(), chatID, user.ID, b.Title, b.About, b.Username); err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) SetMute(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID"); if !ok { return }
	var b struct{ Muted bool `json:"muted"` }
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil { writeError(w, http.StatusBadRequest, "bad body"); return }
	if err := h.uc.SetMute(r.Context(), chatID, user.ID, b.Muted); err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *GroupHandler) Card(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID"); if !ok { return }
	c, err := h.uc.ChatCard(r.Context(), chatID, user.ID)
	if err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]any{
		"id": c.ID, "type": c.Type, "title": c.Title, "username": c.Username, "about": c.About,
		"photo_media_id": c.PhotoMediaID, "creator_id": c.CreatorID, "member_count": c.MemberCount,
		"is_public": c.IsPublic, "my_role": c.MyRole, "my_rights": int(c.MyRights), "muted": c.Muted,
	})
}

func (h *GroupHandler) Users(w http.ResponseWriter, r *http.Request) {
	idsParam := r.URL.Query().Get("ids")
	var ids []int64
	for _, s := range strings.Split(idsParam, ",") {
		if s == "" { continue }
		if n, err := strconv.ParseInt(s, 10, 64); err == nil { ids = append(ids, n) }
	}
	cards, err := h.uc.UsersByIDs(r.Context(), ids)
	if err != nil { h.mapErr(w, err); return }
	out := make([]map[string]any, 0, len(cards))
	for _, c := range cards {
		out = append(out, map[string]any{"id": c.ID, "username": c.Username, "display_name": c.DisplayName, "avatar_url": c.AvatarURL})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

func (h *GroupHandler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID"); if !ok { return }
	var b struct{ UsageLimit *int `json:"usage_limit"` }
	_ = json.NewDecoder(r.Body).Decode(&b)
	link, err := h.uc.CreateInvite(r.Context(), chatID, user.ID, b.UsageLimit)
	if err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]any{"token": link.Token, "url": "/join/" + link.Token})
}

func (h *GroupHandler) ListInvites(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID"); if !ok { return }
	links, err := h.uc.ListInvites(r.Context(), chatID, user.ID)
	if err != nil { h.mapErr(w, err); return }
	out := make([]map[string]any, 0, len(links))
	for _, l := range links { out = append(out, map[string]any{"token": l.Token, "uses": l.Uses, "url": "/join/" + l.Token}) }
	writeJSON(w, http.StatusOK, map[string]any{"invite_links": out})
}

func (h *GroupHandler) Join(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	token := chiURLParam(r, "token")
	if err := h.uc.JoinByToken(r.Context(), token, user.ID); err != nil { h.mapErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
```
> `chiURLParam` = `chi.URLParam(r, "token")` — if the package doesn't already import chi for url params, use `chi.URLParam` directly (other handlers use `pathInt` which wraps it; check `pathInt`'s impl and reuse `chi.URLParam`).

- [ ] **Step 2: Router** — in `router.go`, inside the Bearer group, add:
```go
		gh := NewGroupHandler(chatUC)
		pr.Post("/groups", gh.CreateGroup)
		pr.Get("/chats/{chatID}/card", gh.Card)
		pr.Patch("/chats/{chatID}", gh.EditInfo)
		pr.Post("/chats/{chatID}/members", gh.AddMember)
		pr.Delete("/chats/{chatID}/members/{userID}", gh.RemoveMember)
		pr.Post("/chats/{chatID}/admins", gh.PromoteAdmin)
		pr.Delete("/chats/{chatID}/admins/{userID}", gh.DemoteAdmin)
		pr.Post("/chats/{chatID}/mute", gh.SetMute)
		pr.Post("/chats/{chatID}/invite_links", gh.CreateInvite)
		pr.Get("/chats/{chatID}/invite_links", gh.ListInvites)
		pr.Post("/join/{token}", gh.Join)
		pr.Get("/users", gh.Users)
```
(`POST /groups` instead of overloading `POST /chats`, to avoid touching the existing private-chat handler.)

- [ ] **Step 3: Handler test** — `group_handler_test.go`: spin the chat Interactor with the real repos against a testcontainers PG (reuse the http package's existing integration harness if present, e.g. `chat_handler_test.go`'s setup), OR a lighter fake. At minimum test: create group → 200 + chat_id; non-member add member → 403; creator add member → 200; GET card → correct title/role; GET /users?ids= → the users. Follow the existing `*_handler_test.go` harness in the package.

- [ ] **Step 4: Run** `cd backend && go build ./... && go test ./internal/adapter/delivery/http/... -run Group`

- [ ] **Step 5: Commit**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add backend/internal/adapter/delivery/http/group_handler.go backend/internal/adapter/delivery/http/group_handler_test.go backend/internal/adapter/delivery/http/router.go
git commit -m "feat(http): group endpoints (create/members/admins/edit/mute/invite/join/card/users)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Docs + full suite + merge

**Files:** `docs/contracts.md`, `backend/internal/openapi/openapi.yaml`.

- [ ] **Step 1: contracts.md** — add a "## Groups" section documenting every endpoint from Task 5 (method, auth, body, responses incl. 403/404), and note: roles `creator|admin|member`, rights bitmask values, `member_count` semantics. Mirror the existing section style.

- [ ] **Step 2: openapi.yaml** — add the same paths/schemas (Group, Member, ChatCard, InviteLink, UserCard).

- [ ] **Step 3: Full backend suite** — `cd backend && go build ./... && go vet ./... && go test ./...` (Docker available for testcontainers). All green. Report the summary.

- [ ] **Step 4: Commit + merge**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add docs/contracts.md backend/internal/openapi/openapi.yaml
git commit -m "docs: groups API in contracts.md + openapi

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git checkout master && git merge --no-ff groups-channels-a1 -m "Merge groups-channels-a1: backend multi-member core (groups, perms, invites, mute, users-batch)"
```

- [ ] **Step 5: Smoke-test on the verify stack** — rebuild the verify backend and exercise via curl: create a group (A), add B, GET card (member_count=2), promote B with rights, B (now admin w/ INVITE) adds C, create invite link, D joins via `/join/{token}`, mute the chat, `GET /users?ids=`. Confirm 200s + a 403 for an unauthorized action.

```bash
cd /Users/denisurevic/Documents/messenger-denis
docker compose -p msgrverify -f docker-compose.verify.yml up -d --build backend
# ... curl sequence (reuse the signin helper from earlier plans; BASE=http://localhost:38080/api) ...
```

---

## Self-Review (author checklist — completed)

- **Spec coverage (A1 portion):** schema, rights, groups create/members/admins/edit/mute/invite/join/card, users-batch. Channels post/difference + search = Plan A2 (explicitly out of A1). ✓
- **Layering:** domain (rights/entities) ← usecase/chat (group.go, permission checks) ← adapter (grouprepo/inviterepo, group_handler). TxManager used for multi-step writes (create+add-creator, join+inc-uses). ✓
- **Scale-safe:** `member_count` denormalized (no COUNT); `UsersByIDs` batched; channel tables created now but unused until A2. ✓
- **Type consistency:** roles as TEXT constants; `domain.Rights` int bitmask threaded through repo/usecase/handler; `ChatCard`/`Member`/`InviteLink`/`UserCard` shared. ✓
- **Placeholders:** complete SQL/Go/tests provided; mechanical handler set follows one shown pattern; tests say to reuse existing testcontainers harness (`newTestPool`/`insertUser`, `*_handler_test.go` setup) rather than reinvent. ✓
- **Errors:** ErrForbidden→403, ErrNotFound→404 mapped centrally. ✓
```
