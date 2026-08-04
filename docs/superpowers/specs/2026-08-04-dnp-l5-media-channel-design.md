# DNP подпроект L5 — медиа через канал + SW-стриминг: дизайн

Медиа (скачивание/стриминг) через зашифрованный DNP-канал вместо нативного HTTP. Крупнейший
подпроект. L0–L4 готовы и смёржены; стенд-e2e пройден. Общая спека DNP —
[`../../research/2026-08-01-dnp-noise-transport-protocol.md`](../../research/2026-08-01-dnp-noise-transport-protocol.md) §L5.

**Решение (brainstorming):** начинаем с **L5-b (SW 206-стриминг)** напрямую — реализационно она
стартует с чанк-протокола, затем SW-слой. Байты чанков — **бинарные кадры (protocol v2 «dnp/2»)**,
не base64.

**Почему это добровольно:** нативное медиа-HTTP (`/media/{id}/content?token=`, Range/206, SW-кэш)
уже работает и оптимизировано. L5 отстраивает SW-стриминг заново ради сокрытия байт, уже
зашифрованных TLS. Это завершение цели «свой MTProto без нативного HTTP».

---

## Декомпозиция (roadmap L5)

| PR | Что | Риск |
|---|---|---|
| **PR-1a** | Protocol v2 groundwork: prologue/subprotocol → `dnp/2` + kind-байт (все кадры = 0x00+JSON) + регенерация interop-фикстур | крипто/wire — изолируем |
| **PR-1b** | file-кадры: kind 0x01 `file_chunk` (бинарь) + `file_req` (JSON) + бэкенд MinIO-чанкинг + клиентский download-примитив | средний |
| **PR-2** | SW 206-стриминг: SW↔worker мост + перехват fetch + Range→чанки→206 (порт `stream.ts`) + разводка `<video>/<audio>` + stand-e2e | крупный+ (самый тяжёлый) |
| (потом) | chunked **upload** через канал (замена `putBytes`) | средний |
| (потом) | **L2 мультиплексор** — приоритеты/чанкинг, когда медиа конкурирует с realtime | средний |

**L2 отложен** до момента, когда стриминг реально даёт HoL по realtime (замеры на PR-2). Пиковая
нагрузка стриминга ограничена битрейтом (чанки тянутся по мере проигрывания, § research 3.7), так
что первый L5-b возможен без L2.

---

## Protocol v2 (PR-1a) — эволюция wire

**Зачем:** медиа-чанк (512КБ–1МБ) в base64-JSON = +33% трафик + CPU. Вводим бинарные кадры →
нужен дискриминатор типа payload'а.

### Изменения
1. **prologue: `dnp/1` → `dnp/2`** (клиент `dnpTransport.ts` PROLOGUE; сервер `dnp/noise.go`
   `prologueV1`). Привязывает хендшейк к версии wire — при рассинхроне хендшейк падает чисто
   (анти-downgrade), а не тихо бьёт кадры.
2. **subprotocol: `dnp/1` → `dnp/2`** (клиент `new WebSocket(url, ['dnp/2'])`; сервер апгрейдер
   `Subprotocols` + `hasSubprotocol`). Согласованно с prologue.
3. **kind-байт на КАЖДЫЙ кадр** — первый байт **plaintext** (внутри AEAD-конверта, до JSON/бинаря):
   - `0x00` → остальное = `UTF8(JSON {t,d})` — все существующие realtime/rpc-кадры.
   - `0x01` → остальное = бинарный file-кадр (PR-1b).
   Кладётся/снимается на границе «кадр ↔ байты»: клиент `DnpTransport.send`/`onMessage`, сервер
   `Conn.dispatch`/`Send` (НЕ в codec seal/open — тот остаётся байт-агностичным).

### Совместимость
DNP за флагом, не в проде, клиент+сервер деплоятся вместе → wire-bump безопасен. Старых клиентов
нет. Interop-фикстуры (`nk-vector.json`, prologue «dnp/1») регенерируются с «dnp/2» (крипта та же,
меняется только строка prologue) + обновляется interop-тест. L0-L4 (realtime+RPC) продолжают
работать поверх dnp/2 с kind-байтом 0x00 — это критерий готовности PR-1a.

### Файлы PR-1a
- Клиент: `dnp/dnpTransport.ts` (PROLOGUE, subprotocol, kind-байт в send/onMessage),
  `dnp/noise/fixtures/nk-vector.json` (регенерация), `dnp/noise/interop.test.ts` (обновление).
- Сервер: `ws/dnp/noise.go` (prologueV1), `ws/handler.go` (subprotocol),
  `ws/conn.go` (kind-байт в encode/decode кадра), `ws/dnp/codec_test.go` / фикстур-генератор
  (регенерация под dnp/2).

---

## Чанк-протокол (PR-1b)

### Кадры
- **`file_req`** (JSON, kind 0x00): `{t:"file_req", d:{req_id, media_id, offset, limit}}`.
- **`file_chunk`** (бинарь, kind 0x01): `[0x01][header][raw bytes]`, где header — фиксированный:
  `req_id(u32) │ offset(u64) │ total(u64) │ len(u32)`; дальше `len` байт данных. (req_id как u32 —
  клиентский счётчик; total — полный размер файла для прогресса/EOF.)
- Последний чанк: `offset+len == total` → клиент собирает Blob.

### Сервер (`ws/dnp/` + `ws/conn.go`)
- `case file_req` (в dispatch, как rpc_req — async-горутина + семафор): валидировать доступ к
  `media_id` (переиспользовать media-usecase проверку токена/прав), `GetObject` из MinIO → `Seek(offset)`
  → прочитать `limit` байт → отправить `file_chunk` (бинарный кадр). Доступ: у канала есть
  аутентифицированный юзер (как в RPC) → проверка прав через media-usecase.
- Читатель MinIO `io.ReadSeekCloser` уже Range/Seek-способен (`minio/client.go` GetObject).

### Клиент (`core/net/dnp/fileDownload.ts`)
- `fetchFilePart(mediaId, offset, limit): Promise<Uint8Array>` — шлёт `file_req`, ждёт `file_chunk`
  по req_id (как ChannelRpc), таймаут.
- `downloadMedia(mediaId): Promise<Blob>` — тянет чанками (512КБ) от 0 до total, собирает Blob.
- Транспорт: `DnpTransport.onMessage` при kind 0x01 → распарсить header → отдать байты подписчику
  file-кадров (по req_id). Отдельный от JSON-диспатча путь.

### Тест PR-1b
Go-интеграция (flynn/noise initiator): auth → `file_req` → `file_chunk` бинарём с корректными
байтами MinIO-объекта. Клиент unit: fileDownload собирает Blob из чанков (фейк-транспорт).

---

## SW 206-стриминг (PR-2) — высокоуровнево

**Что:** `<video src>` указывает на фейковый URL (напр. `/dnp-stream/{mediaId}`); SW перехватывает
`fetch`, парсит `Range`, выравнивает на границы чанков, тянет нужные чанки **из SharedWorker через
канал** (PR-1b примитив), конструирует `206 Partial Content` с `Content-Range`/`Accept-Ranges`.

**Компоненты:**
- **SW↔worker мост** (нет сейчас — строим): порт tweb `serviceMessagePort.ts`. SW шлёт
  `requestFilePart(mediaId, offset, limit)` в SharedWorker (через `clients`/MessageChannel), worker
  отвечает байтами (через `fileDownload`/канал).
- **206-эмуляция** (`public/sw.js` + порт `stream.ts` 1:1): выравнивание диапазона, mp4-патч
  Chromium, хак «первого Range» Safari, предзагрузка.
- **Разводка:** `<video>/<audio>` (и voice) на фейковый URL при DNP-ON; иначе нативный
  `mediaContentUrl`. Не-стриминговое медиа (аватары/картинки) — можно на `downloadMedia`→objectURL
  (или оставить нативным до отдельного среза).
- **Эталон (1:1):** tweb `serviceWorker/stream.ts`, `appManagers/apiFileManager.ts`,
  `serviceWorker/serviceMessagePort.ts`, `files/{cacheStorage,streamWriter}.ts`.

**Stand-e2e:** видео с перемоткой играет через Noise-канал (206 из SW, байты из канала); realtime
не залипает во время стрима (иначе → L2).

---

## Безопасность
Медиа-доступ через `file_req` проверяется правами аутентифицированного юзера канала (как RPC) —
не открывает обхода. Приватный ключ/пути не меняются. SW отдаёт 206 только для медиа, к которым у
юзера есть доступ (проверка на сервере при `file_req`).

## Границы (НЕ здесь)
Upload через канал, L2-мультиплексор — отдельные срезы после PR-2.
