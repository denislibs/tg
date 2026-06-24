# Groups & Channels — Plan B: Frontend groups

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-24-groups-channels-design.md`. Backend A1+A2 merged.

**Goal:** Wire the frontend for **groups** — real create-group (`POST /groups`), group titles in the chat list, group messaging with resolved **sender names** (peersManager + `GET /users`), add members (from existing contacts), and a per-chat **mute** toggle. (Channels UI + search + admin panels = Plan C.)

**Architecture:** Worker-first. New worker managers `GroupsManager` (create/addMember/mute/card) and `PeersManager` (batch `GET /users` + cache). A tiny backend tweak makes `GET /chats` return group/channel `title`. `dialogToChat` uses the title for non-private chats. `ConversationView` resolves group sender names via peers and shows a mute toggle. Group messaging already works over the existing realtime path (groups use per-user fan-out → `new_message`); this plan adds the missing UI + naming.

**Tech Stack:** Go (tiny backend change) + React 18/TS/MUI/Vitest. Backend repo (branch `groups-b-backend`); frontend repo `telegram-ui-clone` (branch `frontend-slice7-groups`).

**Verified facts:**
- `GET /chats` (ListDialogs) returns `chat_id,type,last_read_seq,unread,muted,peer?,last_message?` — **no title**. `domain.Dialog` has no `Title`.
- Frontend `Dialog`/`RawDialog` (models.ts) have no `title`; `dialogToChat` name = `peer?.displayName || "Chat N"`.
- `GET /users?ids=` (A1) → `{users:[{id,username,display_name,avatar_url}]}`.
- `POST /groups`, `POST /chats/{id}/members {user_id}`, `POST /chats/{id}/mute {muted}`, `GET /chats/{id}/card` exist (A1).
- Frontend: `ChatsManager.listDialogs`, `chatsStore` (dialogs/meId), `dialogToChat`, `messageToConvMsg(m, meId)`, `ConversationView` (real chats via `useMessageWindow`; group rendering shows `m.sender` + sticky avatar when set), `NewGroupFlow.tsx` (mock create), `startClient().managers`.

---

## Task B-1: Backend — dialogs return title

**Files (backend repo, branch `groups-b-backend`):** `internal/adapter/repo/postgres/chatsrepo.go`, `internal/domain/chat.go`, `internal/adapter/delivery/http/chat_handler.go`; `chatrepos_test.go` (extend).

- [ ] **Step 1: domain** — add `Title string` and `Username string` to `domain.Dialog`.

- [ ] **Step 2: SQL** — in `ListDialogs`, add `c.title, COALESCE(c.username,'')` to the SELECT (after `c.type`), and scan into `&d.Title, &d.Username` (place the two new scan targets right after `&d.Type`). Adjust the column order consistently.

- [ ] **Step 3: JSON** — in `chat_handler.go` `ListDialogs`, add to `row`: `"title": d.Title, "username": d.Username`.

- [ ] **Step 4: Test** — extend `chatrepos_test.go`'s ListDialogs test (or add one): create a group via `NewGroupRepo(pool).CreateMultiMember(ctx,"group","My Group","","",false,u)` + `AddMember(u, creator)`, then `ListDialogs(u)` → the group dialog has `Title=="My Group"`.

- [ ] **Step 5: Run + commit + merge**

```bash
cd /Users/denisurevic/Documents/messenger-denis && git checkout -b groups-b-backend
# ... edits ...
go -C backend build ./... && go -C backend test ./internal/adapter/repo/postgres/ ./internal/adapter/delivery/http/ -run 'Dialog|ListDialogs'
git add backend/ && git commit -m "feat(chat): dialogs return group/channel title + username

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git checkout master && git merge --no-ff groups-b-backend -m "Merge groups-b-backend: dialogs return title/username"
docker compose -p msgrverify -f docker-compose.verify.yml up -d --build backend && sleep 3 && curl -s -o/dev/null -w "%{http_code}\n" http://localhost:38080/api/health
```

---

## Task B-2: Frontend — title in dialog model + GroupsManager + PeersManager

**Files (frontend, branch `frontend-slice7-groups`):** modify `src/core/models.ts`, `src/core/dialogToChat.ts` (+ test); create `src/core/managers/groupsManager.ts` (+ test), `src/core/managers/peersManager.ts` (+ test); modify `src/core/worker.ts`, `src/client/bootstrap.ts`.

- [ ] **Step 1: Branch** — `cd telegram-ui-clone && git checkout master && git checkout -b frontend-slice7-groups`.

- [ ] **Step 2: models + dialogToChat** — in `models.ts`: add `title?: string; username?: string` to `RawDialog` and `Dialog`; map them in `mapDialog` (`title: r.title, username: r.username`). In `dialogToChat.ts`: name = `d.peer?.displayName?.trim() || d.title?.trim() || \`Chat ${d.chatId}\``. Update `dialogToChat.test.ts`: a group dialog `{type:'group', title:'My Group'}` → `name === 'My Group'`.

- [ ] **Step 3: GroupsManager** — `src/core/managers/groupsManager.ts`:

```ts
import type { RestClient } from '../net/restClient'

export interface GroupCard {
  id: number; type: string; title: string; username: string; about: string
  memberCount: number; isPublic: boolean; myRole: string; myRights: number; muted: boolean
}

export function newGroupsManager({ rest }: { rest: Pick<RestClient, 'post' | 'get'> }) {
  return {
    async createGroup(args: { title: string; about?: string; username?: string; isPublic?: boolean }): Promise<number> {
      const r = await rest.post<{ chat_id: number }>('/groups', {
        title: args.title, about: args.about ?? '', username: args.username ?? '', is_public: args.isPublic ?? false,
      })
      return r.chat_id
    },
    async addMember(chatId: number, userId: number): Promise<void> {
      await rest.post(`/chats/${chatId}/members`, { user_id: userId })
    },
    async setMute(chatId: number, muted: boolean): Promise<void> {
      await rest.post(`/chats/${chatId}/mute`, { muted })
    },
    async card(chatId: number): Promise<GroupCard> {
      const c = await rest.get<{ id: number; type: string; title: string; username: string; about: string; member_count: number; is_public: boolean; my_role: string; my_rights: number; muted: boolean }>(`/chats/${chatId}/card`)
      return { id: c.id, type: c.type, title: c.title, username: c.username, about: c.about, memberCount: c.member_count, isPublic: c.is_public, myRole: c.my_role, myRights: c.my_rights, muted: c.muted }
    },
  }
}
export type GroupsManager = ReturnType<typeof newGroupsManager>
```
Test (`groupsManager.test.ts`): createGroup POSTs `/groups` with snake_case + returns chat_id; setMute POSTs `/chats/{id}/mute`; card maps snake→camel.

- [ ] **Step 4: PeersManager** — `src/core/managers/peersManager.ts`:

```ts
import type { RestClient } from '../net/restClient'

export interface Peer { id: number; username: string; displayName: string; avatarUrl: string }

export function newPeersManager({ rest }: { rest: Pick<RestClient, 'get'> }) {
  const cache = new Map<number, Peer>()
  return {
    async getUsers(ids: number[]): Promise<Peer[]> {
      const missing = ids.filter((id) => !cache.has(id))
      if (missing.length) {
        const r = await rest.get<{ users: { id: number; username: string; display_name: string; avatar_url: string }[] }>('/users', { ids: missing.join(',') })
        for (const u of r.users ?? []) cache.set(u.id, { id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url })
      }
      return ids.map((id) => cache.get(id)).filter((p): p is Peer => !!p)
    },
  }
}
export type PeersManager = ReturnType<typeof newPeersManager>
```
Test (`peersManager.test.ts`): two calls for the same id → ONE `GET /users` (cache); returns mapped peers. (Note `rest.get(path, query)` — confirm RestClient.get accepts a query object; it does, from F5.)

- [ ] **Step 5: Worker + Managers** — `worker.ts`: instantiate `groups`/`peers`, register both. `bootstrap.ts`: add `import type { GroupCard } from '../core/managers/groupsManager'` + `Peer` and the `groups`/`peers` members:
```ts
  groups: {
    createGroup(args: { title: string; about?: string; username?: string; isPublic?: boolean }): Promise<number>
    addMember(chatId: number, userId: number): Promise<void>
    setMute(chatId: number, muted: boolean): Promise<void>
    card(chatId: number): Promise<GroupCard>
  }
  peers: { getUsers(ids: number[]): Promise<Peer[]> }
```

- [ ] **Step 6: Run + commit** — `cd telegram-ui-clone && npx vitest run src/core/managers/groupsManager.test.ts src/core/managers/peersManager.test.ts src/core/dialogToChat.test.ts && npx tsc -b`; commit (identity flags) `feat(worker): GroupsManager + PeersManager + dialog title`.

---

## Task B-3: Create-group flow → real API + mute toggle

**Files:** modify `src/App.tsx`, `src/components/NewGroupFlow.tsx` (read it first), `src/components/ConversationView.tsx`.

- [ ] **Step 1: Read** `NewGroupFlow.tsx` to see its `onCreate(name)` contract and any member-selection step.

- [ ] **Step 2: Real create** — in `App.tsx` `Shell`, replace the local `createGroup` body so it calls the worker and reloads dialogs:
```ts
  const createGroup = async (name: string) => {
    const { managers } = startClient()
    const chatId = await managers.groups.createGroup({ title: name || 'New Group' })
    await loadChats(managers)
    setSelectedId(String(chatId))
  }
```
(Keep the signature the Sidebar/NewGroupFlow expects; make `onCreateGroup` async-friendly — it can be fire-and-forget `void createGroup(name)`.) Remove the local-mock group push (`setLocalChats`) for groups. (Channels create still mock until Plan C — leave `createChannel` as-is.)

- [ ] **Step 3: Mute toggle** — in `ConversationView`, for real chats add a mute toggle to the header `⋮` menu (`HeaderMenu`) or as a header action: call `managers.groups.setMute(numericChatId, !muted)` and update `chatsStore` (the dialog's `muted`) optimistically. Read where `HeaderMenu` items are defined; add a "Mute/Unmute" item for real chats that calls setMute + flips a local state + `useChatsStore` dialog update. Minimal: a button in the header for real chats.

- [ ] **Step 4: Run + commit** — `npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`; commit `feat(groups): real create-group + mute toggle`.

---

## Task B-4: Group sender names (peers) in bubbles

**Files:** create `src/core/hooks/usePeers.ts` (+ test); modify `src/core/messageToConvMsg.ts` (+ test), `src/components/ConversationView.tsx`.

**Context:** For group chats, incoming bubbles need the sender's display name (+ the renderer already shows a sticky avatar/name when `ConvMsg.sender` is set). Resolve `senderId → name` via `managers.peers.getUsers`.

- [ ] **Step 1: messageToConvMsg sender** — extend signature to `messageToConvMsg(m, meId, opts?: { senderName?: string })`; when `!out && opts?.senderName`, set `sender: opts.senderName` (and let the existing renderer pick a color via its `peerColor(name)`), keeping everything else. Update its test: passing `{senderName:'Bob'}` on an incoming message sets `sender==='Bob'`; out messages never get a sender.

- [ ] **Step 2: usePeers hook** — `src/core/hooks/usePeers.ts`:
```ts
import { useEffect, useState } from 'react'
import { startClient } from '../../client/bootstrap'
import type { Peer } from '../managers/peersManager'

// Resolve a set of user ids to a name map, fetching missing ones via the worker.
export function usePeers(ids: number[]): Map<number, Peer> {
  const [map, setMap] = useState<Map<number, Peer>>(new Map())
  const key = ids.slice().sort((a, b) => a - b).join(',')
  useEffect(() => {
    if (ids.length === 0) return
    let alive = true
    const { managers } = startClient()
    managers.peers.getUsers(ids).then((peers) => {
      if (!alive) return
      setMap((prev) => { const next = new Map(prev); for (const p of peers) next.set(p.id, p); return next })
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return map
}
```
Test with `renderHook` + a fake managers (mock `startClient`? — simpler: export a pure `mergePeers` helper and unit-test that; OR test the hook by stubbing the module). Minimal: unit-test the key/merge logic via a small exported helper `peersKey(ids)` and skip deep hook testing (the integration is verified live). Keep a tiny test for `peersKey` sorting/dedup.

- [ ] **Step 3: Wire in ConversationView** — for real group chats (`chat.type === 'group'`), collect `senderId`s from `win.msgs` (incoming only), `const peers = usePeers(ids)`, and when building `convMsgs` pass `{ senderName: peers.get(m.senderId)?.displayName }` to `messageToConvMsg`. (Private chats: no sender names; unchanged.) Ensure the IIFE/group-run rendering already keys off `m.sender` (it does).

- [ ] **Step 4: Run + commit** — `npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`; commit `feat(groups): resolve sender names via peersManager`.

---

## Task B-5: Add members (from contacts) + live verify + memory + finish

**Files:** modify `src/components/ConversationView.tsx` or the chat info panel (`UserInfoPanel`/a group info panel); memory.

- [ ] **Step 1: Add-member (minimal)** — in the group info/header, add an "Add member" action that lists the user's existing private-chat peers (from `chatsStore.dialogs` where `peer` exists) and calls `managers.groups.addMember(chatId, peerId)` + `loadChats`. Keep it minimal (a simple list/menu). This unblocks group membership without search (search-based adding = Plan C).

- [ ] **Step 2: Rebuild + live verify (playwright, 2 users)**
```bash
cd telegram-ui-clone && npx vite build --base=/ --outDir ../client-build --emptyOutDir
cd /Users/denisurevic/Documents/messenger-denis && xattr -cr client-build 2>/dev/null
docker compose -p msgrverify -f docker-compose.verify.yml up -d --build nginx && curl -s -o/dev/null -w "%{http_code}\n" http://localhost:38080/
```
Verify: log in as A (`+79990000001`), ensure A has a private chat with B (`+79990000002`) so B is a known peer; create a group (title shows correctly in the list, NOT "Chat N"); add B from contacts; open the group; A sends a message; (in a 2nd context or via API as B) B sends a message → A sees it live with **B's name** on the bubble; toggle mute → dialog badge greys. 0 console errors. Screenshot.
> Group live delivery uses the existing per-user fan-out + realtime bridge (already working). If B's message doesn't arrive live, confirm B is a member and the WS `new_message` fan-out reaches A (it should — `messaging.Send` fans out to all members).

- [ ] **Step 3: Memory** — note FE-7/Plan B done: groups frontend (real create→POST /groups, dialog titles, GroupsManager+PeersManager, sender names via peers, mute toggle, add-member-from-contacts); backend dialogs now return title/username. Next: Plan C (channels UI + search + admin panels).

- [ ] **Step 4: Finish** — `npx vitest run && npx tsc -b` green; merge `frontend-slice7-groups` → `master`.

---

## Self-Review

- **Title gap fixed:** B-1 backend returns title → groups show their name, not "Chat N". ✓
- **Reuse:** group messaging rides the existing realtime/window path; only sender-name resolution + create/mute/add-member UI are new. ✓
- **Scope:** groups only; channels UI + search + admin rights panels = Plan C (explicitly deferred). Add-member uses existing contacts (search-based = C). ✓
- **Types:** `GroupCard`/`Peer` shared worker↔UI; `Dialog.title` threaded repo→JSON→model→dialogToChat. ✓
- **Placeholders:** complete manager/hook code; ConversationView edits are precise; live verify honest about the 2-user path. ✓
```
