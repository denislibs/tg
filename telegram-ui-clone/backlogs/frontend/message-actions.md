# Message actions, bulk-select, date sections — plan

**Status:** planned (not started)
**Date:** 2026-06-26
**Scope:** reply, forward (with attribution), delete (for me / for everyone),
edit (text only), copy, pin, views ("seen by"), bulk multi-select, date
sections + sticky date + service messages. Match tweb 1:1 (animations/markup).

Confirmed decisions:
1. **Delete** — dialog asks **«у себя» vs «у всех»**. "У себя" hides only for the
   requester (author or any participant). "У всех" = revoke (global).
2. **Forward** — real backend support + "Переслано от X" rendering.
3. **Edit** — text only.
4. **Pin** — backend + frontend (pinned bar under header).
5. **Views** — backend + frontend ("Нет просмотров" → seen-by list).

---

## Current state (what exists)

- Context menu (portal) + reactions strip: shell exists, animation not tweb-accurate,
  actions not wired (`ConversationView.tsx:557-567`; only Reply → `startReply`).
- Reply composer preview: **works** (state + UI); send supports `replyToId`. But
  the bubble's reply isn't hydrated from real data (`messageToConvMsg` doesn't set
  `reply`).
- Service messages + date separators render; sender grouping (first/last) exists.
- Backend: NO edit/delete/forward/pin endpoints. Columns `edited_at`/`deleted_at`
  exist; `deleted` already returned in history. Rights `RightEditMessages`/
  `RightDeleteMessages` declared but unused. Read horizons exist
  (`chat_members.last_read_seq`).

---

## Backend schema & endpoints (Phase 0)

### Migrations
1. **Forward origin** on `messages`: `fwd_from_user_id BIGINT NULL`,
   `fwd_from_chat_id BIGINT NULL`, `fwd_from_msg_id BIGINT NULL`,
   `fwd_date TIMESTAMPTZ NULL`. (Optional `fwd_from_name TEXT` for hidden origin.)
2. **Per-user delete** ("у себя"): table
   `message_hides(user_id BIGINT, msg_id BIGINT, PRIMARY KEY(user_id,msg_id))`.
   History filters out rows hidden for the requesting user.
3. **Pin** (start single, extensible): `chats.pinned_msg_id BIGINT NULL`
   (+ `pinned_by`, `pinned_at` optional). Multi-pin = a `pinned_messages` table later.
4. `edited_at`, `deleted_at` already exist — no migration. Views derive from
   `chat_members.last_read_seq` — no migration.

### Domain / repo
- `domain.Message`: add `EditedAt *time.Time`, forward fields, (already `Deleted`).
- repo: `UpdateText(msgID, text, editedAt)`, `SoftDelete(msgID)` (global),
  `HideForUser(userID, msgID)` (per-user), `Pin(chatID, msgID)` / `Unpin(chatID)`,
  `Viewers(chatID, seq)` (members with `last_read_seq >= seq`, excl. sender),
  `InsertForwarded(...)` (copy with fwd fields). History: join `message_hides` to
  exclude per-user-hidden; return `edited_at`, fwd fields, and reply preview
  (reply_to sender_id + snippet).

### Usecases (mirror SendMessage: auth + membership + pts bump + AppendUpdate + publish)
- `EditMessage` (author only, text) → `AppendUpdate("edit_message")` + ws.
- `DeleteMessage(revoke bool)` → revoke: `SoftDelete` + `AppendUpdate("delete_message")`
  + ws to all; non-revoke: `HideForUser` (no broadcast, only requester's other tabs).
- `ForwardMessages(fromChat, msgIds, toChat)` → `InsertForwarded` each (new seq/id,
  fwd origin) → normal `new_message` updates/ws in target.
- `PinMessage` / `UnpinMessage` → `AppendUpdate("pin_message")` + ws.
- `MessageViewers(chatID, msgID)` → list of user ids/names.

### HTTP
- `PATCH  /chats/{id}/messages/{msgId}`        — edit `{text}`
- `DELETE /chats/{id}/messages/{msgId}?revoke=` — delete (for me / for everyone)
- `POST   /chats/{id}/forward`                  — `{from_chat_id, msg_ids[]}`
- `POST   /chats/{id}/messages/{msgId}/pin` / `DELETE .../pin`
- `GET    /chats/{id}/messages/{msgId}/viewers` — seen-by list

### New realtime update types
`edit_message`, `delete_message`, `pin_message` — flow through `/sync` (OtherUpdates)
+ ws like `new_message`. Forward emits a normal `new_message` in the target chat.

---

## Frontend phases

### Phase 1 — data model + plumbing
- `models.ts Message`: `editedAt?`, `deleted?`, fwd fields; `ConvMsg` (`data.ts`):
  `edited?`, `deleted?`, `forwardFrom?: {name, color}`, hydrate `reply`.
- `messageToConvMsg`: map edited/deleted/forward/reply.
- `events.ts`: `RT.editMessage`, `RT.deleteMessage`, `RT.pinMessage` + interfaces;
  route in `worker.ts` + `realtimeBridge.ts`.
- `useMessageWindow`: `applyEdit`, `applyDelete`; `messagesManager`: `editMessage`,
  `deleteMessage`, `forwardMessages`, `pin`/`unpin`, `viewers` (REST) + cache update.

### Phase 2 — context menu animation 1:1 + wire actions
- Animation = tweb `_button.scss`: `scale(.8)→scale3d(1,1,1)` + `opacity 0→1`,
  `transition .2s cubic-bezier(.4,0,.2,1)`, **transform-origin from click point**,
  edge-flip + center fallback (`positionMenu.ts`, padding 8px). Close = reverse,
  remove after 300ms.
- Wire: Copy (Clipboard API text+html + fallback), Reply (exists), Edit (→Phase 3),
  Delete (→ confirm dialog → backend revoke flag), Forward (→ chat picker → backend),
  Pin/Unpin (→ backend, toggles by state), Select (→Phase 4), Views (→ submenu).
- **Edited marker** in bubble: "изменено" before time when `m.edited` (tweb `makeEdited`).

### Phase 3 — edit composer mode + reply bar (Image 90)
- Composer edit mode: top plate "Изменить" (pencil, accent), prefilled text, `PATCH`.
- Reply bar: accent left border (`.1875rem`, primary), "В ответ <name>" accent,
  quote grey, X; height open `0→3rem`. (Largely exists — align.)
- Forwarded-from header in bubble: "Переслано от <name>" (accent), above content.

### Phase 4 — bulk multi-select (checkbox 1:1)
- Selection `Set<msgId>`; enter via "Выбрать"/long-press; exit Esc/back.
- Round checkbox (tweb `_checkbox.scss`): `1.5rem`; circle `scale(0)→scale(1)`
  `transform .2s .05s ease-in-out`; check `stroke-dasharray 0,24.19→24.19,24.19`
  `.1s` delay `.15s`; on bubble `absolute; inset-inline-start:0; bottom:.3125rem`.
- Bubble shift: content `translateX(2.5rem)`, avatar `+scale(.76)`,
  `transition .3s cubic-bezier(.4,0,.2,1)` (class `is-selecting`).
- Selection toolbar (replaces composer): "N выбрано" (center, bold, accent), Delete
  (danger, left), Forward (right); fade show/hide `200ms`. Click bubble toggles.

### Phase 5 — date sections + sticky date + service + pin bar
- Group by day; **sticky date** pill `position:sticky; top:calc(pad+.1875rem); z-index:2`,
  newest stuck date active, `transition opacity .3s ease` (IntersectionObserver,
  `bubbles.ts:1313`).
- Service `.service-msg` (dark translucent pill, `#fff`, radius `.875rem`,
  padding `.28125rem .625rem`, centered) — close already.
- Sender grouping: 2px within / 6px between, tail on last only.
- **Pinned bar** under header (Pin feature): shows pinned message, jump-to on click,
  unpin; counter if multiple later.
- **Views**: "Нет просмотров" item → seen-by list (avatars/names from viewers
  endpoint); "N просмотров" when there are some.

---

## Open sub-decisions (sane defaults if unanswered)
- Pin: single pinned message first (extend to multi later). 
- "Delete for everyone" permission: author always; group admins for others' msgs.
- Forward picker UI: reuse the existing chat/peer picker if present, else a simple
  dialog list of chats.

## Build order
Phase 0 (backend + migrations) first. Then Phase 1 (model). Then parallelizable:
Phase 2 (menu+copy/edit/delete/pin), Phase 5 (dates/service/pin-bar/views — mostly
frontend). Phase 4 (select) standalone. Each = its own commit, tests + browser check.
Two git repos: backend at root, frontend at telegram-ui-clone.
</content>
