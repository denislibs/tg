# Разбор архитектуры Telegram Web K (tweb) — что перенимаем

**Дата:** 2026-06-23
**Источник:** `../tweb` (официальный Telegram Web K), коммит `c29dfcf84`
**Зачем:** вытащить production-оптимизации и фишки для нашего бэкенда и фронта.

> Важно: tweb — это **клиент** к серверу Telegram (MTProto). Часть фишек чисто
> клиентские (рендер, кэш в памяти), но многие диктуют **контракт нашего бэкенда**.
> Помечаю: 🟦 backend-контракт · 🟩 клиент (наш фронт) · ⬜ общее.

---

## 1. Multi-worker архитектура (🟩 + влияет на 🟦)

**Воркеры в tweb:**
- **Main worker** (`src/lib/mainWorker/index.worker.ts`) — **SharedWorker**, в нём крутятся
  ВСЕ менеджеры (55+) и весь сетевой слой. Один экземпляр на все вкладки.
- **Crypto workers** (`crypto.worker.ts`) — до `min(4, hardwareConcurrency)` потоков,
  AES/SHA/PBKDF2/DH; AES-операции load-balance по кругу между потоками.
- **rlottie.worker** — рендер анимированных стикеров (WASM), много потоков.
- **webp.worker** — конвертация WebP→PNG (не все браузеры умеют WebP).
- **tinyld.worker** — детект языка текста.
- **spoilerRenderer.worker** — размытие спойлеров через OffscreenCanvas.
- **Service Worker** — перехват fetch, стриминг/кэш медиа (см. §6).

**RPC между потоками — `SuperMessagePort` (`src/lib/superMessagePort.ts`):**
- `getProxiedManagers.ts` оборачивает менеджеры в `Proxy`: вызов
  `managers.appPeersManager.getPeer(id)` → сообщение `{name, method, args, accountNumber}`
  с уникальным `taskId` → воркер вызывает метод → ответ с тем же `taskId` резолвит Promise.
- **ACK-оптимизация:** если результат в воркере синхронный — он шлётся сразу в ack-таске
  (`cached:true`), без ожидания round-trip Promise.
- **Батчинг:** таски копятся микротаск и шлются одним `batch`-сообщением (меньше postMessage).
- **Transferable:** `ArrayBuffer` передаётся во владение (zero-copy) для крипты/больших буферов.

**Координация вкладок (🟦 влияние):**
- Одна вкладка — «мастер», держит сетевые соединения (`singleInstance.ts`): каждые 5с пишет
  timestamp в `sessionStorage:xt_instance`; неактивная вкладка отдаёт мастерство.
- `BroadcastChannel` синхронизирует события между вкладками (passcode-lock и т.п.).
- Новой вкладке SharedWorker **зеркалит** весь кэш (`mirrorAllPeers/Messages`) — без
  повторных запросов.
- **Web Locks API** — очередь операций на SharedWorker, авто-release при закрытии вкладки.
- **Вывод для бэка:** на аккаунт реально **одно** активное соединение, шарится между
  вкладками. Наш бэк должен спокойно принимать переподключение «мастера» и отдавать
  догон по pts. Несколько устройств = несколько соединений (это норм).

---

## 2. MTProto: надёжная доставка (🟦 — прямо про наш realtime)

**Транспортный уровень (нам частично не нужен — WS+TLS уже даёт порядок/целостность):**
- `msg_id` монотонный (f(server_time+offset, random)); `seq_no` чётный для service, нечётный
  для контент-сообщений → сервер видит пропуски.
- Каждое сообщение хранится в `sentMessages` до ACK; контейнеры (батч ≤640KB), батч ACK ≤8192.
- При обрыве `resend()` перекладывает ВСЕ неподтверждённые в очередь и шлёт заново.
- Дедуп входящих: последние 100 серверных `msg_id` в Set.
- `ping_delay_disconnect` — graceful: «отключусь через N сек», сервер не ждёт зря.
- HTTP long-poll (`http_wait max_wait=25s`) как fallback к WS.
- Exp backoff на реконнект (×1.5, до 15с).

**Что берём в наш протокол (WS+protobuf):** application-level **ack** на отправку,
**дедуп по `client_msg_id`**, **resend неподтверждённых при реконнекте**, **exp backoff**.
Транспортную целостность нам даёт сам WS/TLS — свой msg_id/seq_no городить не нужно.

### 2.1 ⭐ Механизм updates / pts (ГЛАВНОЕ для бэкенда)

Файл: `src/lib/appManagers/apiUpdatesManager.ts`. Это эталон надёжного догона. Наш `updates`/`pts`
из дизайна — упрощённая версия этого; здесь — полная модель:

- **Состояние клиента:** `{ pts, qts, seq, date }`.
  - `pts` — «point in time stream» для **сообщений в боксе пользователя** (личка + малые группы);
    каждый апдейт несёт `pts` и `pts_count` (сколько единиц добавил).
  - **У каждого канала — СВОЙ `pts`** (каналы — отдельный поток, `getChannelState`).
  - `seq` — глобальный счётчик «обёрток» апдейтов (`updates`/`updatesCombined`), с `date`.
  - `qts` — отдельный поток для секретных чатов (у нас Phase 7).
- **Детект дыры:** пришёл апдейт с `pts`; если `localPts + pts_count < pts` → **пропуск**.
  Апдейт кладётся в `pendingPtsUpdates`, через `SYNC_DELAY≈6с` дёргается `getDifference`.
  Аналогично `seq`-дыра → `pendingSeqUpdates[seqStart]`.
- **`updates.getDifference(pts, date, qts, pts_total_limit)`** — отдаёт `new_messages`,
  `other_updates`, обновлённые `users/chats` и новый `state{pts,seq,date}`.
  - `differenceEmpty` — нечего догонять.
  - `differenceSlice` — отдан кусок, надо звать ещё раз.
  - `differenceTooLong` — слишком много пропущено → клиент делает полный ресинк.
- **`updates.getChannelDifference(channel, pts, limit)`** — догон для конкретного канала;
  `channelDifferenceTooLong` → перезагрузить канал.
- **`pop`-алгоритм:** после получения diff отложенные апдейты применяются строго по
  возрастанию pts/seq, рекурсивно, пока цепочка непрерывна.

**Вывод для нашего бэка (уточняет §5–6 дизайна):**
1. Наш `updates.pts` должен нести **`pts` + `pts_count`** (а не просто инкремент), чтобы клиент
   детектил дыры и склеивал апдейты, пришедшие батчем.
2. **Каналы — отдельный поток pts** (когда дойдём до Phase 4): не мешать с pts личного бокса.
3. Эндпоинт `GET /sync` = аналог `getDifference`: принимает `pts/date`, отдаёт `new_messages`
   + `other_updates` + новый `state`, поддерживает «слайсы» и «too long → полный ресинк».
4. Секретные чаты (Phase 7) — отдельный `qts`-поток.

---

## 3. Окно чата и история (🟦 контракт history-API + 🟩 рендер)

**SlicedArray (`src/helpers/slicedArray.ts`):** история хранится как **разреженные слайсы**
mid'ов (не один сплошной массив). Пропуски между слайсами = неподгруженные диапазоны.
Позволяет держать чат на 100k+ сообщений без полной загрузки.

**Открытие чата (`bubbles.ts:setPeer`):**
1. Если возвращаемся в чат — восстанавливаем сохранённую позицию скролла (`chatPositions` в
   stateStorage), без перезагрузки.
2. Иначе грузим вокруг `readMaxId` (первое непрочитанное) — прыжок на «первое непрочитанное».
3. История грузится «окном» через `getHistory(offset_id, add_offset, limit)`.

**Виртуализация:** не классический virtual-scroll, а **удаление невидимых DOM-узлов**
(`getViewportSlice`/`deleteViewportSlice`, debounce 3с) — сообщения остаются в памяти,
DOM чистится. `ScrollSaver` — якорное восстановление позиции (по `getBoundingClientRect`
видимого пузыря), чтобы контент не прыгал при подгрузке сверху.

**Медиа в сообщениях:** `LazyLoadQueue` (≤8 параллельно, throttle 8ms, lock во время
навигации) + `IntersectionObserver` (грузим/анимируем только видимое; играет только
центральное видео) + **LQIP**: `photoStrippedSize` (8×8 blurred preview) показывается мгновенно,
полноразмер — `choosePhotoSize` под вьюпорт.

**Вывод для нашего бэка:** history-API должен быть **как `messages.getHistory`**:
`offset_id` + `add_offset` (± в обе стороны) + `limit`, возвращать `count` + сообщения, чтобы
фронт строил слайсы и детектил концы (`SliceEnd.Top/Bottom`). Плюс на сообщениях/фото нужны:
стабильный `seq/id`, мелкий **blurred-preview (stripped bytes)** и несколько размеров фото.

---

## 4. Хранение и кэш на клиенте (🟩 + мульти-аккаунт 🟦)

- **Три уровня:** in-memory (менеджеры) → IndexedDB (персист) → Cache API (медиа/чанки).
- **IndexedDB по аккаунтам:** `tweb-account-{1..4}` (stores: users/chats/dialogs/messages/…),
  общий `tweb-common` (langPack/settings/passcode). `durability:'relaxed'`.
- **Мульти-аккаунт:** до 4 аккаунтов, каждый — своя БД + свои auth-данные в `sessionStorage`
  (`account1..4`: auth_key, server_salt, userId, dcId, push_key); `current_account`.
- **Passcode-шифрование:** PBKDF2-SHA256 (100k итераций) → AES-256-GCM поверх IndexedDB и
  Cache API. Ключ только в памяти.
- **Reference counting (`storages/peers.ts`):** `requestPeer/releasePeer` — пир в памяти, пока
  нужен какому-то контексту (диалог/поиск/контакт); иначе выгружается.
- **Batching:** запись в storage throttled через `queueMicrotask`.

**Вывод для бэка (🟦):** мульти-аккаунт = независимые сессии/устройства на наш `phone`-логин;
наш бэк уже это закладывал (`devices`). `push_key` на аккаунт — пригодится для §6.

---

## 5. Производительность (🟩 — для фронта)

- `fastRaf` — батч в один RAF; `throttleWithRaf` — не чаще раза за кадр.
- `debounce(fn, ms, shouldRunFirst, shouldRunLast)` — гибкие режимы.
- **Middleware pattern** — авто-отмена promise/observers при уходе с экрана (cleanup).
- `idleController` — на blur вкладки снижаем приоритеты.
- `searchIndex.ts` — клиентский полнотекстовый поиск (whole-word, ранжирование).
- `richTextProcessor` — парсинг сущностей (ссылки/@/#/markdown/emoji) один раз, кэшируется.
- Custom emoji — один `RLottiePlayer` на много emoji (синхронный кадр).

---

## 6. Медиа, Service Worker, Web Push (🟦 контракт media + push)

**Service Worker (`src/lib/serviceWorker/`):** перехватывает `/stream/`, `/download/`, `/hls/`.
- **Стриминг видео через Range-запросы** (206 Partial Content), чанки 512KB (или 1MB для
  видео >75MB), агрессивная предзагрузка следующих чанков, дедуп параллельных Range к одному
  чанку (`RequestSynchronizer`), очистка стрима debounce 150с.
- **Download через ReadableStream** с `CountQueuingStrategy(highWaterMark:1)` — один чанк за раз,
  стриминг прямо на диск.
- **HLS** — m3u8 с несколькими качествами, чанки кэшируются (перемотка).
- Кэш в Cache API, 6 хранилищ, AES-GCM при passcode.

**Вывод для бэка (🟦):** раздача медиа из MinIO **обязана поддерживать HTTP Range** (S3 умеет) —
для стриминга видео/аудио и докачки. Параллельная докачка чанками. Для видео позже — превью +
несколько качеств (Phase 5).

**Web Push (`serviceWorker/push.ts`, `webPushApiManager.ts`, `uiNotificationsManager.ts`):**
- Подписка: `reg.pushManager.subscribe({userVisibleOnly, applicationServerKey: VAPID})` → токен
  на сервер.
- Payload push (зашифрован): `{ loc_key, loc_args, custom:{ msg_id, chat_id/channel_id/from_id,
  peerId, silent }, badge, sound, mute }`.
- В SW: расшифровка (ключ из IDB), проверки **перед показом**: `mute`, `muteUntil` (snooze 24ч),
  **есть ли активное окно** (если онлайн — не показывать), passcode-lock → пустое уведомление.
- Клик → focus вкладки + переход в нужный peer; badge на favicon через `navigator.setAppBadge`.

**Вывод для бэка (🟦, уточняет §11a дизайна):**
1. Push шлём **только если у юзера нет активного WS** (мы это и заложили через `routes:{user}`).
2. Payload должен нести `chat_id`, `msg_id`, `sender`, `badge`(unread), `silent`/`mute`-флаг,
   и опционально превью текста (скрываемо настройкой `nopreview`).
3. Уважать `muted` чата и snooze; чистить протухшие подписки (410 Gone).
4. Хранить push-подписку **на устройство** (у нас `push_subscriptions.device_id`).

---

## 7. Итог: что перенимаем в наш бэкенд (приоритетно)

| Фишка | Где в нашем дизайне | Действие |
|------|---------------------|----------|
| **pts + pts_count в апдейтах** | §5.3 update log | усилить: апдейт несёт pts И pts_count |
| **getDifference / слайсы / too-long-ресинк** | §5.3 `GET /sync` | расширить контракт sync |
| **Отдельный pts на канал** | Phase 4 | заложить channel-pts |
| **history-API offset_id/add_offset/limit + count** | новый раздел | спроектировать history-эндпоинт |
| **Range-запросы для медиа** | §11 media | требование к раздаче MinIO/nginx |
| **stripped/blurred preview + размеры фото** | §6 media | добавить поля превью |
| **Push только при отсутствии WS + payload-контракт** | §11a | уточнить payload и условия |
| **Мульти-аккаунт = независимые devices** | Phase 1 | уже заложено |
| **Application-ack + dedup + resend на reconnect** | §5.1/5.4 | подтверждено, оставляем |
