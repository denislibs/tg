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
- Heartbeat: server pings ~every 25s; the client should respond (WS pong) or send
  `{"t":"ping"}`. Presence stays "online" while heartbeats arrive (TTL ~35s).
