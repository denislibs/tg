# DNP — Denis Noise Protocol

Полное техническое описание кастомного транспортного протокола проекта.

> **Что это.** DNP — аналог MTProto: собственный бинарный протокол, который несёт **все**
> данные приложения (RPC-запросы, realtime-события, медиа) внутри зашифрованного канала
> поверх Noise Framework. Работает как **defense-in-depth ВНУТРИ WSS** (не E2E, ортогонален
> секретным чатам): даже если TLS скомпрометирован/терминируется прокси, полезная нагрузка
> остаётся зашифрованной ключами, которыми владеют только клиент и бэкенд.
>
> **Статус.** L0–L5 реализованы и проверены на стенде. Раскатка — инкрементально за
> build-time флагом (по умолчанию OFF); бэкенд **dual-stack** (принимает и plain-WS, и DNP).

---

## 1. Обзор и цели

Телеграм-клиент штатно ходит на бэкенд по двум каналам:
- **REST** (HTTP) — команды/запросы (`GET /chats`, `POST /media/upload`, `PUT /media/{id}/content`…);
- **WebSocket** `/ws` — realtime (входящие сообщения, typing, presence, ack'и).

DNP заменяет транспорт для обоих: и REST, и realtime, и медиа-байты идут **одним**
Noise-каналом поверх одного WebSocket-соединения. Наружу (на HTTPS) остаётся только то, что
и в Telegram грузится по HTTPS: WS-upgrade рукопожатие, app-shell/ассеты, web-push.

**Почему Noise, а не «просто TLS».** TLS терминируется на границе (nginx/CDN/LB), и дальше
трафик идёт открытым внутри инфраструктуры; администратор LB видит содержимое. Noise-канал
шифруется end-to-end между **кодом клиента** и **процессом бэкенда** ключами, которые на
границе недоступны — это дополнительный слой (defense-in-depth), как MTProto внутри HTTPS.

**Что это НЕ.** Не E2E между пользователями (для этого — секретные чаты, отдельная фича).
Бэкенд видит plaintext (он и есть один из двух концов Noise-канала).

---

## 2. Терминология и где живёт крипта

| Термин | Значение |
|---|---|
| **Initiator** | клиент (инициатор Noise-хендшейка), статического ключа НЕ имеет |
| **Responder** | бэкенд, владеет статической keypair; клиент пиннит его публичный ключ |
| **CipherState (cs)** | пара «ключ + nonce» для шифрования в одну сторону (после Split их две) |
| **Кадр (frame)** | одна единица на проводе: `u32 BE длина ‖ payload` |
| **kind-байт** | первый байт plaintext внутри кадра: тип полезной нагрузки (0x00/0x01/0x02) |

**Клиентская крипта** — хандрол Noise_NK на [`@noble`](https://github.com/paulmillr/noble)
(curves/ciphers/hashes: X25519, ChaCha20-Poly1305, BLAKE2s). НЕ WebCrypto (у той нет
X25519/ChaCha/BLAKE2s), НЕ noise-c.wasm. Живёт в SharedWorker.

**Серверная крипта** — [`flynn/noise`](https://github.com/flynn/noise) (Go).

**Interop** между двумя реализациями проверен байт-в-байт на зафиксированных векторах
(`noise/fixtures/nk-vector.json`): JS воспроизводит хендшейк, сгенерированный flynn/noise.

---

## 3. Карта слоёв

```
┌─────────────────────────────────────────────────────────────────┐
│ L5  Медиа:  download (file_req/file_chunk) · SW-206 стриминг ·    │
│             upload (file_up-стрим)                                │
├─────────────────────────────────────────────────────────────────┤
│ L4  RPC-туннель:  rpc_req → реплей chi-роутера → rpc_resp         │
├─────────────────────────────────────────────────────────────────┤
│ L3  Realtime:  send_message/message_ack, typing, presence, …     │
│                (те же JSON-кадры {t,d}, что и в plain-WS)         │
├─────────────────────────────────────────────────────────────────┤
│ L2  (не реализован) Мультиплексор потоков — YAGNI, см. §12        │
├─────────────────────────────────────────────────────────────────┤
│ L1  Надёжность:  переподключение, разрыв при nonce-десинке       │
├─────────────────────────────────────────────────────────────────┤
│ L0  Noise-канал:  Noise_NK_25519_ChaChaPoly_BLAKE2s поверх WS     │
│                   рамка `u32 len ‖ sealed`, kind-байт             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. L0 — Noise-канал

### 4.1. Cipher suite и паттерн

```
Noise_NK_25519_ChaChaPoly_BLAKE2s
```
- **NK** — паттерн: инициатор без статического ключа (`N`), responder со статическим,
  **K**nown инициатору заранее (pinned). Даёт аутентификацию сервера (клиент уверен, что
  говорит с владельцем pinned-ключа) + конфиденциальность. Клиент анонимен на уровне Noise
  (его аутентифицирует auth-кадр внутри канала, см. §4.5).
- **25519** — X25519 для DH.
- **ChaChaPoly** — ChaCha20-Poly1305 AEAD.
- **BLAKE2s** — хеш.

Паттерн NK (нотация Noise):
```
NK:
  <- s                    // pre-message: клиент ЗНАЕТ статический публичный ключ сервера
  ...
  -> e, es                // msg1: клиент → сервер
  <- e, ee                // msg2: сервер → клиент
```

### 4.2. Prologue и subprotocol — ДВЕ разные строки

Обе кодируют версию протокола, но играют **разные роли** и имеют **разные значения** —
это неочевидно и критично:

| Строка | Значение | Роль | Ограничения |
|---|---|---|---|
| **Noise prologue** | `dnp/2` | Входные байты в BLAKE2s (привязка хендшейка к версии) | Любые байты — `/` допустим |
| **WS subprotocol** | `dnp.2` | `Sec-WebSocket-Protocol` (dual-mode роутинг) | **token по RFC 2616 — `/` ЗАПРЕЩЁН** |

> ⚠️ **Почему `dnp.2`, а не `dnp/2`.** `/` — separator по RFC 2616, недопустим в
> WS-subprotocol-токене. Браузерный `new WebSocket(url, ['dnp/2'])` кидает `SyntaxError`. Это
> был launch-блокер: DNP-канал не поднимался НИ В ОДНОМ браузере (Go-клиент толерантен к `/`,
> поэтому баг не ловился в Go-тестах). Prologue при этом остаётся `dnp/2` — он не token, а
> байты, и менять его = ломать interop-фикстуры. Итог: **subprotocol `dnp.2`, prologue `dnp/2`.**

### 4.3. Установление соединения (dual-mode)

Клиент открывает WebSocket с subprotocol'ом в зависимости от режима:

```
plain-WS:  new WebSocket(url, ['bearer', <session_token>])   // токен в subprotocol, не в URL
DNP:       new WebSocket(url, ['dnp.2'])                       // Noise-хендшейк внутри
```

Сервер (`ws/handler.go`) роутит по subprotocol:
```go
Subprotocols: []string{"bearer", "dnp.2"}   // эхает выбранный
...
if h.dnpServerPriv != nil && hasSubprotocol(r, "dnp.2") {
    // DNP-ветка: upgrade → dnpAccept (хендшейк + auth-кадр в канале)
} else {
    // plain-ветка: токен из subprotocol → Authenticate → обычный JSON-WS
}
```
Если `DNP_SERVER_PRIVKEY` не задан (`dnpServerPriv == nil`), DNP-ветка выключена, приходит
только plain-WS. Так достигается инкрементальная раскатка.

### 4.4. Формат кадра

Единый формат на проводе (`codec.ts` / `codec.go`):
```
┌──────────────┬─────────────────────────────┐
│ u32 BE длина │ payload (длина байт)         │
└──────────────┴─────────────────────────────┘
```
- `MAX_FRAME_LEN = 1 << 20` (1 МиБ) — верхняя граница payload (= серверный `maxMessageSize`).
- **Хендшейк-кадры:** payload = сырые байты Noise-сообщения (msg1/msg2).
- **Транспортные кадры:** payload = `AEAD-seal(plaintext)`, ассоциированные данные (AD) пустые.

> Префикс длины над WebSocket избыточен (WS сам режет на сообщения), но заложен единообразно
> ради возможного будущего сырого-TCP носителя.

### 4.5. Хендшейк + аутентификация в канале

```
Клиент (initiator)                          Сервер (responder)
──────────────────                          ──────────────────
1. WS open (subprotocol dnp.2)  ──────────▶  upgrade
2. msg1 = NKInitiator.writeMessage1()          hs = NKResponder(prologue=dnp/2, static=priv)
   (e, es)  ──[len‖raw]──────────────────▶  ReadMessage1(msg1)          // (e, es)
3. ReadMessage2(msg2)  ◀──[len‖raw]─────────  msg2 = WriteMessage2()      // (e, ee)
   Split() → cs_send, cs_recv                  Split() → cs0, cs1
4. auth-кадр (JSON kind 0x00, sealed):
   seal({t:"auth", d:{token}})  ──────────▶  Open(recv, ...) → JSON
                                                 auth.Authenticate(token) → user, deviceID
5. канал ГОТОВ (onOpen фаерит)  ◀── (сервер начинает readPump/writePump с этими user/cs)
```

Ключевые моменты:
- **Токен НЕ в URL и не в заголовках** — он приходит первым кадром **внутри** уже
  зашифрованного канала (`{t:"auth", d:{token}}`). Не течёт в логи прокси/nginx.
- `flynn/noise` `Split()` даёт `cs0 = init→resp`, `cs1 = resp→init` (важно для симметрии
  nonce между реализациями).
- До auth-кадра сервер выставляет `SetReadLimit(maxMessageSize)` — oversized-кадр не обойдёт
  границу.

### 4.6. Nonce, разрыв, переподключение (L1)

- AEAD-nonce строго упорядочен и продвигается **только при УСПЕШНОМ** encrypt/decrypt.
- Один битый/потерянный/переставленный кадр → рассинхрон receive-nonce → **все** последующие
  кадры не расшифруются, тихо и навсегда.
- Поэтому при ошибке decode сервер **рвёт соединение** (`readPump` return). Клиент
  переподключается и заново проводит хендшейк. `close()` (умышленный стоп) глушит `onclose`,
  чтобы НЕ переподключаться; `fail()` — наоборот, ведёт к reconnect.

---

## 5. Транспортные кадры и kind-байт

Внутри AEAD-конверта первый байт plaintext — **kind**, остальное — payload по типу kind.
Codec клеит kind на send и снимает+проверяет на receive симметрично.

| kind | Имя | Направление | Payload |
|---|---|---|---|
| `0x00` | JSON | оба | UTF-8 JSON `{"t": <тип>, "d": <данные>}` |
| `0x01` | file_chunk | сервер→клиент | бинарь: 24Б BE заголовок + данные (download) |
| `0x02` | file_up | клиент→сервер | бинарь: 28Б BE заголовок + данные (upload) |

JSON-кадр (`frames.ts`): `encodeFrame(t, d) = JSON.stringify({t, d})`. Все L3/L4-кадры и
ack'и медиа — это kind 0x00. Бинарные kind'ы (0x01/0x02) несут сырые байты медиа без base64
(экономия ~33% и CPU) — так же, как MTProto отделяет TL-контейнеры от file-партов.

`plainCodec` (plain-WS) kind игнорирует — шлёт JSON как WebSocket **text**; бинарные kind'ы
на plain-путь не попадают. `dnpCodec` всё шлёт как WebSocket **binary** (sealed).

---

## 6. L4 — RPC-туннель (REST поверх канала)

Заменяет HTTP REST: команды/запросы едут по каналу и **реплеятся через тот же chi-роутер**.

### 6.1. Кадры

```jsonc
// клиент → сервер (kind 0x00)
{ "t": "rpc_req",  "d": { "req_id": "<uuid>", "method": "GET", "path": "/chats", "body": "" } }
// сервер → клиент (kind 0x00)
{ "t": "rpc_resp", "d": { "req_id": "<uuid>", "status": 200, "body": "<json-строка>" } }
```

### 6.2. Как работает (in-process роутер-реплей)

1. Клиентский `restClient.request(...)`: если `channelRpc.isReady()` — шлёт `rpc_req` и ждёт
   `rpc_resp` по `req_id` (таймаут 30с; `status` вне 2xx → `HttpError`). Иначе — обычный `fetch`.
2. Сервер (`ws/conn.go` `case "rpc_req"`): в горутине (семафор 16) вызывает
   `RPCDispatcher.Dispatch(user, deviceID, method, path, body)`.
3. `RouterRPC` (в http-пакете) строит **синтетический** `http.Request`, прогоняет через ТОТ ЖЕ
   chi-роутер (`httptest.ResponseRecorder`), сериализует ответ в `rpc_resp`.
4. `AuthMiddleware` — **trust-preset**: если юзер уже в ctx (положил канал через `WithUser`),
   ре-аутентификация пропускается. Безопасно: `ctxKey` неэкспортируемый, снаружи не подделать.

Итог: **ноль правок в 258 хендлерах** — тот же роутер, те же usecase, только транспорт другой.

### 6.3. Что туннелируется, что нет

- **Туннелируется:** всё после установления канала — `/chats`, `/media/upload`, `/media/{id}/finalize`,
  `/media/token`, `/drafts`, … (когда `channelRpc.isReady()`).
- **Остаётся HTTP:** логин и пре-канальный REST (`/auth/request_code`, `/auth/sign_in`) — до
  того как канал готов; медиа-**байты** — отдельными бинарными kind'ами (L5), не через rpc_req.

---

## 7. L5 — Медиа: скачивание (download)

Заменяет `GET /media/{id}/content`. Клиент тянет медиа чанками по каналу.

### 7.1. Кадры

```jsonc
// запрос (kind 0x00)
{ "t": "file_req", "d": { "req_id": <u32>, "media_id": <int>, "offset": <int>, "limit": <int> } }
// ответ-ошибка (kind 0x00)
{ "t": "file_err", "d": { "req_id": <u32>, "error": "forbidden|error|busy" } }
```
```
// ответ-данные (kind 0x01, БИНАРЬ) — заголовок Big-Endian 24 байта:
┌──────────────┬──────────────┬──────────────┬──────────┬─────────┐
│ req_id (u32) │ offset (u64) │ total (u64)  │ len (u32)│ data …  │
│      @0      │      @4      │     @12      │   @20    │  @24    │
└──────────────┴──────────────┴──────────────┴──────────┴─────────┘
```

### 7.2. Сервер (`FileStreamer.ReadPart`)

- Проверка прав `CanAccessMedia(userID канала, mediaID)` **ДО** открытия объекта (наличие
  объекта не течёт при отказе).
- `Seek(offset)` → read до `limit`; клэмп к EOF; `total` = полный размер.
- Валидация `limit>0 && offset>=0` → иначе `domain.ErrInvalid`; кап чанка `maxFileChunk = 1 МиБ`.
- Диспатч в горутине (семафор 16), как rpc_req; ошибка доступа → `file_err "forbidden"`.

### 7.3. Клиент (`fileDownload.ts`)

- `fetchFilePart(mediaId, offset, limit)` — корреляция по `req_id`, таймаут; собирает Blob
  циклом (короткие чанки дотягиваются). objectURL создаётся на main-thread, не в воркере.
- Один прямой потребитель — изображения (`useMediaContentUrl` → `contentBlob` → `URL.createObjectURL`).

---

## 8. L5 — Медиа: стриминг видео/аудио (Service Worker 206)

Видео/аудио в `<video src>`/`<audio src>` браузер грузит **Range-запросами**. Их обслуживает
Service Worker, транслируя в чанки по каналу и собирая `206 Partial Content`. Порт tweb
`serviceWorker/stream.ts` + `fixChromiumMp4.ts` — **1:1**.

### 8.1. URL и перехват

При DNP-ON `mediaManager.streamUrl(id)` возвращает
`/dnp-stream/{id}?size=<байт>&mime=<mime>[&mp4fix=1]`. Service Worker (`sw.js`) перехватывает
`fetch` на `/dnp-stream/` и обслуживает через `sw-stream.js`.

### 8.2. Топология: SW ↔ SharedWorker мост

Проблема: байто-источник (`fileDownload`) живёт в **SharedWorker** (там Noise-канал), а SW —
отдельный контекст и напрямую до SharedWorker **не достучится**.

Решение — **MessageChannel, брокеримый окном**, с **SW-инициативой** (по эталону tweb
`serviceWorker/index.service.ts`):

```
      SharedWorker (Noise-канал, fileDownload)
            ▲  port2  (attachStreamBridge)
            │
          ОКНО  (курьер; после handoff — вне пути данных)
            │
            ▼  port1  (dnpBridge.setPort)
      Service Worker (sw.js / sw-bridge.js)
```

- **Восстановление рестарта SW.** SW эфемерный — браузер его перезапускает; in-memory
  `dnpBridge.port` теряется. Поэтому SW **сам** на своём старте (`clients.matchAll`) просит окна
  переотдать порт, если порта нет; окно пингует SW (`dnp-ping`) на boot / `controllerchange` /
  `visibilitychange→visible`. Так мост самозалечивается **без reload вкладки** (проверено:
  DevTools *Stop* SW → повтор стрима отдаёт 206 без перезагрузки).

Control-кадры моста (у приёмников **разные ключи** — sw.js читает `d.type`, worker.ts `d.t`):

| Кадр | От → К | Ключ |
|---|---|---|
| `dnp-ping` | окно → SW | `type` |
| `dnp-request-port` | SW → окно | `type` |
| `dnp-bridge-port` (+MessagePort) | окно → SW | `type` |
| `dnp-bridge-port` (+MessagePort) | окно → SharedWorker | `t` |

Протокол данных по мосту (по MessagePort, SW ↔ SharedWorker):
```jsonc
{ "t": "file_part",        "reqId": <u32>, "mediaId": <int>, "offset": <int>, "limit": <int> }
{ "t": "file_part_ok",     "reqId": <u32>, "bytes": <Uint8Array, transfer>, "total": <int> }
{ "t": "file_part_err",    "reqId": <u32>, "error": <string> }
{ "t": "file_part_cancel", "reqId": <u32> }   // отмена in-flight по таймауту (45с)
```

### 8.3. Range → чанки (`sw-stream.js`, порт stream.ts)

- Размер чанка: `STREAM_CHUNK_MIDDLE_LIMIT = 512КБ`, для файлов >75МБ `UPPER = 1МБ`;
  `SMALLEST = 4КБ`.
- `alignOffset(offset, base)` — округляет offset **вниз** до границы чанка; `alignLimit(limit)`
  — до ближайшей степени двойки. Range, пересекающий границу, тянет второй чанк параллельно,
  результат обрезается до точных байт браузера.
- **Safari `[0,1]`-хак:** на пробный `Range: bytes=0-1` отдаётся сфабрикованный 2-байтный 206
  **без обращения к каналу** (иначе Safari не стартует воспроизведение).
- **Chromium mp4-патч** (`fixChromiumMp4`, армится `?mp4fix=1`): подмена битого AAC ESDS
  (crbug 1250841) на корректный — по чанкам, в том, где реально лежит `esds`.
- Сборка `206`: заголовки `Accept-Ranges`, `Content-Range: bytes X-Y/size`, `Content-Length` по
  фактической длине обрезанного буфера.

> Отложено (осознанно): кэш стрим-чанков (`cachedStreamChunks`), read-ahead 20МБ, точечная
> отмена устаревших `file_req` при перемотке. Сейчас — фиксированный 45с timeout на мост.

---

## 9. L5 — Медиа: загрузка (upload)

Заменяет `PUT /media/{id}/content|parts`. Убирает **последний** медиа-HTTP.

### 9.1. Модель (по MTProto, адаптирована под ОДИН канал и MinIO)

MTProto: файл режется на мелкие части (обычно ~512КБ), сервер накапливает их по (file_id,
part) и собирает. У нас **один** Noise-канал (кадры сериализованы, out-of-order бессмыслен) +
объектное хранилище MinIO (S3-multipart требует part ≥5МБ — не влезает в кадр ≤1МБ). Поэтому:

- Клиент режет файл на **512КБ-чанки**, шлёт **по порядку offset, stop-and-wait** (следующий —
  только после ack предыдущего).
- Бэкенд **стримит** чанки в один объект через `io.Pipe → storage.PutObject` (без S3-multipart,
  без правила 5МБ, память = один чанк). Последний чанк закрывает pipe → объект готов →
  ffmpeg-процессинг (dims/thumbnail). **Отдельного finalize по каналу нет.**

### 9.2. Кадры

```
// клиент → сервер (kind 0x02, БИНАРЬ) — заголовок Big-Endian 28 байт:
┌──────────────┬────────────────┬──────────────┬──────────────┬─────────┐
│ req_id (u32) │ media_id (u64) │ offset (u64) │ total (u64)  │ data …  │
│      @0      │       @4       │     @12      │     @20      │  @28    │
└──────────────┴────────────────┴──────────────┴──────────────┴─────────┘
// len выводится из размера кадра: len = framelen − 28. Последний чанк: offset+len == total.
```
```jsonc
// ack сервера (kind 0x00)
{ "t": "file_up_ok",  "d": { "req_id": <u32> } }
{ "t": "file_up_err", "d": { "req_id": <u32>, "error": "forbidden|order|error|busy" } }
```
Кап чанка `maxFileUpChunk = 512КБ` — sealed-кадр укладывается в read-limit 1МБ.

### 9.3. Сервер (`StreamUploads`, usecase/media)

Сессия per `mediaID` (io.Pipe + горутина PutObject + ожидаемый offset). На КАЖДОМ чанке под
per-session lock:

- **Авторизация на каждом чанке:** сессия хранит `owner`; `ownerID != owner` → `ErrForbidden`.
  (Сессия ключится по mediaID глобально — без этой проверки чужой юзер мог бы дописать в чужой
  аплоад.)
- **Cap:** `total == m.Size` (истина — media-строка, не клиентский total); per-chunk
  `offset+len ≤ total`. Иначе обход лимита размера / переполнение объекта.
- **Порядок:** `offset == session.next` иначе abort сессии + `ErrBadPart`.
- **Fail-fast:** горутина PutObject при ошибке делает `pr.CloseWithError` до записи в result —
  иначе завис бы `pw.Write` до idle-таймера.
- **idle-abort:** нет чанков > 60с → сессия абортится (обрыв канала / брошенный аплоад = GC).
- `GetByID` — вне глобального лока (double-check при повторном захвате), чтобы медленная БД не
  стопорила все сессии.

### 9.4. Клиент (`fileUpload.ts`, `mediaManager`)

- `Transport.sendBinary(data)` — новый метод: `sealFrame(withKind(0x02, data))` (WsClient no-op).
- `uploadStream(mediaId, blob, total, onProgress?, signal?)`: цикл `offset<total`,
  `blob.slice(offset, offset+512K).arrayBuffer()`, `sendChunk` (ждёт `file_up_ok`), прогресс,
  abort-check. Корреляция по `req_id`, таймаут 30с, `onClose`→reject in-flight.
- `mediaManager.upload`: при `fileUpload?.isReady()` (DNP-ON + канал готов) стримит по каналу,
  **без finalize**; иначе — существующий HTTP-путь (`uploadChunked`/`putBytes`) не тронут.
  Метаданные (`POST /media/upload`, size/dims/blur_preview) идут RPC-туннелем (L4).

### 9.5. Превью (thumbnails)

Отдельного байтового upload превью **нет** — паритет с текущей системой: превью 100%
серверное (ffmpeg генерит thumbnail/poster → `ThumbKey`), клиент кладёт `blur_preview` в
метаданные при create (RPC). Это прямой аналог tweb (серверные `photoSize` + инлайн
stripped-thumb). Отдельный thumb-upload в tweb есть только под UX-фичу «выбор кадра-обложки
видео» — у нас отложено в тикет.

---

## 10. Что ВСЕГДА остаётся HTTP (и почему)

Как в Telegram (MTProto несёт данные, но код клиента грузится по HTTPS):
- **WS-upgrade рукопожатие** — сам апгрейд `/ws` идёт по HTTP(S);
- **App-shell и ассеты** (`/`, `/assets/*`, `/sw.js`, `/fonts/*`) — грузятся браузером по HTTPS,
  кэшируются Service Worker'ом;
- **Web-push** — доставляется через push-сервис браузера;
- **Логин / пре-канальный REST** — до готовности канала (`/auth/*`).

---

## 11. Модель безопасности

- **Defense-in-depth ВНУТРИ WSS**, не E2E между юзерами. Бэкенд — легитимный конец канала.
- **Pinning:** в клиент (`VITE_DNP_SERVER_PUBKEYS`) попадает ТОЛЬКО публичный статический ключ
  сервера (списком — ради бесшовной ротации, как tweb `publisKeysHex`). Приватный
  (`DNP_SERVER_PRIVKEY`) — исключительно на бэкенде.
- **Аутентификация клиента** — auth-кадром **внутри** канала (§4.5), токен не в URL/логах.
- **Авторизация медиа** — на каждом запросе: download `CanAccessMedia` до чтения; upload
  `owner` на каждом чанке + cap размера.
- **Анти-CSWSH:** WS-upgrade — только с allow-list origin'ов (те же, что WebAuthn); пустой
  Origin (нативные клиенты/тесты) допускается, аутентификация снимает cross-site.
- **Nonce-десинк** необратим → разрыв+reconnect (§4.6), а не тихая порча.
- **Trust-preset RPC** безопасен: ctxKey неэкспортируемый, юзер кладётся только каналом.

Отложенные харднинги (тикеты, не блокеры; фича за флагом): cap числа одновременных
upload-сессий на юзера (DoS); ротация pinned-ключей (сейчас берётся `[0]`); MAX_NONCE-гард.

---

## 12. Что НЕ реализовано (осознанно)

- **L2 — мультиплексор потоков.** Один канал сериализует кадры → большой медиа-стрим может
  дать head-of-line по realtime. Отложено (YAGNI): на localhost HoL ≈ 0, замерить нужность на
  реальной сети; при подтверждении — контейнеры/потоки поверх канала (аналог MTProto).
- **Кэш стрим-чанков, read-ahead, seek-cancel** (§8.3).
- **Upload:** окно конкуренции частей (сейчас stop-and-wait), resume (в tweb тоже нет),
  video-cover upload.
- **file_reference / CDN / DC-топология / лимиты частей MTProto** — не нужны: у нас `media_id`
  + auth + один бэкенд + MinIO (не Telegram-DC).

---

## 13. Конфигурация

| Параметр | Где | Значение | Эффект |
|---|---|---|---|
| `VITE_DNP_ENABLED` | build-time, клиент | `1` | Клиент использует DNP-транспорт вместо plain-WS/HTTP |
| `VITE_DNP_SERVER_PUBKEYS` | build-time, клиент | hex, через запятую | Pinned публичные ключи сервера (ротация списком) |
| `DNP_SERVER_PRIVKEY` | env, бэкенд | hex | Приватный статик-ключ; **пусто → DNP-ветка выключена** |

Генерация keypair: `cmd/dnpkeygen`. Default — всё OFF (plain-WS + HTTP).

---

## 14. Полный жизненный цикл (пример: отправка и просмотр видео)

```
1. Загрузка приложения:  HTTPS  → app-shell, /assets/*, /sw.js  (Service Worker ставится)
2. Логин:                HTTPS  → POST /auth/request_code, /auth/sign_in  (канал ещё не готов)
3. Открытие канала:      WS(dnp.2) → Noise NK хендшейк → auth-кадр {token} → канал ГОТОВ
4. Синхронизация:        КАНАЛ  → rpc_req GET /chats, /drafts, … (L4)  +  realtime события (L3)
5. Отправка видео:
   a) create:            КАНАЛ  → rpc_req POST /media/upload {size, mime, blur_preview} → media_id
   b) байты:             КАНАЛ  → N× file_up (kind 0x02, offset по порядку, stop-and-wait)
                         сервер: io.Pipe→PutObject собирает объект → ffmpeg (thumb/dims)
   c) сообщение:         КАНАЛ  → send_message (L3) → message_ack
6. Просмотр видео:
   a) <video src>:       /dnp-stream/{id}?size&mime  (Service Worker перехватывает)
   b) Range:             SW → мост → SharedWorker → file_req/file_chunk (kind 0x01) → 206
```
**Ни одного байта медиа по нативному HTTP.** Проверено на стенде: отправка 6МБ-видео →
media-строка + 5.9М-объект в MinIO + thumbnail, **0 HTTP `PUT/POST /media`**.

---

## 15. Карта реализации

**Клиент** (`web-client/src/`):
| Файл | Роль |
|---|---|
| `config/app.ts` | флаг `VITE_DNP_ENABLED`, pinned pubkeys |
| `core/net/transport.ts` | интерфейс `Transport` (общий для plain/DNP) |
| `core/net/wsClient.ts` | plain-WS реализация |
| `core/net/dnp/dnpTransport.ts` | `DnpTransport` — Noise-канал, kind-байт, send/sendBinary/onBinary |
| `core/net/dnp/codec.ts` | `frameLen`/`sealFrame`/`openFrame` (u32 len + AEAD) |
| `core/net/dnp/noise/` | хандрол Noise_NK на @noble (primitives/symmetricState/handshakeState) |
| `core/net/dnp/channelRpc.ts` | L4: `rpc_req`/`rpc_resp` корреляция |
| `core/net/dnp/fileDownload.ts` | L5 download: `file_req`/`file_chunk` |
| `core/net/dnp/fileUpload.ts` | L5 upload: `file_up`-стрим |
| `core/net/dnp/streamBridge.ts` | worker-сторона SW-моста |
| `client/dnpBridgeHandoff.ts` | окно-курьер: ping + handoff портов |
| `public/sw.js`, `sw-bridge.js`, `sw-stream.js` | Service Worker: 206-стриминг + мост |
| `core/managers/mediaManager.ts` | разводка upload/URL (DNP vs HTTP) |

**Бэкенд** (`backend/internal/adapter/delivery/ws/`):
| Файл | Роль |
|---|---|
| `handler.go` | dual-mode роутинг по subprotocol (`bearer`/`dnp.2`) |
| `dnp_accept.go` | хендшейк + auth-кадр в канале → user/deviceID |
| `dnp/noise.go` | flynn/noise NK responder (prologue `dnp/2`) |
| `dnp/codec.go` | Seal/Open/EncryptFrame + kind-байт |
| `conn.go` | `frameCodec`-шов, `readPump` (ветвление kind), диспатч rpc_req/file_req/file_up |
| `file.go`, `upload.go` | `FileDispatcher`/`UploadDispatcher` + сериализация кадров |
| `../http/router_rpc.go` | L4: реплей chi-роутера (`RouterRPC`, `WithUser`) |
| `../http/file_stream.go` | L5 download: `FileStreamer.ReadPart` |
| `../http/media_uploader.go` | L5 upload: адаптер → usecase |
| `usecase/media/stream_upload.go` | L5 upload: `StreamUploads` (io.Pipe→PutObject, сессии) |
| `cmd/dnpkeygen` | генерация статической keypair |

**Спеки/планы:** `docs/superpowers/specs/2026-08-*-dnp-*`, `docs/research/2026-08-01-dnp-noise-transport-protocol.md`.
