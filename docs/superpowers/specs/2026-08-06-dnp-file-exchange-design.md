# DNP файловый обмен — цельный дизайн (upload/download/стриминг/превью)

**Дата:** 2026-08-06
**Статус:** дизайн на ревью
**Контекст:** [[dnp-noise-transport]]. Свод после полного изучения файловой подсистемы
tweb (3 исследователя: upload / download+refs+cache / streaming+thumbs). Цель — построить
обмен файлами через DNP-канал без отсебятины и без тупиков, к которым потом придётся
возвращаться. Отменяет наивную модель upload из `2026-08-06-dnp-l5-upload-channel-design.md`
(«один file_up = один MinIO multipart-part»), которая ломалась на правиле S3 «part ≥5МБ».

---

## 1. Эталон tweb/MTProto (сжато)

- **Адресация:** `InputFileLocation{id, access_hash, file_reference, thumb_size}` + `dc_id`.
  Файл живёт в датацентре; `file_reference` — анти-hotlink токен с ротацией.
- **Download:** `upload.getFile{location, offset, limit}`; part-size степень двойки 64КБ→1МБ
  (потолок), offset кратен limit. Стриминг видео: SW ловит Range → выравнивает offset вниз
  до границы чанка, limit до степени 2 (кратно 4КБ, делит 1МБ), догружает overflow вторым
  запросом, собирает 206. Кэш чанков `cachedStreamChunks` по `(docId,offset,limit)`,
  preload-окно 20МБ + prefetch последнего чанка (moov).
- **Upload:** part-size 64КБ типично (512КБ потолок, растёт только для >250МБ ради лимита
  4000 частей). `saveFilePart`/`saveBigFilePart` (порог 10МБ), ключ `(file_id, part)`,
  file_id случайный (нет content-addressing). **Части не по порядку** (concurrency ~9),
  сборка по индексу, **явного finalize нет** — `InputFile{id, parts}` встраивается в
  `sendMedia`, и это неявно финализирует. md5 пустой. Ретрай = весь файл заново, resume нет;
  отмена клиентская, сервер чистит по TTL.
- **Превью:** обычный stripped-thumb — **серверный**, инлайн в объекте. Отдельный байтовый
  upload превью — **только для видео-обложки** (UX «выбор кадра»).

## 2. Что берём, что упрощаем (и почему)

| Механизм tweb | Наше решение | Почему |
|---|---|---|
| `file_reference` + ротация | **Не нужно.** `media_id` + auth канала | У нас не MTProto-DC; доступ проверяет `CanAccessMedia`/owner |
| CDN-редирект | **Не нужно** | Сам tweb не использует; MinIO HTTP-адресуем |
| `dc_id`-топология, 3/6 сокетов | **Не нужно** | Один Noise-канал |
| Лимиты частей 4000/8000, precise-флаги | **Не нужно** | Артефакт MTProto; HTTP/S3 Range без таких лимитов |
| Адаптивный part-size (64КБ→512КБ) | **Фикс 512КБ** | Проще; влезает в read-limit 1МБ; лимита частей нет |
| Части не по порядку, сборка по индексу | **По порядку (offset), стрим** | Один канал сериализует кадры → out-of-order бессмыслен |
| Неявный finalize (sendMedia) | **Стрим-завершение = finalize** | Заканчивается на последнем чанке; процессинг авто-кик |
| Отдельный upload видео-обложки | **Отложено** (backend ffmpeg-poster) | UX-фича; не нужна для MVP |
| stripped-thumb серверный | **Уже есть:** `blur_preview` на create + ffmpeg thumb | Прямой аналог |
| Выравнивание Range, Safari-хак, mp4-патч | **Уже портировано 1:1** (`sw-stream.js`) | — |
| Кэш чанков, seek-cancel, in-use lifecycle | **Отложено** (осознанно) | Замерить нужность; сейчас 45s timeout |
| Download 64КБ→1МБ | **Уже есть:** `file_req`/`file_chunk` 1МБ | — |

## 3. Наша файловая модель (реальность)

- **Хранилище:** MinIO, объект по `ObjectKey = {ownerID}/{randomKey}`, адрес — `media_id` (БД-строка).
- **Запись объекта:** `storage.PutObject(objectKey, io.Reader, size, mime)` — целый объект,
  БЕЗ multipart/правила 5МБ (используется `PutContent`). Multipart (`SavePart`/`Finalize`,
  5МБ-parts) — существующий HTTP-путь для крупных, **его не трогаем** (для не-DNP).
- **Процессинг:** после записи — `go s.process(m)` (ffmpeg: dims/duration/thumbnail/poster),
  строка обновляется асинхронно.
- **Метаданные:** `width/height/duration/blur_preview/fileName` клиент передаёт при
  `CreateUpload` (RPC, уже по каналу).
- **Download/стриминг:** `GetContent` (Range) по финализированному объекту; DNP —
  `file_req`/`file_chunk` (готово) + SW 206 (готово).

## 4. Upload через канал — НОВОЕ (стриминг по offset в один объект)

Модель: клиент режет файл на чанки 512КБ и шлёт их **по порядку offset**; бэкенд
**стримит** их в один MinIO-объект через `io.Pipe → storage.PutObject`. Ноль S3-multipart,
ноль буферизации всего файла, ограниченная память (один чанк). Аналог MTProto «мелкие части
→ серверная сборка», адаптированный под наш один канал (по порядку) и MinIO (PutObject-стрим).

### Wire

- **Клиент→сервер: бинарный `file_up` (kind `0x02`)** — заголовок 24Б BE (как `file_chunk`,
  но offset вместо index): `req_id(u32) │ media_id(u64) │ offset(u64) │ total(u64) │ data`.
  *(len выводится из размера кадра: `len = framelen − 24`; total повторяется в каждом кадре —
  дёшево, и последний чанк детектируется как `offset+len == total`.)*
- **Сервер→клиент: JSON-ack** — `file_up_ok{req_id}` (чанк принят) / `file_up_err{req_id,error}`.
- Чанк-кап `maxFileUpChunk = 512КБ` (sealed < read-limit 1МБ).

### Поток

1. Клиент: `POST /media/upload` (RPC, метаданные+size) → `media_id`.
2. Клиент шлёт `file_up` чанки offset=0,512К,1М… **последовательно** (ждёт ack предыдущего
   ИЛИ небольшое окно с проверкой порядка на бэке — см. flow control).
3. Бэкенд (первый чанк, offset=0): открывает `UploadSession` — goroutine
   `storage.PutObject(objectKey, pipeReader, total, mime)`; пишет data в `pipeWriter`.
   Каждый следующий чанк: проверяет `offset == expectedNext`, пишет в pipe, `ack`.
   Не тот offset → `file_up_err "order"`, сессия рвётся (клиент рестартит весь файл).
4. Последний чанк (`offset+len == total`): закрывает `pipeWriter` → `PutObject` завершает
   объект → `go s.process(m)` → финальный `file_up_ok`. Сессия закрыта.
5. Обрыв канала/conn-close → незакрытые `UploadSession` абортятся (pipe закрывается ошибкой,
   PutObject падает, недописанный объект НЕ финализируется; media-строка остаётся без
   контента — GC по TTL или перезапись при ретрае).

### Flow control / concurrency

Стриминг требует порядок → **stop-and-wait или маленькое окно с in-order-проверкой**. Проще:
клиент шлёт чанк, ждёт `file_up_ok`, шлёт следующий (по одному каналу конкуренция всё равно
сериализуется — потеря пропускной способности только на RTT, приемлемо для MVP; окно можно
добавить позже). Прогресс — по ack'ам (событие `media:upload_progress`, как сейчас).

### Почему НЕ index/out-of-order + сборка

Out-of-order у tweb оправдан 3/6 параллельными сокетами к DC. У нас один Noise-канал —
кадры уже сериализованы, параллелизм частей не даёт throughput, а сборка по индексу требует
стейджа частей (temp-объекты) + явной сборки (ComposeObject тоже упирается в 5МБ). Стриминг
по порядку проще, без temp-стейджа, без правила 5МБ. Осознанное отступление от MTProto,
обоснованное транспортом.

## 5. Download / стриминг — существующее, гардрейлы

- **Не трогаем** `file_req`/`file_chunk` (1МБ) и SW-206 (`sw-stream.js` порт `stream.ts` 1:1).
- **Гардрейл (1 — инвариант потока):** Range/стриминг только по финализированному объекту
  (`Size` записан). Клиент запрашивает стрим только после ack отправки — соблюдено.
- **Гардрейл (2 — defense-in-depth):** проверить, что `GetContent`/`file_req` **ошибается
  (404/err), а НЕ отдаёт частичные байты** по объекту, у которого стрим-запись ещё идёт /
  не завершена. Иначе 206 `Content-Range: X-Y/*` разъедется с реальным содержимым. Проверка
  входит в план PR-a′.
- **ffmpeg `-movflags +faststart`** для видео-транскода/постера — проверить, что процессор
  так делает (иначе TTFP просядет из-за moov в конце; не ломается, но медленнее старт).

## 6. Превью/вложения

- **Обычные:** `blur_preview` (create, RPC) + серверный ffmpeg thumb/poster. Отдельный
  байтовый upload превью **не нужен**.
- **Видео-обложка (выбор кадра)** — отложено, **отдельный тикет**. ВАЖНО: UI обложки в
  медиа-редакторе УЖЕ есть (`MediaEditor.tsx`: `videoThumbPos` 0..1 + drag-хэндл `'cover'`),
  но сегодня **мёртв** — `upload()` не шлёт выбранный кадр (ни по HTTP, ни планируется в DNP).
  Пропуск в DNP-upload = **не регресс** (нечего ломать). Будущий PR «video cover»: клиент
  рендерит кадр из `videoThumbPos` → второй `file_up`-стрим на thumb-объект + бэкенд принимает
  клиентский постер (как tweb `inputMediaUploadedDocument.thumb`) — тогда и UI оживёт.
- **Attributes** (video/voice/duration/dims) — как сейчас, в метаданных create + ffmpeg.

## 7. Согласование с PR-a (уже смёржен, #137)

PR-a смапил `file_up{index}` → `SavePart` (multipart, 5МБ). **Меняем на стрим:**
- `file_up`: `index` → **`offset`**+`total` (заголовок как §4).
- `UploadDispatcher`: `SavePart(...)` → **`WriteChunk(ctx, userID, mediaID, offset, total, data) (done bool, err error)`** (стрим-семантика; сессия per (conn,media)).
- `MediaUploader` (http-адаптер): вместо `svc.SavePart` — новый usecase-метод
  `StreamContent`/`WriteChunk` (io.Pipe→PutObject, аналог `PutContent`, но по чанкам).
- Существующий HTTP multipart-путь (`SavePart`/`Finalize`) **остаётся** для не-DNP.

## 8. Декомпозиция (обновлённая)

- **PR-a′ (backend reshape):** `file_up` offset-стрим + `UploadDispatcher.WriteChunk` +
  usecase `StreamContent` (io.Pipe→PutObject, сессия, порядок, авто-process) + e2e. Заменяет
  multipart-маппинг из #137.
- **PR-b (client):** `Transport.sendBinary` + `core/net/dnp/fileUpload.ts` (offset-стрим,
  stop-and-wait, корреляция req_id, abort/onClose) + разводка `mediaManager` (DNP-on → чанки
  по каналу вместо `rest.putBytes`; и `/content`, и `/parts` заменяются одним стрим-путём).
  Stand-e2e: отправка видео → Network без HTTP `/media/*`, WS `file_up`.

## 9. Отложено (осознанно, YAGNI — но задокументировано)

- Окно/конкуренция частей upload (сейчас stop-and-wait).
- Resume upload (tweb тоже без него).
- Кэш стрим-чанков (`cachedStreamChunks`), seek-cancel устаревших `file_req`, in-use
  lifecycle — замерить нужность; сейчас 45s timeout.
- Клиентский кэш download по стабильному ключу + порог «в память vs на диск» (20МБ).
- Приоритет очереди по активному чату.
- Видео-обложка (выбор кадра).
- GC брошенных upload-сессий по TTL (нужен, т.к. нет протокольного неявного GC) — тикет.

## 10. Открытые вопросы

- **Flow control upload:** stop-and-wait (просто, рекомендую для MVP) vs окно N чанков
  (быстрее на высоком RTT). → взял stop-and-wait, окно отложено.
- **GC брошенных сессий/недописанных media** — отдельный тикет (не блокер обмена).
