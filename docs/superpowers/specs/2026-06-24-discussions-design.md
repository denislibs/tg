# Discussions (channel comments) — Design Spec

**Status:** Approved 2026-06-24. Extends Channels (A2/C). User chose **auto-create** discussion group.

**Goal:** Comments under channel posts via an auto-created linked discussion group. A channel admin enables discussions → a group is created and linked (`chats.discussion_chat_id`). A comment is a normal message in that group carrying `thread_root_id = <channel post message id>`; the post's "Comments" UI lists/posts in that thread. Reuses groups + messages + realtime fan-out.

**Decisions:** auto-create discussion group; comments = group messages with `thread_root_id`; commenting auto-joins the user to the discussion group; "Comments" button under a post opens the thread (reuse mock `DiscussionView`/`CommentsBar`, which mirror tweb).

## Data model (migration 0008)
- `chats` += `discussion_chat_id BIGINT` (set on a channel → its linked group).
- `messages` += `thread_root_id BIGINT` (on discussion-group comments → the channel post message id). Index `messages(chat_id, thread_root_id)`.

## Backend
- `domain.Message` += `ThreadRootID *int64`; `SendInput` += `ThreadRootID *int64`. `MessagesRepo.Insert` writes `thread_root_id`; `scanMessage` + every SELECT using it include the column. New `MessagesRepo.ListThread(ctx, chatID, threadRootID, offset, limit)` + `CountThread`.
- `EnableDiscussion(channelID, actorID)` (needs CHANGE_INFO/creator): if `discussion_chat_id` set → return it; else create a group (type 'group', title "<channel title> chat"), add the channel creator as group creator, set `chats.discussion_chat_id`, return it. (tx.)
- `PostComment(channelID, postID, userID, text, clientMsgID)`: resolve `discussion_chat_id` (404 if discussions off); auto-join user to the discussion group (AddMember member, idempotent); `Send(SendInput{ChatID: discussion, SenderID: user, Text, ClientMsgID, ThreadRootID: &postID})` → reuses fan-out/pts/publish so members get `new_message` live. Returns the message.
- `ListComments(channelID, postID, userID, offset, limit)`: resolve discussion; `ListThread(discussion, postID, ...)` ascending + `CountThread`. (Open: any member of the discussion can read; v1 = membership not required to read — return the thread; commenting auto-joins.)
- `CommentCounts(channelID, postIDs)`: batch counts for the feed (`GET .../comment_counts?ids=`).

## API (REST; contracts/openapi)
- `POST /channels/{id}/discussion` → `{ discussion_chat_id }` (enable/get).
- `GET /channels/{id}` card / channel info exposes `discussion_chat_id`.
- `POST /channels/{id}/posts/{postId}/comments {text, client_msg_id}` → `<Message>` (with thread_root_id).
- `GET /channels/{id}/posts/{postId}/comments?offset&limit` → `{ messages:[...], count }`.
- `GET /channels/{id}/comment_counts?ids=1,2,3` → `{ counts: { "<postId>": n } }`.

## Frontend
- Channel admin info panel: "Обсуждения" toggle → `POST /channels/{id}/discussion` (enable). Show "обсуждения включены".
- Channel feed posts: a "Comments (N)" bar under each post (reuse `CommentsBar`); counts via `comment_counts`. Click → open `DiscussionView` (reuse) for that post: a windowed comment list (`GET comments`) + a composer (`POST comments`). Live: discussion-group `new_message` (existing realtime) filtered by `thread_root_id === postId` appended to the open thread.
- Sender names in comments via peersManager (groups).

## Out of scope
Link-existing-group, nested replies/threads beyond one level, per-comment reactions UI beyond existing, comment pinning, discussion-group standalone view (only via the channel post). Megathread pagination niceties.

## Plans
- **Disc-1 (backend):** migration 0008, Message/SendInput thread_root_id + repo (Insert/scan/ListThread/CountThread), usecase (EnableDiscussion/PostComment/ListComments/CommentCounts), HTTP, contracts, merge + smoke.
- **Disc-2 (frontend):** channelsManager comment methods + enableDiscussion; channel admin toggle; CommentsBar counts + DiscussionView real thread (list+post+live); live verify + merge.

## Self-review
- Reuses groups (discussion = a group), messages + Send fan-out (comments get realtime), permission checks (CHANGE_INFO to enable). thread_root_id threads through the shared message path (nullable → existing inserts unaffected). Auto-join on comment matches the user's choice. ✓
