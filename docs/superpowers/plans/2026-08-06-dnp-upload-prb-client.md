# DNP upload PR-b (client): sendBinary + fileUpload offset-стрим + разводка mediaManager

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> Шаги — чекбоксы.

**Goal:** Клиент грузит байты медиа через Noise-канал: стримит 512КБ-чанки `file_up` по offset
(stop-and-wait), при DNP-ON вместо `rest.putBytes`. После этого медиа-HTTP исчезает.

**Architecture:** `Transport.sendBinary` (бинарь kind 0x02); `core/net/dnp/fileUpload.ts`
(зеркало `fileDownload`): собирает 28Б-заголовок `file_up`, шлёт через `sendBinary`,
корреляция ack `file_up_ok`/`file_up_err` по `req_id`, `uploadStream` крутит offset-цикл.
Разводка `mediaManager.upload` (DNP-ON → `fileUpload.uploadStream`, без finalize — бэкенд
собирает объект + авто-процессинг на последнем чанке) + инжекция в `worker.ts`.

**Tech Stack:** TS strict, vitest. Backend — PR-a′ (#138, готов): принимает `file_up` offset,
собирает объект `io.Pipe→PutObject`, ack `file_up_ok`.

Дизайн: `docs/superpowers/specs/2026-08-06-dnp-file-exchange-design.md`.

## Global Constraints

- TS strict, без `any` в проде.
- **Wire (BE, заголовок 28Б):** `req_id(u32)@0 │ media_id(u64)@4 │ offset(u64)@12 │ total(u64)@20 │
  data@28`. Зеркало сервера `parseFileUp` (PR-a′). `sendBinary` клеит kind-байт 0x02 + seal.
- **Чанк 512КБ** (`UPLOAD_CHUNK = 512*1024`) — = серверный `maxFileUpChunk`; sealed-кадр < read-limit 1МБ.
- **Stop-and-wait:** следующий чанк — только после `file_up_ok` предыдущего (сервер требует порядок).
- **Флаг-off / канал не готов:** `fileUpload` отсутствует ИЛИ `!isReady()` → HTTP-путь (putBytes/
  uploadChunked) как сейчас. DNP-ON + канал готов → стрим по каналу.
- **DNP-путь НЕ зовёт finalize** (бэкенд авто-процессит на последнем чанке); HTTP-путь — как есть.
- Прогресс (`media:upload_progress`) и отмена (`AbortController`) сохранены.

---

### Task 1: Transport.sendBinary (kind 0x02) + DnpTransport + WsClient no-op

**Files:**
- Modify: `web-client/src/core/net/transport.ts`
- Modify: `web-client/src/core/net/dnp/dnpTransport.ts`
- Modify: `web-client/src/core/net/wsClient.ts`
- Test: `web-client/src/core/net/dnp/dnpTransport.test.ts`

**Interfaces:**
- Produces: `Transport.sendBinary(data: Uint8Array): void` — `DnpTransport` шлёт
  `sealFrame(withKind(0x02, data))`; `WsClient` — no-op.

- [ ] **Step 1: Тест — sendBinary шлёт sealed-кадр с kind 0x02**

В `dnpTransport.test.ts` (рядом с существующими; фикстура/инъекция эфемерала уже есть):
```ts
it('sendBinary отправляет sealed-кадр с kind 0x02', () => {
  // t — DnpTransport в состоянии ready (как в существующем тесте send); FakeWS ловит .sent
  const ws = FakeWS.instances[0]
  const before = ws.sent.length
  t.sendBinary(new Uint8Array([1, 2, 3]))
  expect(ws.sent.length).toBe(before + 1)
  // первый расшифрованный байт plaintext = 0x02 (проверить через тот же cipher, что и в send-тесте,
  // ИЛИ — если проще — замокать sealFrame/cipher как в соседних тестах и проверить, что withKind получил 0x02)
})
```
(Опирайся на фактическую механику существующего `send`-теста в этом файле — как он проверяет
исходящий кадр. Повтори её для sendBinary с kind 0x02. Не изобретай новую обвязку.)

- [ ] **Step 2: Запустить — упадёт (sendBinary нет)**

Run: `cd web-client && npx vitest run src/core/net/dnp/dnpTransport.test.ts -t sendBinary`
Expected: FAIL.

- [ ] **Step 3: Реализация**

`transport.ts` — добавить в интерфейс:
```ts
sendBinary(data: Uint8Array): void
```

`dnpTransport.ts` — константа рядом с `KIND_FILE`:
```ts
const KIND_FILE_UP = 0x02
```
и метод (рядом с `send`):
```ts
// sendBinary — бинарный кадр kind 0x02 (file_up). data — уже готовый payload (28Б-заголовок +
// байты чанка), клеим kind и запечатываем. Активен только когда канал ready.
sendBinary(data: Uint8Array): void {
  if (this.state !== 'ready' || !this.cipherSend) return
  this.ws!.send(sealFrame(this.cipherSend, withKind(KIND_FILE_UP, data)) as BufferSource)
}
```

`wsClient.ts` — no-op (DNP-only), рядом с прочими методами:
```ts
sendBinary(): void { /* DNP-only: plain-WS не шлёт бинарные file_up-кадры */ }
```

- [ ] **Step 4: Запустить — зелёные (весь файл)**

Run: `cd web-client && npx vitest run src/core/net/dnp/dnpTransport.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/transport.ts web-client/src/core/net/dnp/dnpTransport.ts web-client/src/core/net/wsClient.ts web-client/src/core/net/dnp/dnpTransport.test.ts
git commit -m "feat(dnp): Transport.sendBinary (kind 0x02 file_up) + WsClient no-op"
```

---

### Task 2: fileUpload.ts — offset-стрим 512КБ, корреляция ack, uploadStream

**Files:**
- Create: `web-client/src/core/net/dnp/fileUpload.ts`
- Test: `web-client/src/core/net/dnp/fileUpload.test.ts`

**Interfaces:**
- Consumes: `Transport.sendBinary`, `Transport.on('file_up_ok'|'file_up_err')`, `onClose`, `isOpen`.
- Produces: `newFileUpload(transport)` →
  - `isReady(): boolean` (= transport.isOpen);
  - `uploadStream(mediaId: number, blob: Blob, total: number, onProgress?: (loaded:number,total:number)=>void, signal?: AbortSignal): Promise<void>`.

- [ ] **Step 1: Тест — uploadStream шлёт чанки по offset, ждёт ack, зовёт прогресс**

```ts
import { describe, it, expect, vi } from 'vitest'
import { newFileUpload } from './fileUpload'

// фейк transport: копит sendBinary-кадры, позволяет вручную «прислать» file_up_ok по req_id.
function fakeTransport() {
  const okCbs: Array<(d: unknown) => void> = []
  const errCbs: Array<(d: unknown) => void> = []
  const closeCbs: Array<() => void> = []
  const frames: Uint8Array[] = []
  return {
    isOpen: () => true,
    sendBinary: (d: Uint8Array) => frames.push(d),
    on: (t: string, cb: (d: unknown) => void) => { if (t === 'file_up_ok') okCbs.push(cb); else if (t === 'file_up_err') errCbs.push(cb) },
    onClose: (cb: () => void) => closeCbs.push(cb),
    onBinary: () => {}, onOpen: () => {}, onError: () => {}, connect: () => {}, close: () => {}, send: () => {},
    // helpers
    frames, ackOk: (reqId: number) => okCbs.forEach((cb) => cb({ req_id: reqId })),
    ackErr: (reqId: number, error: string) => errCbs.forEach((cb) => cb({ req_id: reqId, error })),
    fireClose: () => closeCbs.forEach((cb) => cb()),
  }
}

// прочитать заголовок кадра (28Б BE): req_id, media_id, offset, total
function parseFrame(f: Uint8Array) {
  const dv = new DataView(f.buffer, f.byteOffset, f.byteLength)
  return { reqId: dv.getUint32(0, false), mediaId: Number(dv.getBigUint64(4, false)), offset: Number(dv.getBigUint64(12, false)), total: Number(dv.getBigUint64(20, false)), len: f.byteLength - 28 }
}

it('uploadStream шлёт чанки по offset, stop-and-wait, прогресс', async () => {
  const t = fakeTransport()
  const fu = newFileUpload(t as never)
  const blob = new Blob([new Uint8Array(10)]) // 10 байт; при UPLOAD_CHUNK маленьком для теста см. ниже
  const prog: Array<[number, number]> = []
  // Запускаем стрим; будем аккать по мере поступления кадров.
  const p = fu.uploadStream(5, blob, 10, (l, tot) => prog.push([l, tot]))
  // stop-and-wait: должен уйти РОВНО один кадр (offset 0), ждёт ack
  await Promise.resolve()
  expect(t.frames.length).toBe(1)
  const f0 = parseFrame(t.frames[0]); expect(f0.mediaId).toBe(5); expect(f0.offset).toBe(0); expect(f0.total).toBe(10)
  t.ackOk(f0.reqId)
  await Promise.resolve(); await Promise.resolve()
  // если файл влез в один чанк (10 < UPLOAD_CHUNK) — стрим завершён после первого ack
  await p
  expect(prog.at(-1)).toEqual([10, 10])
})
```

Примечание: `UPLOAD_CHUNK` в проде = 512КБ. Чтобы тест проверил МНОГОЧАНКОВЫЙ путь, экспортируй
`UPLOAD_CHUNK` ИЛИ сделай его параметром для тестируемости (напр. `newFileUpload(transport, chunk = UPLOAD_CHUNK)`),
и в отдельном тесте передай маленький chunk (напр. 4) на 10-байтном blob → 3 чанка (offset 0,4,8),
проверь offset'ы и что каждый ждёт ack перед следующим.

- [ ] **Step 2: Тест — file_up_err реджектит; onClose реджектит in-flight**

```ts
it('file_up_err реджектит uploadStream', async () => {
  const t = fakeTransport(); const fu = newFileUpload(t as never, 4)
  const p = fu.uploadStream(5, new Blob([new Uint8Array(10)]), 10)
  await Promise.resolve()
  const f0 = parseFrame(t.frames[0]); t.ackErr(f0.reqId, 'forbidden')
  await expect(p).rejects.toThrow(/forbidden/i)
})

it('onClose реджектит in-flight uploadStream', async () => {
  const t = fakeTransport(); const fu = newFileUpload(t as never, 4)
  const p = fu.uploadStream(5, new Blob([new Uint8Array(10)]), 10)
  await Promise.resolve()
  t.fireClose()
  await expect(p).rejects.toThrow()
})
```

- [ ] **Step 3: Запустить — упадёт**

Run: `cd web-client && npx vitest run src/core/net/dnp/fileUpload.test.ts`

- [ ] **Step 4: Реализация `fileUpload.ts`**

```ts
import type { Transport } from '../transport'

export const UPLOAD_CHUNK = 512 * 1024
const UPLOAD_TIMEOUT_MS = 30_000

interface Pending { resolve: () => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }

// buildFileUpFrame — 28Б BE заголовок + data (зеркало сервера parseFileUp).
function buildFileUpFrame(reqId: number, mediaId: number, offset: number, total: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(28 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, reqId, false)
  dv.setBigUint64(4, BigInt(mediaId), false)
  dv.setBigUint64(12, BigInt(offset), false)
  dv.setBigUint64(20, BigInt(total), false)
  out.set(data, 28)
  return out
}

// newFileUpload — загрузка медиа стримом чанков через DNP-канал (зеркало fileDownload).
// file_up (бинарь kind 0x02) → ack file_up_ok/file_up_err по req_id. Активен только при DNP-ON.
export function newFileUpload(transport: Transport, chunk: number = UPLOAD_CHUNK) {
  const pending = new Map<number, Pending>()
  let seq = 0

  transport.on('file_up_ok', (d) => {
    const r = d as { req_id?: number }
    if (typeof r?.req_id !== 'number') return
    const p = pending.get(r.req_id); if (!p) return
    clearTimeout(p.timer); pending.delete(r.req_id); p.resolve()
  })
  transport.on('file_up_err', (d) => {
    const r = d as { req_id?: number; error?: string }
    if (typeof r?.req_id !== 'number') return
    const p = pending.get(r.req_id); if (!p) return
    clearTimeout(p.timer); pending.delete(r.req_id); p.reject(new Error(r.error ?? 'file_up error'))
  })
  transport.onClose(() => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('channel closed')) }
    pending.clear()
  })

  function sendChunk(mediaId: number, offset: number, total: number, data: Uint8Array): Promise<void> {
    const reqId = (seq = (seq + 1) >>> 0)
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(reqId); reject(new Error('file_up timeout')) }, UPLOAD_TIMEOUT_MS)
      pending.set(reqId, { resolve, reject, timer })
      transport.sendBinary(buildFileUpFrame(reqId, mediaId, offset, total, data))
    })
  }

  return {
    isReady(): boolean { return transport.isOpen() },
    // uploadStream — режет blob на чанки chunk, шлёт по порядку offset (stop-and-wait: ждёт ack).
    async uploadStream(mediaId: number, blob: Blob, total: number, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void> {
      let offset = 0
      while (offset < total) {
        if (signal?.aborted) throw new Error('aborted')
        const end = Math.min(offset + chunk, total)
        const data = new Uint8Array(await blob.slice(offset, end).arrayBuffer())
        await sendChunk(mediaId, offset, total, data)
        offset = end
        onProgress?.(offset, total)
      }
    },
  }
}

export type FileUpload = ReturnType<typeof newFileUpload>
```

- [ ] **Step 5: Запустить — зелёные + tsc**

Run: `cd web-client && npx vitest run src/core/net/dnp/fileUpload.test.ts && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add web-client/src/core/net/dnp/fileUpload.ts web-client/src/core/net/dnp/fileUpload.test.ts
git commit -m "feat(dnp): fileUpload — offset-стрим 512КБ-чанков (file_up) с ack-корреляцией"
```

---

### Task 3: разводка mediaManager.upload (DNP-ON → стрим) + инжекция worker.ts

**Files:**
- Modify: `web-client/src/core/managers/mediaManager.ts`
- Modify: `web-client/src/core/worker.ts`
- Test: `web-client/src/core/managers/mediaManager.test.ts` (создать/дополнить)

**Interfaces:**
- Consumes: `FileUpload` (Task 2).
- `newMediaManager({..., fileUpload?})`; при `fileUpload?.isReady()` — `upload()` стримит по каналу
  (без finalize), иначе HTTP-путь как есть.

- [ ] **Step 1: Тест — при DNP-ON upload стримит через fileUpload, НЕ putBytes**

```ts
// Мок rest (post отдаёт media_id; putBytes — шпион, НЕ должен вызваться при DNP-ON).
// Мок fileUpload: isReady→true, uploadStream — шпион.
it('DNP-ON: upload стримит через fileUpload, не putBytes, без finalize', async () => {
  const putBytes = vi.fn()
  const uploadStream = vi.fn().mockResolvedValue(undefined)
  const post = vi.fn(async (path: string) => path === '/media/upload' ? { media_id: 77 } : ({}))
  const mm = newMediaManager({
    rest: { post, get: vi.fn(), putBytes, contentUrl: vi.fn(), mediaUrl: vi.fn() } as never,
    fileUpload: { isReady: () => true, uploadStream } as never,
  })
  const blob = new Blob([new Uint8Array(1000)])
  const id = await mm.upload({ blob, mime: 'video/mp4', size: 1000 })
  expect(id).toBe(77)
  expect(uploadStream).toHaveBeenCalledWith(77, expect.any(Blob), 1000, expect.anything(), undefined)
  expect(putBytes).not.toHaveBeenCalled()
  // finalize НЕ вызван по каналу-пути
  expect(post).not.toHaveBeenCalledWith(expect.stringContaining('/finalize'), expect.anything())
})

it('DNP-off (нет fileUpload): upload идёт по HTTP putBytes', async () => {
  const putBytes = vi.fn().mockResolvedValue(undefined)
  const post = vi.fn(async () => ({ media_id: 9 }))
  const mm = newMediaManager({ rest: { post, get: vi.fn(), putBytes, contentUrl: vi.fn(), mediaUrl: vi.fn() } as never })
  await mm.upload({ blob: new Blob([new Uint8Array(10)]), mime: 'image/png', size: 10 })
  expect(putBytes).toHaveBeenCalled()
})
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd web-client && npx vitest run src/core/managers/mediaManager.test.ts`

- [ ] **Step 3: Реализация — mediaManager**

В `newMediaManager` деструктуризацию дополнить `fileUpload?: FileUpload` (импорт типа). В `upload()`
после получения `media_id` и настройки `progress`/`ac`, ветку выбора пути заменить:
```ts
try {
  if (fileUpload?.isReady()) {
    // DNP-ON: стрим всего файла 512КБ-чанками по каналу; бэкенд собирает объект и
    // авто-процессит на последнем чанке — finalize НЕ нужен.
    const blob = a.blob ?? new Blob([a.bytes!])
    await fileUpload.uploadStream(r.media_id, blob, a.size, progress, ac?.signal)
  } else if (a.blob && a.size > CHUNK_THRESHOLD) {
    await uploadChunked(r.media_id, a.blob, a, progress, ac?.signal)
  } else {
    const bytes = a.bytes ?? await a.blob!.arrayBuffer()
    await rest.putBytes(`/media/${r.media_id}/content`, bytes, a.mime, progress, ac?.signal)
  }
} finally { ... }
```
(`RestLike` в интерфейсе mediaManager не меняется. `fileUpload` — новое опциональное поле деструктуризации.)

- [ ] **Step 4: Реализация — worker.ts инжекция**

Рядом с `const fileDownload = AppConfig.dnp.enabled ? newFileDownload(ws) : undefined` (worker.ts:65):
```ts
import { newFileUpload } from './net/dnp/fileUpload'
...
const fileUpload = AppConfig.dnp.enabled ? newFileUpload(ws) : undefined
```
и в `newMediaManager({...})` добавить `fileUpload`:
```ts
const media = newMediaManager({ rest, onUploadProgress, fileDownload, fileUpload })
```

- [ ] **Step 5: Запустить — зелёные + tsc**

Run: `cd web-client && npx vitest run src/core/managers/mediaManager.test.ts && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add web-client/src/core/managers/mediaManager.ts web-client/src/core/worker.ts web-client/src/core/managers/mediaManager.test.ts
git commit -m "feat(dnp): mediaManager стримит upload по каналу при DNP-ON (+ инжекция worker)"
```

---

### Task 4: полная проверка + stand-e2e (ручной, документируется)

- [ ] **Step 1: Полный набор + tsc + lint**

Run: `cd web-client && npx vitest run && npx tsc --noEmit && npx oxlint src/core/net/dnp/ src/core/managers/mediaManager.ts`
Expected: всё зелёное.

- [ ] **Step 2: Stand-e2e (ручной — вне субагента, инструкция для координатора)**

Пересобрать `msgrverify` client-build с DNP-ON (`VITE_DNP_ENABLED=1`), backend из main (#138).
В браузере (`chrome-devtools` MCP): отправить видео/файл в чат. Проверить:
- Network: **нет** HTTP `PUT /media/*/content|parts`; upload идёт WS-кадрами `file_up` (в
  backend-логах нет `PUT /media/.../content`, объект появляется в MinIO);
- медиа доставлено, играбельно (стрим `/dnp-stream/` 206 через канал — уже работает);
- прогресс-бар и отмена работают.
Зафиксировать результат; при провале — тикет.

---

## Self-Review

- **Покрытие дизайна:** sendBinary kind 0x02 (Task 1) ✅; offset-стрим 512КБ + ack (Task 2) ✅;
  разводка DNP-ON→стрим без finalize + инжекция (Task 3) ✅; stand-e2e (Task 4) ✅.
- **Плейсхолдеры:** нет; тест-обвязка со ссылкой на существующие (`dnpTransport.test.ts`,
  `fileDownload.ts`).
- **Типы:** заголовок 28Б `buildFileUpFrame` ↔ серверный `parseFileUp` (PR-a′) — совпадает;
  `uploadStream(mediaId, blob, total, onProgress?, signal?)` — Task 2↔Task 3 согласовано;
  `Transport.sendBinary` — Task 1↔Task 2.
- **Инвариант:** stop-and-wait (ждём ack) гарантирует порядок offset, которого требует сервер.
  Канал не готов/флаг-off → HTTP-путь (бэкенд принимает оба).
