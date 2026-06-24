# Groups & Channels — Design Spec (v1)

**Status:** Approved 2026-06-24. Decomposed first sub-project of the "groups, channels, discussions, stories, QR, multi-account, secret chats" roadmap. Later sub-projects get their own specs.

**Goal:** Add multi-member chats — **groups** (bounded, per-user fan-out) and **channels** (broadcast, scalable to millions of subscribers) — with granular admin permissions, public `@username` + search, invite links, and per-chat mute. Backend + frontend.

**Decisions locked with the user:**
- Groups + channels in ONE spec (shared multi-member chat model).
- Channels scale via **per-channel `pts` + a Redis topic** (NOT per-subscriber fan-out).
- Notifications in this slice = **per-chat mute (API + UI)** only. Global push toggle + in-app toasts = later specs.
- **Granular admin rights** (per-admin bitmask), not just owner/admin/member.
- **Public `@username` + a search endpoint**, not just invite links.

---

## 1. Data model (migration `0006_groups_channels.sql`, on top of 0002)

**`chats`** — add columns:
- `title text` (group/channel name; null for private).
- `username citext unique` (nullable; public handle).
- `about text`.
- `photo_media_id bigint` (nullable; references media).
- `creator_id bigint`.
- `member_count int not null default 0` (denormalized; ++/-- on join/leave — never `COUNT` over millions).
- `is_public boolean not null default false`.
- `channel_pts bigint not null default 0` (per-channel update cursor; channels only).

**`chat_members`** — add columns:
- `role smallint not null default 0` (0 = member/subscriber, 1 = admin, 2 = creator).
- `rights int not null default 0` (bitmask, admins only — see §2).
- `muted boolean not null default false` (per-member mute; already surfaced in dialogs).
- `joined_at timestamptz not null default now()`.
- Indexes: existing `(chat_id, user_id)` unique; `(user_id)` for dialog listing.

**`channel_updates`** (new) — `(id bigserial, channel_id bigint, pts bigint, pts_count int, payload jsonb, created_at)`. The channel's own update log for `getChannelDifference`. **Channels never write per-user `updates` rows.** Index `(channel_id, pts)`.

**`invite_links`** (new) — `(id bigserial, chat_id bigint, token text unique, created_by bigint, expires_at timestamptz null, usage_limit int null, uses int not null default 0, revoked bool default false, created_at)`.

`citext` requires the `citext` extension (case-insensitive usernames) — enable in the migration.

---

## 2. Permissions (rights bitmask)

```
POST_MESSAGES   = 1<<0
EDIT_MESSAGES   = 1<<1
DELETE_MESSAGES = 1<<2
BAN_USERS       = 1<<3
INVITE_USERS    = 1<<4
PIN_MESSAGES    = 1<<5
CHANGE_INFO     = 1<<6
MANAGE_ADMINS   = 1<<7
```
- **Creator** (role 2): all rights implicitly.
- **Admin** (role 1): `rights` bitmask decides each action.
- **Member** (group, role 0): may post (groups are open-post by default), read.
- **Subscriber** (channel, role 0): read only; cannot post.
- Every mutating usecase checks the actor's role/rights and returns `domain.ErrForbidden` (→ 403) otherwise.

---

## 3. Channel scalability (per-channel pts + topic)

**Posting** (actor needs POST_MESSAGES): in one transaction — insert `message` (channel's `last_seq`), bump `chats.channel_pts`, insert a `channel_updates` row (`pts`, `pts_count=1`, payload = the new message). After commit: **one** `PUBLISH channel:{chatID}` with the new-message frame.

**Online delivery:** a connected client that has a channel open subscribes its WS to the Redis topic `channel:{chatID}`; it receives the post immediately. One publish per post; topic fan-out is Redis/Hub's job. **No per-subscriber update rows, no per-subscriber publishes** — that's the scalability win (the DB/queue cost of a post is O(1), independent of subscriber count).

**Catch-up:** `GET /channels/{id}/difference?pts=<lastSeen>` returns `channel_updates` with `pts > lastSeen` (sliced + `too_long` like `getDifference`). Clients call it when opening a channel or on a lightweight "channel updated" hint.

**Counts:** `member_count` maintained incrementally. Listing channel members is admins-only and paginated — never the full subscriber set.

**Honest scope:** broadcasting to millions of *online sockets* is sharded in real Telegram; we keep the socket fan-out simple (single publish to a topic) and eliminate the real killers (per-subscriber rows/queue jobs). Push notifications to millions are async/best-effort via the existing `push:queue` (and gated by mute); true million-scale push infra is out of scope.

---

## 4. Groups (bounded, per-user fan-out)

Groups reuse the existing private-chat machinery: `messaging.Send` with per-user `pts` fan-out and `getDifference`. Membership is bounded (hundreds/low-thousands). Open-post by default; admin actions gated by rights. **Megagroups** (channel-like pts for huge groups) are deferred.

---

## 5. API surface (REST + WS; update `docs/contracts.md` + `openapi.yaml`)

Creation & info:
- `POST /chats` (extend) — create a **group** `{type:"group", title, about?, username?, is_public?}` → `{chat_id}`.
- `POST /channels` — create a **channel** `{title, about?, username?, is_public?}` → `{chat_id}`.
- `GET /chats/{id}` — chat card: `{id, type, title, username, about, photo, member_count, my_role, my_rights, ...}`.
- `PATCH /chats/{id}` — edit title/about/username/photo (needs CHANGE_INFO).

Membership:
- `POST /chats/{id}/members {user_id}` — add (groups; needs INVITE_USERS).
- `DELETE /chats/{id}/members/{userID}` — kick (needs BAN_USERS) or self-leave.
- `POST /chats/{id}/join` — join a public chat by id (resolved via search/username).
- `POST /join/{token}` — join via invite link.
- `GET /chats/{id}/members?offset=&limit=` — paginated; for channels returns admins + count, not the full set.

Admins & invites:
- `POST /chats/{id}/admins {user_id, rights}` — promote/edit (needs MANAGE_ADMINS).
- `DELETE /chats/{id}/admins/{userID}` — demote (needs MANAGE_ADMINS).
- `POST /chats/{id}/invite_links {expires_at?, usage_limit?}` → `{token, url}`; `GET /chats/{id}/invite_links`; `DELETE …/{token}` (revoke).

Messaging extras (over existing messages):
- `PATCH /chats/{id}/messages/{msgID}` (edit — EDIT_MESSAGES), `DELETE …` (DELETE_MESSAGES), `POST …/pin` (PIN_MESSAGES). Minimal in v1; pin = a `pinned_msg_id` on chats.

Mute, sync, search, peers:
- `POST /chats/{id}/mute {muted}` — set per-member mute.
- `GET /channels/{id}/difference?pts=` — channel catch-up.
- `GET /search?q=` — public chats (username/title prefix) + users (display_name/username). Paginated, public-only.
- `GET /users?ids=1,2,3` — batch user cards (id, display_name, avatar_url) for sender-name resolution.

WS: channel posts arrive via the `channel:{id}` topic frame (`new_message` shaped, with the channel context). Group messages use the existing per-user `new_message` fan-out.

---

## 6. Sender names in groups (folded-in tail)

Add a batch `GET /users?ids=` + a frontend **peersManager** (small `Map<userId, {name, avatar}>` cache, `requestUsers(ids)`). Group history/`new_message` carry `sender_id`; the renderer resolves names via peersManager (fetch-missing-then-render). Avoids bloating every message payload while fixing group sender names.

---

## 7. Sync integration

- **Groups:** existing user `pts` / `getDifference` (per-user fan-out already creates user `updates` rows).
- **Channels:** `SyncEngine` gains `channelStates: Map<channelId, {pts}>` (already stubbed in the frontend spec §6.1). On opening a channel (or a topic "updated" hint), call `getChannelDifference(channelId, pts)`; apply + persist per-channel pts. Channel posts are NOT in the user `getDifference`.

---

## 8. Frontend

- **Create flows:** the existing mock create-group / create-channel UIs → real `POST /chats` / `POST /channels`; real membership; the new chat appears via dialog reload.
- **Channel view:** the mock `ChatView` (channel posts) → real channel messages via the windowed loader + `getChannelDifference`; an admin-only post composer.
- **Admin UI:** manage admins + rights, edit info, invite links — functional but minimal (a settings panel per chat).
- **Search:** the sidebar search → `GET /search`; join by `@username` / invite link.
- **Mute:** a toggle in the chat header/menu → `POST /chats/{id}/mute`; reflect in dialog list (badge greys out — already wired).
- **Sender names:** peersManager resolves group sender names in bubbles.
- **Folded tails (optional here):** presence dot in the dialog list, jump-to-first-unread on open.

---

## 9. Implementation: one spec → multiple plans

Too large for one plan. Sequenced plans (each subagent-driven, TDD, verified):
- **Plan A — backend foundation:** migration 0006, domain + repos, permissions, group create/members/admins, channel create/post/difference, invite links, public username + `GET /search`, `GET /users?ids=`, `POST /chats/{id}/mute`, contracts/openapi. (testcontainers PG + miniredis; live docker e2e.)
- **Plan B — frontend groups:** real create-group, members, group messaging with sender names (peersManager + `GET /users`), mute toggle.
- **Plan C — frontend channels + search + admin UI:** channel create/post/view, `getChannelDifference` in SyncEngine, search + join by username/link, admin/info panels.

Each plan ends green (unit + tsc + build) and live-verified on the isolated docker verify stack (nginx :38080).

---

## 10. Out of scope (later specs)

Discussions under channel posts, stories, QR login, multi-account, secret chats (e2e); global push on/off toggle + in-app toasts; megagroups; rich pinned-message UI; message reactions on channel posts beyond what already exists; APNs/FCM native push.

---

## Self-review

- **Placeholders:** none — every entity/endpoint/right is concrete.
- **Internal consistency:** channel pts (per-channel) vs group pts (per-user) clearly separated; `channel_updates` vs `updates`; `member_count` denormalized to avoid COUNT-at-scale. ✓
- **Scope:** focused on multi-member chats; discussions/stories/etc. explicitly deferred; large but coherent, split into 3 plans. ✓
- **Ambiguity:** groups = bounded per-user fan-out; channels = topic + per-channel pts + pull catch-up; rights bitmask enumerated; search is public-only. ✓
