# Invite Links (host URLs) + Join Requests — Design Spec

**Status:** Approved 2026-06-24. Extends the Groups & Channels phase (A1/A2/B/C merged).

**Goal:** Real, shareable invite links (working URLs on our host) and **join-by-request** — an invite link can be marked "requires admin approval"; joining via it creates a pending request that an admin approves/declines (closed groups/channels).

**Decisions (locked with user):**
- Approval is **per-invite-link** (`requires_approval` flag on the link), like Telegram's "request admin approval" toggle — not a chat-wide flag.
- Invite links are **real host URLs**: `${origin}/join/{token}` (no fake t.me domain). The web app handles the `/join/:token` deep route → join or request.

## Data model (migration 0007)
- `invite_links` += `requires_approval boolean NOT NULL DEFAULT false`.
- new `join_requests (id bigserial, chat_id bigint→chats, user_id bigint→users, invite_token text, created_at timestamptz, UNIQUE(chat_id,user_id))` — only pending requests are stored; approve/decline deletes the row.

## Backend behavior
- `CreateInvite(chatID, actor, usageLimit, requiresApproval)` (needs INVITE_USERS). `invite_links.requires_approval` persisted; returned in card/list.
- `POST /join/{token}`: resolve link → if `requires_approval` → create a `join_request` (idempotent, ON CONFLICT DO NOTHING), return `{status:"requested"}`; else add member + IncUses, return `{status:"joined"}`. (Revoked/expired link → 404.)
- Admin (INVITE_USERS): `GET /chats/{id}/join_requests` → pending `[{user_id}]`; `POST /chats/{id}/join_requests/{userID}/approve` → add member + delete request + IncUses; `POST .../decline` → delete request.
- `GET /chats/{id}/card`/list expose `requires_approval` on links and (optionally) a `pending_requests` count for admins.

## Frontend behavior
- **Invite link UI** (admin, in the chat info panel): "Create invite link" with a **"Require admin approval"** toggle; show the copyable `${origin}/join/{token}`; list existing links (uses, approval). Reuse existing panel/kit/TgSwitch markup (mirrors tweb `editChatInvites`/`appEditContactLink`).
- **Deep link**: on app load, if `location.pathname` is `/join/{token}`, after auth call join → toast/inline "Вы вступили" (open the chat) or "Заявка отправлена, ждите одобрения"; then clear the path.
- **Join requests UI** (admin): a section in the info panel listing pending users (name via peers) with **Approve/Decline**. Reuse the members-row markup.

## Out of scope
Chat-wide approval flag, per-link name/expiry editing UI beyond a basic create, request notifications/badges beyond the list, public-username join requests (only link-based approval in v1).

## Plans
- **D1 (backend):** migration 0007, InviteRepo.requires_approval, JoinRequestRepo, usecase (CreateInvite+approval, JoinByToken→status, List/Approve/Decline requests), handlers+routes, contracts/openapi, merge + smoke.
- **D2 (frontend):** invite manager methods, invite-link UI + approval toggle + copy host URL, /join/:token deep-link handler, admin join-requests UI; live verify + merge.

## Self-review
- Per-link approval matches the user's choice; host-URL links are honest + work in-app. join_requests dedups via UNIQUE(chat_id,user_id). Reuses existing group permission checks (INVITE_USERS) + UI primitives. ✓
