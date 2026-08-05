# DNP PR-2a — SW↔SharedWorker мост Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Механизм RPC-моста «дай кусок файла» между Service Worker и SharedWorker (где живёт `fileDownload` поверх DNP-канала): SW-сторона запрашивает по `MessagePort`, SharedWorker-сторона отвечает байтами+total из канала. Плюс приём-обвязка портов на обоих концах (инертна до PR-2c).

**Architecture:** Окно (PR-2c) минтит `MessageChannel` и раздаёт концы SW и SharedWorker; после handoff — прямой `SW ↔ MessagePort ↔ SharedWorker`, переживающий вкладку-брокера. Протокол: SW→worker `{t:'file_part',reqId,mediaId,offset,limit}` → worker `{t:'file_part_ok',reqId,bytes,total}` / `{t:'file_part_err',reqId,error}`. Этот PR строит и тестирует ОБЕ стороны моста + приём порта; отправку/handoff и своп `<video>/<audio>` делает PR-2c.

**Tech Stack:** TS strict (SharedWorker-сторона), plain-JS classic script (SW-сторона, `importScripts`), vitest. DNP-канал/`fileDownload` — из PR-1b.

**Спека-источник:** [`../specs/2026-08-05-dnp-pr2-sw-streaming-design.md`](../specs/2026-08-05-dnp-pr2-sw-streaming-design.md) § PR-2a.

## Global Constraints

- **Протокол моста (по MessagePort):** SW→worker `{ t:'file_part', reqId, mediaId, offset, limit }`; worker→SW `{ t:'file_part_ok', reqId, bytes, total }` (bytes = `Uint8Array`, его `ArrayBuffer` **передаётся** transferable) ИЛИ `{ t:'file_part_err', reqId, error }`. Корреляция по `reqId` (u32-счётчик SW-стороны, обёртка `(seq+1)>>>0`).
- **`reqId` — счётчик SW-стороны**, отдельный от u32 req_id DNP-канала (`fileDownload`). Не путать.
- **Таймаут SW-стороны:** `BRIDGE_TIMEOUT_MS = 45_000` (как tweb `timeout` в stream.ts).
- **SW-сторона — classic script** (`public/sw-bridge.js`, `importScripts`-совместим): определяет `self.createDnpBridge` (НЕ ES-модуль — SW у нас не module-type). Юнит-тест грузит его через `new Function('self', code)`-лоадер.
- **DNP-gated:** worker-приём и sw-приём активны лишь при наличии `fileDownload` (DNP-ON) / прихода порта. Ничего не шлёт порты до PR-2c → обвязка инертна, но не мёртвая.
- **Не трогать:** существующий `fetchFilePart`/`downloadMedia` (PR-1b), plain-WS, native-HTTP медиа, текущую логику `sw.js` (push/cache/навигация).
- **Отвечать по-русски**, комментарии как в окружающем коде. Мёртвый код не оставлять.

## File Structure

- `web-client/src/core/net/dnp/fileDownload.ts` — добавить `fetchFilePartWithTotal` (обёртка над `requestPart`).
- `web-client/src/core/net/dnp/streamBridge.ts` *(новый)* — `attachStreamBridge(port, src)`: worker-сторона моста (роутинг `file_part`→`fetchFilePartWithTotal`→`file_part_ok`/`file_part_err`).
- `web-client/public/sw-bridge.js` *(новый, classic)* — `self.createDnpBridge()` → `{ setPort, requestPart }`: SW-сторона (корреляция по reqId, таймаут).
- `web-client/src/core/worker.ts` — в `bind(ep)` raw-listener на `dnp-bridge-port` → `attachStreamBridge(ev.ports[0], fileDownload)` (инертно до PR-2c).
- `web-client/public/sw.js` — `importScripts('/sw-bridge.js')` + в `message`-хендлере `dnp-bridge-port` → `bridge.setPort(event.ports[0])` (инертно до PR-2c).
- Тесты: `fileDownload.test.ts` (правка), `streamBridge.test.ts` *(новый)*, `sw-bridge.test.ts` *(новый)*.

---

### Task 1: `fetchFilePartWithTotal` на fileDownload

**Files:**
- Modify: `web-client/src/core/net/dnp/fileDownload.ts`
- Test: `web-client/src/core/net/dnp/fileDownload.test.ts` (добавить кейс)

**Interfaces:**
- Consumes: внутренний `requestPart(mediaId, offset, limit): Promise<{ data: Uint8Array; total: number }>` (уже есть).
- Produces: метод `fetchFilePartWithTotal(mediaId: number, offset: number, limit: number): Promise<{ bytes: Uint8Array; total: number }>` в возвращаемом объекте `newFileDownload`. `FileDownload` type подхватит автоматически.

- [ ] **Step 1: Тест**

В `fileDownload.test.ts` добавить (рядом с существующим `fetchFilePart`-тестом, тот же fake-транспорт `fakeTransport`/`chunk`-хелпер):

```ts
it('fetchFilePartWithTotal отдаёт байты и total', async () => {
  const fd = newFileDownload(fakeTransport((req, reply) => {
    reply(chunk(req.req_id, req.offset, 42, new Uint8Array([9, 8, 7])))
  }) as never)
  const { bytes, total } = await fd.fetchFilePartWithTotal(5, 0, 512)
  expect(Array.from(bytes)).toEqual([9, 8, 7])
  expect(total).toBe(42)
})
```

- [ ] **Step 2: Прогнать — падает (нет метода)**

Run: `cd web-client && npx vitest run src/core/net/dnp/fileDownload.test.ts 2>&1 | tail -15`
Expected: FAIL — `fd.fetchFilePartWithTotal is not a function`.

- [ ] **Step 3: Реализовать**

В `fileDownload.ts`, в возвращаемом объекте, рядом с `fetchFilePart`:

```ts
    // Как fetchFilePart, но с total (полный размер файла) — нужно 206-стримингу
    // (Content-Range) через SW↔SharedWorker мост.
    async fetchFilePartWithTotal(mediaId: number, offset: number, limit: number): Promise<{ bytes: Uint8Array; total: number }> {
      const { data, total } = await requestPart(mediaId, offset, limit)
      return { bytes: data, total }
    },
```

- [ ] **Step 4: Прогнать — зелёный + typecheck**

Run: `cd web-client && npx vitest run src/core/net/dnp/fileDownload.test.ts 2>&1 | tail -10 && npx tsc --noEmit 2>&1 | tail -5`
Expected: PASS (новый + существующие), tsc чист.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/dnp/fileDownload.ts web-client/src/core/net/dnp/fileDownload.test.ts
git commit -m "feat(dnp): fetchFilePartWithTotal — байты+total для 206-стриминга"
```

---

### Task 2: `streamBridge.ts` — worker-сторона моста

**Files:**
- Create: `web-client/src/core/net/dnp/streamBridge.ts`
- Test: `web-client/src/core/net/dnp/streamBridge.test.ts`

**Interfaces:**
- Consumes: `fetchFilePartWithTotal` (Task 1) — через структурный тип.
- Produces:
  - `interface PartSource { fetchFilePartWithTotal(mediaId: number, offset: number, limit: number): Promise<{ bytes: Uint8Array; total: number }> }`
  - `interface BridgePort { postMessage(msg: unknown, transfer?: Transferable[]): void; onmessage: ((ev: MessageEvent) => void) | null }`
  - `function attachStreamBridge(port: BridgePort, src: PartSource): void` — ставит `port.onmessage`; на `{t:'file_part',...}` зовёт `src.fetchFilePartWithTotal` и отвечает `file_part_ok`(bytes buffer transfer)/`file_part_err`.

- [ ] **Step 1: Тест (fake порт-пара)**

`streamBridge.test.ts`. Fake-пара портов, доставляющих сообщения друг другу через `queueMicrotask` (env-независимо, без jsdom MessageChannel):

```ts
import { describe, it, expect, vi } from 'vitest'
import { attachStreamBridge, type PartSource } from './streamBridge'

// Пара связанных портов: a.postMessage → b.onmessage (и наоборот), асинхронно.
function portPair() {
  const a: any = { onmessage: null, postMessage: (msg: unknown, _t?: Transferable[]) => queueMicrotask(() => b.onmessage?.({ data: msg } as MessageEvent)) }
  const b: any = { onmessage: null, postMessage: (msg: unknown, _t?: Transferable[]) => queueMicrotask(() => a.onmessage?.({ data: msg } as MessageEvent)) }
  return { a, b }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('attachStreamBridge', () => {
  it('file_part → file_part_ok с байтами и total', async () => {
    const { a: swSide, b: workerSide } = portPair()
    const src: PartSource = { fetchFilePartWithTotal: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), total: 99 }) }
    attachStreamBridge(workerSide, src)
    const got: unknown[] = []
    swSide.onmessage = (e: MessageEvent) => got.push(e.data)
    swSide.postMessage({ t: 'file_part', reqId: 7, mediaId: 5, offset: 0, limit: 512 })
    await flush()
    expect(src.fetchFilePartWithTotal).toHaveBeenCalledWith(5, 0, 512)
    const ok = got[0] as { t: string; reqId: number; bytes: Uint8Array; total: number }
    expect(ok.t).toBe('file_part_ok'); expect(ok.reqId).toBe(7)
    expect(Array.from(ok.bytes)).toEqual([1, 2, 3]); expect(ok.total).toBe(99)
  })

  it('ошибка источника → file_part_err', async () => {
    const { a: swSide, b: workerSide } = portPair()
    const src: PartSource = { fetchFilePartWithTotal: vi.fn().mockRejectedValue(new Error('forbidden')) }
    attachStreamBridge(workerSide, src)
    const got: any[] = []
    swSide.onmessage = (e: MessageEvent) => got.push(e.data)
    swSide.postMessage({ t: 'file_part', reqId: 3, mediaId: 5, offset: 0, limit: 512 })
    await flush()
    expect(got[0].t).toBe('file_part_err'); expect(got[0].reqId).toBe(3); expect(got[0].error).toBe('forbidden')
  })
})
```

- [ ] **Step 2: Прогнать — падает (нет модуля)**

Run: `cd web-client && npx vitest run src/core/net/dnp/streamBridge.test.ts 2>&1 | tail -10`
Expected: FAIL — cannot find module `./streamBridge`.

- [ ] **Step 3: Реализовать streamBridge.ts**

```ts
// Worker-сторона SW↔SharedWorker моста (§ PR-2a). SW шлёт file_part по MessagePort —
// отвечаем байтами из DNP-канала (fileDownload) + total для Content-Range. Окно (PR-2c)
// раздаёт концы MessageChannel; после handoff окно вне пути данных.

export interface PartSource {
  fetchFilePartWithTotal(mediaId: number, offset: number, limit: number): Promise<{ bytes: Uint8Array; total: number }>
}

// Минимальная форма MessagePort (postMessage с transfer + onmessage).
export interface BridgePort {
  postMessage(msg: unknown, transfer?: Transferable[]): void
  onmessage: ((ev: MessageEvent) => void) | null
}

interface FilePartReq { t: 'file_part'; reqId: number; mediaId: number; offset: number; limit: number }

// attachStreamBridge — вешает обработчик file_part на порт: тянет чанк из канала и
// отвечает file_part_ok (buffer передаётся transferable) либо file_part_err.
export function attachStreamBridge(port: BridgePort, src: PartSource): void {
  port.onmessage = async (ev: MessageEvent) => {
    const d = ev.data as Partial<FilePartReq> | null
    if (!d || d.t !== 'file_part' || typeof d.reqId !== 'number') return
    const { reqId, mediaId, offset, limit } = d as FilePartReq
    try {
      const { bytes, total } = await src.fetchFilePartWithTotal(mediaId, offset, limit)
      // .slice() → отдельный ArrayBuffer (bytes может быть subarray-вью канала);
      // его и передаём transferable, чтобы не копировать при переходе SW-границы.
      const copy = bytes.slice()
      port.postMessage({ t: 'file_part_ok', reqId, bytes: copy, total }, [copy.buffer])
    } catch (e) {
      port.postMessage({ t: 'file_part_err', reqId, error: e instanceof Error ? e.message : String(e) })
    }
  }
}
```

- [ ] **Step 4: Прогнать — зелёный + typecheck**

Run: `cd web-client && npx vitest run src/core/net/dnp/streamBridge.test.ts 2>&1 | tail -10 && npx tsc --noEmit 2>&1 | tail -5`
Expected: PASS (2 теста), tsc чист.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/dnp/streamBridge.ts web-client/src/core/net/dnp/streamBridge.test.ts
git commit -m "feat(dnp): streamBridge — worker-сторона SW-моста (file_part→file_part_ok/err)"
```

---

### Task 3: `public/sw-bridge.js` — SW-сторона моста (classic)

**Files:**
- Create: `web-client/public/sw-bridge.js` (classic script)
- Test: `web-client/src/core/net/dnp/sw-bridge.test.ts`

**Interfaces:**
- Produces (глобаль `self.createDnpBridge`): `createDnpBridge(): { setPort(port): void; requestPart(mediaId, offset, limit): Promise<{ bytes: Uint8Array; total: number }> }`. Корреляция по reqId (u32 обёртка), таймаут `BRIDGE_TIMEOUT_MS = 45_000`. `setPort` ставит `port.onmessage` и запоминает порт для отправки.

- [ ] **Step 1: Тест (Function-лоадер classic-скрипта + fake порт)**

`sw-bridge.test.ts`. Грузим classic-скрипт через `new Function('self', code)`, ловим `self.createDnpBridge`. Fake-порт эмулирует worker-ответ:

```ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Загрузка classic-скрипта sw-bridge.js в изолированный self (как SW importScripts).
function loadBridge() {
  const path = fileURLToPath(new URL('../../../../public/sw-bridge.js', import.meta.url))
  const code = readFileSync(path, 'utf8')
  const fakeSelf: any = {}
  new Function('self', code)(fakeSelf)
  return fakeSelf.createDnpBridge as () => { setPort(p: unknown): void; requestPart(m: number, o: number, l: number): Promise<{ bytes: Uint8Array; total: number }> }
}

// Fake worker-порт: на file_part зовёт serve(), который отвечает через port.onmessage.
function workerFakePort(serve: (req: any, reply: (msg: any) => void) => void) {
  const port: any = {
    onmessage: null,
    postMessage: (msg: any) => queueMicrotask(() => serve(msg, (resp) => port.onmessage?.({ data: resp } as MessageEvent))),
  }
  return port
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('sw-bridge createDnpBridge', () => {
  it('requestPart шлёт file_part и резолвит bytes+total', async () => {
    const createDnpBridge = loadBridge()
    const bridge = createDnpBridge()
    const port = workerFakePort((req, reply) => {
      expect(req.t).toBe('file_part'); expect(req.mediaId).toBe(5)
      reply({ t: 'file_part_ok', reqId: req.reqId, bytes: new Uint8Array([4, 5, 6]), total: 77 })
    })
    bridge.setPort(port)
    const { bytes, total } = await bridge.requestPart(5, 128, 512)
    expect(Array.from(bytes)).toEqual([4, 5, 6]); expect(total).toBe(77)
  })

  it('file_part_err → reject', async () => {
    const createDnpBridge = loadBridge()
    const bridge = createDnpBridge()
    bridge.setPort(workerFakePort((req, reply) => reply({ t: 'file_part_err', reqId: req.reqId, error: 'nope' })))
    await expect(bridge.requestPart(5, 0, 512)).rejects.toThrow('nope')
  })
})
```

- [ ] **Step 2: Прогнать — падает (нет файла)**

Run: `cd web-client && npx vitest run src/core/net/dnp/sw-bridge.test.ts 2>&1 | tail -10`
Expected: FAIL — ENOENT `public/sw-bridge.js`.

- [ ] **Step 3: Реализовать sw-bridge.js (classic)**

`web-client/public/sw-bridge.js`:

```js
/* SW-сторона DNP-моста (§ PR-2a): корреляция file_part↔file_part_ok по reqId поверх
 * MessagePort к SharedWorker (где fileDownload тянет байты из Noise-канала). Classic
 * script — грузится в sw.js через importScripts (SW не module-type). Определяет
 * self.createDnpBridge. */
(function () {
  var BRIDGE_TIMEOUT_MS = 45000
  self.createDnpBridge = function () {
    var port = null
    var seq = 0
    var pending = new Map() // reqId → { resolve, reject, timer }

    function onMessage(ev) {
      var d = ev.data
      if (!d || typeof d.reqId !== 'number') return
      var p = pending.get(d.reqId)
      if (!p) return
      clearTimeout(p.timer)
      pending.delete(d.reqId)
      if (d.t === 'file_part_ok') p.resolve({ bytes: d.bytes, total: d.total })
      else if (d.t === 'file_part_err') p.reject(new Error(d.error || 'file_part error'))
    }

    return {
      setPort: function (p) {
        port = p
        port.onmessage = onMessage
      },
      // requestPart(mediaId, offset, limit) → Promise<{bytes, total}>.
      requestPart: function (mediaId, offset, limit) {
        var reqId = (seq = (seq + 1) >>> 0)
        return new Promise(function (resolve, reject) {
          if (!port) { reject(new Error('bridge: no port')); return }
          var timer = setTimeout(function () {
            pending.delete(reqId)
            reject(new Error('bridge timeout'))
          }, BRIDGE_TIMEOUT_MS)
          pending.set(reqId, { resolve: resolve, reject: reject, timer: timer })
          port.postMessage({ t: 'file_part', reqId: reqId, mediaId: mediaId, offset: offset, limit: limit })
        })
      },
    }
  }
})()
```

- [ ] **Step 4: Прогнать — зелёный**

Run: `cd web-client && npx vitest run src/core/net/dnp/sw-bridge.test.ts 2>&1 | tail -10`
Expected: PASS (2 теста).

- [ ] **Step 5: Commit**

```bash
git add web-client/public/sw-bridge.js web-client/src/core/net/dnp/sw-bridge.test.ts
git commit -m "feat(dnp): sw-bridge.js — SW-сторона моста (createDnpBridge, корреляция reqId)"
```

---

### Task 4: приём-обвязка портов (worker.ts + sw.js, инертно до PR-2c)

**Files:**
- Modify: `web-client/src/core/worker.ts`
- Modify: `web-client/public/sw.js`

**Interfaces:**
- Consumes: `attachStreamBridge` (Task 2), `self.createDnpBridge` (Task 3), `fileDownload` (worker.ts, DNP-ON).

Обвязка ПРИЁМА порта на обоих концах. Отправку/handoff из окна делает PR-2c — здесь порты никто не шлёт, поэтому обвязка инертна (но готова принять).

- [ ] **Step 1: worker.ts — raw-listener на dnp-bridge-port в bind()**

`SuperMessagePort.onMessage` игнорит сообщения без `kind` (superMessagePort.ts:92), поэтому параллельный raw-listener на том же `ep` не конфликтует. В `worker.ts` добавить импорт и хук в `bind`:

```ts
import { attachStreamBridge } from './net/dnp/streamBridge'
```
```ts
function bind(ep: Endpoint) {
  const smp = new SuperMessagePort(ep)
  ports.push(smp)
  registerManagers(smp, registry)
  // SW↔SharedWorker мост (§ PR-2a): окно (PR-2c) шлёт по этому же порту control-кадр
  // dnp-bridge-port с переданным MessagePort к SW. SMP такой кадр игнорит (нет kind) —
  // ловим сырым слушателем и подключаем мост к каналу. Активно лишь при DNP-ON.
  if (fileDownload) {
    ep.addEventListener('message', (ev: MessageEvent) => {
      const d = ev.data as { t?: string } | null
      if (d && d.t === 'dnp-bridge-port' && ev.ports && ev.ports[0]) {
        attachStreamBridge(ev.ports[0], fileDownload)
      }
    })
  }
}
```

- [ ] **Step 2: sw.js — importScripts + приём порта в message-хендлере**

В `public/sw.js`: вверху (после комментария-шапки) добавить загрузку моста и его инстанс; в существующий `message`-listener добавить ветку `dnp-bridge-port`:

```js
/* DNP-мост к SharedWorker (§ PR-2a): байты медиа для 206-стриминга. */
importScripts('/sw-bridge.js')
const dnpBridge = self.createDnpBridge()
```
В `self.addEventListener('message', (event) => { ... })` добавить (рядом с `cache-settings`):
```js
  if (d && d.type === 'dnp-bridge-port' && event.ports && event.ports[0]) {
    dnpBridge.setPort(event.ports[0])
    return
  }
```

- [ ] **Step 3: Проверить сборку/типы/тесты**

Run: `cd web-client && npx tsc --noEmit 2>&1 | tail -5 && npx vitest run src/core/net/dnp 2>&1 | tail -12 && npx vite build --outDir /tmp/pr2a-build 2>&1 | tail -4`
Expected: tsc чист (worker.ts компилируется с новым импортом/хуком); dnp-тесты зелёные; сборка ок (sw-bridge.js попадает в билд из public/, importScripts валиден).

> Примечание реализатору: `Endpoint.addEventListener` типизирован `(type:'message', listener:(ev:MessageEvent)=>void)`; `MessageEvent.ports` доступен. `sw.js` — не проходит через tsc (обычный JS в public/), проверяется только сборкой + существующими интеграционными проверками. Не менять существующую логику push/cache/навигации.

- [ ] **Step 4: Commit**

```bash
git add web-client/src/core/worker.ts web-client/public/sw.js
git commit -m "feat(dnp): приём порта моста — worker.ts raw-listener + sw.js importScripts (инертно до PR-2c)"
```

---

## Self-Review

**Spec coverage (§ PR-2a):**
- ✅ Протокол `file_part`/`file_part_ok`/`file_part_err` — Task 2 (worker) + Task 3 (SW).
- ✅ `fileDownload` отдаёт total — Task 1.
- ✅ Worker-сторона роутинга в `fetchFilePartWithTotal` — Task 2.
- ✅ SW-сторона корреляции reqId+таймаут — Task 3.
- ✅ Приём порта на обоих концах (окно-брокер получатель) — Task 4.
- ➕ Отправка/handoff из окна + своп src + e2e — НЕ здесь (PR-2c, по спеке).

**Type consistency:** `fetchFilePartWithTotal(mediaId,offset,limit)→{bytes,total}` — Task 1 объявляет, Task 2 `PartSource` потребляет, Task 4 передаёт `fileDownload`. `{t:'file_part',reqId,mediaId,offset,limit}` и `file_part_ok{reqId,bytes,total}`/`file_part_err{reqId,error}` идентичны в Task 2 (worker) и Task 3 (SW). `attachStreamBridge(port,src)` — Task 2 объявляет, Task 4 (worker.ts) зовёт. `self.createDnpBridge()→{setPort,requestPart}` — Task 3 объявляет, Task 4 (sw.js) зовёт.

**Placeholder scan:** нет TBD/«добавить обработку» — все шаги несут код или точную команду. Тестовые лоадеры (fake порт-пара, Function-лоадер classic-скрипта) выписаны полностью.
