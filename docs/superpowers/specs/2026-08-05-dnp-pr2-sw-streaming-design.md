# DNP L5 PR-2 — SW 206-стриминг: дизайн

Медиа-стриминг (видео/аудио с перемоткой) через зашифрованный DNP-канал: Service Worker
перехватывает `fetch` на фейковый `/dnp-stream/{mediaId}`, эмулирует `206 Partial Content`,
байты берёт чанками из SharedWorker (`fileDownload.fetchFilePart`, PR-1b) поверх Noise-канала.
Завершает цель L5 «свой MTProto без нативного медиа-HTTP». Эталон — tweb **1:1**.

**Статус L5:** PR-1a (protocol v2 `dnp/2`+kind, #130) и PR-1b (file-кадры+чанк-протокол+download-примитив,
#131) смёржены. Осталось PR-2 — стриминг. Общая L5-спека:
[`2026-08-04-dnp-l5-media-channel-design.md`](2026-08-04-dnp-l5-media-channel-design.md) § SW 206-стриминг.

**За флагом** `AppConfig.dnp.enabled` / `dnpServerPriv`, не в проде. Plain-WS + native-HTTP медиа
не трогаются (это их канальный дублёр).

---

## Эталон tweb (что портируем 1:1)

- `src/lib/serviceWorker/stream.ts` — класс `Stream`, `onStreamFetch`, 206-эмуляция:
  - `parseRange(header)` — `"bytes=0-1023"` → `[offset, end]`, **только первый диапазон**.
  - `alignOffset(o, base=4096)` = `o - o%base`; `alignLimit(l)` = следующая степень двойки.
  - `requestRange`: считает `limit` (pow2 если запрошенный end внутри чанка, иначе `limitPart`),
    `alignedOffset`, тянет выровненный чанк (+второй при overflow через границу), `bufferConcat`,
    **slice назад** к точному `[offset, end]`, строит 206.
  - Константы: `STREAM_CHUNK_MIDDLE_LIMIT = 512*1024`, `STREAM_CHUNK_UPPER_LIMIT = 1024*1024`
    (файлы >75МБ), `SMALLEST_CHUNK_LIMIT = 4*1024`.
  - **Хак Safari `[0,1]`** (`responseForSafariFirstRange`): на запрос ровно `[0,1]` вернуть
    сфабрикованный 2-байтный 206 `Content-Range: bytes 0-1/{size}` + `Content-Type` **без fetch** —
    удовлетворяет初 probe Safari.
  - **Chromium mp4-патч** (`tryPatchMp4`/`@helpers/fixChromiumMp4`): армится при search `_crbug1250841`.
  - 206-заголовки: `Accept-Ranges: bytes`, `Content-Range: bytes {o}-{o+len-1}/{size||*}`,
    `Content-Length: {len}`, `Content-Type: {mime}`.
- `src/lib/serviceWorker/serviceMessagePort.ts` (extends `SuperMessagePort`) — SW↔worker RPC по
  **переданному `MessagePort`** (не `clients.matchAll`). SW минтит `MessageChannel`, port1 держит,
  port2 отдаёт window-клиенту, тот форвардит воркеру. `invoke('requestFilePart', {docId,offset,limit})`
  → `MyUploadFile{bytes}`.
- `src/lib/serviceWorker/index.service.ts` — `onFetch`: скоуп-роутер по последнему сегменту URL,
  `case 'stream': onStreamFetch(...)`. Скоуп `stream/` помечает стрим-запрос (без sniff'а Range/ext).
- URL-билдер `getFileURL(type, options)` = `type + '/' + encodeURIComponent(JSON.stringify(options))`;
  для `doc.supportsStreaming` → `type='stream'`. `<video src>` = эта строка.

**Что заменяем:** хвост `serviceMessagePort.invoke('requestFilePart')→MyUploadFile.bytes` → вызов через
SW↔SharedWorker мост в `fileDownload.fetchFilePart(mediaId, alignedOffset, limit)`. Вся математика
`stream.ts` — без изменений.

## Наша база (из разведки)

- SW = рукописный `web-client/public/sw.js` (plain JS, скоуп `/`, push+кэш, **без** message-инфры;
  Range сейчас **пропускает в сеть**). Собирается НЕ через Vite — копируется из `public/`;
  `scripts/write-version.mjs` штампует `app-shell-<build>`.
- `web-client/src/core/net/dnp/fileDownload.ts` — `fetchFilePart(mediaId, offset, limit): Promise<Uint8Array>`
  (без total), `downloadMedia(id): Promise<Blob>`; живёт **внутри SharedWorker** (`core/worker.ts`),
  единый инстанс, говорит по DNP-WebSocket. Внутренний `requestPart` уже возвращает `{data, total}`.
- Топология: **SharedWorker** (`bootstrap.ts`; dedicated `Worker` — только фолбэк). Вкладка коннектится
  `SharedWorker.port` → свой `SuperMessagePort`. `core/rpc/superMessagePort.ts` + `Endpoint` —
  переиспользуемая инфра.
- Свопы src: `mediaManager.contentUrl` (`core/managers/mediaManager.ts`) / `mediaUrl.ts` →
  `MediaLightbox.tsx` (`<video src>`), `core/audio/mediaPlaybackController.ts` (`<audio src>`).
- SW-регистрация: `client/boot.ts` `navigator.serviceWorker.register('/sw.js')`, скоуп `/`.

**Расхождение с tweb:** у нас байто-источник в **SharedWorker** (единый инстанс), SW не может открыть
SharedWorker-коннект сам → мост брокерится окном (как в tweb, но цель — SharedWorker). SW у нас plain-JS
без `SuperMessagePort` → пишем **минимальный** порт-мост руками.

---

## Декомпозиция — 3 тонких PR

| PR | Что | Тестируемый deliverable |
|---|---|---|
| **2a** | SW↔SharedWorker мост (окно-брокер + `file_part` RPC по MessagePort + `fileDownload` отдаёт total) | SW зовёт «дай part» → получает байты+total из канала через SharedWorker; unit на протоколе+роутинге (мок-порты) |
| **2b** | 206-хендлер в SW (порт `stream.ts` на plain-JS): роут `/dnp-stream/`, Range→align→чанки(мост)→206 + Safari/Chromium хаки | vitest на чистой Range-математике (вынесенный `.js`); ручной smoke 206 |
| **2c** | Разводка src video/audio → `/dnp-stream/{id}?size=&mime=` при DNP-ON + boot-handoff моста + stand-e2e | видео с перемоткой играет через Noise-канал; realtime не залипает |

**Отложено (follow-up, YAGNI):** кэш чанков (`cachedStreamChunks` CacheStorage) + read-ahead 20МБ
(`preloadChunks`) + in-use lifecycle (`toggleStreamInUse`/`cancelFilePartRequests`). v1 — on-demand 206
без кэша/предзагрузки/отмены. Замер HoL по realtime на PR-2c решит, нужен ли **L2-мультиплексор**.

---

## PR-2a — SW↔SharedWorker мост (окно-брокер)

### Поток установки
1. Вкладка при загрузке, если `AppConfig.dnp.enabled` И `navigator.serviceWorker.controller` (SW рулит
   страницей): `const ch = new MessageChannel()`.
2. `controller.postMessage({ t: 'dnp-bridge-port' }, [ch.port1])` — port1 в SW.
3. `workerPort.postMessage({ t: 'dnp-bridge-port' }, [ch.port2])` — port2 в SharedWorker через уже
   открытый `SharedWorker.port` (тот, что несёт `SuperMessagePort`). Воркер на своей стороне слушает
   этот управляющий канал и, увидев `dnp-bridge-port`, забирает `e.ports[0]` как мост к SW.
4. **После handoff окно вне пути данных:** `ch.port1` (в SW) ↔ `ch.port2` (в SharedWorker) — прямой
   MessageChannel. Оба конца живут в контекстах SW/SharedWorker → **переживают закрытие вкладки-брокера**.
5. Мульти-вкладка: каждая вкладка при загрузке шлёт свежую пару. SW держит **последний полученный**
   живой порт (fallback при ошибке отправки); SharedWorker слушает все выданные ему порты и отвечает в
   тот же порт, откуда пришёл запрос. Новая вкладка обновляет мост, если старая закрылась.

### Протокол моста (по MessagePort)
- SW → SharedWorker: `{ t: 'file_part', reqId, mediaId, offset, limit }`.
- SharedWorker → SW: `{ t: 'file_part_ok', reqId, bytes, total }` (`bytes: ArrayBuffer`, transferable) —
  ЛИБО `{ t: 'file_part_err', reqId, error }`.
- SW коррелирует по `reqId` (свой u32-счётчик, обёртка), таймаут (напр. 45с как tweb `timeout`).

### Сервер стороны воркера
- `core/worker.ts`: на управляющем порту ловим `dnp-bridge-port` → берём `e.ports[0]` = `swPort`;
  `swPort.onmessage = async (e) => { if e.data.t==='file_part' → fileDownload.fetchFilePartWithTotal(...)
  → swPort.postMessage({t:'file_part_ok',reqId,bytes,total}, [bytes]) }`. Ошибка → `file_part_err`.
  Активен только при `fileDownload` (DNP-ON).
- `fileDownload.ts`: добавить публичный `fetchFilePartWithTotal(mediaId, offset, limit): Promise<{bytes, total}>`
  (тонкая обёртка над внутренним `requestPart`, который уже возвращает `{data, total}`). Существующий
  `fetchFilePart` (только bytes) не трогаем.

### SW сторона (plain-JS в sw.js)
- Модуль-мост: держит `bridgePort` (последний), `pending: Map<reqId,{resolve,reject,timer}>`,
  `requestPart(mediaId, offset, limit): Promise<{bytes, total}>` — шлёт `file_part`, ждёт по reqId.
  `bridgePort.onmessage` резолвит/реджектит. На `dnp-bridge-port` (в `sw.js` `message`-хендлере) —
  `bridgePort = e.ports[0]` + переустановка onmessage.

### Тест PR-2a
- Клиент unit (vitest, мок MessagePort-пара): `requestPart` шлёт `file_part` и резолвит `{bytes,total}`
  из `file_part_ok`; ошибка → reject; корреляция по reqId; таймаут. Воркер-роутер: `file_part` →
  `fileDownload.fetchFilePartWithTotal` (fake) → `file_part_ok` с bytes+total.
- `fetchFilePartWithTotal`: fake-транспорт → `{bytes, total}`.

---

## PR-2b — 206-хендлер в SW (порт stream.ts на plain-JS)

### Роут
- В `sw.js` `fetch`-хендлере, ДО `MEDIA_RE`: `if (url.pathname.startsWith('/dnp-stream/'))
  → event.respondWith(onStreamFetch(event))`. `mediaId` из пути, `size`/`mime` из query.
- Почему query, не JSON-в-пути как tweb: наш URL несёт только `mediaId`; `size` нужен для `Content-Range`,
  `mime` для `Content-Type`. Разводка (PR-2c) знает их из `media.meta(id)` → кладёт в query
  `/dnp-stream/{id}?size={size}&mime={mime}`. Избегаем лишнего round-trip за meta в SW.

### 206-логика (1:1 из stream.ts, plain-JS)
- `parseRange`, `alignOffset(o,4096)`, `alignLimit` (pow2) — **вынести в `public/sw-stream.js`**
  (чистые функции, юнит-тестируемые vitest'ом; sw.js их `importScripts('/sw-stream.js')` ИЛИ дублирует —
  решить в плане, предпочтительно importScripts для DRY+тестов).
- `requestRange(range, {mediaId,size,mime})`: `limit` (pow2 если end внутри чанка, иначе 512КБ; 1МБ для
  size>75МБ), `alignedOffset`, `requestPart(mediaId, alignedOffset, limit)` (+второй при overflow),
  concat, slice `[offset-alignedOffset, end-alignedOffset+1]`, 206.
- **Safari `[0,1]`**: range `[0,1]` → 2-байтный 206 без fetch.
- **Chromium mp4-патч**: порт `fixChromiumMp4` (plain-JS), армить по search `_crbug1250841`.
- 206-заголовки как tweb (см. § Эталон). `size||'*'`. Таймаут-гонка 45с.

### Тест PR-2b
- vitest на `sw-stream.js`: `parseRange` (открытый/закрытый/пустой), `alignOffset`, `alignLimit` (pow2),
  построение `Content-Range` для offset/end/size. Fake `requestPart` → сборка+slice корректны.
- Chromium-патч — юнит на известном mp4-сэмпле (как tweb helper).

---

## PR-2c — разводка src + boot-handoff + stand-e2e

### Разводка
- `mediaManager.contentUrl(id)` (и/или `mediaUrl.ts`): при `AppConfig.dnp.enabled` для **стримового**
  video/audio вернуть `/dnp-stream/{id}?size={size}&mime={mime}` (size/mime из `meta(id)`); иначе —
  текущий token-URL. Картинки уже на blob-URL (PR-1b) — не трогаем.
- Точки: `MediaLightbox.tsx` (`<video src>` через `managers.media.contentUrl`),
  `mediaPlaybackController.ts` (`<audio src>` через `resolveMediaContentUrl`). GIF-в-video
  (`RealMediaBubble`) — по возможности тем же свопом.

### Boot-handoff
- В `client/boot.ts` (или рядом с SW-регистрацией): при `AppConfig.dnp.enabled` +
  `navigator.serviceWorker.controller`, после готовности SharedWorker-порта — выполнить handoff (§ PR-2a
  поток установки). Пере-handoff при `visibilitychange`→visible, если контроллер сменился.

### Stand-e2e (msgrverify)
- Видео с перемоткой в лайтбоксе играет через Noise-канал (206 из SW, байты из канала); проверить
  сетевую вкладку: запросы на `/dnp-stream/`, ответы 206, WS несёт `file_req`/`file_chunk`.
- Realtime (typing/сообщения) не залипает во время стрима. Если залипает → тикет на **L2-мультиплексор**.

---

## Безопасность
Стрим-доступ идёт тем же `file_req` (PR-1b): права проверяются `CanAccessMedia` на аутентифицированном
userId канала. SW отдаёт 206 только для медиа, к которым у юзера есть доступ (гейт на сервере). Приватный
ключ/пути не меняются. `/dnp-stream/{id}?size=&mime=` — size/mime лишь хинты для заголовков; реальные байты
и права — из канала.

## Границы (НЕ здесь)
Кэш чанков, read-ahead, in-use cancel, upload через канал, L2-мультиплексор — отдельные срезы после PR-2c.
