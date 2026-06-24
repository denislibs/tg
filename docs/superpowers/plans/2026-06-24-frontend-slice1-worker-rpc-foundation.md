# Frontend Slice 1 — Worker + RPC Foundation (F0+F1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox (`- [ ]`) steps.

**Goal:** Stand up the multi-threaded client foundation in `telegram-ui-clone`: a **Core Worker** (SharedWorker with a Worker fallback) that runs managers, a typed **RPC** layer (`SuperMessagePort` + managers proxy) between the UI thread and the worker, the **WS frame protocol** types, **REST/WS clients**, and a reactive **connection store**. Proven end-to-end by a `health` manager that calls the backend `/api/health` from inside the worker and surfaces the result on the UI thread.

**Architecture:** Slice 1 of the frontend wiring (design: `docs/superpowers/specs/2026-06-23-frontend-architecture-design.md`; contract: `docs/contracts.md` + `/openapi.yaml`). UI thread only talks to the worker via `managers.<name>.<method>(args)` (RPC) and subscribes to worker-pushed events through zustand stores. The worker holds the REST/WS clients + managers. This slice lands the plumbing (no auth/chats yet — those are the next slice); `data.ts` mocks are untouched here.

**Tech Stack:** Vite 6 + React 18 + TypeScript; **zustand** (state), **vitest** + happy-dom (tests). Backend reached via the nginx proxy (`/api/*`, `/ws`).

> Code lives in the `telegram-ui-clone` repo (its own git). All paths below are relative to `telegram-ui-clone/`.

---

## File Structure
```
telegram-ui-clone/
  vitest.config.ts            — test runner (happy-dom)
  src/
    protocol/frames.ts        — WS envelope + frame payload types (mirrors contracts.md)
    rpc/
      superMessagePort.ts     — RPC over a MessagePort-like endpoint (invoke/result/event)
      superMessagePort.test.ts
      managersProxy.ts        — Proxy: managers.x.y(args) -> invoke('manager',{name,method,args})
      managersProxy.test.ts
    core/
      net/
        restClient.ts         — fetch wrapper to /api with bearer token
        restClient.test.ts
        wsClient.ts           — thin WS wrapper (connect /ws?token=, JSON frames, emitter)
      managers/
        healthManager.ts      — check() -> rest.get('/health')   (pipeline proof)
      worker.ts               — Core Worker entry: registers the 'manager' dispatch
    client/
      bootstrap.ts            — main-thread: create worker, wire SuperMessagePort + managers proxy
    stores/
      connectionStore.ts      — zustand store (status + last health)
```

---

### Task 1: vitest setup

**Files:** Create `telegram-ui-clone/vitest.config.ts`; modify `package.json`.

- [ ] **Step 1: Add dev deps + script**

Run: `cd telegram-ui-clone && npm i -D vitest happy-dom`
Then add to `package.json` "scripts": `"test": "vitest run"` (keep existing scripts).

- [ ] **Step 2: vitest config**

Create `telegram-ui-clone/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Verify the runner works**

Create a throwaway `src/sanity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
describe('sanity', () => { it('runs', () => { expect(1 + 1).toBe(2) }) })
```
Run: `npm test` → expect 1 passing test. Then delete `src/sanity.test.ts`.

- [ ] **Step 4: Commit** (in the telegram-ui-clone repo)
```bash
git add package.json package-lock.json vitest.config.ts && git commit -m "test: add vitest + happy-dom"
```

---

### Task 2: protocol/frames.ts

**Files:** Create `src/protocol/frames.ts`.

- [ ] **Step 1: Frame types (mirror docs/contracts.md WS section)**

Create `src/protocol/frames.ts`:
```ts
// WS envelope: { t: <type>, d: <payload> }. Mirrors backend docs/contracts.md.

export interface Frame<T = unknown> {
  t: string
  d?: T
}

// Client -> server
export interface SendMessageFrame {
  chat_id: number
  type?: string
  text?: string
  reply_to_id?: number | null
  client_msg_id: string
  media_id?: number | null
}
export interface ReadFrame { chat_id: number; up_to_seq: number }
export interface TypingFrame { chat_id: number }

// Server -> client
export interface MessageAck { client_msg_id: string; msg_id: number; seq: number; created_at: string }
export interface NewMessage {
  chat_id: number; msg_id: number; seq: number; sender_id: number
  type: string; text: string; media_id: number | null; created_at: string
}
export interface ReadReceipt { chat_id: number; user_id: number; up_to_seq: number }
export interface TypingEvent { chat_id: number; user_id: number }
export interface PresenceEvent { user_id: number; online: boolean; last_seen: number }
export interface ReactionEvent { chat_id: number; msg_id: number; user_id: number; emoji: string; action: 'add' | 'remove' }

export const encodeFrame = (t: string, d?: unknown): string => JSON.stringify({ t, d })
export const decodeFrame = (raw: string): Frame => JSON.parse(raw) as Frame
```

- [ ] **Step 2: Build check + commit**

Run: `cd telegram-ui-clone && npx tsc --noEmit` (expect clean).
```bash
git add src/protocol/frames.ts && git commit -m "feat: WS frame protocol types"
```

---

### Task 3: RPC — SuperMessagePort

**Files:** Create `src/rpc/superMessagePort.ts`, `src/rpc/superMessagePort.test.ts`.

- [ ] **Step 1: Write the failing test (RPC round-trip over a MessageChannel)**

Create `src/rpc/superMessagePort.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { SuperMessagePort } from './superMessagePort'

describe('SuperMessagePort', () => {
  it('invokes a handler on the other end and resolves with its result', async () => {
    const ch = new MessageChannel()
    const a = new SuperMessagePort(ch.port1)
    const b = new SuperMessagePort(ch.port2)
    b.handle('sum', async (p: { x: number; y: number }) => p.x + p.y)

    await expect(a.invoke<number>('sum', { x: 2, y: 3 })).resolves.toBe(5)
  })

  it('rejects when the handler throws', async () => {
    const ch = new MessageChannel()
    const a = new SuperMessagePort(ch.port1)
    const b = new SuperMessagePort(ch.port2)
    b.handle('boom', async () => { throw new Error('nope') })

    await expect(a.invoke('boom', {})).rejects.toThrow('nope')
  })

  it('delivers events to on() listeners', async () => {
    const ch = new MessageChannel()
    const a = new SuperMessagePort(ch.port1)
    const b = new SuperMessagePort(ch.port2)
    const got: number[] = []
    a.on<number>('tick', (n) => got.push(n))
    b.emit('tick', 7)
    await new Promise((r) => setTimeout(r, 10))
    expect(got).toEqual([7])
  })
})
```

- [ ] **Step 2: Run → fails** (`SuperMessagePort` undefined). `cd telegram-ui-clone && npm test -- superMessagePort`.

- [ ] **Step 3: Implement**

Create `src/rpc/superMessagePort.ts`:
```ts
// Minimal typed RPC over a MessagePort-like endpoint. Works with a MessagePort,
// a SharedWorker port, or a Worker (all expose postMessage + addEventListener).

export interface Endpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void
  start?: () => void
}

type Task =
  | { kind: 'invoke'; id: number; type: string; payload: unknown }
  | { kind: 'result'; id: number; result?: unknown; error?: string }
  | { kind: 'event'; event: string; payload: unknown }

export class SuperMessagePort {
  private nextId = 1
  private awaiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private handlers = new Map<string, (payload: unknown) => unknown | Promise<unknown>>()
  private listeners = new Map<string, Array<(payload: unknown) => void>>()

  constructor(private ep: Endpoint) {
    ep.addEventListener('message', this.onMessage)
    ep.start?.()
  }

  /** UI side: call a handler registered on the other end. */
  invoke<R = unknown>(type: string, payload: unknown, transfer?: Transferable[]): Promise<R> {
    const id = this.nextId++
    const p = new Promise<R>((resolve, reject) => {
      this.awaiting.set(id, { resolve: resolve as (v: unknown) => void, reject })
    })
    this.post({ kind: 'invoke', id, type, payload }, transfer)
    return p
  }

  /** Worker side: register a handler for an invoke type. */
  handle(type: string, fn: (payload: unknown) => unknown | Promise<unknown>): void {
    this.handlers.set(type, fn)
  }

  /** Subscribe to pushed events. */
  on<T = unknown>(event: string, cb: (payload: T) => void): void {
    const arr = this.listeners.get(event) ?? []
    arr.push(cb as (p: unknown) => void)
    this.listeners.set(event, arr)
  }

  /** Push an event to the other end. */
  emit(event: string, payload: unknown): void {
    this.post({ kind: 'event', event, payload })
  }

  private post(task: Task, transfer?: Transferable[]) {
    this.ep.postMessage(task, transfer)
  }

  private onMessage = async (ev: MessageEvent) => {
    const task = ev.data as Task
    if (!task || typeof task !== 'object') return
    if (task.kind === 'invoke') {
      const fn = this.handlers.get(task.type)
      if (!fn) { this.post({ kind: 'result', id: task.id, error: `no handler: ${task.type}` }); return }
      try {
        const result = await fn(task.payload)
        this.post({ kind: 'result', id: task.id, result })
      } catch (e) {
        this.post({ kind: 'result', id: task.id, error: e instanceof Error ? e.message : String(e) })
      }
    } else if (task.kind === 'result') {
      const d = this.awaiting.get(task.id)
      if (!d) return
      this.awaiting.delete(task.id)
      if (task.error) d.reject(new Error(task.error))
      else d.resolve(task.result)
    } else if (task.kind === 'event') {
      for (const cb of this.listeners.get(task.event) ?? []) cb(task.payload)
    }
  }
}
```

- [ ] **Step 4: Run → pass.** `npm test -- superMessagePort`.

- [ ] **Step 5: Commit**
```bash
git add src/rpc/superMessagePort.ts src/rpc/superMessagePort.test.ts && git commit -m "feat: SuperMessagePort RPC over MessagePort"
```

---

### Task 4: managers proxy

**Files:** Create `src/rpc/managersProxy.ts`, `src/rpc/managersProxy.test.ts`.

- [ ] **Step 1: Failing test**

`src/rpc/managersProxy.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { SuperMessagePort } from './superMessagePort'
import { createManagers, registerManagers } from './managersProxy'

describe('managers proxy', () => {
  it('routes managers.x.y(args) to the registered manager method', async () => {
    const ch = new MessageChannel()
    const ui = new SuperMessagePort(ch.port1)
    const worker = new SuperMessagePort(ch.port2)
    registerManagers(worker, {
      health: { async check() { return { status: 'ok' } } },
    })
    const managers = createManagers<{ health: { check(): Promise<{ status: string }> } }>(ui)
    await expect(managers.health.check()).resolves.toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 2: Run → fails.** `npm test -- managersProxy`.

- [ ] **Step 3: Implement**

`src/rpc/managersProxy.ts`:
```ts
import type { SuperMessagePort } from './superMessagePort'

interface ManagerCall { name: string; method: string; args: unknown[] }

/** Worker side: dispatch invoke('manager', {name,method,args}) to a manager object. */
export function registerManagers(smp: SuperMessagePort, registry: Record<string, Record<string, (...a: unknown[]) => unknown>>): void {
  smp.handle('manager', (payload) => {
    const { name, method, args } = payload as ManagerCall
    const mgr = registry[name]
    if (!mgr || typeof mgr[method] !== 'function') throw new Error(`no manager method: ${name}.${method}`)
    return mgr[method](...args)
  })
}

/** UI side: managers.<name>.<method>(...args) -> RPC invoke. */
export function createManagers<T extends object>(smp: SuperMessagePort): T {
  return new Proxy({}, {
    get: (_t, name: string) =>
      new Proxy({}, {
        get: (_t2, method: string) =>
          (...args: unknown[]) => smp.invoke('manager', { name, method, args }),
      }),
  }) as T
}
```

- [ ] **Step 4: Run → pass.** `npm test -- managersProxy`.

- [ ] **Step 5: Commit**
```bash
git add src/rpc/managersProxy.ts src/rpc/managersProxy.test.ts && git commit -m "feat: managers RPC proxy"
```

---

### Task 5: REST client + health manager + WS client

**Files:** Create `src/core/net/restClient.ts` (+test), `src/core/net/wsClient.ts`, `src/core/managers/healthManager.ts`.

- [ ] **Step 1: Failing test for RestClient**

`src/core/net/restClient.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { RestClient } from './restClient'

describe('RestClient', () => {
  it('GETs with the bearer token and parses JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const rest = new RestClient('/api', () => 'tok123')

    const out = await rest.get<{ status: string }>('/health')
    expect(out).toEqual({ status: 'ok' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/health')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok123' })
  })

  it('throws on non-2xx with the error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid code' }), { status: 401 })))
    const rest = new RestClient('/api', () => null)
    await expect(rest.post('/auth/sign_in', {})).rejects.toThrow('invalid code')
  })
})
```

- [ ] **Step 2: Run → fails.** `npm test -- restClient`.

- [ ] **Step 3: Implement RestClient**

`src/core/net/restClient.ts`:
```ts
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export class RestClient {
  constructor(private base: string, private getToken: () => string | null) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    const tok = this.getToken()
    if (tok) h.Authorization = `Bearer ${tok}`
    return h
  }

  async get<R>(path: string, query?: Record<string, string | number>): Promise<R> {
    const qs = query ? '?' + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString() : ''
    return this.request<R>('GET', path + qs)
  }

  async post<R>(path: string, body: unknown): Promise<R> {
    return this.request<R>('POST', path, body)
  }

  async del<R>(path: string): Promise<R> {
    return this.request<R>('DELETE', path)
  }

  private async request<R>(method: string, path: string, body?: unknown): Promise<R> {
    const res = await fetch(this.base + path, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : undefined
    if (!res.ok) throw new HttpError(res.status, (data && data.error) || `HTTP ${res.status}`)
    return data as R
  }
}
```

- [ ] **Step 4: Run → pass.** `npm test -- restClient`.

- [ ] **Step 5: WS client (thin)**

`src/core/net/wsClient.ts`:
```ts
import { decodeFrame, encodeFrame, type Frame } from '../../protocol/frames'

// Thin WS wrapper: connect to /ws?token=, JSON frames in/out, frame listeners.
// The reconnect FSM + heartbeat come in a later slice (F3).
export class WsClient {
  private ws: WebSocket | null = null
  private listeners = new Map<string, Array<(d: unknown) => void>>()

  constructor(private url: string) {}

  connect(token: string): void {
    this.ws = new WebSocket(`${this.url}?token=${encodeURIComponent(token)}`)
    this.ws.onmessage = (ev) => {
      const f: Frame = decodeFrame(typeof ev.data === 'string' ? ev.data : '')
      for (const cb of this.listeners.get(f.t) ?? []) cb(f.d)
    }
  }

  on(type: string, cb: (d: unknown) => void): void {
    const arr = this.listeners.get(type) ?? []
    arr.push(cb)
    this.listeners.set(type, arr)
  }

  send(t: string, d?: unknown): void {
    this.ws?.send(encodeFrame(t, d))
  }

  close(): void {
    this.ws?.close()
    this.ws = null
  }
}
```

- [ ] **Step 6: health manager**

`src/core/managers/healthManager.ts`:
```ts
import type { RestClient } from '../net/restClient'

export interface HealthStatus { status: string }

// Proves the UI -> worker -> REST -> backend pipeline.
export function newHealthManager(rest: RestClient) {
  return {
    async check(): Promise<HealthStatus> {
      return rest.get<HealthStatus>('/health')
    },
  }
}
```

- [ ] **Step 7: Build + commit**

Run: `cd telegram-ui-clone && npx tsc --noEmit && npm test`
```bash
git add src/core/net/ src/core/managers/healthManager.ts && git commit -m "feat: REST client + WS client + health manager"
```

---

### Task 6: Core Worker entry + client bootstrap + connection store + wire-up

**Files:** Create `src/core/worker.ts`, `src/client/bootstrap.ts`, `src/stores/connectionStore.ts`; modify `src/App.tsx` (mount the bootstrap + a tiny status indicator).

- [ ] **Step 1: Add zustand**

Run: `cd telegram-ui-clone && npm i zustand`

- [ ] **Step 2: Core Worker entry**

`src/core/worker.ts`:
```ts
/// <reference lib="webworker" />
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { registerManagers } from '../rpc/managersProxy'
import { RestClient } from './net/restClient'
import { newHealthManager } from './managers/healthManager'

// Token storage lives in the worker (later slices persist it; for now in-memory).
let token: string | null = null
const rest = new RestClient('/api', () => token)

function bind(ep: Endpoint) {
  const smp = new SuperMessagePort(ep)
  registerManagers(smp, {
    health: newHealthManager(rest),
  })
}

// SharedWorker: a port per connecting tab. Worker fallback: the global scope.
const g = self as unknown as {
  onconnect?: (e: MessageEvent) => void
  postMessage?: (m: unknown) => void
  addEventListener: (t: string, cb: (e: MessageEvent) => void) => void
}
if ('onconnect' in g) {
  g.onconnect = (e: MessageEvent) => bind((e as MessageEvent & { ports: MessagePort[] }).ports[0])
} else {
  bind(g as unknown as Endpoint) // dedicated Worker: the global scope is the endpoint
}
```

- [ ] **Step 3: Client bootstrap (main thread)**

`src/client/bootstrap.ts`:
```ts
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { createManagers } from '../rpc/managersProxy'
import type { HealthStatus } from '../core/managers/healthManager'

export interface Managers {
  health: { check(): Promise<HealthStatus> }
}

let cached: { smp: SuperMessagePort; managers: Managers } | null = null

export function startClient(): { smp: SuperMessagePort; managers: Managers } {
  if (cached) return cached
  const url = new URL('../core/worker.ts', import.meta.url)
  let ep: Endpoint
  if (typeof SharedWorker !== 'undefined') {
    const w = new SharedWorker(url, { type: 'module' })
    ep = w.port
  } else {
    ep = new Worker(url, { type: 'module' }) as unknown as Endpoint
  }
  const smp = new SuperMessagePort(ep)
  const managers = createManagers<Managers>(smp)
  cached = { smp, managers }
  return cached
}
```

- [ ] **Step 4: connection store**

`src/stores/connectionStore.ts`:
```ts
import { create } from 'zustand'
import type { HealthStatus } from '../core/managers/healthManager'

interface ConnectionState {
  backendOk: boolean | null
  setBackendOk: (ok: boolean) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  backendOk: null,
  setBackendOk: (ok) => set({ backendOk: ok }),
}))

// Ping the backend through the worker; called once at startup.
export async function pingBackend(managers: { health: { check(): Promise<HealthStatus> } }): Promise<void> {
  try {
    const h = await managers.health.check()
    useConnectionStore.getState().setBackendOk(h.status === 'ok')
  } catch {
    useConnectionStore.getState().setBackendOk(false)
  }
}
```

- [ ] **Step 5: Wire into App.tsx (mount + tiny indicator)**

In `src/App.tsx`, near the top of the component, add a one-time effect that starts the client and pings the backend, and render a small dev badge. Add the imports and inside the component:
```ts
// imports
import { useEffect } from 'react'
import { startClient } from './client/bootstrap'
import { useConnectionStore, pingBackend } from './stores/connectionStore'
```
```tsx
// inside the App component body:
const backendOk = useConnectionStore((s) => s.backendOk)
useEffect(() => {
  const { managers } = startClient()
  void pingBackend(managers)
}, [])
```
And render (anywhere visible, e.g. just inside the root fragment) a tiny fixed badge:
```tsx
<div style={{ position: 'fixed', bottom: 6, right: 8, zIndex: 9999, fontSize: 11, padding: '2px 6px', borderRadius: 6,
  background: backendOk == null ? '#888' : backendOk ? '#1a7f37' : '#b3261e', color: '#fff' }}>
  api: {backendOk == null ? '…' : backendOk ? 'ok' : 'down'}
</div>
```
(If `useEffect`/`useState` are already imported, don't duplicate.)

- [ ] **Step 6: Build + commit**

Run: `cd telegram-ui-clone && npx tsc --noEmit && npm run build:watch` is not needed; do `npx vite build --base=/ --outDir ../client-build --emptyOutDir` to confirm the worker bundles (Vite handles `new SharedWorker(new URL(...))`). Expected: build succeeds, emits a worker chunk.
```bash
git add src/core/worker.ts src/client/bootstrap.ts src/stores/connectionStore.ts src/App.tsx package.json package-lock.json && git commit -m "feat: core worker bootstrap + connection store + api health badge"
```

---

### Task 7: End-to-end verification (worker → /api/health → badge)

**Files:** none.

- [ ] **Step 1: Unit suite green**

Run: `cd telegram-ui-clone && npm test` → all tests pass (superMessagePort, managersProxy, restClient).

- [ ] **Step 2: Live check through nginx**

Build the frontend and bring up the stack:
```bash
cd telegram-ui-clone && npx vite build --base=/ --outDir ../client-build --emptyOutDir
cd .. && docker compose up -d --build   # or an isolated project on a free port if 8080 is taken
```
Open `http://localhost:8080` (or the mapped port). Expected: the page loads and the bottom-right badge shows **api: ok** (the worker called `/api/health` via the nginx proxy → backend). If the badge is red, check the browser console + `docker compose logs nginx backend`.

- [ ] **Step 3:** No code changes expected. Fix under the relevant task if the badge is not green.

---

## Self-Review Notes

- **Spec coverage:** F0 — Core Worker (SharedWorker + Worker fallback), RPC (`SuperMessagePort` + managers proxy), zustand store — Tasks 3,4,6. F1 — protocol frame types (mirroring contracts.md), REST client, WS client (thin) — Tasks 2,5. End-to-end proof (UI→worker→/api) — Tasks 5–7.
- **Out of scope (next slices):** auth/login (F2), ConnectionManager FSM + heartbeat + ack/dedup/resend (F3), SyncEngine/pts (F4), real chats/messages replacing `data.ts` mocks (F5+), IndexedDB, Service Worker media, Web Push. `data.ts` is untouched here.
- **Contract alignment:** frame types + REST paths follow `docs/contracts.md` (envelope `{t,d}`, `/api` prefix, bearer token, `{error}` bodies). The health manager exercises the real `/api/health`.
- **Testing:** pure RPC/proxy/REST logic is unit-tested with vitest over a `MessageChannel` + mocked `fetch` (no worker/network needed); the SharedWorker boot is proven by the live badge.
- **Type consistency:** `SuperMessagePort` (invoke/handle/on/emit), `Endpoint`, `createManagers`/`registerManagers`, `RestClient` (get/post/del + HttpError), `WsClient`, `newHealthManager`/`HealthStatus`, `startClient`/`Managers`, `useConnectionStore`/`pingBackend` consistent across tasks.
```
