# Messenger API — Contracts (Phase 0)

Full request/response contract for every endpoint and WebSocket frame. The
machine-readable source of truth is the OpenAPI spec:

- **OpenAPI YAML:** `backend/internal/openapi/openapi.yaml` (embedded in the binary)
- **Served at runtime:** `GET /openapi.yaml` (raw spec) and `GET /swagger` (Swagger UI)

> Behind nginx the REST API is mounted under `/api/` (e.g. `POST /api/auth/sign_in`).
> Paths below are written without the prefix.

## Conventions

- All bodies are JSON. All timestamps are RFC 3339 (`created_at`) unless noted as
  epoch milliseconds (`date`, `last_seen`).
- **Auth:** protected endpoints require `Authorization: Bearer <token>`, where
  `<token>` is the device session token from `/auth/sign_in`. Missing/invalid →
  `401 {"error": "..."}`.
- **Errors:** non-2xx responses are `{"error": "<message>"}`.
- `seq` — monotonic per-chat message sequence. `pts` — per-user update cursor
  (each update carries `pts` and `pts_count`; the client tracks the latest `pts`).
- IDs are int64.

---

## Auth & sessions

### POST /auth/request_code  · public
Request a login code. In dev the code is **not** sent — it is logged server-side
(`DEV_OTP_CODE`, default `12345`).
- Request: `{ "phone": "+79990000000" }`
- 200: `{ "ok": true }`
- 400: `{ "error": "phone is required" }`

### POST /auth/sign_in  · public
Verify the code, create the user (if new) + a device, return a session token.
- Request: `{ "phone": "+79990000000", "code": "12345", "device": "web", "platform": "browser" }`
  (`device`, `platform` optional)
- 200: `{ "token": "<opaque>", "user": { "id": 1, "phone": "+79990000000", "display_name": "+79990000000" } }`
- 401: `{ "error": "invalid code" }`

### POST /auth/qr/new  · public
Start a QR login. Creates an ephemeral pending record (Redis, ~60s TTL) and
returns the raw token plus a scan URL (`<origin>/qr/{token}`, origin taken from
the `Origin` header, falling back to the request host).
- Request: `{ "platform": "web" }` (`platform` optional)
- 200: `{ "token": "<opaque>", "url": "https://app.example/qr/<token>", "expires_at": "2026-06-24T10:01:00Z" }`
- 503: `{ "error": "qr login unavailable" }` (no QRStore / Redis down)

### GET /auth/qr/{token}  · public
Poll the QR-login record. A confirmed record is single-use — it is deleted on
read, so a second poll returns `expired`. Unknown/expired tokens return
`expired` (never an error).
- 200 pending: `{ "status": "pending" }`
- 200 confirmed: `{ "status": "confirmed", "session_token": "<opaque>", "user": { "id": 1, "phone": "+79990000000", "display_name": "..." } }`
- 200 expired: `{ "status": "expired" }`
- 503: `{ "error": "qr login unavailable" }`

### POST /auth/qr/confirm  · auth
Called by an already-authenticated device (the scanner) to approve a pending QR
login. Mints a fresh session for the caller and attaches it to the record.
- Request: `{ "token": "<opaque>" }`
- 200: `{ "ok": true }`
- 400: `{ "error": "token is required" }`
- 404: `{ "error": "invalid or expired token" }` (unknown/expired/already used)
- 503: `{ "error": "qr login unavailable" }`

### GET /me  · auth
- 200: `{ "id": 1, "phone": "+79990000000", "display_name": "..." }`
- 401: `{ "error": "missing token" | "invalid token" }`

### GET /sessions  · auth
List the user's devices.
- 200: `{ "sessions": [ { "id": 3, "name": "web", "platform": "browser", "last_active": "2026-06-24T10:00:00Z", "current": true } ] }`

### DELETE /sessions/{deviceID}  · auth
Revoke a session (deletes the device, evicts its cache, **closes its live WS socket**).
- 200: `{ "ok": true }`
- 404: `{ "error": "session not found" }`

### POST /auth/logout  · auth
Revoke the current session (same effect as revoking the caller's own device).
- 200: `{ "ok": true }`

---

## Chats

### POST /chats  · auth
Create (or return the existing) private chat with another user.
- Request: `{ "user_id": 2 }`
- 200: `{ "chat_id": 1 }`

### GET /chats  · auth
List the user's dialogs, newest activity first.
- 200:
```json
{ "chats": [
  { "chat_id": 1, "type": "private", "last_read_seq": 4, "unread": 0, "muted": false,
    "peer": { "id": 2, "display_name": "Bob", "avatar_url": "" },
    "last_message": { "seq": 4, "text": "hi", "sender_id": 2, "at": "2026-06-24T10:00:00Z" } }
] }
```
`last_message` is omitted for empty chats. `peer` is the other participant of a
private chat (its `id`/`display_name`/`avatar_url`); it is omitted for non-private chats.

---

## Groups

Multi-member chats (`type: "group"`). Membership carries a **role** and, for
admins, a granular **rights** bitmask.

- **Roles** (`chat_members.role`): `creator` | `admin` | `member`.
  - `creator` — implicitly holds **all** rights (never checked against the bitmask).
  - `admin` — holds exactly the rights in its bitmask.
  - `member` — a plain member; holds **no** admin rights.
- **Rights bitmask** (sum the values you want; `admins` only):

  | Right | Value | Grants |
  |-------|------:|--------|
  | `POST_MESSAGES`  | `1`   | post messages |
  | `EDIT_MESSAGES`  | `2`   | edit others' messages |
  | `DELETE_MESSAGES`| `4`   | delete others' messages |
  | `BAN_USERS`      | `8`   | kick/ban members |
  | `INVITE_USERS`   | `16`  | add members, create/list/revoke invite links |
  | `PIN_MESSAGES`   | `32`  | pin messages |
  | `CHANGE_INFO`    | `64`  | edit title/about/username |
  | `MANAGE_ADMINS`  | `128` | promote/demote admins |

  e.g. an admin who may post and invite has `rights = 17` (`1 + 16`).
- **`member_count`** is a denormalized counter on the chat, maintained on add/remove
  (re-adding an existing member or re-removing a non-member does not double-count).
- **Errors:** an action the caller is not entitled to perform (or performs while
  not a member) → `403 {"error": "forbidden"}`. A missing chat/member → `404
  {"error": "not found"}`.

### POST /groups  · auth
Create a group; the caller becomes its `creator` (with all rights) and first member.
- Request: `{ "title": "Team", "about": "", "username": "", "is_public": false }`
  (`title` required; `about`/`username` optional; `username` only meaningful when public)
- 200: `{ "chat_id": 1 }`
- 400: `{ "error": "title required" }`

### GET /chats/{chatID}/card  · auth
Group/channel info screen, including the caller's own role/rights/mute.
- 200:
```json
{ "id": 1, "type": "group", "title": "Team", "username": "", "about": "",
  "photo_media_id": null, "creator_id": 7, "member_count": 3,
  "is_public": false, "my_role": "creator", "my_rights": 255, "muted": false }
```
  `my_role` is empty and `my_rights` is `0` when the caller is not a member.
- 404: `{ "error": "not found" }` (no such chat)

### GET /chats/{chatID}/members  · auth
List the chat's members with their role and current online status. The caller
must be a member of the chat. Supports `?offset=` (default `0`) and `?limit=`
(default and max `200`); members are ordered by role then `user_id`.
- 200:
```json
{ "members": [
  { "user_id": 7, "role": "creator", "online": true },
  { "user_id": 9, "role": "member",  "online": false }
] }
```
  `online` reflects realtime presence when enabled; when presence is disabled it
  is always `false` and clients should overlay their own presence store.
- 403: `{ "error": "forbidden" }` (caller is not a member)

### PATCH /chats/{chatID}  · auth · needs `CHANGE_INFO`
Edit group info.
- Request: `{ "title": "New", "about": "desc", "username": "team" }`
- 200: `{ "ok": true }`
- 403: `{ "error": "forbidden" }`

### POST /chats/{chatID}/members  · auth · needs `INVITE_USERS`
Add a user as a plain `member`.
- Request: `{ "user_id": 9 }`
- 200: `{ "ok": true }`
- 400: `{ "error": "user_id required" }`
- 403: `{ "error": "forbidden" }`

### DELETE /chats/{chatID}/members/{userID}  · auth
Remove a member. Kicking another user needs `BAN_USERS`; removing **yourself**
(self-leave, `userID` == caller) is always allowed.
- 200: `{ "ok": true }`
- 403: `{ "error": "forbidden" }`

### POST /chats/{chatID}/admins  · auth · needs `MANAGE_ADMINS`
Promote a member to `admin` with the given rights bitmask.
- Request: `{ "user_id": 9, "rights": 17 }`
- 200: `{ "ok": true }`
- 400: `{ "error": "user_id required" }`
- 403: `{ "error": "forbidden" }`

### DELETE /chats/{chatID}/admins/{userID}  · auth · needs `MANAGE_ADMINS`
Demote an admin back to `member` (clears rights).
- 200: `{ "ok": true }`
- 403: `{ "error": "forbidden" }`

### POST /chats/{chatID}/mute  · auth
Set the caller's own per-chat mute flag.
- Request: `{ "muted": true }`
- 200: `{ "ok": true }`

### POST /chats/{chatID}/invite_links  · auth · needs `INVITE_USERS`
Create an invite link with a random token.
- Request: `{ "usage_limit": 10, "requires_approval": false }`  (`usage_limit` optional/nullable = unlimited; `requires_approval` optional, default `false`)
- 200: `{ "token": "<hex>", "url": "/join/<hex>", "requires_approval": false }`
- 403: `{ "error": "forbidden" }`

### GET /chats/{chatID}/invite_links  · auth · needs `INVITE_USERS`
List the chat's active (non-revoked) invite links.
- 200: `{ "invite_links": [ { "token": "<hex>", "uses": 3, "url": "/join/<hex>", "requires_approval": false } ] }`
- 403: `{ "error": "forbidden" }`

### POST /join/{token}  · auth
Join a chat via an invite token. If the link does not require approval the caller
becomes a `member` immediately and the link's `uses` counter increments. If the
link requires approval, a pending join request is recorded instead (idempotent).
- 200: `{ "status": "joined" }` — joined immediately (no approval required)
- 200: `{ "status": "requested" }` — pending admin approval (approval-required link)
- 404: `{ "error": "not found" }` (unknown or revoked token)

### GET /chats/{chatID}/join_requests  · auth · needs `INVITE_USERS`
List pending join requests for the chat.
- 200: `{ "requests": [ { "user_id": 42 } ] }`
- 403: `{ "error": "forbidden" }`

### POST /chats/{chatID}/join_requests/{userID}/approve  · auth · needs `INVITE_USERS`
Approve a pending join request; the user becomes a `member` and the request is removed.
- 200: `{ "ok": true }`
- 403: `{ "error": "forbidden" }`
- 404: `{ "error": "not found" }`

### POST /chats/{chatID}/join_requests/{userID}/decline  · auth · needs `INVITE_USERS`
Decline (remove) a pending join request.
- 200: `{ "ok": true }`
- 403: `{ "error": "forbidden" }`
- 404: `{ "error": "not found" }`

### GET /users?ids=  · auth
Batch-resolve minimal public user cards (for member lists, sender names).
- Query: `ids` — comma-separated int64 ids (e.g. `?ids=1,2,3`). Unknown ids are
  silently skipped; an empty/absent `ids` yields an empty list.
- 200: `{ "users": [ { "id": 1, "username": "alice", "display_name": "Alice", "avatar_url": "" } ] }`

---

## Channels

Broadcast chats (`type: "channel"`) that scale to millions of subscribers.
Channels reuse the group machinery — membership, roles, rights, `member_count`,
mute, the info card (`GET /chats/{chatID}/card`) and message **history**
(`GET /chats/{chatID}/history`) are all the same as for groups. Subscribers join
with role `subscriber` (no admin rights); posting is gated by the `POST_MESSAGES`
right (creator/admins only).

**Scalability model — O(1) per post.** Posting does **not** fan out to
subscribers. Each post is one message insert + one bump of the channel's own
`channel_pts` counter + one row appended to the channel's `channel_updates` log +
**one** `PUBLISH channel:{id}` to Redis (no per-subscriber `pts` rows, no
per-subscriber publishes). Live clients receive the post by subscribing the
`channel:{id}` topic over WS (see `subscribe_channel` below); offline/lagging
clients catch up by pulling `GET /channels/{chatID}/difference?pts=`. The
per-channel `pts` is **independent** of the per-user `/sync` `pts` cursor.

### POST /channels  · auth
Create a channel; the caller becomes its `creator` (with all rights) and first member.
- Request: `{ "title": "News", "about": "", "username": "news", "is_public": true }`
  (`title` required; `about`/`username` optional; `username` only meaningful when public)
- 200: `{ "chat_id": 1 }`
- 400: `{ "error": "title required" }`

### POST /channels/{chatID}/messages  · auth · needs `POST_MESSAGES`
Post to a channel. O(1) delivery: insert message → bump `channel_pts` → append a
`channel_updates` row → **one** `PUBLISH channel:{chatID}`. No per-subscriber fan-out.
- Request: `{ "text": "hello world", "client_msg_id": "uuid-from-client" }`
  (`client_msg_id` optional, makes the post idempotent)
- 200: `{ "id": 10, "chat_id": 1, "seq": 5, "created_at": "2026-06-24T10:00:00Z" }`
- 403: `{ "error": "forbidden" }` (caller lacks `POST_MESSAGES`)

### GET /channels/{chatID}/difference?pts=  · auth
getDifference-style catch-up for a single channel, using the channel's own `pts`.
Membership-gated. The client stores the channel's last seen `pts` and passes it back.
- Query: `pts` (last seen channel pts, default 0).
- 200:
```json
{
  "updates": [
    { "chat_id": 1, "msg_id": 10, "seq": 5, "sender_id": 7, "type": "text",
      "text": "hello world", "media_id": null, "created_at": "2026-06-24T10:00:00Z" }
  ],
  "pts": 6,
  "slice": false
}
```
  - each entry of `updates` is a `new_message` payload (the post).
  - `pts` is the highest channel pts in this batch (the new cursor).
  - `slice: true` → the batch hit the page cap (100); call again with the new `pts`.
- 403: `{ "error": "forbidden" }` (caller is not a member/subscriber)

### POST /channels/join  · auth
Join a public channel by its `@username`; the caller becomes a `subscriber`.
- Request: `{ "username": "news" }`
- 200: `{ "ok": true }`
- 400: `{ "error": "username required" }`
- 404: `{ "error": "not found" }` (no public chat with that username)

### Discussions (channel-post comments)

A channel can enable **discussions**: a backing `group` chat is auto-created and
linked via the channel's `discussion_chat_id`. Comments are ordinary group
messages stamped with `thread_root_id` = the channel post's message `id`, so they
reuse the standard send path (fan-out + per-user `pts` + live `new_message`).
Commenters auto-join the discussion group on first comment (idempotent).

### POST /channels/{chatID}/discussion  · auth · needs `CHANGE_INFO`
Enable discussions on a channel. Idempotent: returns the existing discussion
group id if already enabled. The caller must be an admin (CHANGE_INFO right).
- 200: `{ "discussion_chat_id": 42 }`
- 403: `{ "error": "forbidden" }` (not allowed to change channel info)
- 404: `{ "error": "not found" }` (channel does not exist)

### POST /channels/{chatID}/posts/{postId}/comments  · auth
Post a comment on the channel post `postId`. The comment is a message in the
linked discussion group with `thread_root_id = postId`. The caller is auto-joined
to the discussion group.
- Request: `{ "text": "nice post", "client_msg_id": "uuid-from-client" }`
- 200: a message object, e.g.
```json
{ "id": 99, "chat_id": 42, "seq": 1, "sender_id": 7, "type": "text",
  "text": "nice post", "reply_to_id": null, "media_id": null,
  "thread_root_id": 55, "created_at": "2026-06-24T00:00:00Z", "deleted": false }
```
- 404: `{ "error": "not found" }` (discussions not enabled)

### GET /channels/{chatID}/posts/{postId}/comments  · auth
List the comment thread (ascending by `seq`) for a channel post, plus the total
count.
- Query: `offset` (default 0), `limit` (default 50, max 100).
- 200:
```json
{ "messages": [ { "id": 99, "chat_id": 42, "seq": 1, "sender_id": 7,
  "type": "text", "text": "nice post", "thread_root_id": 55,
  "created_at": "2026-06-24T00:00:00Z", "deleted": false } ], "count": 1 }
```
- 404: `{ "error": "not found" }` (discussions not enabled)

### GET /channels/{chatID}/comment_counts?ids=  · auth
Return comment counts for a batch of channel posts. Returns `0` (or omits) for
posts with no comments and `{}` when discussions are not enabled.
- Query: `ids` — CSV of post message ids, e.g. `?ids=55,56,57`.
- 200: `{ "counts": { "55": 1, "56": 0 } }` (JSON object keys are post id strings)

### GET /search?q=  · auth
Global directory search: public chats (channels/public groups) by `@username` or
title prefix, plus users by `username`/`display_name` prefix. Private chats are
never returned. Both lists are capped at 20 and ordered (chats by `member_count`).
- Query: `q` — search prefix (empty `q` yields empty results).
- 200:
```json
{
  "chats": [ { "id": 1, "type": "channel", "title": "News", "username": "news", "member_count": 1234 } ],
  "users": [ { "id": 2, "username": "alice", "display_name": "Alice", "avatar_url": "" } ]
}
```

---

## Messages & history

### POST /chats/{chatID}/messages  · auth
Send a message. Also delivered live over WS (`new_message`) to all members.
- Request:
```json
{ "type": "text", "text": "hello", "reply_to_id": null,
  "client_msg_id": "uuid-from-client", "media_id": null }
```
  - `type` defaults to `text`. `client_msg_id` (optional) makes the send idempotent.
  - `media_id` (optional) must reference media **owned by the sender**.
- 200 (the created or deduplicated message):
```json
{ "id": 10, "chat_id": 1, "seq": 5, "sender_id": 1, "type": "text", "text": "hello",
  "reply_to_id": null, "media_id": null, "created_at": "2026-06-24T10:00:00Z", "deleted": false }
```
- 403: `{ "error": "not a member of this chat" }` (also when attaching media you don't own)

### GET /chats/{chatID}/history  · auth
Paginated window, like Telegram `messages.getHistory`.
- Query: `offset_id` (reference `seq`; `0`/absent = newest), `add_offset`
  (`>0` → older than offset, `<=0` → newer than offset), `limit` (default 40, max 100).
- 200: `{ "messages": [ <Message>, … ], "count": 5 }`  (messages newest-first when paging from the end)
- 403: `{ "error": "not a member of this chat" }`

### POST /chats/{chatID}/read  · auth
Mark read up to a sequence; fans out a read receipt. The marker never moves
backwards (a stale lower `up_to_seq` is a no-op).
- Request: `{ "up_to_seq": 5 }`
- 200: `{ "ok": true }`
- 403: `{ "error": "not a member of this chat" }`

---

## Reactions

### POST /chats/{chatID}/messages/{msgID}/reactions  · auth
- Request: `{ "emoji": "🔥" }`  (non-empty, ≤32 bytes, valid UTF-8)
- 200: `{ "ok": true }`
- 400: `{ "error": "invalid reaction" }`
- 404: `{ "error": "message not found" }` (also when the message isn't in this chat / no access)

### DELETE /chats/{chatID}/messages/{msgID}/reactions/{emoji}  · auth
`{emoji}` is URL-escaped (e.g. `%F0%9F%94%A5`).
- 200: `{ "ok": true }` · 400 invalid · 404 not found

### GET /chats/{chatID}/messages/{msgID}/reactions  · auth
- 200: `{ "reactions": [ { "emoji": "🔥", "count": 2 }, { "emoji": "❤️", "count": 1 } ] }` (most popular first)
- 404: `{ "error": "message not found" }`

---

## Sync (catch-up)

### GET /sync  · auth
getDifference-style catch-up of updates the client missed. The client stores
`state.pts` and passes it back as the cursor.
- Query: `pts` (last seen pts, default 0), `date` (default 0).
- 200:
```json
{
  "new_messages":  [ { "chat_id":1,"msg_id":10,"seq":5,"sender_id":1,"type":"text","text":"hi","media_id":null,"created_at":"..." } ],
  "other_updates": [ { "chat_id":1,"user_id":2,"up_to_seq":5 }, { "chat_id":1,"msg_id":10,"user_id":2,"emoji":"🔥","action":"add" } ],
  "state": { "pts": 7, "date": 1782237047655 },
  "slice": false,
  "too_long": false
}
```
  - `slice: true` → more updates remain; call `/sync` again with the new `state.pts`.
  - `too_long: true` → the client is too far behind; discard local cache and do a full resync.

---

## Media

Bytes never pass through the backend: the client uploads to / downloads from
object storage (MinIO/S3) using presigned URLs. Download URLs support HTTP Range.

### POST /media/upload  · auth
Register metadata and get a presigned PUT URL; then PUT the bytes to it directly.
- Request:
```json
{ "mime": "image/jpeg", "size": 20480, "width": 800, "height": 600,
  "duration": 0, "blur_preview": "<base64 LQIP>" }
```
  - `size` in bytes, `1..104857600` (100 MiB).
- 200: `{ "media_id": 1, "object_key": "1/ab12…", "upload_url": "https://minio/…?X-Amz-…" }`
- 400: `{ "error": "invalid size" }`  · 413: `{ "error": "file too large" }`
- Then: `PUT <upload_url>` with the raw bytes (direct to storage). Then send a
  message with `media_id`.

### GET /media/{mediaID}  · auth
Resolve media to metadata + a presigned GET (download) URL. Allowed only if the
caller **owns** the media or **shares a chat** with a message referencing it.
- 200:
```json
{ "id": 1, "mime": "image/jpeg", "size": 20480, "width": 800, "height": 600,
  "duration": 0, "blur_preview": "<base64>", "download_url": "https://minio/…?X-Amz-…" }
```
- 404: `{ "error": "media not found" }` (also when not authorized — no enumeration leak)
- The `download_url` honors `Range: bytes=…` → `206 Partial Content` (streaming).

### PUT /media/{mediaID}/content  · auth (Bearer, owner)
Stream the raw object bytes through the backend into storage. The body is the
raw file bytes; `Content-Type` should be the media's mime. Only the **owner**
may upload; the body is capped at 100 MiB.
- Request: raw bytes (not JSON).
- 204: success (no body).
- 403: `{ "error": "not your media" }` (caller is not the owner).
- 404: `{ "error": "media not found" }`.

### GET /media/{mediaID}/content?token=<session-token>  · token-query auth
Stream the object bytes back through the backend. Browser `<img>`/`<video>`
elements can't send an `Authorization` header, so this endpoint authenticates via
the `?token=` **query parameter** (the same mechanism as `/ws`) and is mounted
**outside** the Bearer group. The worker builds the URL (token stays in the
worker); the UI drops the string into `src`. Access is checked exactly like
`GET /media/{mediaID}` (owner or shares a chat referencing the media).
- Streams bytes and honors `Range: bytes=…` → `206 Partial Content` (via
  `http.ServeContent`); sets `Content-Type` (declared mime) and a long
  `Cache-Control: private, max-age=31536000, immutable`.
- 401: `{ "error": "invalid token" }` (missing/invalid `token`).
- 404: `{ "error": "media not found" }` (no access — no enumeration leak).

---

## Web Push

Push is sent only when a recipient has **no active WebSocket** and has **not muted**
the chat. Subscriptions are per device. Requires the server to have VAPID keys set.

### GET /push/vapid_public_key  · auth
- 200: `{ "public_key": "<base64 VAPID public key>" }`

### POST /push/subscribe  · auth
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

---

## Stories

24h ephemeral posts backed by a media object. Visibility is by privacy:
`everyone` / `contacts` (chat partners) / `selected` (an explicit allow-list).
The feed shows the viewer's own active stories plus those of their chat
partners; expired stories (created more than 24h ago) are filtered out on read.

### POST /stories  · auth
Post a story from a media object the caller owns.
- Request: `{ "media_id": 5, "caption": "hi", "privacy": "contacts", "allow_user_ids": [7] }`
  (`caption` optional; `privacy` defaults to `contacts`; `allow_user_ids` used only when `privacy="selected"`)
- 200: `{ "id": 1 }` · 400 missing `media_id` · 403 media not owned by caller

### GET /stories  · auth
The viewer's active story feed (own group first), grouped by author.
- 200:
```json
{ "groups": [
  { "author": { "id": 1, "display_name": "Alice", "avatar_url": "" },
    "stories": [ { "id": 1, "media_id": 5, "caption": "hi", "created_at": "2026-06-24T…Z", "viewed": false } ] }
] }
```

### POST /stories/{storyID}/view  · auth
Mark a story as seen. Idempotent.
- 200: `{ "ok": true }` · 403 story not visible to caller

### GET /stories/{storyID}/viewers  · auth · author only
Who has seen the story (author-gated).
- 200: `{ "viewers": [ { "id": 7, "display_name": "Bob", "avatar_url": "" } ], "count": 1 }`
- 403 caller is not the author

### DELETE /stories/{storyID}  · auth · author only
Delete the caller's own story.
- 200: `{ "ok": true }`

---

## System / docs

- `GET /health` → `{ "status": "ok" }`
- `GET /openapi.yaml` → the OpenAPI 3 spec (YAML)
- `GET /swagger` → Swagger UI

---

## WebSocket — realtime

### Connect
`GET /ws?token=<session-token>` → HTTP 101 (Upgrade). Browsers can't set headers
on WS, so the token goes in the query string. Invalid/missing token → 401 (no upgrade).

### Frame envelope
Every frame is JSON: `{ "t": "<type>", "d": { … } }`.

### Client → server
| `t` | `d` | Effect |
|-----|-----|--------|
| `send_message` | `{ chat_id, type?, text?, reply_to_id?, client_msg_id, media_id? }` | Same as `POST /chats/{id}/messages`; replies with `message_ack` and fans out `new_message`. |
| `read` | `{ chat_id, up_to_seq }` | Same as `POST /chats/{id}/read`; fans out `read`. |
| `typing` | `{ chat_id }` | Ephemeral; fans out `typing` to other members (no persistence). |
| `subscribe_channel` | `{ chat_id }` | Subscribe this connection to a channel's live posts. The Hub lazily joins the Redis `channel:{chat_id}` topic on the first local subscriber; subsequent posts arrive as `new_message`. |
| `unsubscribe_channel` | `{ chat_id }` | Stop receiving live posts for the channel; the Hub leaves the `channel:{chat_id}` topic once no local connection is subscribed. Subscriptions are also dropped automatically on disconnect. |
| `ping` | — | Server replies `{ "t": "pong" }`. |

### Server → client
| `t` | `d` |
|-----|-----|
| `message_ack` | `{ client_msg_id, msg_id, seq, created_at }` (to the sender) |
| `new_message` | `{ chat_id, msg_id, seq, sender_id, type, text, media_id, created_at }` |
| `read` | `{ chat_id, user_id, up_to_seq }` |
| `typing` | `{ chat_id, user_id }` |
| `presence` | `{ user_id, online, last_seen }` (`last_seen` epoch ms; sent to chat partners) |
| `reaction` | `{ chat_id, msg_id, user_id, emoji, action }` (`action`: `add` \| `remove`) |
| `pong` | — |

### Delivery guarantees
- WS is an accelerator, not the source of truth. Every `new_message`/`read`/
  `reaction` is also recorded in the per-user `pts` log, so anything missed
  while disconnected is recovered via `GET /sync`.
- On a slow client, live frames may be dropped (bounded send buffer) — the client
  reconciles via `/sync`.
- **Channels** use a separate, **topic-based** delivery path that scales O(1) per
  post: each post is published **once** to the Redis topic `channel:{id}` (no
  per-subscriber fan-out, no per-subscriber `pts` rows). A client opts in per
  channel via `subscribe_channel {chat_id}`; the Hub joins the `channel:{id}` topic
  on the first local subscriber and routes incoming posts (`new_message`) only to
  the connections that subscribed it, leaving the topic once the last one drops.
  Missed channel posts are recovered per-channel via
  `GET /channels/{id}/difference?pts=` (the channel's own `pts`, independent of the
  per-user `/sync` cursor); channel **history** is the regular
  `GET /chats/{id}/history`.
- Heartbeat: server pings ~every 25s; the client should respond (WS pong) or send
  `{"t":"ping"}`. Presence stays "online" while heartbeats arrive (TTL ~35s).
