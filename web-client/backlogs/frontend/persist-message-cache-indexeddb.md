# Persistent message cache (IndexedDB) + cache invalidation

**Status:** backlog / research (not started)
**Date:** 2026-06-26 (updated 2026-06-27)

> **Update 2026-06-27 — edit/delete/pin/forward now exist.** When this was first
> written messages were effectively immutable, so the doc concluded "edit/delete
> is a future backend dependency". That's now shipped — AND the backend already
> emits `edit_message` / `delete_message` / `pin_message` as update types that
> flow through BOTH `/sync` (OtherUpdates) and the live ws (the worker routes
> them by `edited_at` / `for_me` / `pinned`). So the mutability dependency is
> already SATISFIED on the backend — persistence stays **frontend-only**. The one
> added requirement: the startup/reconnect catch-up must now apply
> `edit_message` / `delete_message` / `pin_message` deltas to the *persisted*
> per-chat cache too (not just `new_message` / `read`). Forwards arrive as
> ordinary `new_message`, so they need nothing extra.
**Context:** The open-chat ladder cascade fires on every *network* load. After a
full page reload our in-memory message cache is empty, so every chat's first
open is a network fetch (spinner + cascade). Real Telegram / tweb persist
history so a reopened chat is instant. This doc captures how tweb keeps a
persisted cache correct, what our backend already provides, and what (if
anything) needs to change.

---

## TL;DR

- **Today we cache messages only in memory** (the `SlicedArray` + message map in
  `messagesManager`, living in the SharedWorker). It survives chat-switching
  within a session but is wiped on a full page reload / worker restart.
  IndexedDB (`src/core/store/idbKv.ts`) is used only for the **auth token** and
  **channel pts** — not for message history.
- **Backend changes are essentially NOT required** for our current append-only
  model. We already have tweb's exact invalidation primitive:
  `GET /sync?pts=X` (= `getDifference`) returning new messages + reads since a
  persisted `pts` checkpoint, with `slice` pagination and a `too_long` reset.
  The worker already persists `pts`/`date` and catches up on reconnect.
- **Message mutability is now implemented AND already invalidation-ready.**
  edit/delete/pin emit update rows carried by `/sync` + ws; deleted messages are
  excluded from history. So a persisted cache can be kept correct by applying
  those deltas on catch-up — no further backend work.
- **The work is entirely frontend:** persist per-chat messages + slice bounds to
  IDB, hydrate on open (→ `cached: true` → instant, no cascade), and wire the
  `/sync` catch-up to apply **new_message / read / edit_message / delete_message
  / pin_message** into the *persisted* `messagesManager` cache (not just the open
  chat's window / UI store); invalidate on `too_long`; evict/clear on logout.

---

## How tweb invalidates a persisted cache

tweb stores messages in IndexedDB, but consistency is guaranteed by an
**update stream with a cursor**, not by the cache itself.

- Persists the **checkpoint** `pts` / `seq` / `date`
  (`apiUpdatesManager.ts:73-79`), not message "correctness".
- On startup / reconnect: load saved `pts` → `updates.getDifference(pts, date,
  qts)` (`apiUpdatesManager.ts:276-369`) → server returns everything changed
  since that `pts`: new messages, **edits**, **deletions**, reads → applied to
  the cache. Gap too large → `differenceTooLong` → reset.
- Live updates mutate both the in-memory cache and the IDB objects:
  - `onUpdateNewMessage` — `appMessagesManager.ts:7360`
  - `onUpdateEditMessage` — `appMessagesManager.ts:7736`
  - `onUpdateDeleteMessages` — `appMessagesManager.ts:8134`
  - `onUpdateReadHistory` — `appMessagesManager.ts:7855`
- Channels use a separate `channel pts` + `getChannelDifference()`
  (`apiUpdatesManager.ts:378-450`).
- Open-chat flow: render from cache immediately, reconcile in the background via
  live updates — no blocking validation (`getHistory` cache path
  `appMessagesManager.ts:9227-9344`).

**What tweb actually persists vs rebuilds:** message *objects* + dialogs/users/
chats are in IDB (`config/databases/state.ts:52-81`), but the **history index**
(the `SlicedArray` of message ids) is **rebuilt in memory on demand**, not
persisted. The durable part is the `pts`/`seq`/`date` checkpoint.

**Required server primitives:** a monotonic `pts` bumped on every change, and a
`getDifference(since pts)` that carries new messages **and edits/deletes/reads**;
immutable message ids; deletions announced as explicit updates.

---

## What our backend already provides

Nearly 1:1 with tweb's model:

| Capability | Evidence |
|---|---|
| Per-chat monotonic `seq` | `messages.seq`; `messagesrepo.go:23-33` (NextSeq) |
| Per-user monotonic `pts` | `user_state.pts`; `updatesrepo.go:24-38` |
| Difference endpoint `GET /sync?pts=X` | `chat_handler.go:153` → `usecase/chat/sync.go:33-63` |
| → returns `{NewMessages, OtherUpdates, State{pts,date}, Slice, TooLong}` | `usecase/chat/ports.go:129-135` |
| Pagination + reset | `slice`, `too_long` (threshold 2000, limit 500) `sync.go:35-47` |
| Worker persists `pts`/`date` + catches up on reconnect | `syncEngine.ts:18-35` |
| `too_long` → full resync (reload dialogs) | `realtimeBridge.ts` (`rt:resync`) |
| Live ws frames | `new_message`, `read`, `typing`, `ack` (`usecase/chat/message.go`, `ws/conn.go:111-114`) |
| Channels: own `channel_pts` + difference | `/channels/{id}/difference`; `channelrepo.go:25-40`, `usecase/chat/channel.go:68-81` |

`/sync` returns **user-level** pts (mixing all chats) — which is exactly tweb's
global `getDifference` model, so a per-chat catch-up endpoint is **not** needed.

---

## The one real backend dependency: edit / delete

tweb's cache correctness depends on `updateEditMessage` / `updateDeleteMessages`.
Our state:

- DB has `messages.edited_at` and `messages.deleted_at`; `history` even returns
  `"deleted"` (`chat_handler.go:248`).
- **But:** no edit/delete HTTP endpoints, no ws event, no update row written →
  `/sync` does not carry them; the frontend `Message` model doesn't include
  them (`models.ts:31-59`).
- **However, messages are effectively immutable today** (the Edit/Delete context
  menu items are not wired). If a message can't be edited/deleted, a persisted
  cache cannot diverge from the server.

→ Backend work is required **only when we add edit/delete**:
1. write the edit/delete as an update row (so `/sync` carries it),
2. broadcast a live ws frame,
3. model + apply it on the frontend.

Reactions are similar: currently delivered only via `/sync` catch-up (not as a
live frame) — acceptable for the cache; a live frame would just be a UX nicety.

---

## Frontend work (the bulk)

1. Persist per chat in IDB: message objects + slice bounds (`reachedTop` /
   `reachedBottom`) + last `seq`. (The global `pts` checkpoint is already
   persisted by `syncEngine`.)
2. On open: hydrate the `messagesManager` `SlicedArray` from IDB → return
   `cached: true` → instant render, no spinner, no cascade (reuses the existing
   `cached` flag → `loadedFromCache` → ladder gating).
3. On startup / reconnect: run the existing `/sync` catch-up and **apply
   `new_message` / `read` into the persisted `messagesManager` cache**, not just
   the UI store. On `too_long` → invalidate the persisted per-chat caches.
4. Eviction: cap per chat (e.g. last ~100 messages); clear on logout
   (`idbDel`).

**Open question / gap to verify:** does the current `/sync` catch-up reach the
`messagesManager` cache for **closed** chats? It appears to flow into
`chatsStore` and the *open* chat's window only — wiring it into the persisted
per-chat cache is the main "glue" task.

---

## Suggested rollout

1. **Frontend persistence (steps 1–2 + eviction)** — gives instant, animation-
   free reopen after a reload. Backend untouched.
2. **Catch-up glue (step 3)** — apply `/sync` deltas into the persisted cache;
   handle `too_long` invalidation. Separate change, with tests.
3. **(Later, only with edit/delete feature)** backend edit/delete updates + ws
   frames + frontend model/handlers.

---

## Related

- [[lazy-cull-window-trimming]] — window trimming for long-open chats.
- Ladder gating today: `ConversationView` `ladderActive` uses
  `win.loadedFromCache`; `getHistory` already returns a `cached` flag
  (`messagesManager.ts`).
</content>
