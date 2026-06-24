# Groups & Channels — Plan C: Frontend channels + search + admin UI

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-24-groups-channels-design.md`. Backend A1+A2+BX merged; frontend B merged.

**Goal:** Make channels usable on the frontend — admin post composer, live posts (`subscribe_channel` WS topic) + `getChannelDifference` catch-up, real create-channel, global search + join by `@username`, and an admin/info panel with members + admin-rights toggles.

**UI mandate (from the user):** Do NOT invent markup/animations. **Reuse the existing tg-ui-clone components** (they already mirror Telegram Web K / tweb) wired to real data; for genuinely new UI, **port the structure from the corresponding tweb file** using the existing primitives (`TgSwitch`, `components/settings/kit.tsx`, framer-motion patterns already in the repo). tweb references (from the exploration):
- Channel footer admin-vs-subscriber (control plate): `tweb/src/components/chat/input.ts` + `controlPlate.tsx` — admin → message input; subscriber → centered Mute/Unmute + discuss. (tg-ui-clone already renders the Mute bar for `isChannel`; add the admin composer.)
- Admin rights editor: `tweb/src/components/sidebarRight/tabs/userPermissions.tsx` — a `Row` + checkbox per right (post/edit/delete/ban/invite/pin/change_info/manage_admins). Mirror with `TgSwitch` rows.
- Members/admins list: `tweb/src/components/sidebarRight/tabs/chatMembers.tsx` / `chatAdministrators.tsx` — avatar + title + subtitle rows. Reuse the existing `UserInfoPanel`/`ChatListItem`/settings-kit row style.
- Search sections: `tweb/src/components/appSearchSuper.ts` + `searchGroup.tsx` — section header + result rows. The repo's `SearchView` already mirrors this; wire to real `GET /search`.
- Header subtitle members/online: `tweb/src/components/chat/topbar.ts` — already implemented in BX (groups/channels counts).
- Animations: reuse the repo's existing framer-motion + `motion.ts` (EASE/DUR) patterns (which mirror tweb's SetTransition/SlideTabs); the right-panel slide + ripple already exist in tg-ui-clone (`UserInfoPanel` slide, `ChatListItem` ripple). Do not add new animation systems.

**Tech Stack:** React 18/TS/MUI/Vitest. Frontend repo `telegram-ui-clone`, branch `frontend-slice8-channels`.

**Verified facts:**
- ConversationView: `isChannel = chat.type==='channel'`, `canType = !isChannel` → channels currently show the Mute bar (no composer). Real chats drive `msgs` from `useMessageWindow` (history via `/chats/{id}/history` works for channels). `rt:new_message` (realtimeBridge → uiEvents) is already applied to the open chat.
- `connectionManager` has `sendMessage/markRead/sendTyping` (ws.send frames); `realtime` worker manager exposes them; `Managers.realtime` typed in bootstrap.
- A2 backend: `POST /channels`, `POST /channels/{id}/messages`, `GET /channels/{id}/difference?pts=` → `{updates:[<new_message payload>], pts, slice}`, `POST /channels/join {username}`, `GET /search?q=` → `{chats, users}`. WS frames `subscribe_channel`/`unsubscribe_channel {chat_id}` route channel-topic posts to the conn as `new_message` frames.
- Repo components to reuse: `NewChannelFlow.tsx` (onCreate(name,description)), `SearchView.tsx` (query, chats, onSelect), `UserInfoPanel.tsx` (chat info slide-in panel), `TgSwitch.tsx`, `components/settings/kit.tsx`, `motion.ts`.
- GroupsManager (B) has `card`/`members`; PeersManager has `getUsers`.

---

## Task C-1: WS channel subscribe/unsubscribe

**Files:** modify `src/core/realtime/connectionManager.ts` (+ test), `src/core/worker.ts`, `src/client/bootstrap.ts`.

- [ ] **Step 1: Branch** — `cd telegram-ui-clone && git checkout master && git checkout -b frontend-slice8-channels`.

- [ ] **Step 2: connectionManager** — add to the returned object:
```ts
    subscribeChannel(chatId: number) { if (ws.isOpen()) ws.send('subscribe_channel', { chat_id: chatId }) },
    unsubscribeChannel(chatId: number) { if (ws.isOpen()) ws.send('unsubscribe_channel', { chat_id: chatId }) },
```
Add a test (extend connectionManager.test.ts): after open, `subscribeChannel(5)` → a `subscribe_channel` frame with `{chat_id:5}` was sent.

- [ ] **Step 3: realtime manager** — in `worker.ts`, add to the `realtime` object:
```ts
  async subscribeChannel(args: { chatId: number }) { conn.subscribeChannel(args.chatId); return { ok: true } },
  async unsubscribeChannel(args: { chatId: number }) { conn.unsubscribeChannel(args.chatId); return { ok: true } },
```
- [ ] **Step 4: Managers iface** — in `bootstrap.ts` add to `realtime`:
```ts
    subscribeChannel(args: { chatId: number }): Promise<{ ok: boolean }>
    unsubscribeChannel(args: { chatId: number }): Promise<{ ok: boolean }>
```
- [ ] **Step 5:** `npx vitest run src/core/realtime/connectionManager.test.ts && npx tsc -b`; commit `feat(ws): subscribe_channel/unsubscribe_channel`.

---

## Task C-2: ChannelsManager + search

**Files:** create `src/core/managers/channelsManager.ts` (+ test); modify `src/core/worker.ts`, `src/client/bootstrap.ts`.

**Context:** Per-channel pts persisted in idb (`idbGet/idbSet` keys `chpts:{id}`). `getDifference` fetches missed posts and returns them ascending; the caller applies them via the existing window. `search` → `GET /search`. `createChannel` → `POST /channels`. `join` → `POST /channels/join`.

- [ ] **Step 1: Implement**
```ts
// src/core/managers/channelsManager.ts
import type { RestClient } from '../net/restClient'
import { mapMessage, type Message, type RawMessage } from '../models'
import { idbGet, idbSet } from '../store/idbKv'

export interface SearchResult {
  chats: { id: number; type: string; title: string; username: string; memberCount: number }[]
  users: { id: number; username: string; displayName: string; avatarUrl: string }[]
}

export function newChannelsManager({ rest }: { rest: Pick<RestClient, 'post' | 'get'> }) {
  return {
    async createChannel(args: { title: string; about?: string; username?: string; isPublic?: boolean }): Promise<number> {
      const r = await rest.post<{ chat_id: number }>('/channels', {
        title: args.title, about: args.about ?? '', username: args.username ?? '', is_public: args.isPublic ?? false,
      })
      return r.chat_id
    },
    async post(chatId: number, text: string, clientMsgId: string): Promise<Message> {
      const r = await rest.post<RawMessage>(`/channels/${chatId}/messages`, { text, client_msg_id: clientMsgId })
      return mapMessage(r)
    },
    // Fetch posts newer than the stored pts; returns them ascending + advances stored pts.
    async getDifference(chatId: number): Promise<Message[]> {
      const pts = (await idbGet<number>(`chpts:${chatId}`)) ?? 0
      const r = await rest.get<{ updates: RawMessage[]; pts: number }>(`/channels/${chatId}/difference`, { pts })
      const msgs = (r.updates ?? []).map(mapMessage).sort((a, b) => a.seq - b.seq)
      if (r.pts != null) await idbSet(`chpts:${chatId}`, r.pts)
      return msgs
    },
    async setPts(chatId: number, pts: number): Promise<void> { await idbSet(`chpts:${chatId}`, pts) },
    async join(username: string): Promise<void> { await rest.post('/channels/join', { username }) },
    async search(q: string): Promise<SearchResult> {
      if (!q.trim()) return { chats: [], users: [] }
      const r = await rest.get<{ chats: { id: number; type: string; title: string; username: string; member_count: number }[]; users: { id: number; username: string; display_name: string; avatar_url: string }[] }>('/search', { q })
      return {
        chats: (r.chats ?? []).map((c) => ({ id: c.id, type: c.type, title: c.title, username: c.username, memberCount: c.member_count })),
        users: (r.users ?? []).map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url })),
      }
    },
  }
}
export type ChannelsManager = ReturnType<typeof newChannelsManager>
```
Test (`channelsManager.test.ts`): createChannel POSTs `/channels`; post POSTs `/channels/{id}/messages` + returns mapped Message; getDifference reads stored pts → GET difference → returns ascending + persists new pts (fake idb via vi.mock of idbKv, or inject — simplest: `vi.mock('../store/idbKv', ...)`); search maps snake→camel + empty query short-circuits.

- [ ] **Step 2: Worker + Managers** — register `channels`; add to `Managers`:
```ts
  channels: {
    createChannel(args: { title: string; about?: string; username?: string; isPublic?: boolean }): Promise<number>
    post(chatId: number, text: string, clientMsgId: string): Promise<Message>
    getDifference(chatId: number): Promise<Message[]>
    setPts(chatId: number, pts: number): Promise<void>
    join(username: string): Promise<void>
    search(q: string): Promise<SearchResult>
  }
```
(import `Message`, `SearchResult` types.)

- [ ] **Step 3:** `npx vitest run src/core/managers/channelsManager.test.ts && npx tsc -b`; commit `feat(worker): ChannelsManager (create/post/difference/join/search)`.

---

## Task C-3: ConversationView channel mode (admin composer + live)

**Files:** modify `src/components/ConversationView.tsx`.

**Context:** Mirror tweb's control plate (admin → composer, subscriber → mute bar). The composer input row already exists; for channels it's hidden (`canType=false`). Show the composer for channels when the viewer may post (card.myRights has POST or role creator/admin). Channel send goes through `channels.post` (not the WS group send). On open: `subscribeChannel` + `getDifference` catch-up; on close: `unsubscribeChannel`. Incoming channel posts already arrive via `rt:new_message` (topic → conn → bridge → uiEvents → applyIncoming).

- [ ] **Step 1: Compute post permission** — for real channels, derive `canPostChannel` from the fetched `card` (BX added card fetch): `card?.myRole === 'creator' || (card?.myRights & 1) === 1` (POST_MESSAGES=1). For groups, `canType` stays true (existing). For channels: `const canType = !isChannel || canPostChannel`.
  > Keep the existing `card` state from BX; if BX stored only `{type, memberCount}`, extend it to also keep `myRole`/`myRights` from the card response.

- [ ] **Step 2: Channel send** — in `send()` / `sendReal`, when `isChannel && isRealChat`, post via channels:
```ts
    if (isRealChat && isChannel) {
      setInput(''); setReply(null); window.dispatchEvent(new Event('tg-send'))
      const clientMsgId = `c-${chat.id}-${performance.now()}-${Math.random().toString(36).slice(2)}`
      void managers.channels.post(numericChatId, text, clientMsgId).then((m) => win.appendOptimistic(text, meId ?? -1, clientMsgId)) // optimistic append (sender is admin = me)
      return
    }
```
(Or appendOptimistic immediately then post; channel post returns the created message — reconcile seq if desired. Keep it simple: appendOptimistic on click, post in background.)

- [ ] **Step 3: Subscribe + catch-up on open** — add an effect for real channels:
```ts
  useEffect(() => {
    if (!isRealChat || !isChannel) return
    let alive = true
    void managers.realtime.subscribeChannel({ chatId: numericChatId })
    managers.channels.getDifference(numericChatId).then((missed) => { if (alive) missed.forEach((m) => win.applyIncoming(m)) })
    return () => { alive = false; void managers.realtime.unsubscribeChannel({ chatId: numericChatId }) }
  }, [isRealChat, isChannel, numericChatId, managers, win])
```
> After history loads, persist the channel's current max seq as pts so future diffs start there: when `win.reachedBottom` and msgs present, `void managers.channels.setPts(numericChatId, maxSeq)`. (Approximate; channel pts ≈ seq for our single-stream channels — acceptable. Document the approximation.)

- [ ] **Step 4:** `npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`; commit `feat(channels): admin composer + live posts (subscribe_channel + getChannelDifference)`.

---

## Task C-4: Real create-channel + search + join

**Files:** modify `src/App.tsx` (createChannel), `src/components/Sidebar.tsx` + `src/components/SearchView.tsx` (real search), reuse `NewChannelFlow.tsx`.

- [ ] **Step 1: Real create-channel** — in `App.tsx` `createChannel(name, description)`: call `managers.channels.createChannel({ title: name, about: description })` → `loadChats` → `setSelectedId(String(chatId))`. Remove the local-mock channel push.

- [ ] **Step 2: Real search** — `SearchView` currently filters mock `chats`. Add a real-results mode: when the query is non-empty, call `managers.channels.search(q)` (debounced ~250ms) and render two sections — **Чаты/Каналы** (results.chats) and **Пользователи** (results.users) — reusing the existing search row markup/animation in `SearchView` (which mirrors tweb `searchGroup`). Keep the local dialog filtering for the "open existing chat" case, OR merge: show local dialogs first, then global results sections. Clicking:
  - a result chat that is already a dialog → `onSelect(String(id))` (open).
  - a public channel/group NOT joined → `managers.channels.join(username)` then `loadChats` + open (need a join handler threaded into SearchView, e.g. `onJoin(username)`).
  - a user → open/create a private chat (existing `POST /chats` via ChatsManager if available; else just show — minimal: open if a dialog exists).
  > Thread a `searchReal(q)` + `onJoin` from the Sidebar (which has `managers`/`loadChats`) into `SearchView`. Keep the existing visual structure; only swap the data source + add the join action.

- [ ] **Step 3:** `npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`; commit `feat(channels): real create-channel + global search + join by @username`.

---

## Task C-5: Admin/info panel (members + rights) + verify + merge

**Files:** modify `src/components/UserInfoPanel.tsx` (the chat info slide-in); reuse `TgSwitch`/settings kit; memory.

**Context:** Port tweb's members + userPermissions structure (Row + a toggle per right) using the existing panel + `TgSwitch`. Minimal but functional: for groups/channels where the viewer is creator/admin with MANAGE_ADMINS, show the members list (from `groups.members`) with each member's role; tapping a member opens a rights editor (a list of `TgSwitch` rows, one per right) that calls `POST /chats/{id}/admins {user_id, rights}` (promote) or `DELETE /chats/{id}/admins/{userID}` (demote). Reuse the existing panel slide-in animation (UserInfoPanel already animates like tweb's right sidebar).

- [ ] **Step 1: GroupsManager admin calls** — add to `groupsManager.ts` + Managers: `promoteAdmin(chatId, userId, rights)` → `POST /chats/{id}/admins`; `demoteAdmin(chatId, userId)` → `DELETE /chats/{id}/admins/{userID}`. (Tests: POST/DELETE shapes.)

- [ ] **Step 2: Members + rights UI in UserInfoPanel** — for real group/channel chats, add a "Участники"/"Подписчики" section listing `managers.groups.members(chatId)` rows (avatar + name via peers + role label), reusing the panel's existing row markup. For an admin viewer (myRights has MANAGE_ADMINS=128 or creator), tapping a member opens a rights sub-view: one `TgSwitch` per right (labels: Публикация/Редактирование/Удаление/Бан/Приглашения/Закрепление/Изменение инфо/Назначение админов mapped to bits 1,2,4,8,16,32,64,128), with a Save that calls `promoteAdmin(chatId, userId, bitmask)`; a "Снять права" → `demoteAdmin`. Mirror tweb `userPermissions.tsx` (Row + checkbox per right) — structure from there, primitives from the repo (`TgSwitch`, settings kit). Keep the existing slide/transition.
  > Scope: minimal but working. No ban/restrict UI (BAN beyond demote), no invite-link management UI here (invite links exist in the API; a basic "create invite link" button is optional).

- [ ] **Step 3: Run** `npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`; commit `feat(channels): admin/info panel — members list + admin-rights toggles`.

- [ ] **Step 4: Live verify (playwright)** — rebuild client + nginx. As A: create a channel via NewChannelFlow → shows with title + "N подписчиков"; post as admin (composer visible) → appears; open search, find a public channel/user by @username, join → it opens; open the info panel of a group → members list shows; promote a member with rights → card my_rights reflects (verify via API). Channel live: post to the channel via API as A from another device → appears live in the open channel (subscribe_channel). 0 console errors. Screenshot.

- [ ] **Step 5: Memory + finish** — note Plan C done (channels frontend: composer/live/create + search/join + admin panel). **Groups & channels phase frontend COMPLETE.** Merge `frontend-slice8-channels` → master.

---

## Self-Review

- **UI from tweb, not invented:** each task reuses an existing tg-ui-clone component (mirroring a named tweb file) or ports the named tweb structure (control plate, userPermissions, searchGroup) with existing primitives + existing animations. ✓
- **Channel scale respected:** UI never enumerates subscribers for delivery; live via subscribe_channel topic; catch-up via getChannelDifference; member list is admin-only + paginated. ✓
- **Reuse:** channel history/read/mute/sender-names = existing paths; only composer-permission, channel-send, subscribe/diff, search-data, and the rights UI are new. ✓
- **Scope honesty:** admin UI is minimal (promote/demote + rights toggles), no ban/restrict/invite-link-management UI (deferred). pts≈seq approximation for channel diff documented. ✓
```
