# Discussions — Plan Disc-1: Backend

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-24-discussions-design.md`.

**Goal:** Auto-created discussion group + channel-post comments (group messages with `thread_root_id`). Backend repo, branch `discussions-d1`.

**Verified:** `messages(id,chat_id,seq,sender_id,type,text,reply_to_id,client_msg_id,media_id,edited_at,deleted_at,created_at)`; `Insert` writes 8 cols + RETURNING 11; `scanMessage`/`scanOneMessage` shared by Insert/GetHistory/FindByClientMsgID. `SendInput{ChatID,SenderID,Type,Text,ReplyToID,ClientMsgID,MediaID}`. `Send(ctx,SendInput)` does per-user fan-out + pts + publish. GroupRepo on `*pgxpool.Pool`. usecase `requireRight(...,RightChangeInfo)`, `CreateMultiMember`, `AddMember`. Tests: `storepostgres.NewTestDB(t)`+`seedUser`.

---

## Task Disc1-1: migration 0008 + thread_root_id through messages

**Files:** create `migrations/0008_discussions.sql`; modify `domain/chat.go`, `usecase/chat/ports.go` (SendInput + MessageRepo iface), `adapter/repo/postgres/messagesrepo.go` (+ test).

- [ ] **Step 1: Branch + migration** — `git checkout -b discussions-d1`. `0008_discussions.sql`:
```sql
-- +goose Up
ALTER TABLE chats ADD COLUMN discussion_chat_id BIGINT;
ALTER TABLE messages ADD COLUMN thread_root_id BIGINT;
CREATE INDEX idx_messages_thread ON messages (chat_id, thread_root_id) WHERE thread_root_id IS NOT NULL;
-- +goose Down
DROP INDEX IF EXISTS idx_messages_thread;
ALTER TABLE messages DROP COLUMN thread_root_id;
ALTER TABLE chats DROP COLUMN discussion_chat_id;
```
- [ ] **Step 2: domain + SendInput** — `domain.Message` += `ThreadRootID *int64`; `SendInput` += `ThreadRootID *int64`.
- [ ] **Step 3: MessagesRepo** — `Insert`: add `thread_root_id` to the INSERT column list + `$9` value `m.ThreadRootID`, and to the RETURNING; `scanMessage` scans `thread_root_id` into `&m.ThreadRootID` — **add `thread_root_id` to EVERY SELECT that feeds scanMessage/scanOneMessage** (Insert RETURNING, GetHistory's 3 queries, FindByClientMsgID, any others — grep `scanMessage`/`scanOneMessage` callers). Add to the MessageRepo port + impl:
```go
ListThread(ctx, chatID, threadRootID int64, offset, limit int) ([]domain.Message, error) // ORDER BY seq ASC
CountThread(ctx, chatID, threadRootID int64) (int, error)
```
ListThread SQL: `SELECT <cols> FROM messages WHERE chat_id=$1 AND thread_root_id=$2 AND deleted_at IS NULL ORDER BY seq ASC LIMIT $3 OFFSET $4`. CountThread: `SELECT count(*) ... WHERE chat_id=$1 AND thread_root_id=$2 AND deleted_at IS NULL`.
- [ ] **Step 4: Test** — extend messagesrepo test (or add): insert two messages with thread_root_id=100 into a chat + one without → ListThread(chat,100) returns 2 ascending; CountThread=2; a normal message round-trips ThreadRootID=nil.
- [ ] **Step 5: Run** `cd backend && go build ./... && go test ./internal/adapter/repo/postgres/ -run 'Message|History|Thread' -v` (Docker) — build clean (all scanMessage SELECTs updated), tests pass.
- [ ] **Step 6: Commit** `feat(discussions): migration 0008 + thread_root_id (Message/SendInput/repo ListThread/CountThread)`.

---

## Task Disc1-2: usecase (enable discussion + comments)

**Files:** modify `usecase/chat/ports.go` (GroupRepo += discussion get/set), `adapter/repo/postgres/grouprepo.go`, `usecase/chat/channel.go` (or a new `discussion.go`) + test.

- [ ] **Step 1: Repo** — GroupRepo += `SetDiscussion(ctx, channelID, groupID int64) error` (`UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`) and `GetDiscussion(ctx, channelID int64) (int64, error)` (`SELECT COALESCE(discussion_chat_id,0) FROM chats WHERE id=$1`; 0 = none). Implement in grouprepo.go.
- [ ] **Step 2: usecase** (new `discussion.go`):
```go
func (i *Interactor) EnableDiscussion(ctx, channelID, actorID int64) (int64, error) {
  if err := i.requireRight(ctx, channelID, actorID, domain.RightChangeInfo); err != nil { return 0, err }
  if cur, _ := i.groups.GetDiscussion(ctx, channelID); cur != 0 { return cur, nil }
  var gid int64
  err := i.tx.WithinTx(ctx, func(ctx) error {
    id, e := i.groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, actorID); if e!=nil {return e}
    if e := i.groups.AddMember(ctx, id, actorID, domain.RoleCreator, domain.AllRights); e!=nil {return e}
    if e := i.groups.SetDiscussion(ctx, channelID, id); e!=nil {return e}
    gid = id; return nil
  })
  return gid, err
}
func (i *Interactor) PostComment(ctx, channelID, postID, userID int64, text, clientMsgID string) (domain.Message, error) {
  disc, _ := i.groups.GetDiscussion(ctx, channelID)
  if disc == 0 { return domain.Message{}, domain.ErrNotFound }
  _ = i.groups.AddMember(ctx, disc, userID, domain.RoleMember, 0) // auto-join (idempotent)
  pid := postID
  return i.Send(ctx, SendInput{ChatID: disc, SenderID: userID, Type: "text", Text: text, ClientMsgID: clientMsgID, ThreadRootID: &pid})
}
func (i *Interactor) ListComments(ctx, channelID, postID, userID int64, offset, limit int) ([]domain.Message, int, error) {
  disc, _ := i.groups.GetDiscussion(ctx, channelID); if disc==0 { return nil,0,domain.ErrNotFound }
  if limit<=0||limit>100 { limit=50 }
  msgs, e := i.msgs.ListThread(ctx, disc, postID, offset, limit); if e!=nil {return nil,0,e}
  cnt, e := i.msgs.CountThread(ctx, disc, postID); return msgs, cnt, e
}
func (i *Interactor) CommentCounts(ctx, channelID int64, postIDs []int64) (map[int64]int, error) {
  disc, _ := i.groups.GetDiscussion(ctx, channelID); out := map[int64]int{}; if disc==0 { return out, nil }
  for _, p := range postIDs { c,_ := i.msgs.CountThread(ctx, disc, p); out[p]=c }; return out, nil
}
```
> `Send` must propagate `ThreadRootID` into the inserted message — verify `Send`'s `msgs.Insert` call passes `ThreadRootID` from the input (update Send to set `ThreadRootID: in.ThreadRootID` on the domain.Message it inserts).
- [ ] **Step 3: Tests** (channel_test.go/discussion_test.go, fakes): EnableDiscussion by non-admin → ErrForbidden; by creator → returns a new group id (idempotent second call returns same); PostComment when discussions off → ErrNotFound; after enable → comment inserted with ThreadRootID set + commenter auto-joined; ListComments returns the thread + count. (Extend fakeGroupRepo with discussion get/set + fakeMsgs ListThread/CountThread.)
- [ ] **Step 4: Run** `cd backend && go build ./... && go test ./internal/usecase/chat/...` — green.
- [ ] **Step 5: Commit** `feat(discussions): EnableDiscussion + PostComment/ListComments/CommentCounts usecase`.

---

## Task Disc1-3: HTTP + docs + merge + smoke

**Files:** modify `adapter/delivery/http/channel_handler.go`, `router.go`; contracts/openapi.

- [ ] **Step 1: Handlers** (ChannelHandler):
  - `EnableDiscussion` (POST): `id,_:=pathInt(chatID)`; `disc,err:=uc.EnableDiscussion(ctx, id, me)`; → `{discussion_chat_id: disc}`.
  - `PostComment` (POST, path postId): body `{text, client_msg_id}`; `m,err:=uc.PostComment(ctx, chatID, postID, me, text, clientMsgID)`; → message JSON (incl. thread_root_id).
  - `ListComments` (GET, path postId): `?offset&limit`; → `{messages:[...], count}`.
  - `CommentCounts` (GET): `?ids=1,2,3` → `{counts:{...}}`.
  mapErr → 403/404.
- [ ] **Step 2: Routes** (Bearer group):
```go
  pr.Post("/channels/{chatID}/discussion", chh.EnableDiscussion)
  pr.Post("/channels/{chatID}/posts/{postId}/comments", chh.PostComment)
  pr.Get("/channels/{chatID}/posts/{postId}/comments", chh.ListComments)
  pr.Get("/channels/{chatID}/comment_counts", chh.CommentCounts)
```
- [ ] **Step 3: Handler test** — A creates channel + post (capture post id); enable discussion; B posts a comment on the post → 200; GET comments → 1 + count 1; comment_counts?ids={postId} → 1.
- [ ] **Step 4: docs** — contracts.md + openapi: the 4 endpoints + `discussion_chat_id` on card/channel.
- [ ] **Step 5: Suite + merge** — `cd backend && go build ./... && go vet ./... && go test ./...` all green; commit docs; `git checkout master && git merge --no-ff discussions-d1 -m "Merge discussions-d1: channel comments (discussion group + thread_root_id)"`.
- [ ] **Step 6: Smoke (:38080)** — rebuild verify backend; A create public channel + a post (note its message id from POST response `id`); A enable discussion; B (another user) POST comment on the post → 200; GET comments → the comment + count 1; comment_counts → 1. (Use `CH`, not `GID`.)

## Self-review
- thread_root_id threaded through the shared message path (nullable, existing inserts unaffected — but EVERY scanMessage SELECT must add the column or scans break: explicit in Step 3). Comments reuse Send (fan-out+pts+publish → live). Discussion = a group (reuses membership/perm). EnableDiscussion gated CHANGE_INFO. ✓
