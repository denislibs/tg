# DNP SW-мост: робастность handoff'а — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> для реализации задача-за-задачей. Шаги — чекбоксы (`- [ ]`).

**Goal:** Мост SW↔SharedWorker переустанавливается автоматически при рестарте Service
Worker (и на first-load), без reload вкладки; свёрнуты follow-ups #3 (close вытесняемого
порта, отмена in-flight по таймауту).

**Architecture:** Connect-based по эталону tweb (`serviceWorker/index.service.ts`): окно
пингует SW, SW отдаёт запрос порта **только если порта нет**; SW **на своём старте**
(`clients.matchAll`) сам инициирует переустановку — это залечивает рестарт. Направление
порта не меняем (окно-mints через существующий `handoffBridgePort`).

**Tech Stack:** classic-JS (`sw.js`, `sw-bridge.js` — грузятся через `importScripts`, НЕ
ESM); TS (`dnpBridgeHandoff.ts`, `fileDownload.ts`, `streamBridge.ts`); vitest (юнит
classic-скриптов — через `new Function('self', code)`-лоадер, как в `sw-bridge.test.ts`).

Спека: `docs/superpowers/specs/2026-08-05-dnp-sw-handoff-robustness-design.md`.

## Global Constraints

- **classic-JS для `sw.js`/`sw-bridge.js`** — только `var`/`function`, без ESM-import,
  без TS-синтаксиса. Грузятся через `importScripts`.
- **Не ронять install SW.** Существующие `try/catch` вокруг `importScripts` и робастность
  push/кэша не трогать; новый код не должен кидать на install.
- **Флаг-off инвариант.** При `VITE_DNP_ENABLED!=1` `installBridgeHandoff` — no-op
  (ранний `return`), никаких пингов/слушателей; `sw.js`/`sw-bridge.js` не активируют мост.
- **DNP-wire (backend) НЕ трогаем.** Отмена (3b) — intra-bridge MessagePort-сообщение, не
  кадр к серверу.
- **tweb-faithful.** Логика «отдать порт ifNeeded» + «SW сам контактирует окна на старте» —
  как `serviceWorker/index.service.ts` (`sendMessagePortIfNeeded`, `'startup check'`).
- **Протокол моста (control-кадры без `kind` — SMP их игнорит):**
  - окно→SW: `{type:'dnp-ping'}`
  - SW→окно: `{type:'dnp-request-port'}`
  - окно→SW: `{type:'dnp-bridge-port'}` + `[port1]` (существует)
  - окно→SharedWorker: `{t:'dnp-bridge-port'}` + `[port2]` (существует)
  - SW→SharedWorker (по мосту): `{t:'file_part'|'file_part_cancel', reqId, …}`
  - SharedWorker→SW (по мосту): `{t:'file_part_ok'|'file_part_err', reqId, …}`

---

### Task 1: sw-bridge.js — hasPort(), close вытесняемого порта (3a), cancel по таймауту (3b)

**Files:**
- Modify: `web-client/public/sw-bridge.js`
- Test: `web-client/src/core/net/dnp/sw-bridge.test.ts`

**Interfaces:**
- Produces: `dnpBridge.hasPort(): boolean`; `setPort(p)` закрывает предыдущий порт;
  `requestPart` при таймауте шлёт `{t:'file_part_cancel', reqId}` по порту.
- Consumes: ничего нового.

- [ ] **Step 1: Тест — hasPort() false до setPort, true после**

```ts
// в sw-bridge.test.ts — рядом с существующими тестами, тот же Function-лоадер
it('hasPort reflects port presence', () => {
  const bridge = loadBridge() // helper из существующего файла: new Function('self', code) → self.createDnpBridge()
  expect(bridge.hasPort()).toBe(false)
  const { port1 } = new MessageChannel()
  bridge.setPort(port1)
  expect(bridge.hasPort()).toBe(true)
})
```

- [ ] **Step 2: Запустить — упадёт (hasPort не существует)**

Run: `cd web-client && npx vitest run src/core/net/dnp/sw-bridge.test.ts -t "hasPort reflects"`
Expected: FAIL (`bridge.hasPort is not a function`).

- [ ] **Step 3: Тест — повторный setPort закрывает старый порт (3a)**

```ts
it('setPort closes the superseded port', () => {
  const bridge = loadBridge()
  const a = new MessageChannel(); const b = new MessageChannel()
  const closeA = vi.spyOn(a.port1, 'close')
  bridge.setPort(a.port1)
  bridge.setPort(b.port1)          // вытесняет a.port1
  expect(closeA).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 4: Тест — таймаут requestPart шлёт file_part_cancel по порту (3b)**

```ts
it('requestPart timeout posts file_part_cancel', () => {
  vi.useFakeTimers()
  const bridge = loadBridge()
  const ch = new MessageChannel()
  const posted: any[] = []
  // перехватываем исходящие на порт: подменяем postMessage на конце SW
  const origPost = ch.port1.postMessage.bind(ch.port1)
  ch.port1.postMessage = (msg: any) => { posted.push(msg); }
  bridge.setPort(ch.port1)
  const p = bridge.requestPart(1, 0, 4096)
  p.catch(() => {}) // подавляем unhandled
  vi.advanceTimersByTime(45000)
  expect(posted.some(m => m.t === 'file_part_cancel')).toBe(true)
  vi.useRealTimers()
})
```

- [ ] **Step 5: Реализация в sw-bridge.js**

В `createDnpBridge`, внутри возвращаемого объекта и замыкания:

```js
return {
  hasPort: function () { return !!port },
  setPort: function (p) {
    if (port && port !== p && typeof port.close === 'function') {
      try { port.close() } catch (_e) { /* порт мог уже умереть */ }
    }
    port = p
    port.onmessage = onMessage
  },
  requestPart: function (mediaId, offset, limit) {
    var reqId = (seq = (seq + 1) >>> 0)
    return new Promise(function (resolve, reject) {
      if (!port) { reject(new Error('bridge: no port')); return }
      var timer = setTimeout(function () {
        pending.delete(reqId)
        // 3b: просим SharedWorker снять in-flight file_req (intra-bridge, не backend-кадр).
        try { port.postMessage({ t: 'file_part_cancel', reqId: reqId }) } catch (_e) {}
        reject(new Error('bridge timeout'))
      }, BRIDGE_TIMEOUT_MS)
      pending.set(reqId, { resolve: resolve, reject: reject, timer: timer })
      port.postMessage({ t: 'file_part', reqId: reqId, mediaId: mediaId, offset: offset, limit: limit })
    })
  },
}
```

(`setPort` заменяет прежнюю версию; `requestPart` — прежнюю; `hasPort` — новый метод.)

- [ ] **Step 6: Запустить целевые тесты — зелёные**

Run: `cd web-client && npx vitest run src/core/net/dnp/sw-bridge.test.ts`
Expected: PASS (все, включая новые 3).

- [ ] **Step 7: Commit**

```bash
git add web-client/public/sw-bridge.js web-client/src/core/net/dnp/sw-bridge.test.ts
git commit -m "feat(dnp): sw-bridge hasPort + close вытесняемого порта + cancel по таймауту"
```

---

### Task 2: fileDownload.ts — AbortSignal в requestPart/fetchFilePart* (3b, канальная сторона)

**Files:**
- Modify: `web-client/src/core/net/dnp/fileDownload.ts`
- Test: `web-client/src/core/net/dnp/fileDownload.test.ts`

**Interfaces:**
- Produces: `fetchFilePart(mediaId, offset, limit, signal?)`,
  `fetchFilePartWithTotal(mediaId, offset, limit, signal?)` — `signal?: AbortSignal`;
  по `abort` соответствующий in-flight `file_req` снимается (корреляция `req_id`
  удаляется, ожидание реджектится `Error('aborted')`), поздний `file_chunk` игнорится.
- Consumes: существующий `Transport`.

- [ ] **Step 1: Тест — abort снимает корреляцию и реджектит**

```ts
it('fetchFilePartWithTotal aborts and drops correlation', async () => {
  const t = makeFakeTransport() // существующий helper/фейк в этом тест-файле
  const fd = newFileDownload(t)
  const ac = new AbortController()
  const p = fd.fetchFilePartWithTotal(1, 0, 4096, ac.signal)
  ac.abort()
  await expect(p).rejects.toThrow(/abort/i)
  // поздний ответ на тот же req_id не должен кинуть/зарезолвить
  t.emitBinaryFor(/* reqId первого запроса */ 1, { offset: 0, total: 100, data: new Uint8Array(10) })
  // отсутствие ошибки = успех (корреляция снята)
})
```

(Если у фейка нет `emitBinaryFor`/способа узнать reqId — использовать реальный порядок:
reqId стартует с 1; помощник эмитит `onBinary`-кадр с этим reqId. При необходимости
расширить фейк минимально.)

- [ ] **Step 2: Запустить — упадёт (signal не поддержан)**

Run: `cd web-client && npx vitest run src/core/net/dnp/fileDownload.test.ts -t "aborts and drops"`
Expected: FAIL (промис не реджектится по abort).

- [ ] **Step 3: Реализация — проброс signal**

`requestPart` принимает `signal?`:

```ts
function requestPart(mediaId: number, offset: number, limit: number, signal?: AbortSignal): Promise<{ data: Uint8Array; total: number }> {
  const reqId = (seq = (seq + 1) >>> 0)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('aborted')); return }
    const timer = setTimeout(() => { pending.delete(reqId); reject(new Error('file timeout')) }, FILE_TIMEOUT_MS)
    const onAbort = () => {
      clearTimeout(timer); pending.delete(reqId); reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pending.set(reqId, {
      resolve: (v) => { signal?.removeEventListener('abort', onAbort); resolve({ data: v.data, total: v.total }) },
      reject: (e) => { signal?.removeEventListener('abort', onAbort); reject(e) },
      timer,
    })
    transport.send('file_req', { req_id: reqId, media_id: mediaId, offset, limit })
  })
}
```

Публичные обёртки принимают и прокидывают `signal`:

```ts
async fetchFilePart(mediaId: number, offset: number, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  const { data } = await requestPart(mediaId, offset, limit, signal)
  return data
},
async fetchFilePartWithTotal(mediaId: number, offset: number, limit: number, signal?: AbortSignal): Promise<{ bytes: Uint8Array; total: number }> {
  const { data, total } = await requestPart(mediaId, offset, limit, signal)
  return { bytes: data, total }
},
```

(`downloadMedia` — без signal, не трогаем: у изображений отмены нет.)

- [ ] **Step 4: Запустить — зелёные (весь файл)**

Run: `cd web-client && npx vitest run src/core/net/dnp/fileDownload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/dnp/fileDownload.ts web-client/src/core/net/dnp/fileDownload.test.ts
git commit -m "feat(dnp): AbortSignal в fetchFilePart* — отмена in-flight file_req"
```

---

### Task 3: streamBridge.ts — обработка file_part_cancel → abort in-flight (3b, worker-сторона)

**Files:**
- Modify: `web-client/src/core/net/dnp/streamBridge.ts`
- Test: `web-client/src/core/net/dnp/streamBridge.test.ts` (создать, если нет)

**Interfaces:**
- Consumes: `PartSource.fetchFilePartWithTotal(mediaId, offset, limit, signal?)` (Task 2).
- Produces: `attachStreamBridge` на `{t:'file_part_cancel', reqId}` абортит контроллер,
  заведённый для этого `reqId` при `file_part`.

- [ ] **Step 1: Тест — file_part_cancel абортит переданный signal**

```ts
import { describe, it, expect, vi } from 'vitest'
import { attachStreamBridge } from './streamBridge'

it('file_part_cancel aborts the in-flight fetch signal', async () => {
  let capturedSignal: AbortSignal | undefined
  const src = { fetchFilePartWithTotal: (_id: number, _o: number, _l: number, signal?: AbortSignal) => {
    capturedSignal = signal
    return new Promise<{ bytes: Uint8Array; total: number }>(() => {}) // виснет — ждём отмены
  } }
  const port: any = { postMessage: vi.fn(), onmessage: null }
  attachStreamBridge(port, src as any)
  port.onmessage({ data: { t: 'file_part', reqId: 7, mediaId: 1, offset: 0, limit: 4096 } })
  expect(capturedSignal?.aborted).toBe(false)
  port.onmessage({ data: { t: 'file_part_cancel', reqId: 7 } })
  expect(capturedSignal?.aborted).toBe(true)
})
```

- [ ] **Step 2: Запустить — упадёт (cancel не обрабатывается)**

Run: `cd web-client && npx vitest run src/core/net/dnp/streamBridge.test.ts`
Expected: FAIL (`capturedSignal.aborted` остаётся false).

- [ ] **Step 3: Реализация — трекинг AbortController по reqId**

```ts
interface FilePartReq { t: 'file_part'; reqId: number; mediaId: number; offset: number; limit: number }
interface FilePartCancel { t: 'file_part_cancel'; reqId: number }

export function attachStreamBridge(port: BridgePort, src: PartSource): void {
  const inflight = new Map<number, AbortController>()
  port.onmessage = async (ev: MessageEvent) => {
    const d = ev.data as Partial<FilePartReq & FilePartCancel> | null
    if (!d || typeof d.reqId !== 'number') return
    if (d.t === 'file_part_cancel') {
      const ac = inflight.get(d.reqId)
      if (ac) { ac.abort(); inflight.delete(d.reqId) }
      return
    }
    if (d.t !== 'file_part') return
    const { reqId, mediaId, offset, limit } = d as FilePartReq
    const ac = new AbortController()
    inflight.set(reqId, ac)
    try {
      const { bytes, total } = await src.fetchFilePartWithTotal(mediaId, offset, limit, ac.signal)
      const copy = bytes.slice()
      port.postMessage({ t: 'file_part_ok', reqId, bytes: copy, total }, [copy.buffer])
    } catch (e) {
      port.postMessage({ t: 'file_part_err', reqId, error: e instanceof Error ? e.message : String(e) })
    } finally {
      inflight.delete(reqId)
    }
  }
}
```

Обновить `PartSource` (сигнатура с `signal?`):

```ts
export interface PartSource {
  fetchFilePartWithTotal(mediaId: number, offset: number, limit: number, signal?: AbortSignal): Promise<{ bytes: Uint8Array; total: number }>
}
```

- [ ] **Step 4: Запустить — зелёные**

Run: `cd web-client && npx vitest run src/core/net/dnp/streamBridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/dnp/streamBridge.ts web-client/src/core/net/dnp/streamBridge.test.ts
git commit -m "feat(dnp): streamBridge отменяет in-flight по file_part_cancel"
```

---

### Task 4: dnpBridgeHandoff.ts — ping-протокол + слушатель request-port (замена one-shot push)

**Files:**
- Modify: `web-client/src/client/dnpBridgeHandoff.ts`
- Test: `web-client/src/client/dnpBridgeHandoff.test.ts` (создать)

**Interfaces:**
- Consumes: `AppConfig.dnp.enabled`; `navigator.serviceWorker`.
- Produces: `installBridgeHandoff(ep)` — пингует SW `{type:'dnp-ping'}` на boot/
  controllerchange/visibility→visible; на `{type:'dnp-request-port'}` от SW вызывает
  `handoffBridgePort(controller, ep)`. `handoffBridgePort` — без изменений.

- [ ] **Step 1: Тест — request-port от SW вызывает handoff (порты уходят обоим концам)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// AppConfig.dnp.enabled = true через мок конфига
vi.mock('../config/app', () => ({ AppConfig: { dnp: { enabled: true } } }))

it('SW dnp-request-port triggers handoff to controller and ep', async () => {
  const ctrlPost = vi.fn()
  const swListeners: Record<string, (e: any) => void> = {}
  const controller = { postMessage: ctrlPost }
  ;(globalThis as any).navigator = {
    serviceWorker: {
      controller,
      ready: Promise.resolve(),
      addEventListener: (t: string, cb: any) => { swListeners[t] = cb },
    },
  }
  ;(globalThis as any).document = { visibilityState: 'visible', addEventListener: vi.fn() }
  const ep = { postMessage: vi.fn() }
  const { installBridgeHandoff } = await import('./dnpBridgeHandoff')
  installBridgeHandoff(ep as any)
  await Promise.resolve() // дать ready.then отработать
  // boot-пинг ушёл
  expect(ctrlPost).toHaveBeenCalledWith({ type: 'dnp-ping' })
  // эмулируем ответ SW: request-port
  swListeners['message']({ data: { type: 'dnp-request-port' } })
  // handoff: контроллеру ушёл dnp-bridge-port c портом, ep — тоже
  expect(ctrlPost).toHaveBeenCalledWith(expect.objectContaining({ type: 'dnp-bridge-port' }), expect.any(Array))
  expect(ep.postMessage).toHaveBeenCalledWith(expect.objectContaining({ t: 'dnp-bridge-port' }), expect.any(Array))
})
```

- [ ] **Step 2: Запустить — упадёт (нет ping/слушателя)**

Run: `cd web-client && npx vitest run src/client/dnpBridgeHandoff.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

`handoffBridgePort` — оставить как есть. Переписать `installBridgeHandoff`:

```ts
// installBridgeHandoff — connect-based (эталон tweb serviceWorker/index.service.ts):
// окно пингует SW, SW просит порт ТОЛЬКО если его нет; SW сам инициирует то же на своём
// старте (clients.matchAll) → рестарт SW самозалечивается без reload. Окно тут — курьер:
// пингует + по запросу SW делает handoffBridgePort.
export function installBridgeHandoff(ep: Poster): void {
  if (!AppConfig.dnp.enabled || !('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker
  const ping = () => { sw.controller?.postMessage({ type: 'dnp-ping' }) }
  sw.addEventListener('message', (ev: MessageEvent) => {
    const d = ev.data as { type?: string } | null
    if (d && d.type === 'dnp-request-port' && sw.controller) handoffBridgePort(sw.controller, ep)
  })
  void sw.ready.then(() => {
    ping()
    sw.addEventListener('controllerchange', ping)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') ping()
      })
    }
  })
}
```

(Тип `Poster` и `handoffBridgePort` — без изменений.)

- [ ] **Step 4: Запустить — зелёные**

Run: `cd web-client && npx vitest run src/client/dnpBridgeHandoff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/client/dnpBridgeHandoff.ts web-client/src/client/dnpBridgeHandoff.test.ts
git commit -m "feat(dnp): ping-протокол handoff'а (окно↔SW, request-port ifNeeded)"
```

---

### Task 5: sw.js — SW сам инициирует переустановку (startup matchAll + dnp-ping) ifNeeded

**Files:**
- Modify: `web-client/public/sw.js`

**Interfaces:**
- Consumes: `dnpBridge.hasPort()` (Task 1).
- Produces: SW на старте и на `{type:'dnp-ping'}` шлёт активным окнам
  `{type:'dnp-request-port'}`, если у моста нет порта.

- [ ] **Step 1: Реализация — функция-хелпер + вызовы**

После инициализации `dnpBridge` (около строки 10) добавить хелпер и стартовый вызов:

```js
/* Переустановка моста (§ handoff-robustness, эталон tweb 'startup check'):
 * если у dnpBridge нет порта — просим активные окна переотдать. Вызывается на старте SW
 * (в т.ч. после рестарта — порт in-memory теряется) и на dnp-ping от окна. */
function requestBridgePortIfNeeded(client) {
  if (!dnpBridge || dnpBridge.hasPort()) return
  if (client) { client.postMessage({ type: 'dnp-request-port' }); return }
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    cs.forEach(function (c) { c.postMessage({ type: 'dnp-request-port' }) })
  })
}
// Стартовая инициатива SW (top-level: исполняется при каждом запуске SW, включая рестарт).
if (dnpBridge) { try { requestBridgePortIfNeeded(null) } catch (_e) {} }
```

- [ ] **Step 2: Реализация — обработка dnp-ping в message-листенере**

В существующем `self.addEventListener('message', …)` (около строки 168), рядом с веткой
`dnp-bridge-port`:

```js
if (d && d.type === 'dnp-ping') {
  requestBridgePortIfNeeded(event.source)
  return
}
```

(`event.source` — WindowClient, приславший ping; отвечаем именно ему.)

- [ ] **Step 3: Проверка сборки — sw.js попадает в билд без синтакс-ошибок**

Run: `cd web-client && VITE_DNP_ENABLED=1 VITE_DNP_SERVER_PUBKEYS=x npx vite build --outDir /tmp/hb-build`
Expected: сборка проходит; `/tmp/hb-build/sw.js` содержит `requestBridgePortIfNeeded` и
`dnp-ping`. Затем `node --check /tmp/hb-build/sw.js` → без ошибок (classic-JS валиден).

- [ ] **Step 4: Commit**

```bash
git add web-client/public/sw.js
git commit -m "feat(dnp): SW сам инициирует переустановку моста на старте+ping (restart-recovery)"
```

---

## Финальная проверка (после всех задач)

- `cd web-client && npx tsc --noEmit` — чисто.
- `cd web-client && npx vitest run` — весь набор зелёный.
- **Стенд-e2e (ручной, msgrverify DNP-ON, см. память `dnp-noise-transport`):**
  1. видео стримится (`/dnp-stream/` → 206);
  2. **DevTools → Application → Service Workers → Stop** (эмуляция рестарта) → повтор стрима
     **без reload** снова даёт 206 (мост переустановлен startup-matchAll'ом);
  3. first-load: снести SW+кэш, один reload → стрим работает без второго reload.

## Self-Review

- **Покрытие спеки:** восстановление рестарта (Task 5 startup-matchAll + Task 4 ping) ✅;
  first-load (Task 4 boot-ping) ✅; 3a close порта (Task 1) ✅; 3b отмена (Task 1 send +
  Task 3 handle + Task 2 signal) ✅.
- **Плейсхолдеры:** нет — весь код приведён.
- **Согласованность типов:** `fetchFilePartWithTotal(…, signal?)` объявлен в Task 2 и
  используется в Task 3 (`PartSource`) — совпадает; `hasPort()` объявлен в Task 1, зовётся
  в Task 5 — совпадает; control-кадры (`dnp-ping`/`dnp-request-port`/`file_part_cancel`) —
  единый список в Global Constraints, отправители/приёмники согласованы между Task 1/3/4/5.
