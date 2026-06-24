# Invite Links + Join Requests — Plan D1: Backend

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-24-invite-links-join-requests-design.md`.

**Goal:** Per-link `requires_approval` + join requests. Migration 0007, repo + usecase + HTTP, merge + smoke. Backend repo, branch `invites-d1`.

**Verified:** `invite_links(id,chat_id,token,created_by,expires_at,usage_limit,uses,revoked,created_at)`. `InviteRepo` (Create(chatID,createdBy,token,usageLimit)/GetByToken/List/IncUses/Revoke), scanLink scans 7 cols. usecase: `CreateInvite(chatID,actorID,usageLimit)`, `JoinByToken(token,userID)` (adds member + IncUses, tx). `requireRight(...,RightInviteUsers)`. domain.InviteLink{ID,ChatID,Token,CreatedBy,UsageLimit,Uses,Revoked}. Handlers CreateInvite/ListInvites/Join + routes. Repos on `*pgxpool.Pool`+querier; tests use `storepostgres.NewTestDB(t)`+`seedUser`; `var _ usecasechat.X = (*X)(nil)` asserts.

---

## Task D1-1: migration 0007 + domain + InviteRepo.requires_approval

**Files:** create `migrations/0007_join_requests.sql`; modify `domain/chat.go`, `adapter/repo/postgres/inviterepo.go` (+ test), `usecase/chat/ports.go`.

- [ ] **Step 1: Branch + migration** — `git checkout -b invites-d1`. Create `0007_join_requests.sql`:
```sql
-- +goose Up
ALTER TABLE invite_links ADD COLUMN requires_approval BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE join_requests (
  id           BIGSERIAL PRIMARY KEY,
  chat_id      BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_token TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_id, user_id)
);
CREATE INDEX idx_join_requests_chat ON join_requests (chat_id);
-- +goose Down
DROP TABLE join_requests;
ALTER TABLE invite_links DROP COLUMN requires_approval;
```

- [ ] **Step 2: domain** — `InviteLink` += `RequiresApproval bool`. Add `JoinRequest struct { ChatID, UserID int64; CreatedAt time.Time }` (import time if needed; chat.go already imports time).

- [ ] **Step 3: InviteRepo** — port `Create` gains `requiresApproval bool`: `Create(ctx, chatID, createdBy int64, token string, usageLimit *int, requiresApproval bool) (domain.InviteLink, error)`. Update `inviterepo.go`: INSERT includes `requires_approval`; `scanLink` scans `requires_approval` into `&l.RequiresApproval` (add the column to every SELECT: Create RETURNING, GetByToken, List). Update the port interface signature. Update the test `Create(...)` call to pass `false`/`true` and assert `RequiresApproval`.

- [ ] **Step 4: Run + commit** — `cd backend && go build ./... && go test ./internal/adapter/repo/postgres/ -run 'Invite' -v` (Docker). Commit `feat(invites): migration 0007 (requires_approval + join_requests) + InviteRepo`.

> Note: `usecase/chat/group.go` `CreateInvite` calls `i.invites.Create(...)` — Step 3 changes that signature; D1-3 updates the caller. To keep the build green at THIS commit, also update the `CreateInvite` call site in group.go to pass `false` for now (D1-3 threads the real flag). Include group.go in this commit.

---

## Task D1-2: JoinRequestRepo

**Files:** create `adapter/repo/postgres/joinrequestrepo.go` (+ test); add `JoinRequestRepo` port.

- [ ] **Step 1: Port** — add to `ports.go`:
```go
type JoinRequestRepo interface {
	Create(ctx context.Context, chatID, userID int64, inviteToken string) error // idempotent (ON CONFLICT DO NOTHING)
	List(ctx context.Context, chatID int64) ([]domain.JoinRequest, error)
	Delete(ctx context.Context, chatID, userID int64) error
}
```
- [ ] **Step 2: Test** — `joinrequestrepo_test.go`: create chat+users, Create(chat,u2,"tok") → List(chat) has u2; Create again → still 1 (dedup); Delete(chat,u2) → List empty. (Use NewGroupRepo to make a chat.)
- [ ] **Step 3: Implement** — `joinrequestrepo.go` (mirror grouprepo style):
```go
func (r *JoinRequestRepo) Create(ctx, chatID, userID int64, token string) error {
  _, err := querier(ctx,r.pool).Exec(ctx,`INSERT INTO join_requests (chat_id,user_id,invite_token) VALUES ($1,$2,$3) ON CONFLICT (chat_id,user_id) DO NOTHING`, chatID, userID, token); return err }
func (r *JoinRequestRepo) List(ctx, chatID int64) ([]domain.JoinRequest, error) { /* SELECT chat_id,user_id,created_at WHERE chat_id=$1 ORDER BY created_at */ }
func (r *JoinRequestRepo) Delete(ctx, chatID, userID int64) error { /* DELETE WHERE chat_id AND user_id */ }
```
(+ `var _ usecasechat.JoinRequestRepo = (*JoinRequestRepo)(nil)`.)
- [ ] **Step 4: Run + commit** — test green; commit `feat(invites): JoinRequestRepo`.

---

## Task D1-3: usecase (approval flow)

**Files:** modify `usecase/chat/chat.go` (add `joinReqs JoinRequestRepo` field + New param + wiring providers.go/app.go), `usecase/chat/group.go` (+ test).

- [ ] **Step 1: Wire** `joinReqs JoinRequestRepo` into Interactor (New trailing param; update providers.go `provideJoinRequestRepo` + app.go fx + all New() call sites incl. tests — pass nil where unused). 
- [ ] **Step 2: CreateInvite + approval** — change `CreateInvite(ctx, chatID, actorID int64, usageLimit *int, requiresApproval bool)`; pass to `invites.Create(...)`.
- [ ] **Step 3: JoinByToken → status** — change to `JoinByToken(ctx, token string, userID int64) (requested bool, err error)`:
```go
link, err := i.invites.GetByToken(ctx, token); if err != nil { return false, err }
if link.RequiresApproval {
  if e := i.joinReqs.Create(ctx, link.ChatID, userID, token); e != nil { return false, e }
  return true, nil
}
err = i.tx.WithinTx(ctx, func(ctx) { addMember(member,0) + IncUses }); return false, err
```
- [ ] **Step 4: Requests admin ops**:
```go
func (i *Interactor) ListJoinRequests(ctx, chatID, actorID int64) ([]domain.JoinRequest, error) { requireRight(InviteUsers); return i.joinReqs.List(ctx,chatID) }
func (i *Interactor) ApproveJoinRequest(ctx, chatID, actorID, userID int64) error {
  requireRight(InviteUsers); return i.tx.WithinTx(ctx, func(ctx){ groups.AddMember(chatID,userID,RoleMember,0); joinReqs.Delete(chatID,userID) }) }
func (i *Interactor) DeclineJoinRequest(ctx, chatID, actorID, userID int64) error { requireRight(InviteUsers); return i.joinReqs.Delete(ctx,chatID,userID) }
```
- [ ] **Step 5: Tests** (group_test.go, fakes — add fakeJoinRequestRepo): create invite with requiresApproval=true → JoinByToken returns requested=true + a pending request exists; non-admin ListJoinRequests → ErrForbidden; ApproveJoinRequest by creator → member added + request gone; requiresApproval=false → JoinByToken requested=false + member added.
- [ ] **Step 6: Run + commit** — `go build ./... && go test ./internal/usecase/chat/...`; commit `feat(invites): join-request approval flow (usecase)`.

---

## Task D1-4: HTTP + docs + merge + smoke

**Files:** modify `adapter/delivery/http/group_handler.go`, `router.go`; `docs/contracts.md`, `openapi.yaml`.

- [ ] **Step 1: Handlers** —
  - `CreateInvite`: body gains `requires_approval bool` → pass to uc.CreateInvite. Response includes `requires_approval` + `url:"/join/"+token`.
  - `ListInvites`: each row includes `requires_approval`.
  - `Join`: `requested, err := uc.JoinByToken(...)`; respond `{ "status": requested ? "requested" : "joined" }`.
  - NEW `JoinRequests` (GET): `uc.ListJoinRequests(chatID, me)` → `{requests:[{user_id}]}`.
  - NEW `ApproveJoinRequest`/`DeclineJoinRequest` (POST, path `userID`): call uc; `{ok:true}`. mapErr → 403/404.
- [ ] **Step 2: Routes** (Bearer group):
```go
  pr.Get("/chats/{chatID}/join_requests", gh.JoinRequests)
  pr.Post("/chats/{chatID}/join_requests/{userID}/approve", gh.ApproveJoinRequest)
  pr.Post("/chats/{chatID}/join_requests/{userID}/decline", gh.DeclineJoinRequest)
```
- [ ] **Step 3: Handler test** — create group (A) + invite with requires_approval → B joins via token → 200 {status:"requested"} → A GET join_requests has B → A approve → B is member (GET /chats/{id}/members) ; non-member approve → 403.
- [ ] **Step 4: docs** — contracts.md + openapi: CreateInvite `requires_approval`, Join `{status}`, the three join_requests endpoints.
- [ ] **Step 5: Suite + merge** — `cd backend && go build ./... && go vet ./... && go test ./...` all green; commit docs; `git checkout master && git merge --no-ff invites-d1 -m "Merge invites-d1: per-link approval + join requests (backend)"`.
- [ ] **Step 6: Smoke (:38080)** — rebuild verify backend; A create group + invite link with requires_approval=true; B `POST /join/{token}` → `{status:"requested"}`; A `GET /chats/{id}/join_requests` shows B; A approve → B in members; also a non-approval link → `{status:"joined"}` immediately. (Use `CH` not `GID`.)

---

## Self-review
- Per-link approval (link flag), host-URL join route reused (`/join/{token}` → status). join_requests dedup via UNIQUE. INVITE_USERS gates admin ops. Build kept green across commits (Create-signature change + caller updated together). ✓
