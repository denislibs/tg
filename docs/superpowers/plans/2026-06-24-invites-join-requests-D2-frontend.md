# Invite Links + Join Requests — Plan D2: Frontend

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-24-invite-links-join-requests-design.md`. Backend D1 merged.

**Goal:** Invite-link UI (admin) with a "require approval" toggle + copyable host URL `${origin}/join/{token}`; a `/join/:token` deep-link that joins or sends a request; an admin "Join requests" section to approve/decline. **Reuse existing tg-ui-clone components** (UserInfoPanel + TgSwitch + settings kit + the members-row markup from C-5 — all mirror tweb). Do not invent markup/animations.

**Backend (D1, ready):** `POST /chats/{id}/invite_links {usage_limit?, requires_approval}` → `{token, url, requires_approval}`; `GET /chats/{id}/invite_links` → `{invite_links:[{token,uses,url,requires_approval}]}`; `POST /join/{token}` → `{status:"requested"|"joined"}`; `GET /chats/{id}/join_requests` → `{requests:[{user_id}]}`; `POST /chats/{id}/join_requests/{userID}/approve|decline`.

**Verified frontend:** `groupsManager` has card/members/promoteAdmin/demoteAdmin (no invite methods yet); `UserInfoPanel` has the members section + rights editor (C-5); `peersManager.getUsers`; `App.tsx` Shell; `RestClient` get/post/del; routing is path-based (no router lib) — handle `location.pathname` on load. Branch `frontend-slice9-invites`.

---

## Task D2-1: groupsManager invite + join-request methods

**Files:** modify `src/core/managers/groupsManager.ts` (+ test), `src/client/bootstrap.ts`.

- [ ] **Step 1: Branch** — `cd telegram-ui-clone && git checkout master && git checkout -b frontend-slice9-invites`.
- [ ] **Step 2: Methods** — add to `newGroupsManager`:
```ts
    async createInvite(chatId: number, opts?: { usageLimit?: number; requiresApproval?: boolean }): Promise<{ token: string; url: string; requiresApproval: boolean }> {
      const r = await rest.post<{ token: string; url: string; requires_approval: boolean }>(`/chats/${chatId}/invite_links`, { usage_limit: opts?.usageLimit ?? null, requires_approval: opts?.requiresApproval ?? false })
      return { token: r.token, url: r.url, requiresApproval: r.requires_approval }
    },
    async listInvites(chatId: number): Promise<{ token: string; uses: number; url: string; requiresApproval: boolean }[]> {
      const r = await rest.get<{ invite_links: { token: string; uses: number; url: string; requires_approval: boolean }[] }>(`/chats/${chatId}/invite_links`)
      return (r.invite_links ?? []).map((l) => ({ token: l.token, uses: l.uses, url: l.url, requiresApproval: l.requires_approval }))
    },
    async joinByToken(token: string): Promise<{ status: 'requested' | 'joined' }> {
      return rest.post<{ status: 'requested' | 'joined' }>(`/join/${token}`, {})
    },
    async listJoinRequests(chatId: number): Promise<number[]> {
      const r = await rest.get<{ requests: { user_id: number }[] }>(`/chats/${chatId}/join_requests`)
      return (r.requests ?? []).map((x) => x.user_id)
    },
    async approveRequest(chatId: number, userId: number): Promise<void> { await rest.post(`/chats/${chatId}/join_requests/${userId}/approve`, {}) },
    async declineRequest(chatId: number, userId: number): Promise<void> { await rest.post(`/chats/${chatId}/join_requests/${userId}/decline`, {}) },
```
(widen the `rest` Pick to include `post`+`get` — already both.)
- [ ] **Step 3: Managers iface** — add the 6 methods to `Managers.groups` in bootstrap.ts (matching signatures).
- [ ] **Step 4: Tests** (groupsManager.test.ts): createInvite POSTs `/chats/{id}/invite_links` with `{usage_limit, requires_approval}` + maps `requires_approval`→`requiresApproval`; joinByToken POSTs `/join/{token}` → returns `{status}`; listJoinRequests maps `{requests:[{user_id}]}`→`number[]`; approve/decline POST the right paths.
- [ ] **Step 5:** `npx vitest run src/core/managers/groupsManager.test.ts && npx tsc -b`; commit `feat(invites): groupsManager invite + join-request methods`.

---

## Task D2-2: invite-link UI + /join deep link

**Files:** modify `src/components/UserInfoPanel.tsx`, `src/App.tsx`.

UI mandate: reuse the panel's existing section/row markup + `TgSwitch` (mirrors tweb editChatInvites). No new style.

- [ ] **Step 1: Invite-link section (admin)** — in UserInfoPanel, for real group/channel chats where the viewer is admin (reuse the C-5 admin gate: card.myRole creator OR myRights & 16 INVITE_USERS — note INVITE_USERS bit = 16), add an "Пригласительные ссылки" section:
  - A "Require approval" `TgSwitch` (state `requireApproval`) + a "Создать ссылку" button → `managers.groups.createInvite(chatId, { requiresApproval })` → prepend to a local links list.
  - List existing links (`managers.groups.listInvites(chatId)` on open): each row shows the full URL `${location.origin}/join/${token}`, a "копировать" action (`navigator.clipboard.writeText(fullUrl)` → brief "Скопировано"), and a badge "по заявке" when `requiresApproval`.
  Reuse the existing panel row markup; the copy button can be a small icon/button matching the panel style.
- [ ] **Step 2: /join deep link** (App.tsx) — on app mount (authed), check `location.pathname` matching `^/join/([\w-]+)$`. If matched: call `managers.groups.joinByToken(token)`; on `{status:'joined'}` → `loadChats(managers)` + select that chat (resolve chat_id: after loadChats, the newly-joined chat appears; simplest — just `loadChats` and show a toast "Вы вступили"); on `{status:'requested'}` → toast "Заявка отправлена, ждите одобрения". Then `window.history.replaceState({}, '', '/')` to clear the path. Use a minimal inline toast/banner (reuse `NotificationBanner` if suitable, or a transient MUI Snackbar-like Box already used elsewhere — check what exists; else a simple fixed Box that auto-hides). Gate so it runs once.
  > Run this only when authed (the existing Shell mounts when authed). If not authed, keep the token (e.g., in sessionStorage) and run after auth — minimal: only handle when already authed; document that unauth deep-link → just lands on login (acceptable v1).
- [ ] **Step 3:** `npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`; commit `feat(invites): invite-link admin UI (copy host URL + approval toggle) + /join deep link`.

---

## Task D2-3: admin join-requests UI + verify + merge

**Files:** modify `src/components/UserInfoPanel.tsx`; memory.

- [ ] **Step 1: Join-requests section (admin)** — in UserInfoPanel for admins, load `managers.groups.listJoinRequests(chatId)` → resolve names via `managers.peers.getUsers(ids)` → render a "Заявки на вступление" section listing pending users with **Approve** (✓) and **Decline** (✕) actions calling `managers.groups.approveRequest/declineRequest(chatId, userId)` → remove the row + (on approve) refresh the members section/card. Show the section only when there are pending requests. Reuse the members-row markup.
- [ ] **Step 2: Rebuild + live verify (playwright)** — rebuild client+nginx. As A (admin): open a group info panel → create an invite link with "require approval" ON → copy shows `${origin}/join/{token}`. As B (another context/tab or via the deep link): open `${origin}/join/{token}` → "Заявка отправлена". Back as A: the info panel "Заявки на вступление" shows B → approve → B becomes a member (members section grows / verify via API). Also verify a non-approval link → opening it joins immediately ("Вы вступили"). 0 console errors. Screenshot.
- [ ] **Step 3: Memory + finish** — note D2 done (invite links UI + deep link + join-requests approval UI). Invite-links + join-requests feature COMPLETE. Merge `frontend-slice9-invites` → master.

---

## Self-review
- Reuses UserInfoPanel/TgSwitch/kit/members-row (mirror tweb) — no invented UI. Host-URL links built client-side from `location.origin` + token. Deep link handles joined vs requested. Admin gate = INVITE_USERS(16)/creator. ✓
