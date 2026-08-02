# DNP — Denis Noise Protocol

**Статус:** дизайн-документ (реализации ещё нет). Описание целевого транспортного протокола
и карта референса — MTProto-подсистемы tweb.
**Дата:** 2026-08-01.
**Автор решения:** пользователь (выбор из brainstorming-сессии).

> DNP — наш собственный транспортный протокол: функциональный аналог MTProto-транспорта
> Telegram, но построенный на выверенной криптографии (**Noise Protocol Framework**) вместо
> самодельного AES-IGE. Цель — унести **весь** прикладной трафик (realtime, RPC-запросы к
> бэку, файлы) в единый зашифрованный канал поверх WebSocket, без опоры на нативный HTTP,
> с безопасностью **не ниже** MTProto.

Ссылки на tweb ведут в соседний репозиторий `/Users/denisurevic/Documents/tweb`
(относительно этого файла — `../../../tweb/...`). tweb — это **эталон** (см. корневой
`CLAUDE.md`): поведение и структуру берём 1:1 оттуда, крипто-примитивы — заменяем на Noise.

---

## 1. Зачем это и что именно строим

Сейчас у нас:

- **Транспорт** — WSS (TLS) + голый JSON-кадр `{t, d}` (`web-client/src/protocol/frames.ts`,
  `backend/internal/adapter/delivery/ws/frames.go`). TLS шифрует канал, но на nginx
  терминируется, и дальше до Go-бэка трафик идёт в открытом виде.
- **RPC к бэку** — отдельный REST-пласт (`web-client/src/core/net/restClient.ts` + ~40
  менеджеров), тоже за TLS.
- **Медиа** — нативный `GET /api/media/{id}/content?token=…` с HTTP Range за TLS
  (`web-client/src/core/mediaUrl.ts`).
- **Токен** — в URL WS-хендшейка (`?token=`) и в `Authorization`-заголовке REST.

DNP заменяет транспортный слой: после установления WSS клиент и сервер прогоняют
**Noise-хендшейк**, получают две симметричные AEAD-cipher-state и дальше **всё** гоняют
внутри зашифрованного канала — realtime-кадры, RPC-запросы (вместо REST), а в полной
версии и файлы (вместо нативного медиа-HTTP). Токен уходит из URL **внутрь** канала.

### Threat model (что защищаем)

| Угроза | TLS сейчас | + DNP |
|---|---|---|
| Пассивный перехват в сети | ✅ | ✅ (двойной слой) |
| Компрометация TLS-терминатора (nginx), корпоративный MITM-прокси, «дружественный» перехват на балансировщике | ❌ трафик виден в открытом виде за nginx | ✅ шифртекст доходит до Go-бэка |
| Подмена сервера на хендшейке | зависит от CA | ✅ **pinning** статического ключа сервера в билд |
| Утечка токена в URL/логах/реферере | ⚠️ токен в query WS | ✅ токен внутри канала |
| Сервер читает контент (E2E) | — | **вне scope DNP** (это транспорт, не E2E; см. §9) |

**Ключевая рамка:** DNP — это **транспортное** шифрование (как MTProto для облачных чатов).
Сервер по-прежнему видит расшифрованный контент. Защита «сервер не видит» — это отдельный
E2E-слой (у нас уже есть для секретных чатов, `web-client/src/core/secret/`). DNP и E2E
ортогональны и складываются.

### Non-goals (сознательно НЕ делаем)

- **Обфускация / обход DPI.** Не маскируем трафик под шум на уровне DNP. Против блокировки по
  SNI это всё равно не помогает (подробный разбор и honest-поправка — §10).
- **Множественные дата-центры.** У MTProto трафик расходится по DC; у нас один бэкенд.
- **Замена E2E.** DNP не заменяет секретные чаты.

---

## 2. Выбор криптографии (и почему ≥ MTProto)

### 2.1 Noise Protocol Framework

Noise — фреймворк построения зашифрованных протоколов на базе DH + AEAD, вычитанный
криптографами; на нём построены транспорт **WireGuard** и **WhatsApp**. Он решает ту же
задачу, что хендшейк MTProto (обмен ключами по Диффи-Хеллману → вывод симметричных
ключей), но стандартной, проверенной конструкцией.

**Паттерн: `Noise_NK`.**

- `N` — у **инициатора (клиент)** нет статического ключа. Браузер — эфемерный клиент;
  личность пользователя удостоверяется **токеном** внутри канала, а не Noise-ключом.
- `K` — статический ключ **ответчика (сервер)** **известен** клиенту заранее (запечён в
  билд — pinning).

Что даёт NK:
- **Аутентификация сервера** — клиент шифрует к статическому ключу сервера; MITM без
  приватного ключа сервера не установит сессию.
- **Forward secrecy** — за счёт эфемерных ключей обеих сторон (ee).
- **Анонимность клиента на уровне транспорта** — сервер не знает, кто подключился, пока не
  получит токен первым кадром (ровно как TLS с server-only auth).

Схема сообщений `Noise_NK` (три «строки»):
```
  <- s                (pre-message: клиент заранее знает статический pubkey сервера)
  ...
  -> e, es            (msg1: клиент шлёт эфемерный ключ + DH(эфемерный_клиент, статик_сервер))
  <- e, ee            (msg2: сервер шлёт эфемерный ключ + DH(эфемерный_сервер, эфемерный_клиент))
```
После msg2 у обеих сторон — общий secret и две AEAD-cipher-state (одна на «клиент→сервер»,
другая на «сервер→клиент»).

**Cipher suite:** `Noise_NK_25519_ChaChaPoly_BLAKE2s`
(Curve25519 для DH, ChaCha20-Poly1305 для AEAD, BLAKE2s для хеша). ChaCha20-Poly1305 —
быстр в софте и на мобильных (нет зависимости от AES-NI), стандартен в Noise/WireGuard.
Альтернатива — `AESGCM` (если хотим AES-NI на сервере), решаем на этапе реализации.

**Будущее (не сейчас):** если захотим привязку к устройству (device key binding) —
переключаемся на `Noise_IK`, где у клиента появляется собственный статический ключ.
NK→IK — смена одной константы паттерна, каркас тот же.

### 2.2 Почему это «не ниже» MTProto

| | MTProto 2.0 | DNP (Noise_NK) |
|---|---|---|
| Обмен ключами | RSA + custom DH на 2048-битном safe-prime | Curve25519 ECDH (стандарт) |
| Симметричное шифрование | AES-256-**IGE** (нестандартный режим) | ChaCha20-Poly1305 (AEAD, стандарт) |
| MAC | `msg_key` = срез SHA-256 от плейнтекста (нестандартная конструкция) | встроенный Poly1305 (AEAD) |
| Аутентификация сервера | fingerprints зашитых RSA-ключей | pinned Curve25519 static key |
| Replay-защита | `msg_id` кодирует время | встроенный монотонный nonce Noise |
| Ревью | критиковался академией за самодельные кирпичи | формально проанализированный фреймворк |

Noise закрывает те же свойства **стандартными** примитивами. Плюс DNP работает **внутри
TLS** (defense-in-depth), чего у MTProto нет. Вывод: по стойкости DNP ≥ MTProto.

### 2.3 Библиотеки

- **Go (сервер):** [`github.com/flynn/noise`](https://github.com/flynn/noise) — эталонная
  реализация Noise, поддерживает NK/IK, Curve25519, ChaChaPoly, BLAKE2s.
- **JS/TS (клиент, в воркере):** **JS/WASM-библиотека для всех примитивов Noise** —
  `@stablelib/*` (x25519, chacha20poly1305, blake2s) + тонкая обёртка хендшейка NK, либо
  готовая `noise-c.wasm` / `noise-protocol`. **Решение принято** (см. §2.4): именно
  библиотека, а не WebCrypto. Это чистый JS/WASM, DOM не нужен, в воркере работает так же,
  как WebCrypto, и даёт полный `Noise_NK_25519_ChaChaPoly_BLAKE2s` без оглядки на версии
  браузеров. Выбор конкретной библиотеки (`@stablelib` vs `noise-c.wasm`) — на этапе
  реализации (взвесить размер бандла и аудируемость).

### 2.4 Почему библиотека, а не WebCrypto (решено)

`crypto.subtle` в воркере доступен и у нас **уже используется** (секретные чаты делают
ECDH+HKDF+AES-GCM в SharedWorker, `web-client/src/core/secret/crypto.ts`). Но WebCrypto **не
покрывает набор примитивов Noise**:

| Примитив Noise | В WebCrypto? |
|---|---|
| X25519 (DH) | появился недавно, поддержан неравномерно по браузерам |
| ChaCha20-Poly1305 (AEAD) | **нет** (только AES-GCM/CBC/CTR) |
| BLAKE2s (hash) | **нет** (только SHA-1/256/384/512) |

Варианты были:
1. **JS/WASM-библиотека на все примитивы** — полный `…_ChaChaPoly_BLAKE2s`, без завязки на
   версии браузеров. **← выбрано.**
2. WebCrypto-дружелюбный сьют `Noise_NK_25519_AESGCM_SHA256` — AEAD/хеш нативные, но X25519
   всё равно из библиотеки. Полукомпромисс, смысла мало.

Библиотека (путь 1) — чистый JS/WASM, DOM не нужен, в SharedWorker живёт штатно (как
WebCrypto), cipher-state не покидает воркер, наружу ходят только `ArrayBuffer` (transferable).

---

## 3. Слоистая архитектура

DNP — не один слой, а стек. У MTProto эти слои встроены неявно (или разнесены по DC); у нас
их надо спроектировать явно. Порядок снизу вверх:

```
┌─ Прикладной слой: менеджеры, realtime-проектор, медиа-бабл ────────────┐
├─ L5  File API: getFile(offset,limit) + upload по чанкам                │  медиа-подсистема
│      + Service Worker, эмулирующий HTTP 206 Range для <video>/<img>    │  (эталон: stream.ts)
├─ L4  RPC-over-channel: request/response по req_id, маппинг ошибок      │  заменяет REST
├─ L3  Realtime: кадры {t,d} (уже есть — переезжают внутрь канала)       │
├─ L2  Мультиплексор: stream_id + приоритеты + backpressure              │  анти-HoL
├─ L1  Надёжность: msg_id / ack / dedup / resend / backoff               │  частично есть
│      + reconnect = новый Noise-хендшейк                                │
├─ L0  Noise secure channel: NK-хендшейк + AEAD-конверт на каждый кадр   │  фундамент
└─ Транспорт: WSS (один или несколько сокетов) ────────────────────────┘
```

### L0 — Noise secure channel (фундамент)

**Что:** установление зашифрованного канала и AEAD-обёртка каждого кадра.

**Как работает:**
1. Клиент открывает WSS `/ws` (без `?token=`), `binaryType = 'arraybuffer'`.
2. **Хендшейк** (2 бинарных кадра): клиент → msg1 (`e, es`), сервер → msg2 (`e, ee`).
   В `prologue` кладём версию протокола (`"dnp/1"`) — привязывает хендшейк к версии,
   защищает от downgrade.
3. Получены две cipher-state. Дальше каждый прикладной кадр:
   ```
   plaintext  = сериализованный кадр (см. L1/L3)
   nonce      = встроенный счётчик cipher-state (монотонный, по одному на направление)
   ciphertext = ChaCha20Poly1305.Encrypt(key_send, nonce, ad="", plaintext)
   ```
   Отправляется как бинарный WS-фрейм. На приёме — `Decrypt`. Повтор/пропуск ловится
   монотонным nonce.
4. **Аутентификация пользователя:** первым прикладным кадром внутри канала клиент шлёт
   `auth { token }`. Сервер валидирует `token_hash` (как сейчас в
   `backend/internal/domain/token.go`) и только потом принимает остальные кадры.

**Эталон в tweb:** хендшейк — [`authorizer.ts`](../../../tweb/src/lib/mtproto/authorizer.ts)
(у нас на порядок проще — Noise вместо RSA+DH-ручного); AEAD-обёртка кадра — концептуально
[`networker.ts`](../../../tweb/src/lib/mtproto/networker.ts) `getEncryptedOutput` /
`parseResponse` (у нас — вызов Noise cipher-state вместо ручного
[`messageKeyUtils.ts`](../../../tweb/src/lib/mtproto/messageKeyUtils.ts) +
[`aesIGE.ts`](../../../tweb/src/lib/crypto/utils/aesIGE.ts)).

**Pinning:** статический pubkey сервера — константа в билде фронта (`VITE_DNP_SERVER_PUBKEY`).
Ротация = пересборка фронта (у нас фронт и бэк деплоятся вместе через compose — не проблема).
Эталон концепции — зашитые RSA-фингерпринты
[`rsaKeysManager.ts`](../../../tweb/src/lib/mtproto/rsaKeysManager.ts).

**Ротация pinned-ключа — пинить массив, а не один ключ.** Pinning означает: если серверную
пару ключей меняют/компрометируют, новый публичный ключ доедет до клиентов только с новым
билдом. При этом уже загруженные вкладки и закэшированный app-shell продолжают работать на
старом билде — одномоментного передеплоя всех клиентов не бывает. Поэтому на будущее стоит
пинить **массив** ключей (текущий + следующий), чтобы во время ротации клиент принимал оба и
плавно переходил на новый, — ровно как tweb держит `publisKeysHex`
([`rsaKeysManager.ts`](../../../tweb/src/lib/mtproto/rsaKeysManager.ts)) **списком**, а не одним
ключом. Приватный ключ при этом всегда остаётся только на сервере, в клиент попадают исключительно
публичные.

### L1 — Надёжность

**Что:** гарантированная доставка поверх «рвущегося» WS.

**Как:** большая часть уже есть в
[`connectionManager.ts`](../../web-client/src/core/realtime/connectionManager.ts)
(`web-client/src/core/realtime/connectionManager.ts`): durable outbox в IndexedDB, resend
неподтверждённых при реконнекте, дедуп по `client_msg_id`, exp backoff, ping/pong grace.
DNP добавляет:
- **msg_id** на каждый кадр канала (монотонный), **ack** и **дедуп входящих** (последние
  N msg_id в Set) — сейчас это только для `send_message`, DNP обобщает на все кадры.
- **reconnect = новый хендшейк.** Обрыв WS → новый Noise-хендшейк (новые эфемерные ключи),
  затем повторная `auth`, затем resend неподтверждённого.

**Эталон:** механика надёжности [`networker.ts`](../../../tweb/src/lib/mtproto/networker.ts):
`sentMessages`/`pendingMessages` (трекинг до ack), `resend()`/`pushResend` (на реконнект),
`ackMessage`/`processMessageAck` (батч-ack до 8192), контейнеры ≤640КБ
(`performScheduledRequest`), `lastServerMessages: Set` (дедуп, cap 100),
`sendPingDelayDisconnect` (graceful keepalive). У нас `msg_id` не нужен для транспортной
целостности (её даёт WS/TLS+Noise-nonce), но нужен для ack/дедупа/resend на **прикладном**
уровне — как и решили в `docs/research/2026-06-23-tweb-architecture-findings.md`.

### L2 — Мультиплексор (критичный слой)

**Что:** несколько независимых логических потоков в одном канале.

**Зачем:** как только по одному упорядоченному каналу идут realtime + RPC + файлы, большой
файл **застопорит** доставку сообщений (head-of-line blocking). MTProto избегает этого
несколькими TCP-соединениями к разным DC. У нас — явный мультиплексор.

**Как (варианты, решаем на реализации):**
- **App-level мультиплексор:** у каждого кадра `stream_id` + приоритет (realtime > RPC >
  file), сервер и клиент чередуют обслуживание потоков, крупные файловые чанки нарезаются,
  чтобы не занимать канал монопольно. Backpressure по окну на поток.
- **Несколько параллельных Noise-каналов** (несколько WS): realtime — свой сокет, файлы —
  свой. Проще по коду, ближе к «нескольким DC» MTProto, но больше сокетов/хендшейков.

**Эталон:** явного «мультиплексора» в tweb нет (его роль играют раздельные networker'ы на
DC — [`dcConfigurator.ts`](../../../tweb/src/lib/mtproto/dcConfigurator.ts),
[`networkerFactory.ts`](../../../tweb/src/lib/appManagers/networkerFactory.ts): отдельные
networker'ы для client/download/upload). Наш L2 — эквивалент этого разделения в одном канале.

### L3 — Realtime

**Что:** существующие кадры `{t, d}` (new_message, read, typing, presence, reaction, …).

**Как:** формат кадра не меняется — он просто становится payload'ом внутри L0/L1-конверта.
Насос `smp → eventBus` (`web-client/src/client/realtimeBridge.ts`) и Store-проектор — без
изменений. Меняется только транспорт под ними.

### L4 — RPC-over-channel (заменяет REST)

**Что:** все запросы менеджеров (`listDialogs`, `sendMessage`-команды, настройки, контакты…)
идут запросами-ответами внутри канала вместо REST-fetch.

**Как:** кадр `rpc_request { req_id, method, args }` → кадр `rpc_response { req_id, result }`
или `rpc_error { req_id, code, message }`. Корреляция по `req_id`. **Бонус:** сейчас
HTTP-статусы теряются через RPC-границу воркера (см. комментарий в
`web-client/src/core/managers/chatsManager.ts` про `ReadDateResult`) — DNP несёт код ошибки
явно, проблема уходит. `restClient.ts` меняет реализацию (fetch → канал), но публичный
интерфейс (`get/post/put/del`) сохраняем — менеджеры не трогаются.

**Эталон:** [`apiManager.ts`](../../../tweb/src/lib/appManagers/apiManager.ts) (`invokeApi` —
точка входа RPC, корреляция, маппинг ошибок, миграции) и
[`apiManagerMethods.ts`](../../../tweb/src/lib/appManagers/apiManagerMethods.ts)
(`invokeApiSingle`/`Cacheable`/`Hashable`, кэш ответов). У нас проще — один бэкенд, без
DC-миграций.

### L5 — File API + Service Worker (медиа)

**Что:** загрузка/скачивание/стриминг медиа через канал вместо нативного HTTP.

**Почему это отдельная война:** сейчас медиа работает нативно — `<img src>`, `<video>` с
HTTP Range (перемотка), Service Worker кэширует (`web-3g-load-opt`). Чтобы пустить медиа
через канал, надо воспроизвести файловый API Телеграма:
- **Чанковый down/upload:** `getFile(location, offset, limit)` кусками (512КБ/1МБ),
  `saveFilePart` при загрузке.
- **Service Worker, подделывающий `206 Partial Content`:** `<video src>` указывает на
  фейковый URL, SW перехватывает `fetch`, парсит заголовок `Range`, тянет нужные чанки из
  воркера через канал и **конструирует ответ 206** с `Content-Range`/`Accept-Ranges`. Для
  браузера — обычный HTTP-сервер с Range, под капотом — байты из зашифрованного канала.

**Эталон (прямой чертёж, брать 1:1):**
- [`stream.ts`](../../../tweb/src/lib/serviceWorker/stream.ts) — эмуляция 206 Range, выравнивание
  диапазона на границы чанков, предзагрузка, mp4-патч Chromium, хак «первого Range» Safari.
- [`apiFileManager.ts`](../../../tweb/src/lib/appManagers/apiFileManager.ts) — чанковый
  down/upload, очередь конкурентности, file-reference refresh.
- [`download.ts`](../../../tweb/src/lib/serviceWorker/download.ts) — save-to-disk через
  `ReadableStream`.
- [`serviceMessagePort.ts`](../../../tweb/src/lib/serviceWorker/serviceMessagePort.ts) —
  контракт SW ↔ воркер (`requestFilePart` → `MyUploadFile`, cancel, download*).
- Хранилища: [`cacheStorage.ts`](../../../tweb/src/lib/files/cacheStorage.ts),
  [`streamWriter.ts`](../../../tweb/src/lib/files/streamWriter.ts),
  [`downloadWriter.ts`](../../../tweb/src/lib/files/downloadWriter.ts),
  [`memoryWriter.ts`](../../../tweb/src/lib/files/memoryWriter.ts).

**Компромисс:** у Телеги нет выбора (сервер отдаёт файлы только по MTProto). У нас нативный
медиа-HTTP уже работает и оптимизирован. L5 — это добровольно отстроить SW-стриминг заново
ради сокрытия байтов, которые за TLS (и опц. E2E) уже зашифрованы. Поэтому L5 — **последняя**
фаза, отдельным подпроектом; до неё медиа остаётся на TLS.

### 3.7 Размещение крипты в воркере и производительность (L0–L4 vs L5)

Где именно исполняется Noise-крипта — не деталь реализации, а решение с последствиями для
задержек. Разбор по фазам.

**Факт-база.** Наш воркер — **SharedWorker** (`web-client/src/client/bootstrap.ts:28`, фолбэк
на обычный `Worker`), и в нём уже штатно работает WebCrypto: секретные чаты делают там
ECDH+HKDF+AES-GCM (`web-client/src/core/secret/crypto.ts`). JS/WASM-библиотека Noise (§2.3) —
такой же обитатель воркера: DOM ей не нужен, cipher-state держится внутри воркера, наружу
ходят только `ArrayBuffer` (transferable). То есть «крипта в воркере» у нас — уже проверенный
факт, а не гипотеза.

**Профиль нагрузки у DNP-крипты неоднородный.** AEAD-обёртка (§ L0) вызывается на **каждый**
кадр канала, но кадры бывают двух очень разных классов:

| Класс трафика | Слои | Размер/частота | Стоимость крипты |
|---|---|---|---|
| Управляющий (realtime-события, RPC-запросы/ответы, ack, ping) | L1–L4 | сотни байт, редко | **копейки** — encrypt/decrypt на мелком буфере незаметен |
| Массовый (медиа-чанки при стриминге/скачивании) | L5 | 512 КБ–1 МБ на чанк, поток мегабайтов/сек | **тяжёлый** — расшифровка идёт непрерывно, конкурирует за поток воркера |

**Почему это важно.** Если объёмную расшифровку медиа гнать в **том же** потоке, где живут
`WsClient`/`connectionManager` и диспетчер realtime-кадров, то долгая расшифровка большого
видео-чанка **задержит обработку** пришедшего в тот же момент `new_message`/ack. Это тот же
head-of-line blocking, что и на уровне канала (§ L2), только уже на уровне **CPU воркера**, а
не сокета. Для мелких управляющих кадров этой проблемы нет — они слишком дёшевы, чтобы кого-то
задержать.

**Как это решает эталон (tweb).** tweb выносит объёмную симметричную крипту в **отдельные,
выделенные крипто-воркеры**: mtproto-воркер общается с ними через
[`cryptoMessagePort.ts`](../../../tweb/src/lib/crypto/cryptoMessagePort.ts), а сам крипто-воркер
[`crypto.worker.ts`](../../../tweb/src/lib/crypto/crypto.worker.ts) диспатчит операции по
реестру [`cryptoMethodsRegistry.ts`](../../../tweb/src/lib/crypto/cryptoMethodsRegistry.ts).
Ключевая деталь: `cryptoMessagePort` держит **несколько** портов к нескольким крипто-воркерам
и **раскидывает encrypt/decrypt по ним round-robin'ом** — так массовая расшифровка файловых
чанков параллелится по ядрам и не отбирает поток у сетевой логики. То есть у tweb сеть и
объёмная крипта **физически в разных потоках**.

**Наш план по фазам:**

- **Фундамент и туннель (L0–L4)** — крипта живёт в **том же SharedWorker**, рядом с
  `WsClient`/`connectionManager`. Один хендшейк, одна Noise-сессия, шаренная на все вкладки
  (у нас один WS шарится между вкладками — как в tweb). Управляющие кадры дёшевы, отдельный
  поток не нужен, лишняя граница postMessage только добавила бы задержку. Это осознанно
  **простой** старт.
- **Медиа (L5)** — когда по каналу пойдут файловые чанки, у нас два пути, выбор — по
  замерам на стенде:
  1. **Выделенный крипто-воркер** (или пул, round-robin) по образцу tweb — объёмная
     расшифровка чанков уходит с сетевого потока; сетевой воркер только перекладывает
     `ArrayBuffer`'ы (transferable, без копирования). Это «правильный» вариант при высокой
     нагрузке.
  2. **Оставить в том же воркере**, если замеры покажут, что хватает: WASM-ChaCha20-Poly1305
     выдаёт **сотни МБ/с**, а Service-Worker-стриминг (§ L5) и так подтягивает чанки по
     мере проигрывания (не весь файл разом), так что пиковая нагрузка на крипту ограничена
     битрейтом видео, а не размером файла. Часто этого достаточно.

  **Критерий выбора:** на стенде `:38443` замерить, задерживает ли доставка realtime-кадров
  во время активного стриминга видео. Если да — путь 1; если нет — путь 2 (проще). Решение
  фиксируется в спеке подпроекта #4, не сейчас.

**Вывод:** «крипта в отдельном воркере» — это не про L0–L4 (там достаточно основного
SharedWorker), а про L5, и то как **условие, включаемое по замерам**. Каркас один и тот же:
JS/WASM-примитивы Noise, cipher-state в воркере, `ArrayBuffer` через границу.

---

## 4. Формат кадра (черновик, финализируется на реализации)

Внутри Noise-конверта — бинарный кадр DNP. Черновая раскладка:

```
DNP frame (внутри AEAD-конверта):
  ┌────────┬─────────┬──────────┬───────────┬─────────────────┐
  │ ver(1) │ kind(1) │ msg_id(8)│ stream(2) │ payload (varlen)│
  └────────┴─────────┴──────────┴───────────┴─────────────────┘
  kind: 0=auth 1=ack 2=realtime 3=rpc_req 4=rpc_resp 5=rpc_err
        6=file_req 7=file_chunk 8=ping 9=pong
  payload: для realtime/rpc — JSON или MessagePack {t,d}/{method,args}
```

Кодирование payload (JSON vs MessagePack/бинарь) — решение этапа реализации; на L3/L4 проще
начать с JSON (совместимо с текущими кадрами), файловые чанки (L5) — всегда бинарь.

**Length-framing (важно для носитель-агностичности, см. §10.8).** Кадр DNP несёт **свой
префикс длины**, а не полагается на границы WebSocket-сообщений. Над WS это «избыточно» (там
каждый `ws.send` — уже отдельное сообщение), но потоковый носитель (сырой TCP) границ не даёт —
поток байт надо резать самому. Заложив length-prefix в кодек сразу, мы даём будущему TCP-бэкенду
слотиться без правок L0/L1 (ровно как кодеки tweb `abridged`/`intermediate`/`padded` кадрируют
TCP-поток). Схема выше — это payload **внутри** length-framed конверта.

---

## 5. Интеграция в наш репозиторий

### Фронтенд (`web-client/`)
- **Новый модуль** `web-client/src/core/net/dnp/` — Noise-хендшейк, cipher-state, кодек кадра,
  мультиплексор. Живёт в воркере (крипто уже там).
- [`wsClient.ts`](../../web-client/src/core/net/wsClient.ts) — обёртывается
  DNP-слоем: `binaryType='arraybuffer'`, хендшейк на `connect()`, encode/decode кадров.
- [`connectionManager.ts`](../../web-client/src/core/realtime/connectionManager.ts)
  — обобщить outbox/ack/resend с `send_message` на любой кадр канала; reconnect → rehandshake.
- `restClient.ts` (L4) — реализацию с fetch на RPC-over-channel, интерфейс сохранить.
- Точка сборки транспорта: `web-client/src/core/worker.ts:250` (`new WsClient('/ws')`),
  `:259` (`newConnectionManager`).
- `.env`: `VITE_DNP_SERVER_PUBKEY` (pinned static key).

### Бэкенд (`backend/`)
- **Новый пакет** `backend/internal/adapter/delivery/ws/dnp/` — серверный Noise-хендшейк
  (`flynn/noise`, responder), cipher-state, кодек, мультиплексор.
- [`handler.go`](../../backend/internal/adapter/delivery/ws/handler.go) —
  после upgrade прогнать Noise-хендшейк **до** аутентификации; токен теперь приходит первым
  кадром `auth` внутри канала, а не из `?token=`.
- [`conn.go`](../../backend/internal/adapter/delivery/ws/conn.go) —
  read/write pump оборачивают Decrypt/Encrypt; L4 добавляет RPC-роутинг к usecase'ам.
- Статический ключ сервера: секрет в конфиге (env/секрет-менеджер), приватный — только на
  сервере; публичный — в билд фронта.
- Точка монтирования: `backend/internal/adapter/delivery/http/router.go:52`
  (`r.Get("/ws", …)`), сборка — `backend/internal/app/server.go:200`.
- `nginx` — **менять не нужно**: DNP идёт внутри тех же WSS-кадров, nginx проксирует их как
  есть (уже проверено, что `/ws` за TLS работает).

---

## 6. Декомпозиция на подпроекты (roadmap)

Одной веткой это не делается — гарантированный месяц незакоммиченного кода без живой
проверки. Каждый подпроект — своя спека → план → реализация, проверяется на стенде
(`:38443`, проект `msgrverify`) перед следующим.

| # | Подпроект | Слои | Объём | Живой критерий |
|---|---|---|---|---|
| 1 | **Фундамент** | L0 + L1 | средний | realtime-кадры идут через Noise-канал, токен внутри, reconnect=rehandshake; чат работает |
| 2 | **Мультиплексор** | L2 | средний | несколько логических потоков без HoL, backpressure |
| 3 | **RPC-туннель** | L4 | крупный | все менеджеры с REST на канал, коды ошибок сохранены |
| 4 | **File API + SW-стриминг** | L5 | крупный+ | медиа через канал, перемотка видео (206) работает |
| 5 | **Ключи** | — | малый | ротация статического ключа, версионирование `dnp/N` |

**Первая ветка (по решению из brainstorming): #1 «Фундамент» (L0+L1)** — из `main`, имя
ветки предположительно `feat/dnp-transport`.

---

## 7. Полная карта MTProto-подсистемы tweb (референс)

Пути относительно `/Users/denisurevic/Documents/tweb`. Это то, что мы воспроизводим (крипто —
на Noise, DC-специфику — опускаем). Сгруппировано по слоям DNP.

### 7.1 Хендшейк / auth key → **DNP L0**
- [`src/lib/mtproto/authorizer.ts`](../../../tweb/src/lib/mtproto/authorizer.ts) — полный
  MTProto-хендшейк генерации auth-key (`req_pq_multi` → факторизация PQ → `req_DH_params` с
  RSA-шифрованием → server DH → `set_client_DH_params` → `dh_gen_ok`), проверка nonce, DH
  против пиннутого safe-prime, perm/temp (PFS) ключи, начальный `server_salt`. **DNP-аналог: Noise_NK
  msg1/msg2 — на порядок проще.**
- [`src/lib/mtproto/authKey.ts`](../../../tweb/src/lib/mtproto/authKey.ts) — value-класс
  256-байтного ключа + id + PFS-биндинг.
- [`src/lib/mtproto/rsaKeysManager.ts`](../../../tweb/src/lib/mtproto/rsaKeysManager.ts) —
  зашитые публичные RSA-ключи сервера + фингерпринты. **DNP-аналог: pinned Curve25519 pubkey.**
- [`src/lib/mtproto/dcConfigurator.ts`](../../../tweb/src/lib/mtproto/dcConfigurator.ts) —
  маппинг DC+тип соединения → транспорт, зашитые IP/host, сборка `wss://…/apiws`. **DNP: один
  бэкенд, но идея «разные соединения под разные задачи» → наш L2.**
- [`src/lib/mtproto/timeManager.ts`](../../../tweb/src/lib/mtproto/timeManager.ts) —
  генерация монотонных `msg_id` + `timeOffset` с сервером. **DNP L1: msg_id (проще — без
  привязки ко времени).**
- [`src/lib/mtproto/messageKeyUtils.ts`](../../../tweb/src/lib/mtproto/messageKeyUtils.ts) —
  вывод `aesKey`/`aesIv` из `authKey`+`msgKey` (MTProto 2.0 SHA-256 KDF) и вычисление
  `msgKey`. **DNP: заменяется KDF внутри Noise — писать не нужно.**

### 7.2 Networker (message layer) → **DNP L1**
- [`src/lib/mtproto/networker.ts`](../../../tweb/src/lib/mtproto/networker.ts) — ядро
  `MTPNetworker`: сериализация/шифрование исходящих контейнеров, разбор/дедуп/диспатч
  входящих, PFS-биндинг, gzip, ping, WS/HTTP. **Главный референс надёжности (см. §3 L1).**
- [`src/lib/appManagers/networkerFactory.ts`](../../../tweb/src/lib/appManagers/networkerFactory.ts)
  — фабрика networker'ов, инжект `timeManager`/`initConnection`, персист server-salt,
  `startAll`/`stopAll`/`forceReconnect`.
- [`src/lib/mtproto/connectionStatus.ts`](../../../tweb/src/lib/mtproto/connectionStatus.ts) —
  enum статуса соединения + payload события. **DNP: у нас уже есть `connectionStore`.**
- [`src/lib/mtproto/networkStats.ts`](../../../tweb/src/lib/mtproto/networkStats.ts) — счётчик
  байт по DC + `waitForChunk`.
- [`src/lib/mtproto/tl_utils.ts`](../../../tweb/src/lib/mtproto/tl_utils.ts) — TL-бинарный
  (де)сериализатор (`store*`/`fetch*`, gzip_packed). **DNP: наш кодек кадра (§4), проще TL.**
- [`src/lib/mtproto/schema.ts`](../../../tweb/src/lib/mtproto/schema.ts) — сгенерированная
  TL-схема (конструкторы/методы всего API-слоя). **DNP: у нас REST-контракт, TL не нужен.**

### 7.3 Транспорты → **DNP L0/транспорт (+ обфускация = вне scope)**
- [`src/lib/mtproto/transports/transport.ts`](../../../tweb/src/lib/mtproto/transports/transport.ts)
  — интерфейсы `MTTransport`/`MTConnection`.
- [`src/lib/mtproto/transports/websocket.ts`](../../../tweb/src/lib/mtproto/transports/websocket.ts)
  — **обёртка браузерного `WebSocket`** (`'binary'`, arraybuffer, таймаут 7.5с). **Прямой
  аналог нашего `wsClient.ts`.**
- [`src/lib/mtproto/transports/tcpObfuscated.ts`](../../../tweb/src/lib/mtproto/transports/tcpObfuscated.ts)
  — драйвер поверх `MTConnection`: хендшейк обфускации, кадрирование, очередь, авто-reconnect.
- [`src/lib/mtproto/transports/obfuscation.ts`](../../../tweb/src/lib/mtproto/transports/obfuscation.ts)
  — **DPI-обфускация (obfuscation2):** случайный 64-байтный init, AES-CTR на каждый пакет,
  трафик под шум. **Вне scope DNP — референс на будущее, если понадобится обход DPI.**
- [`src/lib/mtproto/transports/codec.ts`](../../../tweb/src/lib/mtproto/transports/codec.ts) —
  интерфейс кодека кадрирования.
- [`src/lib/mtproto/transports/abridged.ts`](../../../tweb/src/lib/mtproto/transports/abridged.ts)
  — abridged TCP-кодек (тег `0xef`, длина/4).
- [`src/lib/mtproto/transports/intermediate.ts`](../../../tweb/src/lib/mtproto/transports/intermediate.ts)
  — intermediate-кодек (4-байтный префикс длины).
- [`src/lib/mtproto/transports/padded.ts`](../../../tweb/src/lib/mtproto/transports/padded.ts)
  — padded-intermediate (+0–3 байта рандом-паддинга, DPI).
- [`src/lib/mtproto/transports/http.ts`](../../../tweb/src/lib/mtproto/transports/http.ts) —
  HTTP-транспорт (fetch POST на `/apiw1`, long-poll fallback).
- [`src/lib/mtproto/transports/controller.ts`](../../../tweb/src/lib/mtproto/transports/controller.ts)
  — авто-выбор ws vs https по доступности.
- [`src/lib/mtproto/transports/socketProxied.ts`](../../../tweb/src/lib/mtproto/transports/socketProxied.ts)
  — проксирование сокета в другой realm (Safari-воркер не открывает WS напрямую).

### 7.4 API-менеджеры → **DNP L4 (RPC) + L5 (файлы) + updates**
- [`src/lib/appManagers/apiManager.ts`](../../../tweb/src/lib/appManagers/apiManager.ts) —
  **точка входа RPC** (`invokeApi`): выбор networker'а, обработка ошибок, 303-миграции,
  401 auth-export/import. **DNP L4: у нас проще (один бэк, без миграций).**
- [`src/lib/appManagers/apiManagerMethods.ts`](../../../tweb/src/lib/appManagers/apiManagerMethods.ts)
  — `invokeApiSingle/After/Hashable/Cacheable` + кэш ответов.
- [`src/lib/appManagers/apiFileManager.ts`](../../../tweb/src/lib/appManagers/apiFileManager.ts)
  — **чанковый up/download** (`upload.getFile`/`saveFilePart`, очередь, file-reference
  refresh). **DNP L5.**
- [`src/lib/appManagers/apiUpdatesManager.ts`](../../../tweb/src/lib/appManagers/apiUpdatesManager.ts)
  — **машина updates**: pts/qts/seq/date, буфер out-of-order (`pendingPtsUpdates`),
  `getDifference`/`getChannelDifference` на дыры. **У нас уже реализовано:
  `web-client/src/core/realtime/{syncEngine,pendingPts,cursor}.ts` + бэкендовый `/sync`.**

### 7.5 Крипто → **DNP L0 (заменяется Noise)**
Примитивы MTProto: RSA (raw modpow) на хендшейке; AES-256-**IGE** на конверт; AES-256-CTR
на обфускацию; SHA-1/SHA-256; PBKDF2-HMAC-SHA512 (2FA/SRP); Brent-Pollard rho (факторизация);
SRP (2FA). **В DNP всё это заменяется одним Noise cipher suite** — писать крипто-примитивы
самим НЕ надо (главное предостережение).
- [`src/lib/crypto/crypto.worker.ts`](../../../tweb/src/lib/crypto/crypto.worker.ts) —
  крипто-воркер (off-main-thread). **DNP: наш крипто тоже в воркере.**
- [`src/lib/crypto/cryptoMessagePort.ts`](../../../tweb/src/lib/crypto/cryptoMessagePort.ts) —
  RPC-мост к крипто-воркеру, round-robin AES по портам.
- [`src/lib/crypto/crypto_methods.ts`](../../../tweb/src/lib/crypto/crypto_methods.ts) /
  [`cryptoMethodsRegistry.ts`](../../../tweb/src/lib/crypto/cryptoMethodsRegistry.ts) — карта
  и реестр крипто-операций.
- [`src/lib/crypto/computeDhKey.ts`](../../../tweb/src/lib/crypto/computeDhKey.ts) /
  [`generateDh.ts`](../../../tweb/src/lib/crypto/generateDh.ts) /
  [`dhValidation.ts`](../../../tweb/src/lib/crypto/dhValidation.ts) — DH для звонков + валидация
  safe-prime/public value (Miller-Rabin). **DNP: Curve25519 в Noise — валидация встроена.**
- [`src/lib/crypto/srp.ts`](../../../tweb/src/lib/crypto/srp.ts) — 2FA (SRP). **Вне scope DNP.**
- [`src/lib/crypto/subtle.ts`](../../../tweb/src/lib/crypto/subtle.ts) — shim WebCrypto.
- [`src/lib/crypto/aesCtrUtils.ts`](../../../tweb/src/lib/crypto/aesCtrUtils.ts) — stateful
  AES-CTR для обфускации.
- Утилиты: [`utils/aesIGE.ts`](../../../tweb/src/lib/crypto/utils/aesIGE.ts) (конверт MTProto),
  [`utils/aesCTR.ts`](../../../tweb/src/lib/crypto/utils/aesCTR.ts),
  [`utils/aesCTRJs.ts`](../../../tweb/src/lib/crypto/utils/aesCTRJs.ts),
  [`utils/aesLocal.ts`](../../../tweb/src/lib/crypto/utils/aesLocal.ts) (at-rest passcode),
  [`utils/rsa.ts`](../../../tweb/src/lib/crypto/utils/rsa.ts),
  [`utils/sha1.ts`](../../../tweb/src/lib/crypto/utils/sha1.ts),
  [`utils/sha256.ts`](../../../tweb/src/lib/crypto/utils/sha256.ts),
  [`utils/pbkdf2.ts`](../../../tweb/src/lib/crypto/utils/pbkdf2.ts),
  [`utils/factorize/BrentPollard.ts`](../../../tweb/src/lib/crypto/utils/factorize/BrentPollard.ts)
  (+ `tdlib.ts`, `vanillaPollandRho.ts`). **Всё это в DNP не воспроизводится.**

### 7.6 File streaming / Service Worker → **DNP L5**
- [`src/lib/serviceWorker/stream.ts`](../../../tweb/src/lib/serviceWorker/stream.ts) —
  **эмуляция HTTP 206 Range для `<video>`** (главный чертёж L5): перехват `fetch`, парс
  `Range`, выравнивание на чанки, сбор 206-ответа, предзагрузка, mp4-патч, Safari-хак.
- [`src/lib/serviceWorker/download.ts`](../../../tweb/src/lib/serviceWorker/download.ts) —
  save-to-disk через `ReadableStream`.
- [`src/lib/serviceWorker/index.service.ts`](../../../tweb/src/lib/serviceWorker/index.service.ts)
  — entry/роутер SW: порты к mtproto/crypto воркерам, роутинг `fetch` (stream/download/share/
  RTMP/HLS/cache), install/activate, passcode-ключ, push.
- [`src/lib/serviceWorker/serviceMessagePort.ts`](../../../tweb/src/lib/serviceWorker/serviceMessagePort.ts)
  — контракт SW ↔ воркер (`requestFilePart`, cancel, download*).
- [`src/lib/serviceWorker/cache.ts`](../../../tweb/src/lib/serviceWorker/cache.ts) — кэш
  статики (Cache API + timeout race).
- Хранилища файлов: [`src/lib/files/cacheStorage.ts`](../../../tweb/src/lib/files/cacheStorage.ts)
  (Cache API, опц. at-rest шифрование), [`downloadStorage.ts`](../../../tweb/src/lib/files/downloadStorage.ts),
  [`streamWriter.ts`](../../../tweb/src/lib/files/streamWriter.ts) (интерфейс writer'а),
  [`downloadWriter.ts`](../../../tweb/src/lib/files/downloadWriter.ts) (стрим на диск),
  [`memoryWriter.ts`](../../../tweb/src/lib/files/memoryWriter.ts) (в RAM → Blob),
  [`fileStorage.ts`](../../../tweb/src/lib/files/fileStorage.ts) (база),
  [`idb.ts`](../../../tweb/src/lib/files/idb.ts) (IndexedDB-обёртка).

### 7.7 Смежное (конфиг, воркеры, персист)
- [`src/config/modes.ts`](../../../tweb/src/config/modes.ts) — флаги режимов (test/ssl/http/
  transport/noPfs/noWorker).
- [`src/config/app.ts`](../../../tweb/src/config/app.ts) — константы приложения для
  `initConnection`.
- [`src/lib/rootScope.ts`](../../../tweb/src/lib/rootScope.ts) — глобальная шина событий.
- [`src/lib/sessionStorage.ts`](../../../tweb/src/lib/sessionStorage.ts) /
  [`src/lib/accounts/accountController.ts`](../../../tweb/src/lib/accounts/accountController.ts)
  — персист auth_key/server_salt/dcId по аккаунту. **DNP: у нас статический ключ сервера —
  в билде, сессионных auth_key нет (Noise-сессия эфемерна).**
- [`src/lib/apiManagerProxy.ts`](../../../tweb/src/lib/apiManagerProxy.ts) — main-thread прокси
  к mtproto-воркеру. **Наш аналог — `web-client/src/rpc/managersProxy.ts`.**
- [`src/lib/mainWorker/mainMessagePort.ts`](../../../tweb/src/lib/mainWorker/mainMessagePort.ts)
  / `index.worker.ts` — порт и entry mtproto-воркера.
- Доп. SW-хендлеры: `rtmp.ts`, `src/lib/hls/*`, `watchMtprotoOnDev.ts`, `clearOldCache.ts`,
  `push.ts`, `share.ts`, `backgrounds.ts`, `errors.ts`, `timeout.ts`.

---

## 8. Открытые вопросы (решить на этапе спеки подпроекта #1)

1. **Cipher suite:** ChaCha20-Poly1305 (мобильность) vs AES-GCM (AES-NI на сервере).
2. **Кодирование payload:** JSON (совместимо с текущими кадрами) vs MessagePack (компактнее).
   Для L3/L4 старт с JSON, L5 — бинарь.
3. **L2 сейчас или потом:** мультиплексор нужен только когда по каналу пойдут RPC/файлы. В
   подпроекте #1 (только realtime) — один поток, L2 не нужен. Риск: спроектировать L2
   вслепую под несуществующих потребителей.
4. **Ротация статического ключа:** билд-константа (просто, ротация = пересборка) — принято;
   пинить **массив** ключей (текущий + следующий), клиент принимает оба на время ротации (см.
   блок «Ротация pinned-ключа» в §3, слой L0). Формализовать процедуру и версионирование
   `prologue = "dnp/N"`.
5. **Библиотека Noise на клиенте:** `@stablelib`-примитивы + своя обёртка NK vs готовая
   `noise-c.wasm`. Взвесить размер бандла и аудируемость.

---

## 9. Связь с другими нашими наработками

- **E2E секретные чаты** (`web-client/src/core/secret/`, WebCrypto ECDH+AES-GCM) —
  ортогональны DNP. DNP шифрует **канал**, E2E — **контент**. Складываются.
- **updates/pts/getDifference** (`web-client/src/core/realtime/{syncEngine,pendingPts,cursor}.ts`)
  — уже реализовано по мотивам `apiUpdatesManager.ts`; DNP их транспортирует, логику не трогает.
- **TLS/WSS** (nginx, mkcert, `:38443`/`:8443`) — база, поверх которой ложится DNP
  (defense-in-depth). Менять nginx не требуется.
- **Исходный разбор MTProto:** `docs/research/2026-06-23-tweb-architecture-findings.md` (§2 —
  надёжная доставка, §2.1 — updates/pts).

---

## 10. DPI и обфускация: границы применимости

Раздел отвечает на вопрос «а обфускацию как у Telegram сделать?» и честно фиксирует, что тут
работает, а что нет — с поправкой к первоначальному наброску (в non-goals §1 обфускация
помечена как не-цель, здесь — почему).

### 10.1 Что DPI на самом деле блокирует

DPI не расшифровывает трафик — он **фингерпринтит** его по тому, что видно **снаружи** TLS:
- **SNI** (имя домена открытым текстом в TLS ClientHello) — главный триггер;
- **IP** сервера;
- форма TLS-хендшейка (JA3), паттерн/тайминги пакетов.

Содержимое внутри WSS для DPI уже непрозрачно (это зашифрованный TLS-поток). Ещё один слой
шифрования внутри (Noise у нас, обфускация у Telegram) **не меняет то, что DPI видит на
проводе** — снаружи как был TLS-поток к твоему домену, так и остался.

### 10.2 MTProto и сырой TCP (носители)

**Родной носитель MTProto — сырой TCP.** Нативные клиенты (мобильные, tdesktop) открывают
прямой TCP-сокет к дата-центру и гоняют MTProto прямо по нему; HTTP — fallback; MTProto-прокси
и обфускация obfuscation2 — тоже поверх сырого TCP.

**Браузер сырой TCP открыть не может** (нет API — только WebSocket/HTTP/WebRTC). Поэтому tweb
**туннелирует тот же MTProto поверх WebSocket** (`wss://…/apiws`). Framing и обфускация —
те же самые байты, отличается только носитель: TCP у нативных клиентов, WS у веба. Именно
поэтому единый транспорт называется `TcpObfuscated`, хотя под ним может быть и WebSocket.

### 10.3 Как это работает в tweb сейчас (по исходникам)

tweb **действительно** гоняет MTProto-обфускацию внутри браузерного WebSocket. Кодпуть в
[`dcConfigurator.ts`](../../../tweb/src/lib/mtproto/dcConfigurator.ts) (`transportSocket`):

```
new TcpObfuscated( Socket, wss://…ws{dc}.web.telegram.org/apiws )
        │              └─ браузерный WebSocket ('binary', arraybuffer) — websocket.ts
        └─ на open прогоняет Obfuscation (obfuscation2, AES-CTR),
           дальше AES-CTR-шифрует КАЖДЫЙ пакет поверх WS
```

- [`transports/tcpObfuscated.ts`](../../../tweb/src/lib/mtproto/transports/tcpObfuscated.ts) —
  всегда оборачивает соединение (безусловно), кадрирует abridged-кодеком.
- [`transports/websocket.ts`](../../../tweb/src/lib/mtproto/transports/websocket.ts) —
  обычный `new WebSocket(url, 'binary')`.
- [`transports/obfuscation.ts`](../../../tweb/src/lib/mtproto/transports/obfuscation.ts) —
  64-байтный случайный init (с отбраковкой узнаваемых сигнатур `0xef`/`HEAD`/`POST`/`GET`/…),
  вывод AES-CTR ключей/IV, шифрование всего потока в «шум».

Отдельного «необфусцированного WS»-пути у tweb **нет** — переиспользуется единственная
реализация MTProto-транспорта.

### 10.4 Честная поправка к первоначальному наброску

Первый набросок утверждал «обфускацию payload в браузере сделать нельзя/бессмысленно». Это
**неточно** — уточняем:

- **Браузер обфусцировать УМЕЕТ.** Это просто JS-шный AES-CTR над arraybuffer-кадрами, ничего
  запрещённого. tweb — прямое доказательство.
- **Но против SNI-блокировки прямого коннекта она бесполезна.** Когда режут домены Telegram по
  SNI/IP, внутренняя обфускация прямой браузерный `wss://` не спасает.
- **Реальная анти-DPI ценность обфускации — на прокси / сыром TCP,** где TLS нет: там
  AES-CTR-«шум» без опознаваемого заголовка — единственная защита от фингерпринта. Поверх
  `wss://` обфускация **избыточна с TLS** (belt-and-suspenders); tweb держит её только потому,
  что это единый кодпуть транспорта.

Вывод: рычаг обхода DPI — **эндпоинт** (другой домен/IP/прокси), а не шифрование полезной
нагрузки.

### 10.5 Как обход DPI делается для браузера (если понадобится)

Всё это — **инфраструктура, а не слой DNP**:
1. **CDN-фронтинг** — WSS-эндпоинт за крупным CDN (Cloudflare и т.п.): SNI/IP = адрес CDN,
   «заблокировать нас» = заблокировать пол-интернета за CDN. Конфиг nginx→CDN.
2. **ECH (Encrypted Client Hello)** — прячет сам SNI; уровень браузер+CDN, не приложения.
3. **Запасные домены/IP + ротация** — если один режут, клиент идёт на другой (инфра + немного
   логики выбора эндпоинта на клиенте).

### 10.6 Что можно на уровне DNP (марджинально)

Не против блокировки, а против **traffic-analysis** (наблюдатель считает размеры/тайминги
зашифрованных кадров):
- **Паддинг кадров** — добивать до фиксированных размеров (аналог padded-intermediate
  [`transports/padded.ts`](../../../tweb/src/lib/mtproto/transports/padded.ts), тег `0xdd`,
  +0–3 случайных байта). Дёшево, можно заложить опциональным полем в формат кадра (§4).
- **Cover-трафик / постоянный битрейт** — пустышки ради маскировки тайминга. Дорого, почти
  никогда не окупается.

### 10.7 Что делаем мы

- **DPI-обход — non-goal для браузерного DNP.** Против SNI-блокировки протокольная обфускация
  не помогает, а у нас поверх и так TLS **и** Noise — внутренняя обфускация была бы **вдвойне**
  избыточной (у Telegram-over-wss поверх только TLS, MTProto — не AEAD-канал).
- **Реальные пути, если понадобится:** инфраструктурный фронтинг (CDN/ECH — §10.5, доступно
  сейчас, вне протокола) или нативный obfuscation2 по [`obfuscation.ts`](../../../tweb/src/lib/mtproto/transports/obfuscation.ts)
  — но только если появится нативный клиент с доступом к сырому TCP.
- **Задел:** опциональный паддинг кадров (§10.6) заложить в формат кадра, включать по флагу.

### 10.8 Носитель-агностичность: WS сейчас, сырой TCP для нативного клиента

DNP **архитектурно не привязан к носителю**. Noise — протокол над потоком байт, ему всё равно,
что под ним; L0 (хендшейк + AEAD) и L1 (надёжность) не зависят от того, TCP там или WS. На
**сервере** (Go) сырой TCP бесплатен: `flynn/noise` работает над любым `io.ReadWriter`, а
`net.Listener` даёт TCP из коробки.

**Ограничение — браузер.** У браузера нет API для raw TCP (только WebSocket/HTTP/WebRTC/
WebTransport). Наш `web-client` — браузерное приложение, поэтому для него сырой TCP **исключён**,
остаётся WSS. Ровно поэтому tweb туннелирует MTProto поверх WebSocket, а не гоняет по TCP как
нативные клиенты (§10.2).

**Когда сырой TCP становится реальным:** только с появлением **нативного клиента** (Electron/
мобильный) — там есть доступ к сокетам. Тогда это тот же расклад, что у Telegram, и он замыкается
с обфускацией (§10.4):

| Клиент | Носитель DNP | Обфускация |
|---|---|---|
| Веб (сейчас) | WSS | бесполезна против SNI — не делаем |
| Нативный (гипотетически) | сырой TCP | **имеет смысл** — нет TLS-SNI, obfuscation2 маскирует поток |

Сырой TCP и обфускация — **один и тот же «нативный» сценарий**; по отдельности смысла не
добавляют, вместе — дают то, ради чего Telegram держит raw-TCP-транспорт.

**Что закладываем сейчас (дёшево, без постройки TCP-носителя — потреблять его некому):**
1. **Транспорт за абстрактным интерфейсом соединения** — аналог tweb `MTTransport`/`MTConnection`
   ([`transports/transport.ts`](../../../tweb/src/lib/mtproto/transports/transport.ts)), чтобы
   WS-бэкенд и будущий TCP-бэкенд были взаимозаменяемы, а L0/L1 их не различали.
2. **Length-framing в кодеке кадра** (§4), а не опора на границы WS-сообщений — тогда потоковый
   носитель (TCP) слотится позже без правок Noise/надёжности.

Обе меры — страховка ценой одного интерфейса, ровно как разделение transport/codec у tweb. Сам
TCP-носитель **не строим** до появления нативного клиента.
