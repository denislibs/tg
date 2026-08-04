# DNP PR-3b — клиент: RPC поверх канала (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** При DNP-ON пост-логин REST течёт через канал: `ChannelRpc` шлёт `rpc_req`/ждёт `rpc_resp` по req_id; `RestClient.request` роутит в канал, когда он готов, иначе fetch. Публичный интерфейс `RestClient` не меняется → менеджеры не трогаем. Сервер (PR-3a) уже в main.

**Architecture:** `ChannelRpc(transport)` — корреляция req_id, таймаут, reject на close. `RestClient` получает опциональный structural `channelRpc` (без импорта класса — без цикла). `worker.ts`: транспорт создаётся РАНЬШЕ, `channelRpc` строится из него при DNP-ON и передаётся в `RestClient`; тот же инстанс `ws` шарится с `connectionManager`.

**Tech Stack:** TypeScript strict (Vitest), Vite 8. Всё из `web-client/`.

**Спека:** [`../specs/2026-08-04-dnp-l4-rpc-tunnel-design.md`](../specs/2026-08-04-dnp-l4-rpc-tunnel-design.md) §4.

## Global Constraints

- **Кадры:** `rpc_req{req_id, method, path, body}` → `rpc_resp{req_id, status, body}`. `body` — JSON-значение (null если нет). Точное зеркало сервера PR-3a.
- **Туннель только когда канал ГОТОВ** (`channelRpc.isReady()` = `transport.isOpen()`): auth/логин и пре-канальный REST → fetch автоматически.
- **Медиа не трогаем:** `putBytes`/`contentUrl`/`mediaUrl` остаются на HTTP (L5).
- **Без цикла импортов:** `restClient` типизирует `channelRpc` СТРУКТУРНО (локальный интерфейс), не импортируя класс `ChannelRpc`. `channelRpc` импортирует `HttpError` из `restClient` (одностороннее).
- **Prod-инвариант:** флаг OFF → `channelRpc` не создаётся, `RestClient` работает через fetch 1:1. `createTransport()` без side-effect (connect позже).
- **TypeScript strict, без `any`** (узкие касты на unknown-payload допустимы); неиспользуемые переменные ломают сборку. Импорты в `core/net` — относительные.
- **e2e — док-шаг** (стенд), не автогейт. Автогейт: unit + typecheck + build.

## Файловая структура

- `src/core/net/dnp/channelRpc.ts` (новый) — `class ChannelRpc`.
- `src/core/net/dnp/channelRpc.test.ts` (новый).
- `src/core/net/restClient.ts` (правка) — опциональный `channelRpc`, роутинг в `request`.
- `src/core/net/restClient.test.ts` (новый) — роутинг канал vs fetch.
- `src/core/worker.ts` (правка) — поднять транспорт, построить `channelRpc`, передать в `RestClient`.

---

### Task 1: `ChannelRpc`

**Files:**
- Create: `web-client/src/core/net/dnp/channelRpc.ts`
- Create: `web-client/src/core/net/dnp/channelRpc.test.ts`

**Interfaces:**
- Consumes: `Transport` (`../transport`), `HttpError` (`../restClient`).
- Produces: `class ChannelRpc { constructor(transport: Transport); isReady(): boolean; call(method: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> }`.

- [ ] **Step 1: Написать тест (падающий)**

`web-client/src/core/net/dnp/channelRpc.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChannelRpc } from './channelRpc'
import { HttpError } from '../restClient'
import type { Transport } from '../transport'

class FakeTransport implements Transport {
  sent: Array<{ t: string; d: unknown }> = []
  private frameCbs = new Map<string, Array<(d: unknown) => void>>()
  private closeCbs: Array<() => void> = []
  private open = true
  connect(): void {}
  close(): void {}
  isOpen(): boolean { return this.open }
  onOpen(): void {}
  onClose(cb: () => void): void { this.closeCbs.push(cb) }
  onError(): void {}
  on(t: string, cb: (d: unknown) => void): void { const a = this.frameCbs.get(t) ?? []; a.push(cb); this.frameCbs.set(t, a) }
  send(t: string, d?: unknown): void { this.sent.push({ t, d }) }
  // test helpers
  emit(t: string, d: unknown): void { for (const cb of this.frameCbs.get(t) ?? []) cb(d) }
  fireClose(): void { this.open = false; for (const cb of this.closeCbs) cb() }
}

describe('ChannelRpc', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends rpc_req and resolves on the matching rpc_resp', async () => {
    const ft = new FakeTransport(); const rpc = new ChannelRpc(ft)
    const p = rpc.call('GET', '/dialogs', null)
    expect(ft.sent).toHaveLength(1)
    const sent = ft.sent[0].d as { req_id: string; method: string; path: string; body: unknown }
    expect(sent.method).toBe('GET'); expect(sent.path).toBe('/dialogs')
    ft.emit('rpc_resp', { req_id: sent.req_id, status: 200, body: { ok: true } })
    await expect(p).resolves.toEqual({ status: 200, body: { ok: true } })
  })

  it('ignores a rpc_resp with an unknown req_id (stays pending until timeout)', async () => {
    const ft = new FakeTransport(); const rpc = new ChannelRpc(ft)
    const p = rpc.call('GET', '/x', null)
    ft.emit('rpc_resp', { req_id: 'other', status: 200, body: null })
    vi.advanceTimersByTime(30_000)
    await expect(p).rejects.toBeInstanceOf(HttpError)
  })

  it('rejects pending calls when the channel closes', async () => {
    const ft = new FakeTransport(); const rpc = new ChannelRpc(ft)
    const p = rpc.call('POST', '/y', { a: 1 })
    ft.fireClose()
    await expect(p).rejects.toBeInstanceOf(HttpError)
  })

  it('isReady reflects transport.isOpen', () => {
    const ft = new FakeTransport(); const rpc = new ChannelRpc(ft)
    expect(rpc.isReady()).toBe(true)
    ft.fireClose()
    expect(rpc.isReady()).toBe(false)
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/core/net/dnp/channelRpc.test.ts`
Expected: FAIL — `./channelRpc` не существует.

- [ ] **Step 3: Реализовать**

`web-client/src/core/net/dnp/channelRpc.ts`:
```ts
import type { Transport } from '../transport'
import { HttpError } from '../restClient'

const RPC_TIMEOUT_MS = 30_000

interface Pending {
  resolve: (v: { status: number; body: unknown }) => void
  reject: (e: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

// ChannelRpc туннелит REST через DNP-канал: rpc_req → rpc_resp с корреляцией по req_id.
// Активен только при DNP-ON; RestClient зовёт его лишь когда канал готов (isReady).
export class ChannelRpc {
  private pending = new Map<string, Pending>()
  private seq = 0

  constructor(private transport: Transport) {
    transport.on('rpc_resp', (d) => this.onResp(d))
    // Обрыв канала → все in-flight запросы reject'аются (не зависать).
    transport.onClose(() => this.rejectAll('channel closed'))
  }

  isReady(): boolean { return this.transport.isOpen() }

  call(method: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const reqId = `r${++this.seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new HttpError(0, 'rpc timeout'))
      }, RPC_TIMEOUT_MS)
      this.pending.set(reqId, { resolve, reject, timer })
      this.transport.send('rpc_req', { req_id: reqId, method, path, body: body ?? null })
    })
  }

  private onResp(d: unknown): void {
    const r = d as { req_id?: string; status?: number; body?: unknown }
    if (!r || typeof r.req_id !== 'string') return
    const p = this.pending.get(r.req_id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(r.req_id)
    p.resolve({ status: r.status ?? 0, body: r.body })
  }

  private rejectAll(reason: string): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new HttpError(0, reason))
    }
    this.pending.clear()
  }
}
```

- [ ] **Step 4: Тесты зелёные + тайпчек**

Run: `npx vitest run src/core/net/dnp/channelRpc.test.ts && npm run typecheck`
Expected: PASS (4 кейса), тайпчек чист.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/dnp/channelRpc.ts web-client/src/core/net/dnp/channelRpc.test.ts
git commit -m "feat(dnp): ChannelRpc — REST over the DNP channel (req_id correlation + timeout)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Роутинг в `RestClient`

**Files:**
- Modify: `web-client/src/core/net/restClient.ts`
- Create: `web-client/src/core/net/restClient.test.ts`

**Interfaces:**
- Produces: `RestClient` конструктор с 4-м опциональным параметром `channelRpc?: { isReady(): boolean; call(method: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> }` (structural — без импорта класса `ChannelRpc`).

- [ ] **Step 1: Написать тест (падающий)**

`web-client/src/core/net/restClient.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RestClient, HttpError } from './restClient'

const channelRpc = (ready: boolean, resp: { status: number; body: unknown }) => ({
  isReady: () => ready,
  call: vi.fn(async () => resp),
})

describe('RestClient routing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('routes through the channel when channelRpc.isReady() and returns the body', async () => {
    const ch = channelRpc(true, { status: 200, body: { id: 5 } })
    const rc = new RestClient('/api', () => 'tok', undefined, ch)
    await expect(rc.get('/me')).resolves.toEqual({ id: 5 })
    expect(ch.call).toHaveBeenCalledWith('GET', '/me', undefined)
  })

  it('maps a non-2xx channel status to HttpError', async () => {
    const ch = channelRpc(true, { status: 403, body: { error: 'forbidden' } })
    const rc = new RestClient('/api', () => 'tok', undefined, ch)
    await expect(rc.get('/x')).rejects.toMatchObject({ status: 403, message: 'forbidden' })
  })

  it('falls back to fetch when channel is NOT ready', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ via: 'http' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ch = channelRpc(false, { status: 200, body: null })
    const rc = new RestClient('/api', () => 'tok', undefined, ch)
    await expect(rc.get('/me')).resolves.toEqual({ via: 'http' })
    expect(ch.call).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalled()
  })

  it('with no channelRpc uses fetch (unchanged behavior)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const rc = new RestClient('/api', () => 'tok')
    await expect(rc.post('/z', { a: 1 })).resolves.toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/core/net/restClient.test.ts`
Expected: FAIL — конструктор не принимает channelRpc / роутинга нет.

- [ ] **Step 3: Реализовать**

`web-client/src/core/net/restClient.ts` — добавить structural-тип и параметр конструктора:
```ts
// Structural-контракт канального RPC (реализуется ChannelRpc). Импортируем как тип-форму,
// а не класс, чтобы не создавать цикл restClient↔channelRpc.
export interface ChannelRpcLike {
  isReady(): boolean
  call(method: string, path: string, body: unknown): Promise<{ status: number; body: unknown }>
}
```
Конструктор:
```ts
  constructor(
    private base: string,
    private getToken: () => string | null,
    private ready?: () => Promise<void>,
    private channelRpc?: ChannelRpcLike,
  ) {}
```
`request` — в начало добавить канальную ветку (fetch-ветку оставить как есть):
```ts
  private async request<R>(method: string, path: string, body?: unknown): Promise<R> {
    // При DNP-ON и готовом канале REST идёт через Noise-канал; иначе (логин/пре-канал) — fetch.
    if (this.channelRpc?.isReady()) {
      const { status, body: respBody } = await this.channelRpc.call(method, path, body)
      if (status < 200 || status >= 300) {
        const err = respBody as { error?: string } | null
        throw new HttpError(status, err?.error ?? `HTTP ${status}`)
      }
      return respBody as R
    }
    if (this.ready) await this.ready()
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
```
`putBytes`/`contentUrl`/`mediaUrl` — НЕ трогать (медиа/HTTP).

- [ ] **Step 4: Тесты зелёные + тайпчек**

Run: `npx vitest run src/core/net/restClient.test.ts && npm run typecheck`
Expected: PASS (4 кейса), тайпчек чист.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/restClient.ts web-client/src/core/net/restClient.test.ts
git commit -m "feat(dnp): RestClient routes request() through the channel when ready, else fetch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Разводка в `worker.ts` + полный гейт

**Files:**
- Modify: `web-client/src/core/worker.ts`

**Interfaces:**
- Consumes: `createTransport` (существующий), `ChannelRpc` (Task 1), `AppConfig` (`../config/app`), `RestClient` с channelRpc (Task 2).

- [ ] **Step 1: Поднять транспорт и построить channelRpc ПЕРЕД rest**

`web-client/src/core/worker.ts` — импорты (добавить):
```ts
import { ChannelRpc } from './net/dnp/channelRpc'
import { AppConfig } from '../config/app'
```
Перед строкой `const rest = new RestClient(...)` (сейчас ~55) вставить создание транспорта и channelRpc:
```ts
// Транспорт создаём здесь (раньше — на строке ~250), чтобы RestClient получил канал.
// createTransport() — чистое создание объекта, connect() зовётся позже connectionManager'ом.
const ws = createTransport()
// channelRpc активен только при DNP-ON; иначе RestClient идёт через fetch.
const channelRpc = AppConfig.dnp.enabled ? new ChannelRpc(ws) : undefined
```
Изменить создание rest — передать channelRpc:
```ts
const rest = new RestClient('/api', () => tokens.get(), () => tokens.ready(), channelRpc)
```

- [ ] **Step 2: Убрать старое создание транспорта (строка ~250)**

Удалить строку `const ws = createTransport()` (та, что была ~250) — теперь `ws` создан выше и переиспользуется в `newConnectionManager({ ws, ... })` (~259) без изменений.
Проверь `grep -n "createTransport\|const ws =" src/core/worker.ts` — должно остаться РОВНО одно создание `ws` (новое, вверху).

- [ ] **Step 3: Полный гейт**

Run: `npm test && npm run typecheck && npm run build`
Expected: всё зелёное. Флаг OFF: `channelRpc===undefined` → `RestClient` через fetch (поведение 1:1); транспорт `WsClient`. Флаг ON: `channelRpc` построен, REST туннелится, когда канал готов.

- [ ] **Step 4: Commit**

```bash
git add web-client/src/core/worker.ts
git commit -m "feat(dnp): wire ChannelRpc into worker RestClient (transport hoisted, shared with conn)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Финальная проверка PR-3b

- [ ] `npm test && npm run typecheck && npm run build` — зелёное.
- [ ] Флаг OFF: `RestClient` через fetch 1:1; `channelRpc` не создаётся; чат работает как сейчас.
- [ ] Один инстанс `ws` (транспорт) шарится между `channelRpc` и `connectionManager`.
- [ ] Медиа (`putBytes`/`contentUrl`/`mediaUrl`) — не трогали.
- [ ] PR в `main`, ветка `feat/dnp-rpc-l4-client`.

## Стенд-e2e (ручная верификация — док-шаг)

На стенде `msgrverify` (пересобрать backend из origin/main с DNP + `DNP_SERVER_PRIVKEY`; фронт `VITE_DNP_ENABLED=1 VITE_DNP_SERVER_PUBKEYS=<pub> vite build`):
1. Залогиниться (OTP `12345`) — логин идёт по HTTP (канал ещё не готов).
2. После входа: открыть диалоги, отправить сообщение, зайти в настройки — в DevTools Network **нет новых `/api/*` fetch** (кроме медиа); WS-кадры бинарные (rpc_req/rpc_resp внутри Noise).
3. Проверить ошибочный путь (напр. несуществующий чат) — приходит корректный статус (`rpc_resp{status}` → `HttpError`), не зависает.
4. Параллельно вкладка со старым билдом (флаг OFF) — REST по HTTP, работает.

## Self-review (проверено при написании плана)

- **Покрытие спеки §4:** ChannelRpc (Task 1), RestClient-роутинг (Task 2), worker-разводка (Task 3), e2e-док-шаг. Медиа/L5 сознательно вне scope.
- **Без цикла импортов:** `restClient` объявляет `ChannelRpcLike` (structural), НЕ импортирует `ChannelRpc`; `channelRpc` импортирует `HttpError` из `restClient` — одностороннее.
- **Prod-инвариант:** флаг OFF → channelRpc undefined → fetch 1:1; `request` канальную ветку не берёт (`this.channelRpc?.isReady()` = undefined→falsy).
- **Согласованность:** `ChannelRpc.call(method,path,body)→{status,body}` (Task 1) ↔ `ChannelRpcLike` (Task 2) ↔ вызов в `request` (Task 2); `rpc_req/rpc_resp` формат ↔ сервер PR-3a (`req_id/method/path/body` ↔ `req_id/status/body`).
- **Разводка:** один `ws` (транспорт) поднят вверх, шарится channelRpc + connectionManager; `transport.on/onClose` многослушательные (сосуществуют).
