# Realtime over WebSocket (F3 + F4 + F7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chats fully live: a `ConnectionManager` (WS FSM + heartbeat + reconnect backoff + outbox/ack/resend), a `SyncEngine` (pts-based `GET /sync` catch-up on connect/reconnect), and live delivery of `new_message`/`read`/`typing`/`presence`/`reaction` into the chat list and the open conversation — with optimistic send over WS.

**Architecture:** Worker-first. The Core Worker owns ONE WebSocket (singleton `ConnectionManager`) and a singleton `SyncEngine`. Both are created once at module scope (not per connecting tab). Server→UI delivery uses the existing `SuperMessagePort` **event** channel (`emit`/`on`), broadcast to every connected tab's port. The UI subscribes to `rt:*` events and updates `chatsStore` (dialog previews/unread/presence) and the open `ConversationView` (append incoming, optimistic send reconcile, typing/presence indicators).

**Tech Stack:** React 18 + TS + MUI + Vite + Vitest/happy-dom + zustand. Backend WS gateway (`/ws?token=`) + `GET /sync`, unchanged.

**Repo topology (CRITICAL):** Frontend code lives in `telegram-ui-clone/` — its **own git repo** (gitignored by the backend repo). All code tasks run there. This plan lives in the backend repo `docs/`. Commit frontend changes with `git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit`.

**Backend WS contract (verified in `backend/internal/adapter/delivery/ws/conn.go`):**
- Client→server frames: `{"t":"ping"}` (→ server replies `{"t":"pong"}`), `send_message {chat_id,type,text,reply_to_id,client_msg_id,media_id}` (→ `message_ack {client_msg_id,msg_id,seq,created_at}` to the SENDER only; `new_message` fanned out to OTHER members), `read {chat_id,up_to_seq}`, `typing {chat_id}`.
- Server→client frames: `pong`, `message_ack`, `new_message {chat_id,msg_id,seq,sender_id,type,text,media_id,created_at}`, `read {chat_id,user_id,up_to_seq}`, `typing {chat_id,user_id}`, `presence {user_id,online,last_seen}`, `reaction {chat_id,msg_id,user_id,emoji,action}`.
- **WS frames carry NO `pts`.** The server also sends protocol PingMessage every 25s (the browser auto-pongs at protocol level). Envelope is `{t, d}`.
- `GET /sync?pts=&date=` → `{ new_messages: [<Message>], other_updates: [<Update>], state: {pts,date}, slice: bool, too_long: bool }`. `other_updates` items are either a read `{chat_id,user_id,up_to_seq}` or a reaction `{chat_id,msg_id,user_id,emoji,action}` (distinguish by the presence of `up_to_seq` vs `emoji`). `too_long` ⇒ full resync (reload dialogs); `slice` ⇒ call again with the advanced state.

**Design decisions (deviations from the spec, which assumed protobuf + pts-on-frames):**
1. Live WS frames lack `pts`, so there is NO pts-gap-detection on the live stream. `pts` advances only via `GET /sync`. `SyncEngine.catchUp()` runs on every transition into READY (initial connect + each reconnect) and recovers anything missed while disconnected. Live frames are applied immediately and deduped by `msg_id` so a `/sync` replay is idempotent.
2. The sender receives only `message_ack` (never its own `new_message`), so optimistic append + ack-reconcile cannot duplicate.
3. Heartbeat: the client sends `{"t":"ping"}` every 20s and expects `{"t":"pong"}`; two missed pongs ⇒ force-close ⇒ reconnect. (Server protocol pings also keep the socket warm.)

---

## File Structure

**Create (under `telegram-ui-clone/src/`):**
- `core/realtime/syncEngine.ts` + `.test.ts` — pts catch-up loop over `GET /sync`.
- `core/realtime/connectionManager.ts` + `.test.ts` — WS FSM, heartbeat, backoff, outbox/ack/resend.
- `core/realtime/events.ts` — shared `RT` event-name constants + payload types.
- `client/realtimeBridge.ts` — UI-side: subscribe `rt:*` smp events → chatsStore + uiEvents.
- `core/hooks/uiEvents.ts` — tiny typed emitter the open ConversationView subscribes to.

**Modify:**
- `core/net/wsClient.ts` — add `onOpen`/`onClose`/`onError` hooks + `isOpen`.
- `core/worker.ts` — singleton CM + SyncEngine; broadcast events to all ports; register a `realtime` manager.
- `client/bootstrap.ts` — extend `Managers` with `realtime`; start the bridge.
- `stores/chatsStore.ts` — live actions `applyNewMessage`/`applyRead`/`setPresence`.
- `core/hooks/useMessageWindow.ts` — `appendOptimistic`/`reconcileAck`/`applyIncoming`.
- `components/ConversationView.tsx` — send/read/typing over WS; incoming append; typing + presence UI.
- `core/auth/tokenStore.ts` **(or worker.ts)** — await `tokens.load()` before first `me()` (relogin race fix).
- `core/dialogToChat.ts` — already returns raw ISO `date`; add a small formatter for the preview timestamp (ISO tail fix).

---

## Task 0: Branch setup

- [ ] **Step 1: Create the feature branch**

```bash
cd telegram-ui-clone
git checkout master && git pull --ff-only 2>/dev/null; git checkout -b frontend-slice4-realtime
git status   # clean, on the new branch
```

---

## Task 1: wsClient lifecycle hooks

**Files:** Modify `src/core/net/wsClient.ts`; Test `src/core/net/wsClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/net/wsClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WsClient } from './wsClient'

class FakeWS {
  static instances: FakeWS[] = []
  onmessage: ((ev: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  readyState = 0
  constructor(public url: string) { FakeWS.instances.push(this) }
  send(s: string) { this.sent.push(s) }
  close() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  message(s: string) { this.onmessage?.({ data: s }) }
}

beforeEach(() => { FakeWS.instances = []; vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket) })

describe('WsClient', () => {
  it('fires onOpen, routes frames by type, exposes isOpen', () => {
    const c = new WsClient('/ws')
    const opened = vi.fn(); const got = vi.fn()
    c.onOpen(opened); c.on('new_message', got)
    c.connect('tok')
    const ws = FakeWS.instances[0]
    expect(ws.url).toContain('/ws?token=tok')
    ws.open()
    expect(opened).toHaveBeenCalled()
    expect(c.isOpen()).toBe(true)
    ws.message(JSON.stringify({ t: 'new_message', d: { msg_id: 5 } }))
    expect(got).toHaveBeenCalledWith({ msg_id: 5 })
  })

  it('fires onClose and reports not open', () => {
    const c = new WsClient('/ws'); const closed = vi.fn(); c.onClose(closed)
    c.connect('tok'); const ws = FakeWS.instances[0]; ws.open(); ws.close()
    expect(closed).toHaveBeenCalled(); expect(c.isOpen()).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`onOpen`/`isOpen` not defined)

Run: `cd telegram-ui-clone && npx vitest run src/core/net/wsClient.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/core/net/wsClient.ts
import { decodeFrame, encodeFrame, type Frame } from '../../protocol/frames'

// Thin WS wrapper: connect to /ws?token=, JSON frames in/out, frame + lifecycle listeners.
export class WsClient {
  private ws: WebSocket | null = null
  private listeners = new Map<string, Array<(d: unknown) => void>>()
  private openCbs: Array<() => void> = []
  private closeCbs: Array<() => void> = []
  private errorCbs: Array<() => void> = []

  constructor(private url: string) {}

  connect(token: string): void {
    const ws = new WebSocket(`${this.url}?token=${encodeURIComponent(token)}`)
    this.ws = ws
    ws.onopen = () => { for (const cb of this.openCbs) cb() }
    ws.onclose = () => { for (const cb of this.closeCbs) cb() }
    ws.onerror = () => { for (const cb of this.errorCbs) cb() }
    ws.onmessage = (ev) => {
      const f: Frame = decodeFrame(typeof ev.data === 'string' ? ev.data : '')
      for (const cb of this.listeners.get(f.t) ?? []) cb(f.d)
    }
  }

  on(type: string, cb: (d: unknown) => void): void {
    const arr = this.listeners.get(type) ?? []
    arr.push(cb)
    this.listeners.set(type, arr)
  }
  onOpen(cb: () => void): void { this.openCbs.push(cb) }
  onClose(cb: () => void): void { this.closeCbs.push(cb) }
  onError(cb: () => void): void { this.errorCbs.push(cb) }

  isOpen(): boolean { return this.ws?.readyState === 1 }

  send(t: string, d?: unknown): void { this.ws?.send(encodeFrame(t, d)) }

  close(): void {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null }
  }
}
```

- [ ] **Step 4: Run — expect PASS.** `cd telegram-ui-clone && npx vitest run src/core/net/wsClient.test.ts`

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone && git add src/core/net/wsClient.ts src/core/net/wsClient.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(ws): WsClient open/close/error hooks + isOpen"
```

---

## Task 2: shared realtime event constants

**Files:** Create `src/core/realtime/events.ts`

(No test — pure constants/types consumed by later tasks.)

- [ ] **Step 1: Implement**

```ts
// src/core/realtime/events.ts
// Worker -> UI event names (over SuperMessagePort.emit). Live frames AND /sync
// catch-up both surface through these, so the UI handles them uniformly.
export const RT = {
  newMessage: 'rt:new_message',
  read: 'rt:read',
  typing: 'rt:typing',
  presence: 'rt:presence',
  reaction: 'rt:reaction',
  ack: 'rt:ack',
  state: 'rt:state',
} as const

export type ConnState = 'connecting' | 'ready' | 'reconnecting' | 'offline'

export interface NewMessageEvt { chat_id: number; msg_id: number; seq: number; sender_id: number; type: string; text: string; media_id: number | null; created_at: string }
export interface ReadEvt { chat_id: number; user_id: number; up_to_seq: number }
export interface TypingEvt { chat_id: number; user_id: number }
export interface PresenceEvt { user_id: number; online: boolean; last_seen: number }
export interface ReactionEvt { chat_id: number; msg_id: number; user_id: number; emoji: string; action: 'add' | 'remove' }
export interface AckEvt { client_msg_id: string; msg_id: number; seq: number; created_at: string }
```

- [ ] **Step 2: Commit**

```bash
cd telegram-ui-clone && git add src/core/realtime/events.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(realtime): shared rt event names + payload types"
```

---

## Task 3: SyncEngine (pts catch-up)

**Files:** Create `src/core/realtime/syncEngine.ts` + `.test.ts`

**Context:** Persists `{pts,date}` (via idbKv). `catchUp()` loops `GET /sync` while `slice` is true; on `too_long` calls the injected `onResync` (UI reloads dialogs). Each new_message/other_update is dispatched through injected sink callbacks (the worker wires these to broadcast `rt:*` events). Idempotent: a replayed message is deduped downstream by `msg_id`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/realtime/syncEngine.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newSyncEngine } from './syncEngine'

function fakeRest(pages: Array<{ new_messages: unknown[]; other_updates: unknown[]; state: { pts: number; date: number }; slice: boolean; too_long?: boolean }>) {
  let i = 0
  return { get: vi.fn(async () => pages[i++]) } as never
}
const mem = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v) } }

describe('SyncEngine.catchUp', () => {
  it('drains slices, dispatches updates, advances + persists pts', async () => {
    const rest = fakeRest([
      { new_messages: [{ msg_id: 1 }], other_updates: [], state: { pts: 5, date: 10 }, slice: true },
      { new_messages: [{ msg_id: 2 }], other_updates: [{ up_to_seq: 3, chat_id: 1, user_id: 2 }], state: { pts: 9, date: 11 }, slice: false },
    ])
    const onNew = vi.fn(); const onOther = vi.fn(); const onResync = vi.fn()
    const store = mem()
    const se = newSyncEngine({ rest, store, onNewMessage: onNew, onOtherUpdate: onOther, onResync })
    await se.catchUp()
    expect(onNew).toHaveBeenCalledTimes(2)
    expect(onOther).toHaveBeenCalledTimes(1)
    expect(await store.get('pts')).toBe(9)
    expect(onResync).not.toHaveBeenCalled()
  })

  it('triggers onResync on too_long and stops', async () => {
    const rest = fakeRest([{ new_messages: [], other_updates: [], state: { pts: 0, date: 0 }, slice: false, too_long: true }])
    const onResync = vi.fn()
    const se = newSyncEngine({ rest, store: mem(), onNewMessage: vi.fn(), onOtherUpdate: vi.fn(), onResync })
    await se.catchUp()
    expect(onResync).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** `cd telegram-ui-clone && npx vitest run src/core/realtime/syncEngine.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/core/realtime/syncEngine.ts
import type { RestClient } from '../net/restClient'

interface KV { get<T = unknown>(k: string): Promise<T | undefined>; set(k: string, v: unknown): Promise<void> }
interface SyncResp { new_messages: unknown[]; other_updates: unknown[]; state: { pts: number; date: number }; slice: boolean; too_long?: boolean }

export interface SyncDeps {
  rest: Pick<RestClient, 'get'>
  store: KV
  onNewMessage: (m: unknown) => void
  onOtherUpdate: (u: unknown) => void
  onResync: () => void
}

export function newSyncEngine({ rest, store, onNewMessage, onOtherUpdate, onResync }: SyncDeps) {
  let running: Promise<void> | null = null

  async function loadState(): Promise<{ pts: number; date: number }> {
    return { pts: (await store.get<number>('pts')) ?? 0, date: (await store.get<number>('date')) ?? 0 }
  }

  async function run(): Promise<void> {
    let { pts, date } = await loadState()
    for (;;) {
      const r = await rest.get<SyncResp>('/sync', { pts, date })
      if (r.too_long) { onResync(); break }
      for (const m of r.new_messages ?? []) onNewMessage(m)
      for (const u of r.other_updates ?? []) onOtherUpdate(u)
      pts = r.state?.pts ?? pts
      date = r.state?.date ?? date
      await store.set('pts', pts)
      await store.set('date', date)
      if (!r.slice) break
    }
  }

  return {
    // serialize concurrent calls; a reconnect mid-sync just awaits the in-flight run
    catchUp(): Promise<void> {
      if (running) return running
      running = run().finally(() => { running = null })
      return running
    },
    async setState(pts: number, date: number): Promise<void> {
      await store.set('pts', pts); await store.set('date', date)
    },
  }
}

export type SyncEngine = ReturnType<typeof newSyncEngine>
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone && git add src/core/realtime/syncEngine.ts src/core/realtime/syncEngine.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(realtime): SyncEngine pts catch-up over GET /sync"
```

---

## Task 4: ConnectionManager (FSM + heartbeat + backoff + outbox)

**Files:** Create `src/core/realtime/connectionManager.ts` + `.test.ts`

**Context:** Wraps a `WsClient`. Drives the FSM, heartbeat ping/pong, exponential backoff reconnect, and an outbox keyed by `client_msg_id` (resend-all on reconnect, clear on ack). Time is injected (`now`, `setTimeout`/`clearTimeout`) so tests use fake timers. `onState` reports state transitions; on entering `ready` it calls `onReady` (the worker runs SyncEngine.catchUp there).

- [ ] **Step 1: Write the failing test**

```ts
// src/core/realtime/connectionManager.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { newConnectionManager } from './connectionManager'

function fakeWs() {
  const frames: Array<{ t: string; d?: unknown }> = []
  let openCb = () => {}; let closeCb = () => {}
  const onHandlers = new Map<string, (d: unknown) => void>()
  return {
    client: {
      connect: vi.fn(),
      onOpen: (cb: () => void) => { openCb = cb },
      onClose: (cb: () => void) => { closeCb = cb },
      onError: () => {},
      on: (t: string, cb: (d: unknown) => void) => onHandlers.set(t, cb),
      send: (t: string, d?: unknown) => frames.push({ t, d }),
      isOpen: () => true,
      close: vi.fn(() => closeCb()),
    },
    frames, fireOpen: () => openCb(), fireClose: () => closeCb(),
    recv: (t: string, d: unknown) => onHandlers.get(t)?.(d),
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ConnectionManager', () => {
  it('connects, reaches ready on open, runs onReady', async () => {
    const ws = fakeWs(); const onReady = vi.fn(); const onState = vi.fn()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady, onState, onFrame: () => {} })
    cm.start()
    expect(ws.client.connect).toHaveBeenCalledWith('tok')
    ws.fireOpen()
    expect(onState).toHaveBeenCalledWith('ready')
    expect(onReady).toHaveBeenCalled()
  })

  it('queues a send in the outbox and clears it on ack', () => {
    const ws = fakeWs()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
    cm.start(); ws.fireOpen()
    cm.sendMessage({ chatId: 1, text: 'hi', clientMsgId: 'c1' })
    expect(ws.frames.find(f => f.t === 'send_message')).toBeTruthy()
    expect(cm.outboxSize()).toBe(1)
    ws.recv('message_ack', { client_msg_id: 'c1', msg_id: 9, seq: 5, created_at: 'now' })
    expect(cm.outboxSize()).toBe(0)
  })

  it('resends the outbox after a reconnect', () => {
    const ws = fakeWs()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
    cm.start(); ws.fireOpen()
    cm.sendMessage({ chatId: 1, text: 'hi', clientMsgId: 'c1' })
    ws.frames.length = 0
    ws.fireClose()
    vi.advanceTimersByTime(1000) // backoff elapses → reconnect
    ws.fireOpen()
    expect(ws.frames.filter(f => f.t === 'send_message').length).toBe(1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/core/realtime/connectionManager.ts
import type { WsClient } from '../net/wsClient'
import type { ConnState } from './events'

export interface SendArgs { chatId: number; text: string; clientMsgId: string; replyToId?: number | null; mediaId?: number | null }

export interface CMDeps {
  ws: WsClient
  getToken: () => string | null
  onReady: () => void
  onState: (s: ConnState) => void
  onFrame: (type: string, payload: unknown) => void // new_message/read/typing/presence/reaction/message_ack
  now?: () => number
}

const HEARTBEAT_MS = 20_000
const PONG_GRACE = 2 // missed pongs before force-reconnect
const MAX_BACKOFF = 30_000
const FRAME_TYPES = ['new_message', 'read', 'typing', 'presence', 'reaction', 'message_ack', 'pong']

export function newConnectionManager({ ws, getToken, onReady, onState, onFrame }: CMDeps) {
  const outbox = new Map<string, SendArgs>()
  let state: ConnState = 'offline'
  let attempt = 0
  let hbTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let missedPongs = 0
  let wired = false

  const setState = (s: ConnState) => { state = s; onState(s) }

  function wireOnce() {
    if (wired) return
    wired = true
    ws.onOpen(() => {
      attempt = 0; missedPongs = 0
      setState('ready')
      startHeartbeat()
      for (const m of outbox.values()) sendFrame(m) // resend unacked
      onReady()
    })
    ws.onClose(() => { stopHeartbeat(); if (state !== 'offline') scheduleReconnect() })
    ws.onError(() => { /* onClose will follow */ })
    for (const t of FRAME_TYPES) {
      ws.on(t, (d) => {
        if (t === 'pong') { missedPongs = 0; return }
        if (t === 'message_ack') { const id = (d as { client_msg_id?: string })?.client_msg_id; if (id) outbox.delete(id) }
        onFrame(t, d)
      })
    }
  }

  function startHeartbeat() {
    stopHeartbeat()
    hbTimer = setInterval(() => {
      if (++missedPongs > PONG_GRACE) { ws.close(); return } // triggers onClose→reconnect
      ws.send('ping')
    }, HEARTBEAT_MS)
  }
  function stopHeartbeat() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null } }

  function scheduleReconnect() {
    setState('reconnecting')
    const base = Math.min(MAX_BACKOFF, 500 * 2 ** attempt++)
    const delay = base / 2 + Math.floor(Math.random() * (base / 2 + 1)) // jitter
    reconnectTimer = setTimeout(connect, delay)
  }

  function connect() {
    const token = getToken()
    if (!token) { setState('offline'); return }
    setState(state === 'reconnecting' ? 'reconnecting' : 'connecting')
    wireOnce()
    ws.connect(token)
  }

  function sendFrame(m: SendArgs) {
    ws.send('send_message', { chat_id: m.chatId, type: 'text', text: m.text, client_msg_id: m.clientMsgId, reply_to_id: m.replyToId ?? null, media_id: m.mediaId ?? null })
  }

  return {
    start() { if (state === 'offline') connect() },
    stop() { if (reconnectTimer) clearTimeout(reconnectTimer); stopHeartbeat(); state = 'offline'; ws.close() },
    state: () => state,
    outboxSize: () => outbox.size,
    sendMessage(m: SendArgs) { outbox.set(m.clientMsgId, m); if (ws.isOpen()) sendFrame(m) },
    markRead(chatId: number, upToSeq: number) { if (ws.isOpen()) ws.send('read', { chat_id: chatId, up_to_seq: upToSeq }) },
    sendTyping(chatId: number) { if (ws.isOpen()) ws.send('typing', { chat_id: chatId }) },
  }
}

export type ConnectionManager = ReturnType<typeof newConnectionManager>
```

- [ ] **Step 4: Run — expect PASS.** (Fake timers drive heartbeat/backoff.)

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone && git add src/core/realtime/connectionManager.ts src/core/realtime/connectionManager.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(realtime): ConnectionManager FSM + heartbeat + backoff + outbox/ack/resend"
```

---

## Task 5: Worker wiring — singletons, multi-tab broadcast, `realtime` manager

**Files:** Modify `src/core/worker.ts`, `src/client/bootstrap.ts`

**Context:** CM + SyncEngine are created once at module scope. The worker keeps a list of every bound `SuperMessagePort` and `broadcast(event,payload)` emits to all (multi-tab). The CM's `onFrame` translates WS frames into `rt:*` broadcasts; the SyncEngine's sinks reuse the same broadcasts. A `realtime` manager exposes `start`/`sendMessage`/`markRead`/`sendTyping` to the UI. On CM `onReady` → `syncEngine.catchUp()`.

- [ ] **Step 1: Rewrite `worker.ts`**

```ts
// src/core/worker.ts
/// <reference lib="webworker" />
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { registerManagers } from '../rpc/managersProxy'
import { RestClient } from './net/restClient'
import { WsClient } from './net/wsClient'
import { newHealthManager } from './managers/healthManager'
import { TokenStore } from './auth/tokenStore'
import { newAuthManager } from './managers/authManager'
import { newChatsManager } from './managers/chatsManager'
import { newMessagesManager } from './managers/messagesManager'
import { newConnectionManager } from './realtime/connectionManager'
import { newSyncEngine } from './realtime/syncEngine'
import { RT } from './realtime/events'
import { idbGet, idbSet } from './store/idbKv'

const tokens = new TokenStore()
const rest = new RestClient('/api', () => tokens.get())
const auth = newAuthManager({ rest, store: tokens })
const chats = newChatsManager({ rest })
const messages = newMessagesManager({ rest })

// every connected tab's port — events broadcast to all
const ports: SuperMessagePort[] = []
const broadcast = (event: string, payload: unknown) => { for (const p of ports) p.emit(event, payload) }

// map an `other_update` from /sync to the right rt:* event
function dispatchOther(u: unknown) {
  const o = u as Record<string, unknown>
  if (o && 'up_to_seq' in o) broadcast(RT.read, o)
  else if (o && 'emoji' in o) broadcast(RT.reaction, o)
}

const ws = new WsClient('/ws')
const sync = newSyncEngine({
  rest, store: { get: idbGet, set: idbSet },
  onNewMessage: (m) => broadcast(RT.newMessage, m),
  onOtherUpdate: dispatchOther,
  onResync: () => broadcast('rt:resync', null),
})
const conn = newConnectionManager({
  ws, getToken: () => tokens.get(),
  onReady: () => { void sync.catchUp() },
  onState: (s) => broadcast(RT.state, { state: s }),
  onFrame: (type, payload) => {
    if (type === 'message_ack') broadcast(RT.ack, payload)
    else if (type === 'new_message') broadcast(RT.newMessage, payload)
    else if (type === 'read') broadcast(RT.read, payload)
    else if (type === 'typing') broadcast(RT.typing, payload)
    else if (type === 'presence') broadcast(RT.presence, payload)
    else if (type === 'reaction') broadcast(RT.reaction, payload)
  },
})

const realtime = {
  async start() { await tokens.load(); conn.start(); return { state: conn.state() } },
  async sendMessage(args: { chatId: number; text: string; clientMsgId: string; replyToId?: number | null; mediaId?: number | null }) { conn.sendMessage(args); return { ok: true } },
  async markRead(args: { chatId: number; upToSeq: number }) { conn.markRead(args.chatId, args.upToSeq); return { ok: true } },
  async sendTyping(args: { chatId: number }) { conn.sendTyping(args.chatId); return { ok: true } },
}

function bind(ep: Endpoint) {
  const smp = new SuperMessagePort(ep)
  ports.push(smp)
  registerManagers(smp, {
    health: newHealthManager(rest),
    auth: auth as unknown as Record<string, (...a: unknown[]) => unknown>,
    chats: chats as unknown as Record<string, (...a: unknown[]) => unknown>,
    messages: messages as unknown as Record<string, (...a: unknown[]) => unknown>,
    realtime: realtime as unknown as Record<string, (...a: unknown[]) => unknown>,
  })
}

const g = self as unknown as {
  onconnect?: (e: MessageEvent) => void
  addEventListener: (t: string, cb: (e: MessageEvent) => void) => void
}
if ('onconnect' in g) {
  g.onconnect = (e: MessageEvent) => bind((e as MessageEvent & { ports: MessagePort[] }).ports[0])
} else {
  bind(g as unknown as Endpoint)
}
```

- [ ] **Step 2: Extend the `Managers` interface in `bootstrap.ts`**

Add to imports: `import type { ConnState } from '../core/realtime/events'`. Add the member:

```ts
  realtime: {
    start(): Promise<{ state: ConnState }>
    sendMessage(args: { chatId: number; text: string; clientMsgId: string; replyToId?: number | null; mediaId?: number | null }): Promise<{ ok: boolean }>
    markRead(args: { chatId: number; upToSeq: number }): Promise<{ ok: boolean }>
    sendTyping(args: { chatId: number }): Promise<{ ok: boolean }>
  }
```

- [ ] **Step 3: Typecheck + full tests + build**

Run: `cd telegram-ui-clone && npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`
Expected: clean / all green / build OK.

- [ ] **Step 4: Commit**

```bash
cd telegram-ui-clone && git add src/core/worker.ts src/client/bootstrap.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(worker): realtime singletons + multi-tab broadcast + realtime manager"
```

---

## Task 6: uiEvents emitter

**Files:** Create `src/core/hooks/uiEvents.ts` + `.test.ts`

**Context:** A tiny synchronous emitter the open ConversationView subscribes to for its chat. The realtime bridge (Task 8) feeds it from smp events.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/hooks/uiEvents.test.ts
import { describe, it, expect, vi } from 'vitest'
import { uiEvents } from './uiEvents'

describe('uiEvents', () => {
  it('delivers to subscribers and unsubscribes', () => {
    const cb = vi.fn()
    const off = uiEvents.on('rt:new_message', cb)
    uiEvents.emit('rt:new_message', { msg_id: 1 })
    expect(cb).toHaveBeenCalledWith({ msg_id: 1 })
    off()
    uiEvents.emit('rt:new_message', { msg_id: 2 })
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/core/hooks/uiEvents.ts
type Cb = (payload: unknown) => void

class Emitter {
  private map = new Map<string, Set<Cb>>()
  on(event: string, cb: Cb): () => void {
    const set = this.map.get(event) ?? new Set()
    set.add(cb); this.map.set(event, set)
    return () => set.delete(cb)
  }
  emit(event: string, payload: unknown): void {
    for (const cb of this.map.get(event) ?? []) cb(payload)
  }
}

export const uiEvents = new Emitter()
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone && git add src/core/hooks/uiEvents.ts src/core/hooks/uiEvents.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(ui): uiEvents emitter for realtime fan-out to the open chat"
```

---

## Task 7: chatsStore live actions

**Files:** Modify `src/stores/chatsStore.ts`; Test `src/stores/chatsStore.test.ts` (extend)

**Context:** Apply live updates to the dialog list: a new message bumps `lastMessage`, increments `unread` when it's incoming and the chat isn't the active one, and moves the dialog to the top; a read receipt from me clears `unread` and advances `lastReadSeq`; presence is tracked in a `presence` map.

- [ ] **Step 1: Add the failing tests** (append to the existing describe in `chatsStore.test.ts`)

```ts
  it('applyNewMessage bumps preview, unread (incoming, not active), moves to top', () => {
    useChatsStore.setState({ dialogs: [
      { chatId: 1, type: 'private', lastReadSeq: 0, unread: 0, muted: false },
      { chatId: 2, type: 'private', lastReadSeq: 0, unread: 0, muted: false },
    ], meId: 7, activeChatId: null })
    useChatsStore.getState().applyNewMessage({ chat_id: 2, msg_id: 9, seq: 4, sender_id: 5, type: 'text', text: 'yo', media_id: null, created_at: 'now' })
    const s = useChatsStore.getState()
    expect(s.dialogs[0].chatId).toBe(2)
    expect(s.dialogs[0].unread).toBe(1)
    expect(s.dialogs[0].lastMessage?.text).toBe('yo')
  })

  it('applyNewMessage does not bump unread for my own message or the active chat', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, unread: 0, muted: false }], meId: 7, activeChatId: 2 })
    useChatsStore.getState().applyNewMessage({ chat_id: 2, msg_id: 9, seq: 4, sender_id: 5, type: 'text', text: 'hi', media_id: null, created_at: 'now' })
    expect(useChatsStore.getState().dialogs[0].unread).toBe(0)
  })

  it('applyRead from me clears unread', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, unread: 3, muted: false }], meId: 7 })
    useChatsStore.getState().applyRead({ chat_id: 2, user_id: 7, up_to_seq: 9 })
    expect(useChatsStore.getState().dialogs[0].unread).toBe(0)
    expect(useChatsStore.getState().dialogs[0].lastReadSeq).toBe(9)
  })
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — extend `ChatsState` and the store:

Add to the interface: `activeChatId: number | null`, `presence: Record<number, { online: boolean; lastSeen: number }>`, `setActiveChat(id: number | null): void`, `applyNewMessage(m: NewMessageEvt): void`, `applyRead(r: ReadEvt): void`, `setPresence(p: PresenceEvt): void`. Add the import `import type { NewMessageEvt, ReadEvt, PresenceEvt } from '../core/realtime/events'`. Initial `activeChatId: null`, `presence: {}`. Implement:

```ts
  setActiveChat: (activeChatId) => set({ activeChatId }),
  setPresence: (p) => set((s) => ({ presence: { ...s.presence, [p.user_id]: { online: p.online, lastSeen: p.last_seen } } })),
  applyNewMessage: (m) =>
    set((s) => {
      const idx = s.dialogs.findIndex((d) => d.chatId === m.chat_id)
      if (idx === -1) return {} // unknown chat (will surface on next dialog reload)
      const d = s.dialogs[idx]
      const incoming = m.sender_id !== s.meId
      const bumpUnread = incoming && s.activeChatId !== m.chat_id
      const updated = {
        ...d,
        lastMessage: { seq: m.seq, text: m.text, senderId: m.sender_id, at: m.created_at },
        unread: bumpUnread ? d.unread + 1 : d.unread,
      }
      const rest = s.dialogs.filter((_, i) => i !== idx)
      return { dialogs: [updated, ...rest] }
    }),
  applyRead: (r) =>
    set((s) => {
      const idx = s.dialogs.findIndex((d) => d.chatId === r.chat_id)
      if (idx === -1) return {}
      if (r.user_id !== s.meId) return {} // only my own read clears my unread
      const next = s.dialogs.slice()
      next[idx] = { ...next[idx], unread: 0, lastReadSeq: Math.max(next[idx].lastReadSeq, r.up_to_seq) }
      return { dialogs: next }
    }),
```

- [ ] **Step 4: Run — expect PASS.** `cd telegram-ui-clone && npx vitest run src/stores/chatsStore.test.ts`

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone && git add src/stores/chatsStore.ts src/stores/chatsStore.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(store): live chatsStore updates (new message/read/presence/active)"
```

---

## Task 8: useMessageWindow — optimistic send + incoming apply

**Files:** Modify `src/core/hooks/useMessageWindow.ts`; Test `.test.ts` (extend)

**Context:** Add three actions used by the open chat: `appendOptimistic(text, meId, clientMsgId)` (append a local pending message with a tentative seq above the current max), `reconcileAck(clientMsgId, {msgId, seq, createdAt})` (replace the tentative with the server values), and `applyIncoming(m)` (append a received `new_message`, deduped by `id`). All keep the list sorted ascending and deduped.

- [ ] **Step 1: Add failing tests** (extend the existing describe)

```ts
  it('appendOptimistic then reconcileAck swaps the tentative seq', async () => {
    const managers = fakeManagers(() => ({ messages: [], count: 0, reachedTop: true, reachedBottom: true }))
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.reachedBottom).toBe(true))
    act(() => { result.current.appendOptimistic('hi', 7, 'c1') })
    expect(result.current.msgs.at(-1)?.text).toBe('hi')
    act(() => { result.current.reconcileAck('c1', { msgId: 50, seq: 12, createdAt: 'now' }) })
    const last = result.current.msgs.at(-1)!
    expect(last.id).toBe(50); expect(last.seq).toBe(12)
  })

  it('applyIncoming appends and dedups by id', async () => {
    const managers = fakeManagers(() => ({ messages: [], count: 0, reachedTop: true, reachedBottom: true }))
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.reachedBottom).toBe(true))
    const m = { id: 9, chatId: 1, seq: 3, senderId: 5, type: 'text', text: 'yo', replyToId: null, mediaId: null, createdAt: 'now' }
    act(() => { result.current.applyIncoming(m) })
    act(() => { result.current.applyIncoming(m) })
    expect(result.current.msgs.filter((x) => x.id === 9)).toHaveLength(1)
  })
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — add to the `MessageWindow` interface and the hook body:

```ts
  appendOptimistic: (text: string, meId: number, clientMsgId: string) => void
  reconcileAck: (clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) => void
  applyIncoming: (m: Message) => void
```

In the hook (a ref maps clientMsgId → tentative seq; tentative ids are negative to avoid colliding with real ids):

```ts
  const pending = useRef<Map<string, number>>(new Map())

  const appendOptimistic = useCallback((text: string, meId: number, clientMsgId: string) => {
    setMsgs((prev) => {
      const maxSeq = prev.length ? prev[prev.length - 1].seq : 0
      const tentativeSeq = maxSeq + 1
      pending.current.set(clientMsgId, tentativeSeq)
      const tmp: Message = { id: -Date.now(), chatId, seq: tentativeSeq, senderId: meId, type: 'text', text, replyToId: null, mediaId: null, createdAt: new Date().toISOString() }
      return dedupAsc([...prev, tmp])
    })
  }, [chatId])

  const reconcileAck = useCallback((clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) => {
    const tentativeSeq = pending.current.get(clientMsgId)
    if (tentativeSeq === undefined) return
    pending.current.delete(clientMsgId)
    setMsgs((prev) => dedupAsc(prev.map((m) => m.seq === tentativeSeq ? { ...m, id: ack.msgId, seq: ack.seq, createdAt: ack.createdAt } : m)))
  }, [])

  const applyIncoming = useCallback((m: Message) => {
    setMsgs((prev) => prev.some((x) => x.id === m.id) ? prev : dedupAsc([...prev, m]))
  }, [])
```

Add them to the returned object. (`new Date().toISOString()` is allowed in the UI thread; only Workflow scripts forbid it.)

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone && git add src/core/hooks/useMessageWindow.ts src/core/hooks/useMessageWindow.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(hooks): optimistic send + incoming apply in useMessageWindow"
```

---

## Task 9: UI realtime bridge + start on auth

**Files:** Create `src/client/realtimeBridge.ts`; Modify `src/App.tsx`

**Context:** Once authed, the UI calls `managers.realtime.start()` and subscribes to the worker's `rt:*` events: dialog-level updates go to `chatsStore`; everything also re-emits onto `uiEvents` so the open `ConversationView` can react to its chat. `rt:resync` reloads dialogs.

- [ ] **Step 1: Implement the bridge**

```ts
// src/client/realtimeBridge.ts
import { startClient } from './bootstrap'
import { loadChats, useChatsStore } from '../stores/chatsStore'
import { uiEvents } from '../core/hooks/uiEvents'
import { RT, type NewMessageEvt, type ReadEvt, type PresenceEvt } from '../core/realtime/events'

let started = false

// Subscribe to worker realtime events exactly once per page.
export function startRealtime(): void {
  if (started) return
  started = true
  const { smp, managers } = startClient()
  const store = useChatsStore.getState()

  smp.on(RT.newMessage, (m) => { store.applyNewMessage(m as NewMessageEvt); uiEvents.emit(RT.newMessage, m) })
  smp.on(RT.read, (r) => { store.applyRead(r as ReadEvt); uiEvents.emit(RT.read, r) })
  smp.on(RT.presence, (p) => { store.setPresence(p as PresenceEvt); uiEvents.emit(RT.presence, p) })
  smp.on(RT.typing, (t) => uiEvents.emit(RT.typing, t))
  smp.on(RT.reaction, (r) => uiEvents.emit(RT.reaction, r))
  smp.on(RT.ack, (a) => uiEvents.emit(RT.ack, a))
  smp.on('rt:resync', () => { void loadChats(managers) })

  void managers.realtime.start()
}
```

- [ ] **Step 2: Start realtime when the Shell mounts (authed)** — in `App.tsx`, the `Shell` already has a `useEffect` that calls `loadChats`. Add the realtime start there:

```ts
// in App.tsx imports
import { startRealtime } from './client/realtimeBridge'
```
```ts
  // inside the existing Shell useEffect, after `void loadChats(managers)`
    startRealtime()
```

- [ ] **Step 3: Typecheck + build**

Run: `cd telegram-ui-clone && npx tsc -b && npx vite build --outDir /tmp/tg-build-check --emptyOutDir` — clean + OK.

- [ ] **Step 4: Commit**

```bash
cd telegram-ui-clone && git add src/client/realtimeBridge.ts src/App.tsx
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(ui): realtime bridge — worker events -> chatsStore + uiEvents; start on auth"
```

---

## Task 10: ConversationView — live send/receive/typing/presence/read

**Files:** Modify `src/components/ConversationView.tsx`

**Context:** Replace the REST send with optimistic WS send + ack reconcile, append incoming `new_message` for this chat (scroll if at bottom), mark read when viewing the newest, send throttled `typing`, and show the peer typing/presence in the header. All gated on `isRealChat`.

- [ ] **Step 1: Imports + active-chat registration**

Add imports:
```ts
import { uiEvents } from '../core/hooks/uiEvents'
import { RT, type NewMessageEvt, type AckEvt, type TypingEvt } from '../core/realtime/events'
import { mapMessage } from '../core/models'
```
Register the active chat (drives `chatsStore` unread suppression) — add an effect after the `win` setup:
```ts
  const setActiveChat = useChatsStore((s) => s.setActiveChat)
  useEffect(() => {
    if (isRealChat) setActiveChat(numericChatId)
    return () => setActiveChat(null)
  }, [isRealChat, numericChatId, setActiveChat])
```

- [ ] **Step 2: Optimistic WS send + ack reconcile** — replace the `sendReal` body:

```ts
  const sendReal = (text: string) => {
    const clientMsgId = `c-${chat.id}-${performance.now()}-${Math.random().toString(36).slice(2)}`
    win.appendOptimistic(text, meId ?? -1, clientMsgId)
    void managers.realtime.sendMessage({ chatId: numericChatId, text, clientMsgId })
    requestAnimationFrame(() => { const el = scrollRef.current; if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight }) })
  }
```
And subscribe to acks for this chat:
```ts
  useEffect(() => {
    if (!isRealChat) return
    const off = uiEvents.on(RT.ack, (a) => {
      const ack = a as AckEvt
      win.reconcileAck(ack.client_msg_id, { msgId: ack.msg_id, seq: ack.seq, createdAt: ack.created_at })
    })
    return off
  }, [isRealChat, win])
```

- [ ] **Step 3: Incoming new_message for this chat** — append + read + conditional scroll:

```ts
  useEffect(() => {
    if (!isRealChat) return
    const off = uiEvents.on(RT.newMessage, (raw) => {
      const m = raw as NewMessageEvt
      if (m.chat_id !== numericChatId) return
      win.applyIncoming(mapMessage({ id: m.msg_id, chat_id: m.chat_id, seq: m.seq, sender_id: m.sender_id, type: m.type, text: m.text, reply_to_id: null, media_id: m.media_id, created_at: m.created_at }))
      // we are looking at this chat → mark read up to the new message
      void managers.realtime.markRead({ chatId: numericChatId, upToSeq: m.seq })
      const el = scrollRef.current
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
      }
    })
    return off
  }, [isRealChat, numericChatId, win, managers])
```

- [ ] **Step 4: Mark read on open** — when the newest is loaded/visible, send read up to the max seq:

```ts
  useEffect(() => {
    if (!isRealChat || !win.reachedBottom || win.msgs.length === 0) return
    const maxSeq = win.msgs[win.msgs.length - 1].seq
    void managers.realtime.markRead({ chatId: numericChatId, upToSeq: maxSeq })
  }, [isRealChat, win.reachedBottom, win.msgs, numericChatId, managers])
```

- [ ] **Step 5: Typing — send (throttled) + show peer typing** — in the composer `onChange`, after `setInput(...)`, add a throttled typing send; subscribe to incoming typing to drive the existing `typing` state (the header already renders `t('typing…')` when `typing` is true):

Add a throttle ref near the other refs: `const lastTypingRef = useRef(0)`. In the input `onChange` handler add:
```ts
                        if (isRealChat) {
                          const now = performance.now()
                          if (now - lastTypingRef.current > 3000) { lastTypingRef.current = now; void managers.realtime.sendTyping({ chatId: numericChatId }) }
                        }
```
And subscribe to incoming typing (auto-clear after 4s):
```ts
  useEffect(() => {
    if (!isRealChat) return
    let timer = 0
    const off = uiEvents.on(RT.typing, (raw) => {
      const tEvt = raw as TypingEvt
      if (tEvt.chat_id !== numericChatId || tEvt.user_id === meId) return
      setTyping(true)
      clearTimeout(timer); timer = window.setTimeout(() => setTyping(false), 4000)
    })
    return () => { off(); clearTimeout(timer) }
  }, [isRealChat, numericChatId, meId])
```

- [ ] **Step 6: Presence in the header** — read presence for the private peer and reflect it. The header subtitle currently shows `chat.status`. Add (near the top of the component, after `meId`):
```ts
  const presence = useChatsStore((s) => (isRealChat && chat.type === 'private' ? s.presence : null))
  // peer id isn't on `chat`; presence shows in the dialog list. For the header we
  // fall back to the existing chat.status when peer presence is unknown.
```
(Header presence wiring is best-effort: the dialog peer id isn't currently threaded into `ConversationView`. Leave the header subtitle as-is for private chats; the dialog-list presence dot is out of scope here. Document this in the verification notes.)

- [ ] **Step 7: Typecheck + full tests + build**

Run: `cd telegram-ui-clone && npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir` — clean / green / OK.

- [ ] **Step 8: Commit**

```bash
cd telegram-ui-clone && git add src/components/ConversationView.tsx
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(chat): live WS send/receive/read/typing in ConversationView"
```

---

## Task 11: Small tails — relogin race + ISO date

**Files:** Modify `src/core/managers/authManager.ts` **or** `src/App.tsx`; `src/core/dialogToChat.ts`

**Context (relogin race):** On reload the worker cold-starts and `me()` reads `store.get()` synchronously before `tokens.load()` resolves, returning null ⇒ spurious logout. Fix: make `me()` await a load completion. The cleanest fix is in the worker: `TokenStore.load()` is already called; expose a `ready` promise and await it in `auth.me()`.

- [ ] **Step 1: Add `ready()` to TokenStore + await it in `me()`**

In `src/core/auth/tokenStore.ts`, capture the load promise:
```ts
  private loadPromise: Promise<void> | null = null
  load(): Promise<void> { this.loadPromise ??= this._load(); return this.loadPromise }
  ready(): Promise<void> { return this.loadPromise ?? this.load() }
```
(Rename the existing body to `private async _load()`. Keep `get`/`set`/`clear` as-is.)

In `src/core/managers/authManager.ts`, the `TokenStoreLike` gains `ready(): Promise<void>`; at the top of `me()` add `await store.ready()` before `if (!store.get()) return null`.

In `worker.ts`, ensure `tokens.load()` is invoked at module init (the realtime `start()` already awaits it; also call `void tokens.load()` right after constructing `tokens`).

- [ ] **Step 2: Format the dialog preview timestamp (ISO tail)**

In `src/core/dialogToChat.ts`, replace `date: d.lastMessage?.at ?? ''` with a short formatter:
```ts
function fmtWhen(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: 'short' })
}
```
and `date: fmtWhen(d.lastMessage?.at),`. Update `dialogToChat.test.ts`'s date assertion to expect a non-empty formatted string (e.g. `expect(c.date).not.toBe('2026-06-24T10:00:00Z')` and `expect(c.date.length).toBeGreaterThan(0)`).

- [ ] **Step 3: Typecheck + tests + build** — `cd telegram-ui-clone && npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`.

- [ ] **Step 4: Commit**

```bash
cd telegram-ui-clone && git add src/core/auth/tokenStore.ts src/core/managers/authManager.ts src/core/worker.ts src/core/dialogToChat.ts src/core/dialogToChat.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "fix: await token load before me() (relogin race); format dialog timestamp"
```

---

## Task 12: Live verification (two tabs) + memory + finish

**Context:** Reuse the verify stack from FE-3 (`docker compose -p msgrverify -f docker-compose.verify.yml`, nginx on :38080, seeded users `+79990000001`/`+79990000002`, OTP `12345`). Rebuild `client-build` + bake into the nginx image (the `com.apple.provenance` xattr blocks bind-mounts — COPY at build time bypasses it).

- [ ] **Step 1: Rebuild + redeploy**

```bash
cd telegram-ui-clone && npx vite build --base=/ --outDir ../client-build --emptyOutDir
cd /Users/denisurevic/Documents/messenger-denis && xattr -cr client-build 2>/dev/null
docker compose -p msgrverify -f docker-compose.verify.yml up -d --build nginx
curl -s -o /dev/null -w "SPA %{http_code}\n" http://localhost:38080/   # expect 200
```
(If the stack is down, `docker compose -p msgrverify -f docker-compose.verify.yml up -d --build` and re-seed per the FE-3 plan.)

- [ ] **Step 2: Browser verification (playwright MCP)** — TWO contexts/tabs:
  1. Tab A: log in as `+79990000001` (`+7`+`9990000001`, OTP `12345`), open the chat with `+79990000002`.
  2. Via the API (or Tab B logged in as `+79990000002`) send a new message to the chat.
  3. **Assert in Tab A:** the new message appears **live** (no reload), the sidebar preview updates and the dialog moves to top; 0 console errors.
  4. In Tab A, send a message → it appears optimistically; confirm it persists (`GET /history`).
  5. Kill the backend WS briefly (or toggle network) and confirm reconnect + that a message sent while disconnected is recovered on reconnect via `/sync` (send via API while WS down, then confirm it shows after reconnect).
  6. Type in Tab B → assert Tab A header shows "typing…" then clears.

  Record a screenshot. Any console error or missed delivery is a bug — fix before finishing.

- [ ] **Step 3: Update memory** — edit `memory/messenger-project.md`: FE-4 (F3+F4+F7) done — ConnectionManager (WS FSM/heartbeat/backoff/outbox) + SyncEngine (pts `/sync` catch-up on connect/reconnect) + worker realtime singletons w/ multi-tab broadcast + live new_message/read/typing/presence/reaction into chatsStore & open chat + optimistic WS send + relogin-race + ISO-date fixes. Note deviations (JSON frames, no pts on live stream → catch-up only on connect; sender gets ack only). Next: F9 (media via SW) / F10 (web push); group sender-name + dialog-list presence dot.

- [ ] **Step 4: Finish the branch** — superpowers:finishing-a-development-branch in `telegram-ui-clone` (verify `npx vitest run` + `npx tsc -b` green first), default merge `frontend-slice4-realtime` → `master`:

```bash
cd telegram-ui-clone && npx vitest run && npx tsc -b
git checkout master && git merge --no-ff frontend-slice4-realtime -m "Merge frontend-slice4: realtime over WS (F3+F4+F7)"
```

---

## Self-Review (author checklist — completed)

- **Spec coverage:** F3 (Task 4 CM), F4 (Task 3 SyncEngine), F7 (Tasks 7–10 live send/read/typing/presence). ✓
- **Contract fidelity:** frame names/payloads match `conn.go`/contracts (`ping`→`pong`, `send_message`→`message_ack` to sender only, `new_message`/`read`/`typing`/`presence`/`reaction`); `/sync` shape matches `sync.go` (`new_messages`/`other_updates`/`state`/`slice`/`too_long`). ✓
- **Deviations documented:** no pts on live frames → catch-up only on (re)connect, idempotent via msg_id dedup; optimistic-send safe because sender gets only ack. ✓
- **Type consistency:** `RT`/event payload types shared across worker, bridge, store, hook, view; `SendArgs` reused; `ConnState` shared. ✓
- **Multi-tab:** CM/SyncEngine are module-scope singletons; events broadcast to every bound port; `started` guard prevents double-subscribe per page. ✓
- **No placeholders:** every code step has complete code; the one best-effort item (header presence) is explicitly scoped out with reason. ✓
- **Out of scope (documented):** dialog-list presence dot + header peer presence (peer id not threaded into ConversationView), reactions UI (events plumbed, no picker wiring), media/push (F9/F10), jump-to-first-unread. ✓
