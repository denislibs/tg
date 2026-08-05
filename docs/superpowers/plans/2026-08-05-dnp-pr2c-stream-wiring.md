# DNP PR-2c — окно-handoff + своп src + stand-e2e Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Активировать SW-стриминг end-to-end: окно раздаёт концы `MessageChannel` мосту (SW↔SharedWorker, PR-2a), а `<video>` (MediaLightbox) и `<audio>` (mediaPlaybackController) при DNP-ON получают src `/dnp-stream/{id}?size=&mime=` — байты идут через Noise-канал (PR-2b 206-хендлер). Финал L5.

**Architecture:** `client/dnpBridgeHandoff.ts` минтит `MessageChannel`, `port1`→SW (`controller.postMessage`), `port2`→SharedWorker (`ep.postMessage`) — приёмники обоих концов уже стоят (PR-2a, инертны до этого handoff). Новый `mediaManager.streamUrl(id)` — единая точка политики URL: DNP-ON→`/dnp-stream/`, DNP-off→нативный token-URL. Видео/аудио зовут его безусловно. Картинки (blob, PR-1b) и прочие `contentUrl`-консюмеры (аватары/скачивание/сторис) НЕ трогаются.

**Tech Stack:** TS strict (main+worker), plain WebSocket/MessageChannel, vitest. Мост PR-2a (#132), 206-хендлер PR-2b (#133) — смёржены.

**Спека-источник:** [`../specs/2026-08-05-dnp-pr2-sw-streaming-design.md`](../specs/2026-08-05-dnp-pr2-sw-streaming-design.md) § PR-2c.

## Global Constraints

- **Handoff-протокол:** окно шлёт `{t:'dnp-bridge-port'}` с переданным `MessagePort` — `controller.postMessage({t:'dnp-bridge-port'},[port1])` (в SW) и `ep.postMessage({t:'dnp-bridge-port'},[port2])` (в SharedWorker). Приёмники стоят с PR-2a (sw.js `message`-хендлер `dnp-bridge-port`→`dnpBridge.setPort`; worker.ts `bind` raw-listener→`attachStreamBridge`). После handoff окно вне пути данных.
- **Стрим-URL:** `/dnp-stream/{id}?size={meta.size}&mime={encodeURIComponent(meta.mime)}`; для mp4 добавить `&mp4fix=1` (Chromium AAC-esds патч; на не-Chromium/хороших файлах `tryPatchMp4`→false, безвреден).
- **Точечная разводка:** ТОЛЬКО `<video>` (MediaLightbox) и `<audio>` (mediaPlaybackController). Картинки остаются на blob (PR-1b); `contentUrl` (аватары/скачивание/сторис/GIF-video/thumb) — не трогать. GIF-в-video через native — follow-up.
- **DNP-off неизменен:** `streamUrl` при DNP-off возвращает нативный token-URL (как `contentUrl`); `resolveStreamUrl` при DNP-off делегирует в `resolveMediaContentUrl` (сохраняя sync-gesture назначение src для аудио).
- **DNP-ON сигнал в воркере:** наличие `fileDownload` (`= AppConfig.dnp.enabled ? newFileDownload : undefined`); в main — `AppConfig.dnp.enabled`.
- Не трогать: plain-WS, native-HTTP media, push/cache, существующие `contentUrl`/`meta`/`contentBlob`. Отвечать по-русски, комментарии как в коде. Мёртвый код не оставлять.

## File Structure

- `web-client/src/client/bootstrap.ts` — `startClient()` возвращает ещё и `ep` (сырой Endpoint) для handoff.
- `web-client/src/client/dnpBridgeHandoff.ts` *(новый)* — `handoffBridgePort(controller, ep)` + `installBridgeHandoff(ep)`.
- `web-client/src/client/boot.ts` — вызвать `installBridgeHandoff(ep)` (self-gated DNP).
- `web-client/src/core/managers/mediaManager.ts` — `streamUrl(id)` + локальный `loadMeta(id)` (рефактор `meta`).
- `web-client/src/core/mediaUrl.ts` — `resolveStreamUrl(id)`.
- `web-client/src/components/messages/MediaLightbox.tsx` — video src → `streamUrl`.
- `web-client/src/core/audio/mediaPlaybackController.ts` — audio src → `resolveStreamUrl`.
- Тесты: `client/dnpBridgeHandoff.test.ts` *(новый)*, `core/managers/mediaManager.test.ts` (правка).

---

### Task 1: Окно-handoff моста

**Files:**
- Modify: `web-client/src/client/bootstrap.ts`
- Create: `web-client/src/client/dnpBridgeHandoff.ts`
- Create: `web-client/src/client/dnpBridgeHandoff.test.ts`
- Modify: `web-client/src/client/boot.ts`

**Interfaces:**
- Produces: `handoffBridgePort(controller: Poster, ep: Poster): void` (минтит MessageChannel, раздаёт концы); `installBridgeHandoff(ep: Poster): void` (ждёт SW-контроллер, handoff + пере-handoff при `controllerchange`; self-gated `AppConfig.dnp.enabled`). `type Poster = { postMessage(m: unknown, t?: Transferable[]): void }`.
- `startClient()` теперь возвращает `{ smp, managers, ep }`.

- [ ] **Step 1: Тест handoffBridgePort**

`dnpBridgeHandoff.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { handoffBridgePort } from './dnpBridgeHandoff'

describe('handoffBridgePort', () => {
  it('раздаёт концы MessageChannel: port в SW и в SharedWorker', () => {
    const controller = { postMessage: vi.fn() }
    const ep = { postMessage: vi.fn() }
    handoffBridgePort(controller, ep)
    expect(controller.postMessage).toHaveBeenCalledTimes(1)
    expect(ep.postMessage).toHaveBeenCalledTimes(1)
    // control-кадр + ровно один transferable-порт на каждый конец
    const [cMsg, cTransfer] = controller.postMessage.mock.calls[0]
    const [eMsg, eTransfer] = ep.postMessage.mock.calls[0]
    expect((cMsg as { t: string }).t).toBe('dnp-bridge-port')
    expect((eMsg as { t: string }).t).toBe('dnp-bridge-port')
    expect(cTransfer).toHaveLength(1)
    expect(eTransfer).toHaveLength(1)
    // два разных конца одного канала
    expect(cTransfer[0]).not.toBe(eTransfer[0])
  })
})
```

- [ ] **Step 2: Прогнать — падает (нет модуля)**

Run: `cd web-client && npx vitest run src/client/dnpBridgeHandoff.test.ts 2>&1 | tail -10`
Expected: FAIL — cannot find module `./dnpBridgeHandoff`.

- [ ] **Step 3: Реализовать dnpBridgeHandoff.ts**

```ts
import { AppConfig } from '../config/app'

// Минимальная форма поста с transferables (MessagePort/Worker/ServiceWorker).
type Poster = { postMessage(message: unknown, transfer?: Transferable[]): void }

// handoffBridgePort — минтит MessageChannel и раздаёт концы: port1 → SW (controller),
// port2 → SharedWorker (ep). После этого окно вне пути данных; канал живёт в SW/
// SharedWorker и переживает закрытие вкладки-брокера (§ PR-2a).
export function handoffBridgePort(controller: Poster, ep: Poster): void {
  const ch = new MessageChannel()
  controller.postMessage({ t: 'dnp-bridge-port' }, [ch.port1])
  ep.postMessage({ t: 'dnp-bridge-port' }, [ch.port2])
}

// installBridgeHandoff — при DNP-ON ждёт готовности SW-контроллера и делает handoff;
// пере-handoff при смене контроллера (обновление SW → новый порт к SW). На первом
// визите контроллер появляется после clients.claim → ловим controllerchange.
export function installBridgeHandoff(ep: Poster): void {
  if (!AppConfig.dnp.enabled || !('serviceWorker' in navigator)) return
  const trySend = () => {
    const c = navigator.serviceWorker.controller
    if (c) handoffBridgePort(c, ep)
  }
  void navigator.serviceWorker.ready.then(() => {
    trySend()
    navigator.serviceWorker.addEventListener('controllerchange', trySend)
  })
}
```

- [ ] **Step 4: bootstrap.ts возвращает ep**

В `startClient`: добавить `ep` в кэш и возврат. Сигнатура:
```ts
let cached: { smp: SuperMessagePort; managers: Managers; ep: Endpoint } | null = null

export function startClient(): { smp: SuperMessagePort; managers: Managers; ep: Endpoint } {
  if (cached) return cached
  let ep: Endpoint
  // ...существующая ветка SharedWorker/Worker без изменений...
  const smp = new SuperMessagePort(ep)
  const managers = createManagers<Managers>(smp)
  cached = { smp, managers, ep }
  return cached
}
```

- [ ] **Step 5: boot.ts вызывает installBridgeHandoff**

В `boot.ts`, после `const { managers } = startClient()`, поднять ep и запустить handoff (импорт добавить):
```ts
import { installBridgeHandoff } from './dnpBridgeHandoff'
```
```ts
  const { managers, ep } = startClient()
  // DNP-ON: раздаём мост SW↔SharedWorker (self-gated; инертно при DNP-off).
  installBridgeHandoff(ep)
```

- [ ] **Step 6: Прогнать тест + typecheck**

Run: `cd web-client && npx vitest run src/client/dnpBridgeHandoff.test.ts 2>&1 | tail -8 && npx tsc --noEmit 2>&1 | tail -3`
Expected: PASS; tsc чист (`ep: Endpoint` совместим с `Poster` в вызове — `Endpoint.postMessage(msg, transfer?)`).

- [ ] **Step 7: Commit**

```bash
git add web-client/src/client/dnpBridgeHandoff.ts web-client/src/client/dnpBridgeHandoff.test.ts web-client/src/client/bootstrap.ts web-client/src/client/boot.ts
git commit -m "feat(dnp): окно-handoff моста SW↔SharedWorker (installBridgeHandoff)"
```

---

### Task 2: `mediaManager.streamUrl`

**Files:**
- Modify: `web-client/src/core/managers/mediaManager.ts`
- Modify: `web-client/src/core/managers/mediaManager.test.ts`

**Interfaces:**
- Produces: метод `streamUrl(id: number): Promise<string>` в объекте `newMediaManager`. DNP-ON (`fileDownload` задан) → `/dnp-stream/{id}?size=&mime=[&mp4fix=1]`; DNP-off → нативный token-URL. Рефактор: локальный `loadMeta(id)` (общий для `meta` и `streamUrl`).

- [ ] **Step 1: Тест**

В `mediaManager.test.ts` добавить: (a) DNP-off (без `fileDownload`) → нативный URL; (b) DNP-ON (с fake `fileDownload`) → `/dnp-stream/{id}?size=&mime=`; (c) mp4 mime → `&mp4fix=1`.

```ts
it('streamUrl без DNP → нативный token-URL', async () => {
  const mgr = newMediaManager({ rest: fakeRest() })
  const u = await mgr.streamUrl(42)
  expect(u).toBe('/api/media/42/content?token=mtok')
})

it('streamUrl при DNP-ON → /dnp-stream с size/mime (+mp4fix для mp4)', async () => {
  const rest = fakeRest()
  ;(rest as never as { get: ReturnType<typeof vi.fn> }).get.mockImplementation(async (p: string) =>
    p === '/media/token'
      ? { token: 'mtok', expires_at: new Date(Date.now() + 900_000).toISOString() }
      : { id: 42, mime: 'video/mp4', size: 1000, width: 0, height: 0, duration: 0, blur_preview: '', has_thumb: false },
  )
  const fileDownload = { isReady: () => true, downloadMedia: vi.fn(), fetchFilePart: vi.fn(), fetchFilePartWithTotal: vi.fn() }
  const mgr = newMediaManager({ rest, fileDownload } as never)
  const u = await mgr.streamUrl(42)
  expect(u).toBe('/dnp-stream/42?size=1000&mime=video%2Fmp4&mp4fix=1')
})
```

- [ ] **Step 2: Прогнать — падает (нет метода)**

Run: `cd web-client && npx vitest run src/core/managers/mediaManager.test.ts 2>&1 | tail -12`
Expected: FAIL — `mgr.streamUrl is not a function`.

- [ ] **Step 3: Реализовать**

(a) Рефактор `meta`: вынести тело в локальную `async function loadMeta(id)` (перед `return {`), а метод `meta` делает `return loadMeta(id)`:
```ts
  async function loadMeta(id: number): Promise<MediaMeta> {
    const hit = metaCache.get(id)
    if (hit && hit.hasThumb) return hit
    const r = await rest.get<{ id: number; mime: string; size: number; width: number; height: number; duration: number; blur_preview: string; file_name?: string; has_thumb?: boolean }>(`/media/${id}`)
    const m: MediaMeta = { id: r.id, mime: r.mime, size: r.size, width: r.width, height: r.height, duration: r.duration, blurPreview: r.blur_preview ?? '', fileName: r.file_name ?? '', hasThumb: !!r.has_thumb }
    metaCache.set(id, m)
    return m
  }
```
В объекте: `async meta(id: number): Promise<MediaMeta> { return loadMeta(id) },`

(b) Добавить `streamUrl` рядом с `contentUrl`:
```ts
    // streamUrl — URL для <video>/<audio>. При DNP-ON отдаёт /dnp-stream/{id} (SW
    // соберёт 206 из чанков Noise-канала; size/mime — для Content-Range/Content-Type,
    // mp4fix армит Chromium AAC-esds патч). Иначе — нативный token-URL (как contentUrl).
    async streamUrl(id: number): Promise<string> {
      if (!fileDownload) {
        const tok = await ensureToken()
        return rest.mediaUrl(`/media/${id}/content`, tok)
      }
      const m = await loadMeta(id)
      let u = `/dnp-stream/${id}?size=${m.size}&mime=${encodeURIComponent(m.mime)}`
      if (m.mime.includes('mp4')) u += '&mp4fix=1'
      return u
    },
```

- [ ] **Step 4: Прогнать — зелёный + typecheck**

Run: `cd web-client && npx vitest run src/core/managers/mediaManager.test.ts 2>&1 | tail -10 && npx tsc --noEmit 2>&1 | tail -3`
Expected: PASS (новые + существующие); tsc чист.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/managers/mediaManager.ts web-client/src/core/managers/mediaManager.test.ts
git commit -m "feat(dnp): mediaManager.streamUrl — /dnp-stream при DNP-ON, нативный иначе"
```

---

### Task 3: Разводка video/audio на streamUrl

**Files:**
- Modify: `web-client/src/core/mediaUrl.ts` (`resolveStreamUrl`)
- Modify: `web-client/src/components/messages/MediaLightbox.tsx` (video)
- Modify: `web-client/src/core/audio/mediaPlaybackController.ts` (audio)

**Interfaces:**
- Consumes: `managers.media.streamUrl` (Task 2).
- Produces: `resolveStreamUrl(id): string | Promise<string>` в mediaUrl.ts — DNP-ON → `startClient().managers.media.streamUrl(id)`; иначе → `resolveMediaContentUrl(id)` (сохраняет sync-gesture).

- [ ] **Step 1: mediaUrl.ts — resolveStreamUrl**

Добавить импорт `AppConfig` и функцию (рядом с `resolveMediaContentUrl`):
```ts
import { AppConfig } from '../config/app'
```
```ts
// Как resolveMediaContentUrl, но для стримового медиа (<video>/<audio>): при DNP-ON
// уводит на /dnp-stream/{id} (SW-206 из Noise-канала). При DNP-off — прежнее
// поведение (синхронный token-URL в рамках жеста, где можно).
export function resolveStreamUrl(id: number): string | Promise<string> {
  if (AppConfig.dnp.enabled) return startClient().managers.media.streamUrl(id)
  return resolveMediaContentUrl(id)
}
```

- [ ] **Step 2: MediaLightbox.tsx — video через streamUrl**

Найти (`components/messages/MediaLightbox.tsx:~177`):
```ts
    void managers.media.contentUrl(mediaId).then((u) => {
```
Заменить на выбор источника по типу (video → streamUrl):
```ts
    void (video ? managers.media.streamUrl(mediaId) : managers.media.contentUrl(mediaId)).then((u) => {
```
(`video` — уже объявленная выше `const video = item.type === 'video'`.)

- [ ] **Step 3: mediaPlaybackController.ts — audio через resolveStreamUrl**

Импорт: заменить `resolveMediaContentUrl` на `resolveStreamUrl` в импорте из `../mediaUrl` (и в вызове). В `load` (строка ~86):
```ts
    const resolved = resolveStreamUrl(track.mediaId)
    url = typeof resolved === 'string' ? resolved : await resolved
```
> `mediaContentUrl`/`primeMediaToken` в этом файле остаются (используются для secret-префетча/waveform) — трогаем только строку обычного трека.

- [ ] **Step 4: Проверить typecheck + сборку + тесты**

Run: `cd web-client && npx tsc --noEmit 2>&1 | tail -3 && npx vitest run 2>&1 | tail -6 && npx vite build --outDir /tmp/pr2c-build 2>&1 | tail -4`
Expected: tsc чист; сьют зелёный; сборка ок.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/mediaUrl.ts web-client/src/components/messages/MediaLightbox.tsx web-client/src/core/audio/mediaPlaybackController.ts
git commit -m "feat(dnp): video (Lightbox) + audio (playback) через streamUrl при DNP-ON"
```

---

### Task 4 (MANUAL): stand-e2e

> Не SDD-задача (нет кода) — ручная проверка активации на стенде `msgrverify`. Выполняется контроллером после зелёного гейта ветки, НЕ субагентом.

- [ ] Пересобрать стенд с DNP-ON client-build (`VITE_DNP_ENABLED=1`) + backend с `DNP_SERVER_PRIVKEY` (см. память «Messenger verify stack» / stand-e2e PR-1b).
- [ ] Открыть `https://localhost:38443`, залогиниться, открыть видео в лайтбоксе с перемоткой.
- [ ] **Network:** запросы на `/dnp-stream/{id}` → ответы **206**; WS несёт `file_req`/`file_chunk`. Перемотка → новые `/dnp-stream/` Range-запросы.
- [ ] Аудио (голос/музыка) играет через `/dnp-stream/`.
- [ ] **Realtime не залипает** во время стрима (typing/сообщения проходят). Если залипает → тикет на **L2-мультиплексор**.
- [ ] Зафиксировать результат (и решение по L2) в память DNP.

---

## Self-Review

**Spec coverage (§ PR-2c):**
- ✅ Окно-handoff (минт MessageChannel, port→SW/SharedWorker, пере-handoff) — Task 1.
- ✅ Своп `mediaManager`/`mediaUrl` → `/dnp-stream/{id}?size=&mime=` для video/audio при DNP-ON — Task 2-3.
- ✅ Точки: MediaLightbox (video), mediaPlaybackController (audio) — Task 3.
- ✅ stand-e2e (206 из SW, байты из канала, realtime не залипает → иначе L2) — Task 4 (manual).
- ➕ mp4fix арминг для mp4 — Task 2 (сверх спеки, безвредно).

**Type consistency:** `startClient()` → `{smp, managers, ep}` (Task 1) — `ep` потребляется `installBridgeHandoff` (Task 1) и в boot. `streamUrl(id): Promise<string>` — Task 2 объявляет, Task 3 (MediaLightbox + resolveStreamUrl) зовёт. `resolveStreamUrl` — Task 3 (mediaUrl) объявляет, mediaPlaybackController зовёт. Handoff-протокол `{t:'dnp-bridge-port'}` + transferable — совпадает с приёмниками PR-2a (sw.js/worker.ts).

**Placeholder scan:** нет TBD. Task 4 — ручной чеклист (явно помечен как не-SDD), не плейсхолдер-код. Все code-шаги несут точный код/команду.
