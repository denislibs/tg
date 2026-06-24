# Real Chats + Virtualized Message Window (F5 + F6 + F8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock `src/data.ts` chat source with real backend dialogs (`GET /api/chats`), and render any chat's history through a tweb-faithful windowed loader — `SlicedArray` sparse history, `GET /chats/{id}/history` paging on scroll edges, DOM virtualization, and anchor-based scroll preservation — generic across private/group/channel chats.

**Architecture:** Worker-first (per `docs/superpowers/specs/2026-06-23-frontend-architecture-design.md`). New worker managers `ChatsManager` and `MessagesManager` (the latter owns a per-chat `SlicedArray<number>` of seqs + a `Map<seq,Message>` cache, mirroring tweb's `appMessagesManager`). The UI consumes them over the existing `SuperMessagePort` RPC. A `chatsStore` (zustand) holds dialogs + `meId`. `ConversationView` is refactored to drive its message list from a `useMessageWindow` hook that loads windows on scroll edges, virtualizes the DOM (renders only a visible window + buffer, off-screen rows replaced by measured spacers), and preserves scroll position when prepending older messages via a ported `ScrollSaver`.

**Tech Stack:** React 18 + TypeScript + MUI + Vite + Vitest/happy-dom + zustand. Backend contract: `docs/contracts.md` + `backend/internal/openapi/openapi.yaml` (unchanged by this plan).

**Repo topology (CRITICAL):** Frontend code lives in `telegram-ui-clone/` which is its **own git repo** (gitignored by the backend repo). All code tasks below run inside `telegram-ui-clone/`. This plan file lives in the backend repo's `docs/`. Commit frontend changes with `git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit`.

**Backend history semantics (verified in `backend/internal/adapter/repo/postgres/messagesrepo.go`):**
- `offset_id=0` → newest `limit` messages, **DESC** (newest-first).
- `offset_id=S, add_offset>0` → older **inclusive**: `seq<=S`, **DESC**.
- `offset_id=S, add_offset<=0` → newer: `seq>S`, **ASC**.
- Response: `{ "messages": [<Message>...], "count": N }` where `count` = number returned in this page.

**Direction → request mapping used throughout this plan:**
- Initial / newest: `{ offsetSeq: 0, addOffset: 0, limit }`.
- Older than oldest-loaded seq `S`: `{ offsetSeq: S, addOffset: 1, limit }` then drop messages with `seq >= S` (inclusive overlap).
- Newer than newest-loaded seq `S`: `{ offsetSeq: S, addOffset: 0, limit }` (already strictly `seq>S`, no overlap).
- `reachedTop` when an older fetch returns `< limit` rows; `reachedBottom` when a newer/initial fetch returns `< limit` rows.

**SlicedArray convention (tweb):** seqs stored **descending** (slice[0] = highest/newest). Always sort fetched seqs descending before `insertSlice`. The UI result is returned **ascending** (oldest-first) for top→bottom rendering.

---

## File Structure

**Create (all under `telegram-ui-clone/src/`):**
- `core/models.ts` — frontend `Dialog` / `Message` types + raw-DTO mappers.
- `core/dialogToChat.ts` — `Dialog` → existing render `Chat` (from `data.ts`).
- `core/messageToConvMsg.ts` — backend `Message` → existing render `ConvMsg`.
- `core/history/slicedArray.ts` — port of tweb `SlicedArray` (standalone, numeric).
- `core/history/slicedArray.test.ts`
- `core/managers/chatsManager.ts` + `.test.ts`
- `core/managers/messagesManager.ts` + `.test.ts`
- `core/dom/getVisibleRect.ts` — port of tweb helper.
- `core/dom/getViewportSlice.ts` — port of tweb helper.
- `core/dom/scrollSaver.ts` — focused port of tweb `ScrollSaver` (scrollHeightMinusTop anchoring).
- `core/hooks/useMessageWindow.ts` — windowed history loader hook + `.test.ts`.
- `stores/chatsStore.ts` + `.test.ts`
- `core/models.test.ts`, `core/dialogToChat.test.ts`, `core/messageToConvMsg.test.ts`

**Modify:**
- `client/bootstrap.ts` — extend `Managers` interface with `chats` + `messages`.
- `core/worker.ts` — instantiate + register the two new managers.
- `App.tsx` — `Shell` reads dialogs from `chatsStore` instead of mock `initialChats`; map via `dialogToChat`.
- `components/ConversationView.tsx` — drive `msgs` from `useMessageWindow`; add DOM virtualization window + `ScrollSaver` on prepend; replace mock bot-reply with real REST send; load on scroll edges.

---

## Task 0: Branch setup

- [ ] **Step 1: Create feature branch in the frontend repo**

```bash
cd telegram-ui-clone
git checkout -b frontend-slice3-real-chats
git status   # expect clean, on new branch
```

(No worktree: the frontend repo's `node_modules` is needed for vitest/tsc, so we branch in-place — same as slices 1 & 2.)

---

## Task 1: Frontend domain models + raw DTO mappers

**Files:**
- Create: `telegram-ui-clone/src/core/models.ts`
- Test: `telegram-ui-clone/src/core/models.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/models.test.ts
import { describe, it, expect } from 'vitest'
import { mapDialog, mapMessage, type RawDialog, type RawMessage } from './models'

describe('mapDialog', () => {
  it('maps a private dialog with peer + last_message', () => {
    const raw: RawDialog = {
      chat_id: 1, type: 'private', last_read_seq: 4, unread: 2, muted: false,
      peer: { id: 2, display_name: 'Bob', avatar_url: '' },
      last_message: { seq: 4, text: 'hi', sender_id: 2, at: '2026-06-24T10:00:00Z' },
    }
    const d = mapDialog(raw)
    expect(d).toEqual({
      chatId: 1, type: 'private', lastReadSeq: 4, unread: 2, muted: false,
      peer: { id: 2, displayName: 'Bob', avatarUrl: '' },
      lastMessage: { seq: 4, text: 'hi', senderId: 2, at: '2026-06-24T10:00:00Z' },
    })
  })

  it('handles missing peer / last_message / muted', () => {
    const d = mapDialog({ chat_id: 7, type: 'group', last_read_seq: 0, unread: 0 })
    expect(d.peer).toBeUndefined()
    expect(d.lastMessage).toBeUndefined()
    expect(d.muted).toBe(false)
  })
})

describe('mapMessage', () => {
  it('maps a raw message and computes seq/ids', () => {
    const raw: RawMessage = {
      id: 10, chat_id: 1, seq: 5, sender_id: 1, type: 'text', text: 'hello',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z',
    }
    expect(mapMessage(raw)).toEqual({
      id: 10, chatId: 1, seq: 5, senderId: 1, type: 'text', text: 'hello',
      replyToId: null, mediaId: null, createdAt: '2026-06-24T10:01:00Z',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd telegram-ui-clone && npx vitest run src/core/models.test.ts`
Expected: FAIL — cannot find module `./models`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/models.ts
export type ChatKind = 'private' | 'group' | 'channel'

export interface RawDialog {
  chat_id: number
  type: ChatKind
  last_read_seq: number
  unread: number
  muted?: boolean
  peer?: { id: number; display_name: string; avatar_url: string }
  last_message?: { seq: number; text: string; sender_id: number; at: string }
}

export interface Dialog {
  chatId: number
  type: ChatKind
  lastReadSeq: number
  unread: number
  muted: boolean
  peer?: { id: number; displayName: string; avatarUrl: string }
  lastMessage?: { seq: number; text: string; senderId: number; at: string }
}

export interface RawMessage {
  id: number
  chat_id: number
  seq: number
  sender_id: number
  type: string
  text: string
  reply_to_id: number | null
  media_id: number | null
  created_at: string
}

export interface Message {
  id: number
  chatId: number
  seq: number
  senderId: number
  type: string
  text: string
  replyToId: number | null
  mediaId: number | null
  createdAt: string
}

export function mapDialog(r: RawDialog): Dialog {
  return {
    chatId: r.chat_id,
    type: r.type,
    lastReadSeq: r.last_read_seq,
    unread: r.unread,
    muted: !!r.muted,
    peer: r.peer
      ? { id: r.peer.id, displayName: r.peer.display_name, avatarUrl: r.peer.avatar_url }
      : undefined,
    lastMessage: r.last_message
      ? { seq: r.last_message.seq, text: r.last_message.text, senderId: r.last_message.sender_id, at: r.last_message.at }
      : undefined,
  }
}

export function mapMessage(r: RawMessage): Message {
  return {
    id: r.id,
    chatId: r.chat_id,
    seq: r.seq,
    senderId: r.sender_id,
    type: r.type,
    text: r.text,
    replyToId: r.reply_to_id,
    mediaId: r.media_id,
    createdAt: r.created_at,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd telegram-ui-clone && npx vitest run src/core/models.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone
git add src/core/models.ts src/core/models.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(models): frontend Dialog/Message types + DTO mappers"
```

---

## Task 2: dialogToChat mapper (Dialog → render Chat)

**Files:**
- Create: `telegram-ui-clone/src/core/dialogToChat.ts`
- Test: `telegram-ui-clone/src/core/dialogToChat.test.ts`

**Context:** The existing `Sidebar`/`ChatListItem` render the rich `Chat` type from `src/data.ts` (gradient avatar, `avatarText`, `preview`, `date`, `unread`, `type`, `status`). We adapt real dialogs to that type so the UI stays unchanged. Names come from `peer.displayName` for private chats; groups/channels (no title field in the backend dialog yet) fall back to `Chat N`. Avatar is a deterministic gradient derived from `chatId`. `date` is the raw ISO string of the last message (the existing `useTimeFormatter` renders it).

- [ ] **Step 1: Write the failing test**

```ts
// src/core/dialogToChat.test.ts
import { describe, it, expect } from 'vitest'
import { dialogToChat, GRADIENTS } from './dialogToChat'
import type { Dialog } from './models'

const base: Dialog = { chatId: 1, type: 'private', lastReadSeq: 0, unread: 0, muted: false }

describe('dialogToChat', () => {
  it('uses peer display name + initial for private chats', () => {
    const c = dialogToChat({ ...base, peer: { id: 2, displayName: 'Bob', avatarUrl: '' } })
    expect(c.id).toBe('1')
    expect(c.name).toBe('Bob')
    expect(c.avatarText).toBe('B')
    expect(c.type).toBe('private')
  })

  it('falls back to "Chat N" for groups without a title', () => {
    const c = dialogToChat({ ...base, chatId: 9, type: 'group' })
    expect(c.name).toBe('Chat 9')
    expect(c.avatarText).toBe('C')
  })

  it('passes preview/date/unread from last_message', () => {
    const c = dialogToChat({
      ...base,
      unread: 3,
      lastMessage: { seq: 4, text: 'yo', senderId: 2, at: '2026-06-24T10:00:00Z' },
    })
    expect(c.preview).toBe('yo')
    expect(c.date).toBe('2026-06-24T10:00:00Z')
    expect(c.unread).toBe(3)
  })

  it('omits unread badge when zero', () => {
    expect(dialogToChat(base).unread).toBeUndefined()
  })

  it('picks a stable gradient from the chat id', () => {
    const a = dialogToChat({ ...base, chatId: 5 })
    const b = dialogToChat({ ...base, chatId: 5 })
    expect(a.avatar).toBe(b.avatar)
    expect(GRADIENTS).toContain(a.avatar)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd telegram-ui-clone && npx vitest run src/core/dialogToChat.test.ts`
Expected: FAIL — cannot find module `./dialogToChat`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/dialogToChat.ts
import type { Chat } from '../data'
import type { Dialog } from './models'

export const GRADIENTS = [
  'linear-gradient(135deg,#42e695,#3bb2b8)',
  'linear-gradient(135deg,#f7971e,#ffd200)',
  'linear-gradient(135deg,#6a11cb,#2575fc)',
  'linear-gradient(135deg,#ff5f6d,#ffc371)',
  'linear-gradient(135deg,#5b86e5,#36d1dc)',
  'linear-gradient(135deg,#f857a6,#ff5858)',
  'linear-gradient(135deg,#9a7ff0,#6f8df5)',
  'linear-gradient(135deg,#11998e,#38ef7d)',
]

function gradientFor(id: number): string {
  return GRADIENTS[Math.abs(id) % GRADIENTS.length]
}

export function dialogToChat(d: Dialog): Chat {
  const name = d.peer?.displayName?.trim() || `Chat ${d.chatId}`
  return {
    id: String(d.chatId),
    name,
    avatar: gradientFor(d.chatId),
    avatarText: name.charAt(0).toUpperCase() || '?',
    date: d.lastMessage?.at ?? '',
    preview: d.lastMessage?.text ?? '',
    type: d.type,
    muted: d.muted || undefined,
    unread: d.unread > 0 ? d.unread : undefined,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd telegram-ui-clone && npx vitest run src/core/dialogToChat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone
git add src/core/dialogToChat.ts src/core/dialogToChat.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(chats): dialogToChat render mapper"
```

---

## Task 3: ChatsManager (worker) + registration

**Files:**
- Create: `telegram-ui-clone/src/core/managers/chatsManager.ts`
- Test: `telegram-ui-clone/src/core/managers/chatsManager.test.ts`
- Modify: `telegram-ui-clone/src/core/worker.ts`
- Modify: `telegram-ui-clone/src/client/bootstrap.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/managers/chatsManager.test.ts
import { describe, it, expect } from 'vitest'
import { newChatsManager } from './chatsManager'
import type { RestClient } from '../net/restClient'

function fakeRest(payload: unknown): RestClient {
  return { get: async () => payload } as unknown as RestClient
}

describe('ChatsManager', () => {
  it('listDialogs maps GET /chats payload', async () => {
    const rest = fakeRest({
      chats: [
        { chat_id: 1, type: 'private', last_read_seq: 4, unread: 0, muted: false,
          peer: { id: 2, display_name: 'Bob', avatar_url: '' },
          last_message: { seq: 4, text: 'hi', sender_id: 2, at: '2026-06-24T10:00:00Z' } },
      ],
    })
    const mgr = newChatsManager({ rest })
    const dialogs = await mgr.listDialogs()
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0].peer?.displayName).toBe('Bob')
    expect(dialogs[0].chatId).toBe(1)
  })

  it('listDialogs tolerates an empty/absent chats array', async () => {
    const mgr = newChatsManager({ rest: fakeRest({}) })
    expect(await mgr.listDialogs()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd telegram-ui-clone && npx vitest run src/core/managers/chatsManager.test.ts`
Expected: FAIL — cannot find module `./chatsManager`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/managers/chatsManager.ts
import type { RestClient } from '../net/restClient'
import { mapDialog, type Dialog, type RawDialog } from '../models'

export interface ChatsDeps { rest: RestClient }

export function newChatsManager({ rest }: ChatsDeps) {
  return {
    async listDialogs(): Promise<Dialog[]> {
      const r = await rest.get<{ chats?: RawDialog[] }>('/chats')
      return (r.chats ?? []).map(mapDialog)
    },
  }
}

export type ChatsManager = ReturnType<typeof newChatsManager>
```

- [ ] **Step 4: Register in the worker**

In `src/core/worker.ts`, add the import and instantiation, and add it to the `registerManagers` registry inside `bind`:

```ts
// add near the other manager imports
import { newChatsManager } from './managers/chatsManager'
```

```ts
// after `const auth = newAuthManager({ rest, store: tokens })`
const chats = newChatsManager({ rest })
```

```ts
// inside bind(ep), extend the registry object:
  registerManagers(smp, {
    health: newHealthManager(rest),
    auth: auth as unknown as Record<string, (...a: unknown[]) => unknown>,
    chats: chats as unknown as Record<string, (...a: unknown[]) => unknown>,
  })
```

- [ ] **Step 5: Extend the `Managers` interface (UI side)**

In `src/client/bootstrap.ts`, add the import and the `chats` member:

```ts
// add to imports
import type { Dialog } from '../core/models'
```

```ts
// inside the Managers interface, after `auth: { ... }`
  chats: {
    listDialogs(): Promise<Dialog[]>
  }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd telegram-ui-clone && npx vitest run src/core/managers/chatsManager.test.ts && npx tsc -b`
Expected: tests PASS; `tsc` clean (no errors).

- [ ] **Step 7: Commit**

```bash
cd telegram-ui-clone
git add src/core/managers/chatsManager.ts src/core/managers/chatsManager.test.ts src/core/worker.ts src/client/bootstrap.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(worker): ChatsManager.listDialogs + RPC registration"
```

---

## Task 4: chatsStore (zustand)

**Files:**
- Create: `telegram-ui-clone/src/stores/chatsStore.ts`
- Test: `telegram-ui-clone/src/stores/chatsStore.test.ts`

**Context:** Mirrors `connectionStore.ts` (zustand, plus a free `loadChats` function that talks to the managers). Holds `dialogs`, `meId` (from `auth.me()`), and a `loaded` flag. `loadChats` fetches `me` + dialogs in parallel.

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/chatsStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useChatsStore, loadChats } from './chatsStore'
import type { Dialog } from '../core/models'

const dialogs: Dialog[] = [
  { chatId: 1, type: 'private', lastReadSeq: 0, unread: 0, muted: false,
    peer: { id: 2, displayName: 'Bob', avatarUrl: '' } },
]

function fakeManagers(over: Partial<{ me: unknown; dialogs: Dialog[] }> = {}) {
  return {
    auth: { me: async () => over.me ?? { id: 7, phone: '+1', display_name: 'Me' } },
    chats: { listDialogs: async () => over.dialogs ?? dialogs },
  }
}

describe('chatsStore', () => {
  beforeEach(() => useChatsStore.setState({ dialogs: [], meId: null, loaded: false }))

  it('loadChats populates dialogs + meId', async () => {
    await loadChats(fakeManagers() as never)
    const s = useChatsStore.getState()
    expect(s.meId).toBe(7)
    expect(s.dialogs).toHaveLength(1)
    expect(s.loaded).toBe(true)
  })

  it('upsertDialogs replaces an existing dialog by chatId, prepends new', () => {
    useChatsStore.setState({ dialogs })
    useChatsStore.getState().upsertDialog({
      chatId: 1, type: 'private', lastReadSeq: 5, unread: 1, muted: false,
    })
    expect(useChatsStore.getState().dialogs[0].lastReadSeq).toBe(5)
    expect(useChatsStore.getState().dialogs).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd telegram-ui-clone && npx vitest run src/stores/chatsStore.test.ts`
Expected: FAIL — cannot find module `./chatsStore`.

- [ ] **Step 3: Write the implementation**

```ts
// src/stores/chatsStore.ts
import { create } from 'zustand'
import type { Dialog } from '../core/models'

interface ChatsState {
  dialogs: Dialog[]
  meId: number | null
  loaded: boolean
  setDialogs: (d: Dialog[]) => void
  setMeId: (id: number | null) => void
  upsertDialog: (d: Dialog) => void
}

export const useChatsStore = create<ChatsState>((set) => ({
  dialogs: [],
  meId: null,
  loaded: false,
  setDialogs: (dialogs) => set({ dialogs, loaded: true }),
  setMeId: (meId) => set({ meId }),
  upsertDialog: (d) =>
    set((s) => {
      const idx = s.dialogs.findIndex((x) => x.chatId === d.chatId)
      if (idx === -1) return { dialogs: [d, ...s.dialogs] }
      const next = s.dialogs.slice()
      next[idx] = d
      return { dialogs: next }
    }),
}))

interface LoadDeps {
  auth: { me(): Promise<{ id: number } | null> }
  chats: { listDialogs(): Promise<Dialog[]> }
}

// Fetch the current user + dialogs and populate the store.
export async function loadChats(managers: LoadDeps): Promise<void> {
  const [me, dialogs] = await Promise.all([managers.auth.me(), managers.chats.listDialogs()])
  const st = useChatsStore.getState()
  st.setMeId(me?.id ?? null)
  st.setDialogs(dialogs)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd telegram-ui-clone && npx vitest run src/stores/chatsStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone
git add src/stores/chatsStore.ts src/stores/chatsStore.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(store): chatsStore (dialogs + meId) with loadChats"
```

---

## Task 5: Wire Sidebar to real dialogs (App.tsx)

**Files:**
- Modify: `telegram-ui-clone/src/App.tsx`

**Context:** `Shell` currently seeds `chatList` from mock `initialChats` and mutates it locally in `createGroup`/`createChannel`. Replace the source with `chatsStore` dialogs mapped via `dialogToChat`. Group/channel creation has no backend yet, so those compose flows remain **local-only optimistic** entries (kept for UI continuity) prepended to the rendered list. `loadChats` runs once when `Shell` mounts (the user is authed by then).

- [ ] **Step 1: Update imports**

In `src/App.tsx`, replace the mock import line:

```ts
import { chats as initialChats, type Chat } from './data'
```

with:

```ts
import type { Chat } from './data'
import { useChatsStore, loadChats } from './stores/chatsStore'
import { dialogToChat } from './core/dialogToChat'
```

- [ ] **Step 2: Replace the chat source in `Shell`**

Replace these lines in `Shell`:

```ts
  const [chatList, setChatList] = useState<Chat[]>(initialChats)
  const [selectedId, setSelectedId] = useState<string | null>(null)
```

with (real dialogs + local optimistic group/channel stubs):

```ts
  const dialogs = useChatsStore((s) => s.dialogs)
  const [localChats, setLocalChats] = useState<Chat[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const { managers } = startClient()
    void loadChats(managers)
  }, [])

  const chatList = useMemo<Chat[]>(
    () => [...localChats, ...dialogs.map(dialogToChat)],
    [localChats, dialogs],
  )
```

- [ ] **Step 3: Point the two creators at `setLocalChats`**

In `createGroup`, replace:

```ts
    setChatList((prev) => [prev[0], newGroup, ...prev.slice(1)])
    setSelectedId(id)
```

with:

```ts
    setLocalChats((prev) => [newGroup, ...prev])
    setSelectedId(id)
```

In `createChannel`, replace:

```ts
    setChatList((prev) => [prev[0], newChannel, ...prev.slice(1)])
    setSelectedId(id)
```

with:

```ts
    setLocalChats((prev) => [newChannel, ...prev])
    setSelectedId(id)
```

- [ ] **Step 4: Add the React imports if missing**

Ensure the top-of-file React import includes `useMemo` (it already imports `useEffect, useMemo, useState` — confirm; if not, add `useMemo`).

- [ ] **Step 5: Typecheck + build**

Run: `cd telegram-ui-clone && npx tsc -b && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`
Expected: `tsc` clean; vite build succeeds. (We build to a throwaway dir; the real watch build writes to `../client-build`.)

- [ ] **Step 6: Commit**

```bash
cd telegram-ui-clone
git add src/App.tsx
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(app): render real dialogs from chatsStore in the sidebar"
```

---

## Task 6: Port SlicedArray (tweb)

**Files:**
- Create: `telegram-ui-clone/src/core/history/slicedArray.ts`
- Test: `telegram-ui-clone/src/core/history/slicedArray.test.ts`

**Context:** Faithful port of `/Users/denisurevic/Documents/tweb/src/helpers/slicedArray.ts` (descending sorted storage). Drop the `MOUNT_CLASS_TO` line. Inline its two deps: `compareValue` (numeric: `(a,b)=>a<b?-1:a>b?1:0`) and `indexOfAndSplice`. Keep the class API identical: `insertSlice`, `sliceMe`, `findSlice`, `findSliceOffset`, `unshift`, `push`, `delete`, getters `first`/`last`/`slice`/`length`, and the `SliceEnd` enum.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/history/slicedArray.test.ts
import { describe, it, expect } from 'vitest'
import SlicedArray, { SliceEnd } from './slicedArray'

describe('SlicedArray (descending seqs)', () => {
  it('insertSlice stores descending and reports length', () => {
    const sa = new SlicedArray<number>()
    sa.insertSlice([5, 4, 3]) // newest-first
    expect(Array.from(sa.first)).toEqual([5, 4, 3])
    expect(sa.length).toBe(3)
  })

  it('merges an overlapping older slice into one', () => {
    const sa = new SlicedArray<number>()
    sa.insertSlice([5, 4, 3])
    sa.insertSlice([3, 2, 1]) // overlaps at 3
    expect(Array.from(sa.first)).toEqual([5, 4, 3, 2, 1])
    expect(sa.slices.length).toBe(1)
  })

  it('keeps disjoint ranges as separate slices', () => {
    const sa = new SlicedArray<number>()
    sa.insertSlice([10, 9])
    sa.insertSlice([3, 2])
    expect(sa.slices.length).toBe(2)
  })

  it('sliceMe returns a window from the newest end when offsetId=0 and Bottom is set', () => {
    const sa = new SlicedArray<number>()
    const first = sa.insertSlice([5, 4, 3, 2, 1])!
    first.setEnd(SliceEnd.Bottom)
    const r = sa.sliceMe(0, 0, 2)
    expect(r).toBeDefined()
    expect(Array.from(r!.slice)).toEqual([5, 4])
  })

  it('sliceMe reports Top fulfilled at the top end', () => {
    const sa = new SlicedArray<number>()
    const first = sa.insertSlice([5, 4, 3, 2, 1])!
    first.setEnd(SliceEnd.Both)
    const r = sa.sliceMe(2, 1, 40) // older inclusive of seq 2
    expect(r).toBeDefined()
    expect((r!.fulfilled & SliceEnd.Top) === SliceEnd.Top).toBe(true)
  })

  it('serializes and restores ends via toJSON/fromJSON', () => {
    const sa = new SlicedArray<number>()
    const first = sa.insertSlice([3, 2, 1])!
    first.setEnd(SliceEnd.Both)
    const restored = SlicedArray.fromJSON<number>(sa.toJSON())
    expect(Array.from(restored.first)).toEqual([3, 2, 1])
    expect(restored.first.getEnds().both).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd telegram-ui-clone && npx vitest run src/core/history/slicedArray.test.ts`
Expected: FAIL — cannot find module `./slicedArray`.

- [ ] **Step 3: Port the implementation**

Create `src/core/history/slicedArray.ts` by copying `/Users/denisurevic/Documents/tweb/src/helpers/slicedArray.ts` verbatim, then applying exactly these edits:
1. Delete the three `import` lines at the top.
2. Delete the final line `MOUNT_CLASS_TO && (MOUNT_CLASS_TO.SlicedArray = SlicedArray);`.
3. Add these two inlined helpers at the top of the file (after the `ItemType` type alias):

```ts
function compareValue(a: ItemType, b: ItemType): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function indexOfAndSplice<T>(array: T[], item: T): T | undefined {
  const idx = array.indexOf(item)
  return idx === -1 ? undefined : array.splice(idx, 1)[0]
}
```

4. In the constructor, the line `this.compareValue ??= compareValue;` now refers to the inlined `compareValue` — keep it.

Leave every other line (the `Slice` subclass, `insertSlice`, `flatten`, `sliceMe`, `findSliceOffset`, `findOffsetInSlice`, `unshift`, `push`, `delete`, `deleteSlice`, `toJSON`, `fromJSON`, getters) byte-for-byte identical. Keep `// @ts-ignore` where present.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd telegram-ui-clone && npx vitest run src/core/history/slicedArray.test.ts && npx tsc -b`
Expected: tests PASS; `tsc` clean. (If `tsc` complains about the `Slice` interface/value name shadowing, that is original tweb code and compiles under its config — keep the `// @ts-ignore` and the `implements Slice<T>` as-is.)

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone
git add src/core/history/slicedArray.ts src/core/history/slicedArray.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(history): port tweb SlicedArray (standalone, numeric)"
```

---

## Task 7: MessagesManager (worker) — getHistory + sendMessage

**Files:**
- Create: `telegram-ui-clone/src/core/managers/messagesManager.ts`
- Test: `telegram-ui-clone/src/core/managers/messagesManager.test.ts`
- Modify: `telegram-ui-clone/src/core/worker.ts`
- Modify: `telegram-ui-clone/src/client/bootstrap.ts`

**Context:** Owns a per-chat `SlicedArray<number>` of seqs + a `Map<chatId, Map<seq, Message>>` message cache. `getHistory` first consults the cache via `sliceMe`; on a miss it fetches `GET /chats/{id}/history`, normalizes seqs to **descending**, `insertSlice`s them, sets the appropriate end flag when the page is short, caches the `Message` objects, and returns the window **ascending** (oldest-first). `sendMessage` POSTs to `/chats/{id}/messages`, caches the created message, and returns it.

The `HistoryArgs` direction mapping (see plan header) is the caller's responsibility (the hook); the manager just translates `{offsetSeq, addOffset, limit}` straight through to the REST query (`offset_id`, `add_offset`, `limit`) and to `sliceMe`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/managers/messagesManager.test.ts
import { describe, it, expect } from 'vitest'
import { newMessagesManager } from './messagesManager'
import type { RestClient } from '../net/restClient'
import type { RawMessage } from '../models'

function rawPage(seqs: number[]): { messages: RawMessage[]; count: number } {
  // backend returns newest-first (DESC) for offset_id=0 / older pages
  const messages = seqs.map((seq) => ({
    id: seq, chat_id: 1, seq, sender_id: 1, type: 'text', text: `m${seq}`,
    reply_to_id: null, media_id: null, created_at: '2026-06-24T10:00:00Z',
  }))
  return { messages, count: messages.length }
}

function countingRest(pages: Record<string, { messages: RawMessage[]; count: number }>) {
  let calls = 0
  const rest = {
    get: async (_path: string, q?: Record<string, string | number>) => {
      calls++
      const key = `${q?.offset_id ?? 0}:${q?.add_offset ?? 0}:${q?.limit ?? 0}`
      return pages[key] ?? { messages: [], count: 0 }
    },
    post: async () => ({}),
  } as unknown as RestClient
  return { rest, calls: () => calls }
}

describe('MessagesManager.getHistory', () => {
  it('fetches the newest window and returns ascending messages', async () => {
    const { rest } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    const r = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    expect(r.messages.map((m) => m.seq)).toEqual([3, 4, 5]) // ascending for UI
    expect(r.count).toBe(3)
  })

  it('serves the second identical request from cache (no extra REST call)', async () => {
    const { rest, calls } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    expect(calls()).toBe(1)
  })

  it('reports reachedTop when an older page is short', async () => {
    const { rest } = countingRest({
      '0:0:40': rawPage([5, 4, 3, 2, 1]),
      '1:1:40': rawPage([1]), // older inclusive of 1 → just [1] (< limit)
    })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const older = await mgr.getHistory({ chatId: 1, offsetSeq: 1, addOffset: 1, limit: 40 })
    expect(older.reachedTop).toBe(true)
  })
})

describe('MessagesManager.sendMessage', () => {
  it('POSTs and returns the created message, caching it', async () => {
    const created: RawMessage = {
      id: 10, chat_id: 1, seq: 6, sender_id: 1, type: 'text', text: 'hey',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T11:00:00Z',
    }
    const rest = { post: async () => created, get: async () => ({ messages: [], count: 0 }) } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const m = await mgr.sendMessage({ chatId: 1, text: 'hey', clientMsgId: 'c1' })
    expect(m.seq).toBe(6)
    expect(m.text).toBe('hey')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd telegram-ui-clone && npx vitest run src/core/managers/messagesManager.test.ts`
Expected: FAIL — cannot find module `./messagesManager`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/managers/messagesManager.ts
import type { RestClient } from '../net/restClient'
import { mapMessage, type Message, type RawMessage } from '../models'
import SlicedArray, { SliceEnd } from '../history/slicedArray'

export interface HistoryArgs {
  chatId: number
  offsetSeq?: number // reference seq; 0 = newest
  addOffset?: number // >0 older (inclusive), <=0 newer
  limit?: number
}

export interface HistoryResult {
  messages: Message[] // ascending (oldest-first) for top→bottom rendering
  count: number // rows returned by the last fetch (or cached count)
  reachedTop: boolean
  reachedBottom: boolean
}

export interface SendArgs {
  chatId: number
  text: string
  clientMsgId: string
  replyToId?: number | null
  mediaId?: number | null
}

export interface MessagesDeps { rest: RestClient }

export function newMessagesManager({ rest }: MessagesDeps) {
  const slices = new Map<number, SlicedArray<number>>()
  const cache = new Map<number, Map<number, Message>>()

  const sliceFor = (chatId: number): SlicedArray<number> => {
    let sa = slices.get(chatId)
    if (!sa) { sa = new SlicedArray<number>(); slices.set(chatId, sa) }
    return sa
  }
  const cacheFor = (chatId: number): Map<number, Message> => {
    let c = cache.get(chatId)
    if (!c) { c = new Map(); cache.set(chatId, c) }
    return c
  }
  const put = (chatId: number, msgs: Message[]) => {
    const c = cacheFor(chatId)
    for (const m of msgs) c.set(m.seq, m)
  }

  return {
    async getHistory(args: HistoryArgs): Promise<HistoryResult> {
      const { chatId, offsetSeq = 0, addOffset = 0, limit = 40 } = args
      const sa = sliceFor(chatId)
      const c = cacheFor(chatId)

      // --- cache check (mirrors tweb appMessagesManager.getHistory) ---
      const have = sa.sliceMe(offsetSeq, addOffset, limit)
      const pagingOlder = addOffset > 0
      const pagingNewer = addOffset <= 0 && offsetSeq !== 0
      const cacheHit =
        have &&
        (have.slice.length >= limit ||
          (have.fulfilled & SliceEnd.Both) === SliceEnd.Both ||
          (pagingOlder && (have.fulfilled & SliceEnd.Top) === SliceEnd.Top) ||
          ((pagingNewer || offsetSeq === 0) && (have.fulfilled & SliceEnd.Bottom) === SliceEnd.Bottom))

      if (cacheHit && have) {
        const seqsDesc = Array.from(have.slice) // descending
        const msgs = seqsDesc.map((s) => c.get(s)).filter((m): m is Message => !!m)
        const asc = msgs.slice().reverse()
        return {
          messages: asc,
          count: asc.length,
          reachedTop: (have.fulfilled & SliceEnd.Top) === SliceEnd.Top,
          reachedBottom: (have.fulfilled & SliceEnd.Bottom) === SliceEnd.Bottom,
        }
      }

      // --- network fetch ---
      const r = await rest.get<{ messages: RawMessage[]; count: number }>(
        `/chats/${chatId}/history`,
        { offset_id: offsetSeq, add_offset: addOffset, limit },
      )
      const fetched = (r.messages ?? []).map(mapMessage)
      put(chatId, fetched)

      // normalize to descending seqs for the SlicedArray
      const seqsDesc = fetched.map((m) => m.seq).sort((a, b) => b - a)
      const inserted = seqsDesc.length ? sa.insertSlice(seqsDesc) : sa.first

      // end detection: a short page means we hit the end in the paging direction
      const short = r.count < limit
      let reachedTop = false
      let reachedBottom = false
      if (inserted) {
        if (offsetSeq === 0) {
          inserted.setEnd(SliceEnd.Bottom) // newest page always includes the bottom
          reachedBottom = true
          if (short) { inserted.setEnd(SliceEnd.Top); reachedTop = true }
        } else if (pagingOlder && short) {
          inserted.setEnd(SliceEnd.Top); reachedTop = true
        } else if (pagingNewer && short) {
          inserted.setEnd(SliceEnd.Bottom); reachedBottom = true
        }
      }

      // return ascending; for an older fetch we filter out the inclusive overlap
      // (caller passes offsetSeq=oldestLoaded with addOffset=1)
      let asc = fetched.slice().sort((a, b) => a.seq - b.seq)
      if (pagingOlder) asc = asc.filter((m) => m.seq < offsetSeq)

      return { messages: asc, count: r.count, reachedTop, reachedBottom }
    },

    async sendMessage(args: SendArgs): Promise<Message> {
      const created = await rest.post<RawMessage>(`/chats/${args.chatId}/messages`, {
        type: 'text',
        text: args.text,
        client_msg_id: args.clientMsgId,
        reply_to_id: args.replyToId ?? null,
        media_id: args.mediaId ?? null,
      })
      const m = mapMessage(created)
      put(args.chatId, [m])
      const sa = sliceFor(args.chatId)
      // a sent message is the newest — push to the bottom end if we hold it
      if (sa.first.isEnd(SliceEnd.Bottom) && !sa.findSlice(m.seq)) sa.unshift(m.seq)
      return m
    },
  }
}

export type MessagesManager = ReturnType<typeof newMessagesManager>
```

- [ ] **Step 4: Register in the worker**

In `src/core/worker.ts`:

```ts
// add to imports
import { newMessagesManager } from './managers/messagesManager'
```

```ts
// after `const chats = newChatsManager({ rest })`
const messages = newMessagesManager({ rest })
```

```ts
// extend the registry inside bind(ep):
    messages: messages as unknown as Record<string, (...a: unknown[]) => unknown>,
```

- [ ] **Step 5: Extend the `Managers` interface**

In `src/client/bootstrap.ts`:

```ts
// add to imports
import type { Message } from '../core/models'
import type { HistoryArgs, HistoryResult, SendArgs } from '../core/managers/messagesManager'
```

```ts
// inside the Managers interface, after the chats member
  messages: {
    getHistory(args: HistoryArgs): Promise<HistoryResult>
    sendMessage(args: SendArgs): Promise<Message>
  }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd telegram-ui-clone && npx vitest run src/core/managers/messagesManager.test.ts && npx tsc -b`
Expected: tests PASS; `tsc` clean.

- [ ] **Step 7: Commit**

```bash
cd telegram-ui-clone
git add src/core/managers/messagesManager.ts src/core/managers/messagesManager.test.ts src/core/worker.ts src/client/bootstrap.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(worker): MessagesManager getHistory (SlicedArray cache) + sendMessage"
```

---

## Task 8: messageToConvMsg mapper

**Files:**
- Create: `telegram-ui-clone/src/core/messageToConvMsg.ts`
- Test: `telegram-ui-clone/src/core/messageToConvMsg.test.ts`

**Context:** Convert a backend `Message` into the render `ConvMsg` the bubble renderer already understands. For this slice backend messages are text (media rendering is F9). `out = senderId === meId`. `time` is the raw ISO string (`useTimeFormatter` renders it). Status: outgoing → `'sent'` (read receipts are F7); incoming → none. Sender name for groups is deferred (no users map yet) — leave `sender` undefined so the renderer shows it as a plain incoming bubble.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/messageToConvMsg.test.ts
import { describe, it, expect } from 'vitest'
import { messageToConvMsg } from './messageToConvMsg'
import type { Message } from './models'

const base: Message = {
  id: 1, chatId: 1, seq: 1, senderId: 2, type: 'text', text: 'hi',
  replyToId: null, mediaId: null, createdAt: '2026-06-24T10:00:00Z',
}

describe('messageToConvMsg', () => {
  it('marks messages from me as out with sent status', () => {
    const c = messageToConvMsg({ ...base, senderId: 7 }, 7)
    expect(c.out).toBe(true)
    expect(c.status).toBe('sent')
    expect(c.text).toBe('hi')
    expect(c.time).toBe('2026-06-24T10:00:00Z')
  })

  it('marks messages from others as incoming with no status', () => {
    const c = messageToConvMsg(base, 7)
    expect(c.out).toBe(false)
    expect(c.status).toBeUndefined()
  })

  it('always produces a text-type ConvMsg for now', () => {
    expect(messageToConvMsg(base, 7).type).toBe('text')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd telegram-ui-clone && npx vitest run src/core/messageToConvMsg.test.ts`
Expected: FAIL — cannot find module `./messageToConvMsg`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/messageToConvMsg.ts
import type { ConvMsg } from '../data'
import type { Message } from './models'

// Convert a backend Message into the renderer's ConvMsg shape.
// meId decides out/in; status is sent for outgoing (read receipts arrive in F7).
export function messageToConvMsg(m: Message, meId: number | null): ConvMsg {
  const out = meId != null && m.senderId === meId
  return {
    type: 'text',
    out,
    text: m.text,
    time: m.createdAt,
    status: out ? 'sent' : undefined,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd telegram-ui-clone && npx vitest run src/core/messageToConvMsg.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone
git add src/core/messageToConvMsg.ts src/core/messageToConvMsg.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(chats): messageToConvMsg render mapper"
```

---

## Task 9: Port getVisibleRect + getViewportSlice + ScrollSaver

**Files:**
- Create: `telegram-ui-clone/src/core/dom/getVisibleRect.ts`
- Create: `telegram-ui-clone/src/core/dom/getViewportSlice.ts`
- Create: `telegram-ui-clone/src/core/dom/scrollSaver.ts`
- Test: `telegram-ui-clone/src/core/dom/scrollSaver.test.ts`

**Context:** Standalone DOM helpers for the virtualization + scroll preservation, ported from tweb. `getVisibleRect` drops the `windowSize`/`lookForSticky`/`MOUNT_CLASS_TO` machinery (we never ignore boundaries). `getViewportSlice` is verbatim minus its import (it takes elements directly). `ScrollSaver` is a focused, framework-free version: it wraps a scroll container element and implements the robust `scrollHeightMinusTop` anchoring (tweb's `_save`/`_restore` path) — `save()` records `scrollHeight - scrollTop`; `restore()` sets `scrollTop = newScrollHeight - saved`, which keeps the viewport pinned relative to the bottom when older content is prepended.

- [ ] **Step 1: Write `getVisibleRect.ts`**

```ts
// src/core/dom/getVisibleRect.ts
export interface RectMin { top: number; right: number; bottom: number; left: number }

// Returns the clipped visible rect of `element` within `overflowElement`, or null
// if fully outside. Ported from tweb (simplified: no sticky/ignoreBoundaries).
export default function getVisibleRect(
  element: HTMLElement,
  overflowElement: HTMLElement,
  rect: RectMin = element.getBoundingClientRect(),
  overflowRect: RectMin = overflowElement.getBoundingClientRect(),
): { rect: RectMin } | null {
  const { top: oT, right: oR, bottom: oB, left: oL } = overflowRect
  if (rect.top >= oB || rect.bottom <= oT || rect.right <= oL || rect.left >= oR) {
    return null
  }
  return {
    rect: {
      top: Math.max(rect.top, oT),
      right: Math.min(rect.right, oR),
      bottom: Math.min(rect.bottom, oB),
      left: Math.max(rect.left, oL),
    },
  }
}
```

- [ ] **Step 2: Write `getViewportSlice.ts`**

```ts
// src/core/dom/getViewportSlice.ts
import getVisibleRect, { type RectMin } from './getVisibleRect'

export type ViewportPart = { element: HTMLElement; rect: DOMRect }[]

// Categorizes elements into invisibleTop / visible / invisibleBottom relative to
// overflowElement, with an extraSize buffer and an extraMinLength keep-alive band.
// Ported from tweb src/helpers/dom/getViewportSlice.ts.
export default function getViewportSlice({
  overflowElement,
  elements,
  extraSize = 0,
  extraMinLength = 0,
}: {
  overflowElement: HTMLElement
  elements: HTMLElement[]
  extraSize?: number
  extraMinLength?: number
}): { invisibleTop: ViewportPart; visible: ViewportPart; invisibleBottom: ViewportPart } {
  let overflowRect: RectMin = overflowElement.getBoundingClientRect()
  if (extraSize) {
    overflowRect = {
      top: overflowRect.top - extraSize,
      right: overflowRect.right + extraSize,
      bottom: overflowRect.bottom + extraSize,
      left: overflowRect.left - extraSize,
    }
  }

  const invisibleTop: ViewportPart = []
  const visible: ViewportPart = []
  const invisibleBottom: ViewportPart = []
  let foundVisible = false
  for (const element of elements) {
    const rect = element.getBoundingClientRect()
    const isVisible = !!getVisibleRect(element, overflowElement, rect, overflowRect)
    const arr = isVisible ? (foundVisible = true, visible) : foundVisible ? invisibleBottom : invisibleTop
    arr.push({ element, rect })
  }

  if (extraMinLength) {
    visible.unshift(...invisibleTop.splice(Math.max(0, invisibleTop.length - extraMinLength), extraMinLength))
    visible.push(...invisibleBottom.splice(0, extraMinLength))
  }

  return { invisibleTop, visible, invisibleBottom }
}
```

- [ ] **Step 3: Write `scrollSaver.ts`**

```ts
// src/core/dom/scrollSaver.ts
// Focused port of tweb's ScrollSaver (_save/_restore, scrollHeightMinusTop path).
// reverse=true anchors to the bottom: prepending older content above the viewport
// keeps the currently-visible messages in place.
export default class ScrollSaver {
  private scrollHeightMinusTop = 0

  constructor(private container: HTMLElement, private reverse = true) {}

  save(): void {
    const { scrollTop, scrollHeight } = this.container
    this.scrollHeightMinusTop = this.reverse ? scrollHeight - scrollTop : scrollTop
  }

  restore(): void {
    const { scrollHeight } = this.container
    const newTop = this.reverse ? scrollHeight - this.scrollHeightMinusTop : this.scrollHeightMinusTop
    this.container.scrollTop = newTop
  }
}
```

- [ ] **Step 4: Write the failing test (jsdom/happy-dom with stubbed metrics)**

```ts
// src/core/dom/scrollSaver.test.ts
import { describe, it, expect } from 'vitest'
import ScrollSaver from './scrollSaver'

function makeContainer(scrollHeight: number, scrollTop: number): HTMLElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => (el as any)._sh })
  ;(el as any)._sh = scrollHeight
  el.scrollTop = scrollTop
  return el
}

describe('ScrollSaver (reverse / bottom-anchored)', () => {
  it('keeps the viewport pinned to the bottom when content is prepended', () => {
    const el = makeContainer(1000, 200) // 800px below the fold
    const saver = new ScrollSaver(el, true)
    saver.save() // scrollHeightMinusTop = 1000 - 200 = 800
    ;(el as any)._sh = 1500 // prepended 500px of older content above
    saver.restore()
    expect(el.scrollTop).toBe(700) // 1500 - 800, same distance from bottom
  })

  it('non-reverse mode preserves absolute scrollTop', () => {
    const el = makeContainer(1000, 200)
    const saver = new ScrollSaver(el, false)
    saver.save()
    ;(el as any)._sh = 1500
    saver.restore()
    expect(el.scrollTop).toBe(200)
  })
})
```

- [ ] **Step 5: Run tests**

Run: `cd telegram-ui-clone && npx vitest run src/core/dom/scrollSaver.test.ts && npx tsc -b`
Expected: tests PASS; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
cd telegram-ui-clone
git add src/core/dom/getVisibleRect.ts src/core/dom/getViewportSlice.ts src/core/dom/scrollSaver.ts src/core/dom/scrollSaver.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(dom): port getVisibleRect, getViewportSlice, ScrollSaver"
```

---

## Task 10: useMessageWindow hook

**Files:**
- Create: `telegram-ui-clone/src/core/hooks/useMessageWindow.ts`
- Test: `telegram-ui-clone/src/core/hooks/useMessageWindow.test.ts`

**Context:** The data brain of the chat view. On mount (and when `chatId` changes) it loads the newest window. `loadOlder()` pages older (offsetSeq=oldest.seq, addOffset=1) and **prepends**; `loadNewer()` pages newer (offsetSeq=newest.seq, addOffset=0) and **appends**. It tracks `reachedTop`/`reachedBottom` and per-direction loading flags, and de-duplicates by seq. `appendLocal(msg)` lets the view optimistically add a just-sent message. The hook is framework-testable with `renderHook` from a thin manager fake.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/hooks/useMessageWindow.test.ts
import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMessageWindow } from './useMessageWindow'
import type { Message } from '../models'
import type { HistoryArgs, HistoryResult } from '../managers/messagesManager'

function msg(seq: number): Message {
  return { id: seq, chatId: 1, seq, senderId: 1, type: 'text', text: `m${seq}`,
    replyToId: null, mediaId: null, createdAt: '2026-06-24T10:00:00Z' }
}

function fakeManagers(handler: (a: HistoryArgs) => HistoryResult) {
  return { messages: { getHistory: async (a: HistoryArgs) => handler(a), sendMessage: async () => msg(99) } }
}

describe('useMessageWindow', () => {
  it('loads the newest window on mount (ascending)', async () => {
    const managers = fakeManagers(() => ({
      messages: [msg(3), msg(4), msg(5)], count: 3, reachedBottom: true, reachedTop: false,
    }))
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.msgs.length).toBe(3))
    expect(result.current.msgs.map((m) => m.seq)).toEqual([3, 4, 5])
    expect(result.current.reachedBottom).toBe(true)
  })

  it('loadOlder prepends and dedups', async () => {
    let call = 0
    const managers = fakeManagers((a) => {
      call++
      if (a.offsetSeq === 0) return { messages: [msg(3), msg(4), msg(5)], count: 3, reachedBottom: true, reachedTop: false }
      return { messages: [msg(1), msg(2)], count: 2, reachedBottom: false, reachedTop: true }
    })
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.msgs.length).toBe(3))
    await act(async () => { await result.current.loadOlder() })
    expect(result.current.msgs.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5])
    expect(result.current.reachedTop).toBe(true)
    expect(call).toBe(2)
  })

  it('does not load older once reachedTop', async () => {
    let call = 0
    const managers = fakeManagers((a) => {
      call++
      if (a.offsetSeq === 0) return { messages: [msg(1), msg(2)], count: 2, reachedBottom: true, reachedTop: true }
      return { messages: [], count: 0, reachedBottom: false, reachedTop: true }
    })
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.reachedTop).toBe(true))
    await act(async () => { await result.current.loadOlder() })
    expect(call).toBe(1)
  })
})
```

- [ ] **Step 2: Install the testing library (devDependency)**

Run: `cd telegram-ui-clone && npm i -D @testing-library/react @testing-library/dom`
Expected: installs cleanly (React 18 peer satisfied).

- [ ] **Step 3: Run test to verify it fails**

Run: `cd telegram-ui-clone && npx vitest run src/core/hooks/useMessageWindow.test.ts`
Expected: FAIL — cannot find module `./useMessageWindow`.

- [ ] **Step 4: Write the implementation**

```ts
// src/core/hooks/useMessageWindow.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Message } from '../models'
import type { HistoryResult } from '../managers/messagesManager'

interface ManagersLike {
  messages: {
    getHistory(args: { chatId: number; offsetSeq?: number; addOffset?: number; limit?: number }): Promise<HistoryResult>
  }
}

export interface MessageWindow {
  msgs: Message[]
  reachedTop: boolean
  reachedBottom: boolean
  loadingOlder: boolean
  loadingNewer: boolean
  loading: boolean
  loadOlder: () => Promise<void>
  loadNewer: () => Promise<void>
  appendLocal: (m: Message) => void
}

function dedupAsc(list: Message[]): Message[] {
  const bySeq = new Map<number, Message>()
  for (const m of list) bySeq.set(m.seq, m)
  return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq)
}

export function useMessageWindow(chatId: number, managers: ManagersLike, limit = 40): MessageWindow {
  const [msgs, setMsgs] = useState<Message[]>([])
  const [reachedTop, setReachedTop] = useState(false)
  const [reachedBottom, setReachedBottom] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [loading, setLoading] = useState(true)
  // guards against overlapping loads / stale chat responses
  const reqChat = useRef(chatId)

  useEffect(() => {
    reqChat.current = chatId
    setMsgs([]); setReachedTop(false); setReachedBottom(false); setLoading(true)
    let cancelled = false
    ;(async () => {
      const r = await managers.messages.getHistory({ chatId, offsetSeq: 0, addOffset: 0, limit })
      if (cancelled || reqChat.current !== chatId) return
      setMsgs(dedupAsc(r.messages))
      setReachedTop(r.reachedTop)
      setReachedBottom(r.reachedBottom)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [chatId, managers, limit])

  const loadOlder = useCallback(async () => {
    if (reachedTop || loadingOlder || loading) return
    const oldest = msgs[0]
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const r = await managers.messages.getHistory({ chatId, offsetSeq: oldest.seq, addOffset: 1, limit })
      if (reqChat.current !== chatId) return
      setMsgs((prev) => dedupAsc([...r.messages, ...prev]))
      setReachedTop(r.reachedTop)
    } finally {
      setLoadingOlder(false)
    }
  }, [chatId, managers, limit, msgs, reachedTop, loadingOlder, loading])

  const loadNewer = useCallback(async () => {
    if (reachedBottom || loadingNewer || loading) return
    const newest = msgs[msgs.length - 1]
    if (!newest) return
    setLoadingNewer(true)
    try {
      const r = await managers.messages.getHistory({ chatId, offsetSeq: newest.seq, addOffset: 0, limit })
      if (reqChat.current !== chatId) return
      setMsgs((prev) => dedupAsc([...prev, ...r.messages]))
      setReachedBottom(r.reachedBottom)
    } finally {
      setLoadingNewer(false)
    }
  }, [chatId, managers, limit, msgs, reachedBottom, loadingNewer, loading])

  const appendLocal = useCallback((m: Message) => {
    setMsgs((prev) => dedupAsc([...prev, m]))
  }, [])

  return { msgs, reachedTop, reachedBottom, loadingOlder, loadingNewer, loading, loadOlder, loadNewer, appendLocal }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd telegram-ui-clone && npx vitest run src/core/hooks/useMessageWindow.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd telegram-ui-clone
git add src/core/hooks/useMessageWindow.ts src/core/hooks/useMessageWindow.test.ts package.json package-lock.json
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(hooks): useMessageWindow windowed history loader"
```

---

## Task 11: Wire ConversationView to the real windowed loader + virtualization

**Files:**
- Modify: `telegram-ui-clone/src/components/ConversationView.tsx`

**Context:** This is the integration task. `ConversationView` currently seeds `msgs` from `chat.messages` and uses a mock send + bot auto-reply. We:
1. Resolve the numeric `chatId` from `chat.id` (real dialogs have numeric string ids; local stub group/channel ids like `group-123` are non-numeric → fall back to the old mock behavior so those still render).
2. For real chats, drive `msgs` from `useMessageWindow` + `messageToConvMsg`.
3. Replace the mock bot-reply send with a real REST `sendMessage` (optimistic append via `appendLocal`).
4. On scroll near the top edge, call `loadOlder()` wrapped in a `ScrollSaver` so prepending older messages doesn't jump the viewport; near the bottom edge (when not `reachedBottom`), call `loadNewer()`.
5. Add DOM virtualization: render only a window of `convMsgs` (computed from `getViewportSlice` after each scroll/resize, debounced) with measured top/bottom spacer heights so off-window rows stay out of the DOM but the scroll size is preserved.

To keep the large bubble-rendering JSX intact, we introduce minimal changes around the existing `msgs` source and the scroll container.

- [ ] **Step 1: Add imports**

At the top of `ConversationView.tsx`, after the existing imports, add:

```ts
import { startClient } from '../client/bootstrap'
import { useMessageWindow } from '../core/hooks/useMessageWindow'
import { messageToConvMsg } from '../core/messageToConvMsg'
import { useChatsStore } from '../stores/chatsStore'
import ScrollSaver from '../core/dom/scrollSaver'
```

- [ ] **Step 2: Resolve chatId + real vs mock source**

Replace the existing line:

```ts
  const [msgs, setMsgs] = useState<ConvMsg[]>(chat.messages ?? [])
```

with:

```ts
  const numericChatId = Number(chat.id)
  const isRealChat = Number.isFinite(numericChatId) && String(numericChatId) === chat.id
  const meId = useChatsStore((s) => s.meId)
  const { managers } = startClient()
  const win = useMessageWindow(isRealChat ? numericChatId : -1, managers, 40)

  // Mock chats (local group/channel stubs) keep the old in-memory message list;
  // real chats render the windowed history mapped to ConvMsg.
  const [mockMsgs, setMockMsgs] = useState<ConvMsg[]>(chat.messages ?? [])
  const msgs: ConvMsg[] = isRealChat ? win.msgs.map((m) => messageToConvMsg(m, meId)) : mockMsgs
  const setMsgs = setMockMsgs
```

> Note: the existing code uses `setMsgs` in the recorder/sticker/gif/mock paths. Those paths only run for mock chats (the composer mutates `mockMsgs`). For real chats, sending goes through `sendReal` (Step 4) and `setMsgs` is a harmless no-op writer to `mockMsgs` that isn't rendered. Leave the recorder/sticker/gif handlers untouched.

- [ ] **Step 3: Reset the mock list only on mock-chat switch**

The existing `useEffect(() => { setMsgs(chat.messages ?? []) ... }, [chat, canType])` resets local state on chat change. Change its first line to guard real chats:

Replace:

```ts
  useEffect(() => {
    setMsgs(chat.messages ?? [])
    setInput('')
```

with:

```ts
  useEffect(() => {
    setMockMsgs(chat.messages ?? [])
    setInput('')
```

(Everything else in that effect stays.)

- [ ] **Step 4: Real send path**

In the `send` function, at the very top replace:

```ts
  const send = () => {
    const text = input.trim()
    if (!text || !canType) return
```

with:

```ts
  const sendReal = async (text: string) => {
    const clientMsgId = `c-${chat.id}-${performance.now()}-${Math.random().toString(36).slice(2)}`
    const created = await managers.messages.sendMessage({ chatId: numericChatId, text, clientMsgId })
    win.appendLocal(created)
  }

  const send = () => {
    const text = input.trim()
    if (!text || !canType) return
    if (isRealChat) {
      setInput('')
      setReply(null)
      window.dispatchEvent(new Event('tg-send'))
      void sendReal(text)
      return
    }
```

(The rest of the existing mock `send` body — the optimistic push + `setTyping` + bot reply — stays and now only runs for mock chats.)

- [ ] **Step 5: Edge-triggered history loading on scroll**

Find the existing scroll effect that toggles `showScrollDown`:

```ts
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollDown(dist > 240)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [msgs])
```

Replace its `onScroll` body to also trigger windowed loads for real chats (anchor older loads with `ScrollSaver`):

```ts
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollDown(dist > 240)
      if (!isRealChat) return
      if (el.scrollTop < 200 && !win.reachedTop && !win.loadingOlder) {
        const saver = new ScrollSaver(el, true)
        saver.save()
        void win.loadOlder().then(() => requestAnimationFrame(() => saver.restore()))
      }
      if (dist < 200 && !win.reachedBottom && !win.loadingNewer) {
        void win.loadNewer()
      }
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [msgs, isRealChat, win])
```

- [ ] **Step 6: Keep auto-scroll-to-bottom only when already near the bottom**

The existing effect force-scrolls to the bottom on every `msgs`/`typing` change. That fights `loadOlder` (which prepends). Guard it so it only pins to the bottom when the user is already near the bottom OR it's the initial load:

Replace:

```ts
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // scroll after layout — content height isn't final synchronously on open
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
      r2 = requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
      })
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [msgs, typing])
```

with:

```ts
  const didInitialScroll = useRef(false)
  useEffect(() => { didInitialScroll.current = false }, [chat])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = dist < 240
    // Only pin to the bottom on first paint of a chat or when already near it,
    // so prepending older history (loadOlder) doesn't yank the viewport down.
    if (!didInitialScroll.current || nearBottom) {
      let r2 = 0
      const r1 = requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
        r2 = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
      })
      didInitialScroll.current = true
      return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2) }
    }
  }, [msgs, typing, chat])
```

- [ ] **Step 7: Typecheck + build + full test run**

Run: `cd telegram-ui-clone && npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`
Expected: `tsc` clean; all vitest suites green; vite build succeeds.

> **DOM virtualization note:** Steps 5–6 give true windowed *loading* + scroll preservation (the core of the user's request). Heavy off-screen-node removal (`getViewportSlice` deletion of DOM rows, debounced ~3s) is wired in Task 12 as a separate, isolated change so the loader can be verified first.

- [ ] **Step 8: Commit**

```bash
cd telegram-ui-clone
git add src/components/ConversationView.tsx
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(chat): drive ConversationView from windowed history loader + real send"
```

---

## Task 12: DOM virtualization (getViewportSlice-based node culling)

**Files:**
- Modify: `telegram-ui-clone/src/components/ConversationView.tsx`

**Context:** Add tweb-style DOM culling on top of the working loader: keep all messages in memory (`msgs`) but only render rows within the visible window + a buffer (`extraSize = max(700, height) * 2`, `extraMinLength = 5`), replacing the culled top/bottom runs with measured spacer `<Box>`es so `scrollHeight` is preserved. Recompute on scroll/resize, debounced ~300ms (tweb uses ~3s; we use 300ms for snappier feel — still well past the load-trigger work). Only active for real chats; mock chats render in full.

- [ ] **Step 1: Add the render-window state + effect**

After the `win` / `msgs` setup (Task 11 Step 2), add a render-window computed over the rendered rows. Because rows are produced inside an IIFE in the JSX, we virtualize at the **row container** level using a measured index window. Introduce:

```ts
  // DOM virtualization: [start,end) index range of `msgs` to actually render.
  const feedRef = scrollRef // the scroll viewport
  const [winRange, setWinRange] = useState<{ start: number; end: number }>({ start: 0, end: Number.MAX_SAFE_INTEGER })
  const rowEls = useRef<Map<number, HTMLElement>>(new Map())
  const [spacers, setSpacers] = useState<{ top: number; bottom: number }>({ top: 0, bottom: 0 })

  useEffect(() => {
    if (!isRealChat) { setWinRange({ start: 0, end: Number.MAX_SAFE_INTEGER }); setSpacers({ top: 0, bottom: 0 }); return }
    const el = feedRef.current
    if (!el) return
    let t = 0
    const recompute = () => {
      const els: HTMLElement[] = []
      const idxOf = new Map<HTMLElement, number>()
      rowEls.current.forEach((node, idx) => { els.push(node); idxOf.set(node, idx) })
      els.sort((a, b) => (idxOf.get(a)! - idxOf.get(b)!))
      if (!els.length) return
      const extraSize = Math.max(700, el.clientHeight) * 2
      // inline getViewportSlice to avoid coupling: categorize by buffered rect
      const orr = el.getBoundingClientRect()
      const top = orr.top - extraSize, bottom = orr.bottom + extraSize
      let firstVisible = -1, lastVisible = -1
      els.forEach((node) => {
        const r = node.getBoundingClientRect()
        const idx = idxOf.get(node)!
        const visible = !(r.top >= bottom || r.bottom <= top)
        if (visible) { if (firstVisible === -1) firstVisible = idx; lastVisible = idx }
      })
      if (firstVisible === -1) return
      const start = Math.max(0, firstVisible - 5)
      const end = Math.min(msgs.length, lastVisible + 1 + 5)
      // measure spacer heights from the culled runs
      let topH = 0, botH = 0
      els.forEach((node) => {
        const idx = idxOf.get(node)!
        if (idx < start) topH += node.getBoundingClientRect().height
        else if (idx >= end) botH += node.getBoundingClientRect().height
      })
      setWinRange({ start, end })
      setSpacers({ top: topH, bottom: botH })
    }
    const onScroll = () => { clearTimeout(t); t = window.setTimeout(recompute, 300) }
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    recompute()
    return () => { clearTimeout(t); el.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, [isRealChat, msgs.length])
```

> Implementation detail for the reviewer: `getViewportSlice`/`getVisibleRect` from Task 9 are the canonical helpers; this effect inlines the same categorization against the per-row element map (`rowEls`) because the rows are generated in an IIFE. Either form is acceptable as long as the buffer math (`extraSize`, `extraMinLength=5`) matches. If the implementer prefers, they may refactor the row loop to collect elements and call `getViewportSlice` directly.

- [ ] **Step 2: Apply the window + spacers in the render loop**

In the message-render IIFE, wrap so that for real chats only indices in `[winRange.start, winRange.end)` produce bubbles, every rendered row registers its DOM node into `rowEls`, and top/bottom spacer boxes carry the culled heights. Concretely:

1. Before `msgs.forEach((m, i) => {`, add a top spacer push:

```ts
              if (isRealChat && spacers.top > 0) {
                nodes.push(<Box key="spacer-top" sx={{ height: spacers.top, flexShrink: 0 }} />)
              }
```

2. At the very start of the `forEach` callback body, skip culled rows for real chats:

```ts
              if (isRealChat && (i < winRange.start || i >= winRange.end)) return
```

3. Wrap the produced `row` so its DOM node is captured. Change the `row` `<Box key={i} ...>` to add a ref callback:

```ts
                  ref={(node: HTMLElement | null) => {
                    if (node) rowEls.current.set(i, node)
                    else rowEls.current.delete(i)
                  }}
```

(Add this prop to the outer `<Box>` of `row`. MUI `Box` forwards `ref`.)

4. After the `flushGroup()` that closes the IIFE (before `return nodes`), push the bottom spacer:

```ts
              if (isRealChat && spacers.bottom > 0) {
                nodes.push(<Box key="spacer-bottom" sx={{ height: spacers.bottom, flexShrink: 0 }} />)
              }
```

> If the grouped-avatar wrapper (`isGroup` runs) makes per-row refs awkward, capture refs on the group wrapper instead and treat the group as the cull unit — culling whole sender-runs is acceptable and matches tweb's bubble granularity.

- [ ] **Step 3: Clear the row map on chat switch**

In the chat-reset effect (Task 11 Step 3), add `rowEls.current.clear()` and reset the window:

```ts
    rowEls.current.clear()
    setWinRange({ start: 0, end: Number.MAX_SAFE_INTEGER })
    setSpacers({ top: 0, bottom: 0 })
```

- [ ] **Step 4: Typecheck + build + tests**

Run: `cd telegram-ui-clone && npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`
Expected: `tsc` clean; all suites green; build succeeds.

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone
git add src/components/ConversationView.tsx
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(chat): DOM virtualization (cull off-window rows with measured spacers)"
```

---

## Task 13: Live verification (seeded backend) + memory + finish

**Files:**
- Modify: `/Users/denisurevic/.claude/projects/-Users-denisurevic-Documents-messenger-denis/memory/messenger-project.md` (+ MEMORY.md if a new pointer is warranted)

**Context:** Stand up the docker stack, seed two users + a private chat with enough messages to exercise paging, run the watch build, and verify in a real browser via playwright that (a) the sidebar shows the real dialog, (b) opening it loads the newest window, (c) scrolling up pages older messages without the viewport jumping, (d) sending appends a real message. Then record progress in memory and finish the branch.

- [ ] **Step 1: Bring up the stack + watch build**

```bash
cd /Users/denisurevic/Documents/messenger-denis
docker compose up -d --build         # backend + pg + redis + minio + nginx
cd telegram-ui-clone && (npm run build:watch &)   # writes ../client-build
```

Wait for `client-build/index.html` to exist and the backend `/api/health` to return `{"status":"ok"}` (via nginx).

- [ ] **Step 2: Seed two users + a chat + ~120 messages**

Use the dev OTP `12345`. Run this seeding script (adjust the nginx host/port to the compose mapping; the API is under `/api`):

```bash
cd /Users/denisurevic/Documents/messenger-denis
BASE="http://localhost:<NGINX_PORT>/api"
# helper: sign in a phone, echo its token
signin () {
  curl -s "$BASE/auth/request_code" -H 'Content-Type: application/json' -d "{\"phone\":\"$1\"}" >/dev/null
  curl -s "$BASE/auth/sign_in" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$1\",\"code\":\"12345\",\"device\":\"seed\",\"platform\":\"web\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])'
}
TOKA=$(signin "+10000000001")
TOKB=$(signin "+10000000002")
# user B id (so A can open a chat with B)
BID=$(curl -s "$BASE/me" -H "Authorization: Bearer $TOKB" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
# A creates a private chat with B
CID=$(curl -s "$BASE/chats" -H "Authorization: Bearer $TOKA" -H 'Content-Type: application/json' -d "{\"user_id\":$BID}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["chat_id"])')
# send 120 alternating messages
for i in $(seq 1 120); do
  if [ $((i % 2)) -eq 0 ]; then TOK=$TOKA; else TOK=$TOKB; fi
  curl -s "$BASE/chats/$CID/messages" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
    -d "{\"type\":\"text\",\"text\":\"seed message $i\",\"client_msg_id\":\"seed-$i\"}" >/dev/null
done
echo "seeded chat $CID with 120 messages; login as +10000000001 / 12345"
```

> If `POST /chats` expects a different body key than `user_id`, check `docs/contracts.md` §`POST /chats` and adjust. (Contract: create-or-return a private chat with another user.)

- [ ] **Step 2b: Verify the seeding via the History API directly**

```bash
curl -s "$BASE/chats/$CID/history?offset_id=0&add_offset=0&limit=40" -H "Authorization: Bearer $TOKA" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("count",d["count"],"first",d["messages"][0]["seq"],"last",d["messages"][-1]["seq"])'
```

Expected: `count 40`, newest-first (first seq ≈ 120, last ≈ 81).

- [ ] **Step 3: Browser verification (playwright MCP)**

Navigate to the nginx URL, log in as `+10000000001` / `12345`, then:
1. Confirm the dialog with `+10000000002` (display name fallback) appears in the sidebar with preview "seed message 120".
2. Open it — confirm the newest messages render and the view is pinned to the bottom; check the browser console has 0 errors.
3. Scroll to the top of the feed repeatedly — confirm older messages load in pages and the **viewport does not jump** (ScrollSaver) until you reach "seed message 1" (top).
4. Type a message and send — confirm it appears at the bottom immediately, and (after reload) persists (it was POSTed).
5. Take a screenshot for the record.

Record any console error or scroll jump as a bug and fix before finishing.

- [ ] **Step 4: Update project memory**

Edit `memory/messenger-project.md`: update the frontend status line — FE-3 (F5+F6+F8) done: real dialog list from `GET /chats` via `ChatsManager`+`chatsStore`; `MessagesManager` with ported tweb `SlicedArray` cache + `GET /history` paging; `useMessageWindow` edge-triggered loader; `ConversationView` real-send + `ScrollSaver` anchoring + DOM virtualization (getViewportSlice node culling). Note next: F7 (live WS receive/read/typing/presence) and F9/F10 (media/push). Mention the seeding recipe lives in this plan.

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch in the `telegram-ui-clone` repo (verify `npx vitest run` + `npx tsc -b` green first). Default: merge `frontend-slice3-real-chats` → `master` locally.

```bash
cd telegram-ui-clone
npx vitest run && npx tsc -b
git checkout master && git merge --no-ff frontend-slice3-real-chats -m "Merge frontend-slice3: real chats + virtualized message window (F5+F6+F8)"
```

---

## Self-Review (author checklist — completed)

- **Spec coverage:** F5 (Tasks 1–5), F6 (Tasks 6–8, 10), F8 (Tasks 9, 11–12). Maps to spec §8.1 (SlicedArray), §8.2 (window loading under History API), §8.4 (DOM virtualization + ScrollSaver). ✓
- **Backend semantics:** Direction→request mapping verified against `messagesrepo.go` (older = `seq<=S` DESC inclusive → filter overlap; newer = `seq>S` ASC; newest = `offset_id=0`). ✓
- **Type consistency:** `Dialog`/`Message` (camelCase) from `models.ts` used throughout; `HistoryArgs`/`HistoryResult`/`SendArgs` shared between manager + hook + bootstrap interface; `ChatKind` reused. `dialogToChat`/`messageToConvMsg` bridge to the existing `Chat`/`ConvMsg` render types. ✓
- **Placeholders:** none — every code step has complete code; the only "port verbatim" step (Task 6) names the exact source file + the 4 precise edits. ✓
- **Working software per slice boundary:** after Task 5 the real sidebar renders; after Task 11 real history loads + scrolls + sends; Task 12 adds culling; Task 13 verifies live. ✓
- **Out of scope (documented):** live WS receive/read-receipts/typing/presence (F7), media bubbles/streaming (F9), web push (F10), jump-to-first-unread on open, group sender-name resolution. ✓
