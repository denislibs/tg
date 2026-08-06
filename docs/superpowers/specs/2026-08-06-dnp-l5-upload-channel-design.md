# DNP L5: upload медиа через канал — дизайн

**Дата:** 2026-08-06
**Статус:** дизайн на ревью
**Контекст:** [[dnp-noise-transport]] — последний кусок L5, убирающий медиа-HTTP целиком.
Зеркало download-примитива (PR-1b `file_req`→`file_chunk`), направление обратное (client-push).

## Проблема

При отправке медиа метаданные уже идут по Noise-каналу (RPC-туннель L4): `POST /media/upload`
(создать запись), `POST /media/{id}/finalize`, `GET /media/{id}/parts` (resume). **Байты**
файла всё ещё грузятся по HTTP: `rest.putBytes('/media/{id}/content', …)` (мелкие) и
`rest.putBytes('/media/{id}/parts/{index}', …)` (крупные, chunked). Это последний медиа-HTTP.

## Решение

При DNP-on **любой** upload идёт через parts по каналу (мелкий файл = 1 part). Каждый чанк —
бинарный кадр `file_up` (kind 0x02) → бэкенд пишет его через существующий usecase
`SavePart` → JSON-ack `file_up_ok`/`file_up_err`. `finalize`/resume остаются RPC (уже по
каналу). Single-content путь (`PutContent`, буферит до 100МБ) под DNP не используется —
всё унифицировано в parts (память ограничена размером чанка).

Flow control: per-part ack + существующая concurrency-очередь `uploadChunked` (несколько
parts в полёте, backpressure по ack).

### Wire-протокол

- **Клиент→сервер: бинарный кадр kind `0x02` (`file_up`)** — заголовок Big-Endian 24 байта:
  `req_id(u32)@0 │ media_id(u64)@4 │ index(u32)@12 │ total(u32)@16 │ len(u32)@20 │ data@24`.
  (Зеркало `file_chunk`: там offset/total, тут index/total — семантика parts.)
- **Сервер→клиент: JSON-ack (kind 0x00)** — `file_up_ok{req_id}` / `file_up_err{req_id,error}`
  (error: forbidden/bad_part/error; наличие объекта не течёт).

### Backend

1. **codec-шов (`conn.go`)** — `frameKindFileUp byte = 0x02`. Сейчас `dnpCodec.decode`
   принимает только 0x00 (JSON) и ошибится на 0x02. Расширить: `decode` отдаёт **kind +
   payload** (или типизированный кадр), `readPump` ветвится: 0x00→JSON-диспатч (как есть),
   0x02→бинарный `file_up`-диспатч. plain-WS не трогаем.
2. **Диспатч `file_up`** — парсит заголовок, буферит `data` (≤ чанк-кап, напр. 1МБ),
   вызывает `UploadDispatcher.SavePart` (горутина + семафор 16, как `file_req`), отвечает
   `file_up_ok`/`file_up_err`.
3. **`UploadDispatcher` интерфейс** (зеркало `FileDispatcher`, ws НЕ импортит usecase/http):
   `SavePart(ctx, userID, mediaID int64, index, total int, data []byte) error`. Реализация —
   адаптер над `mediaSvc.SavePart(ctx, mediaID, userID, index, total, bytes.NewReader(data),
   int64(len(data)))`. Права — уже в `SavePart` (`ErrForbidden` по userID канала).
   Late-bind `SetUploadDispatcher` в `server.go` (как `SetFileDispatcher`).
4. **Лимиты:** чанк-кап `maxFileUpChunk` (1МБ) — reject кадра сверх (влезает в текущий
   MaxFrameLen без его подъёма); `index/total` валидируются `SavePart` (`ErrBadPart`).
   userID — из `dnpAccept` (аутентифицирован). **Один part = один `file_up`-кадр:** при
   DNP-on клиент режет файл на parts по `maxFileUpChunk`, так что part целиком влезает в
   кадр (не пересобираем MaxFrameLen, не вводим суб-чанки).

### Client

1. **`Transport.sendBinary(data: Uint8Array)`** — новый метод: `DnpTransport` шлёт
   `sealFrame(withKind(0x02, data))`; `WsClient` — no-op (DNP-only). (`onBinary` уже есть.)
2. **`core/net/dnp/fileUpload.ts`** (зеркало `fileDownload.ts`): `newFileUpload(transport)`
   → `uploadPart(mediaId, index, total, bytes, signal?)`: собирает заголовок+data, шлёт
   `sendBinary`, корреляция по u32 `req_id`, ждёт `file_up_ok`/`file_up_err`; таймаут,
   reject-all на `onClose`, `AbortSignal`. `isReady = transport.isOpen()`.
3. **Разводка `mediaManager`:** при DNP-on (`fileUpload` доступен) `uploadChunked` шлёт parts
   через `fileUpload.uploadPart` вместо `rest.putBytes('/parts/{index}')`; мелкие файлы тоже
   идут через parts-путь (1 part) вместо `putBytes('/content')`. `finalize`/resume/`upload`
   (создание) — без изменений (уже RPC). Прогресс/отмена (`AbortController`,
   `media:upload_progress`) сохранены.

## Что НЕ делаем (YAGNI / вне scope)

- **Стриминг в usecase через io.Pipe** — не нужен: parts буферят только чанк (≤1МБ).
- **Отдельный content-путь по каналу** — унифицировано в parts.
- **Backend `file_up_cancel`** — отмена клиентская (перестаёт ждать ack; частичные parts
  переживают resume/finalize-проверку). Wire к серверу не добавляем.
- **Windowed/скользящее окно сверх текущей concurrency** — YAGNI, per-part ack достаточно.

## Декомпозиция (2 PR, как download PR-1b)

- **PR-a (backend):** kind 0x02 приём в codec-шве + `readPump` ветка + `UploadDispatcher`→
  `SavePart` + ack-кадры + late-bind. e2e через живой flynn/noise initiator (шлёт `file_up`,
  проверяет запись + ack).
- **PR-b (client):** `Transport.sendBinary` + `fileUpload.ts` + разводка `mediaManager`
  (DNP-on → parts по каналу). Юнит-тесты примитива; ручной stand-e2e — отправка видео,
  Network без HTTP `/media/*/parts|content`, WS `file_up`/`file_up_ok`.

## Тестирование

- **Backend:** unit заголовок file_up (парс/сборка); e2e flynn/noise — `file_up` пишет part
  (fake UploadDispatcher ловит index/total/bytes), ack `file_up_ok`; невалидный (bad index)
  → `file_up_err`; чужой media → forbidden.
- **Client:** unit `fileUpload` — корреляция req_id, ack ok/err, таймаут, abort, onClose;
  mediaManager разводка (DNP-on зовёт uploadPart, не putBytes).
- **Stand-e2e:** отправка видео на msgrverify (DNP-on) — байты идут WS `file_up`, backend не
  видит HTTP `PUT /media/*/parts|content`, медиа доставлено и играбельно.

## Открытые вопросы

Нет — развилки (всё через parts; per-part ack + concurrency) подтверждены.
