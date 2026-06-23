# Архитектура фронтенда мессенджера (многопоточная, async, под наш бэкенд)

**Дата:** 2026-06-23
**База:** существующий `telegram-ui-clone/` (Vite 6 + React 18 + MUI v6 + framer-motion), сейчас на моках (`src/data.ts`)
**Бэкенд:** Go + protobuf WS + REST + MinIO + Web Push (см. `2026-06-23-messenger-backend-design.md`)
**Образец паттернов:** Telegram Web K (`../tweb`), см. `docs/research/2026-06-23-tweb-architecture-findings.md`

> Цель документа — дать **подробную, исполнимую** инструкцию, как превратить моковый UI в
> многопоточный realtime-клиент: менеджеры в воркере, перехват fetch в Service Worker,
> sync-движок на `pts`, ленивый рендер и Web Push — всё заточено под наш бэкенд.

---

## 1. Принципы

1. **UI-поток только рисует.** Вся логика (сеть, состояние, кэш, sync) — в **Core Worker**.
   React-компоненты читают данные через тонкий слой и подписки, не знают про сеть.
2. **Сеть — это ускоритель, правда — в кэше + на сервере.** WS может рваться; sync по `pts`
   гарантирует консистентность (см. §7).
3. **Тяжёлое — в отдельные воркеры** (крипта, декод медиа), чтобы не фризить кадры.
4. **Медиа идёт через Service Worker** (перехват fetch, Range-стриминг, кэш).
5. **Один сетевой коннект на аккаунт**, шарится между вкладками (§12).

---

## 2. Топология потоков

```
┌──────────────────────── Браузер ────────────────────────────────────┐
│                                                                       │
│  UI Thread (React + MUI)                                              │
│    components/ ──▶ stores (signals) ──▶ ManagersProxy ──┐             │
│        ▲                                                 │ RPC        │
│        └──────────── подписки на события ◀───────────────┤ (MessagePort)
│                                                          ▼             │
│  ┌──────────────── Core Worker (SharedWorker) ───────────────────┐    │
│  │  ConnectionManager ── protobuf WS ◀────────────────────────────┼──▶ Go /ws
│  │  SyncEngine (pts/pts_count, getDifference)  ───── REST ─────────┼──▶ Go /api
│  │  AuthManager · ChatsManager · MessagesManager · MediaManager   │    │
│  │  PeersManager · PresenceManager · DraftsManager                │    │
│  │  LocalStore (IndexedDB)  ·  in-memory caches  ·  ref-counting   │    │
│  └──────┬─────────────────────────────────┬───────────────────────┘    │
│         │ Transferable (crypto)            │                            │
│         ▼                                  ▼                            │
│  ┌──────────────┐                  ┌────────────────────────────┐      │
│  │ Crypto Worker│                  │ Service Worker             │      │
│  │ (e2e Phase7) │                  │  перехват fetch:           │──────┼─▶ MinIO
│  └──────────────┘                  │  /media стрим (Range),     │      │ (presigned)
│                                     │  кэш, download, Web Push   │      │
│                                     └────────────────────────────┘      │
└───────────────────────────────────────────────────────────────────────┘
```

**Потоки и ответственность:**

| Поток | Что делает | Почему отдельно |
|------|-----------|-----------------|
| **UI Thread** | React-рендер, ввод, анимации | держим 60fps, никакой сети/парсинга |
| **Core Worker** (SharedWorker) | менеджеры, WS, sync, кэш, IndexedDB | один на все вкладки; блокирующие операции не фризят UI |
| **Crypto Worker** | AES/ключи (e2e, Phase 7) | крипта тяжёлая, параллелим |
| **Service Worker** | перехват fetch медиа, кэш, стриминг, Web Push | живёт вне жизненного цикла вкладки, контролирует network+cache |

Fallback: если **SharedWorker не поддерживается** (Safari старые) → обычный `Worker` на вкладку +
синхронизация через `BroadcastChannel`. Если воркеры запрещены (debug) → менеджеры в main-потоке
через `MessageChannel` в том же потоке (для отладки с брейкпоинтами).

---

## 3. Структура каталогов фронта (внутри `telegram-ui-clone/src/`)

```
src/
  components/            — существующий UI (Sidebar, ChatView, …) — почти не трогаем
  data.ts                — УДАЛЯЕМ моки, заменяем на реальные данные из менеджеров
  core/                  — НОВОЕ: всё, что уезжает в Core Worker
    worker/
      index.worker.ts     — точка входа Core Worker, регистрирует обработчики RPC
      managers/
        authManager.ts
        connectionManager.ts   — protobuf WS, FSM, heartbeat, ack/dedup/resend
        syncEngine.ts          — pts/pts_count, getDifference, детект дыр
        chatsManager.ts        — список чатов, unread, last_read_seq
        messagesManager.ts     — отправка, история (SlicedArray), кэш сообщений
        peersManager.ts        — users/chats объекты, ref-counting
        mediaManager.ts        — presigned URL, превью
        presenceManager.ts     — online/typing
        draftsManager.ts
      store/
        localStore.ts          — обёртка IndexedDB (по аккаунтам)
        idb.ts                 — низкоуровневый IndexedDB helper
      net/
        wsClient.ts            — сырой WS + (де)сериализация protobuf
        restClient.ts          — fetch к /api с авторизацией
  rpc/
    superMessagePort.ts   — RPC-абстракция (по образцу tweb)
    managersProxy.ts      — Proxy: managers.x.y(args) → RPC-invoke
    transferable.ts
  protocol/
    frames.ts             — общие TS-типы WS-кадров { t, seq, d } (синхронизированы с бэком)
  sync/
    slicedArray.ts        — разреженная история (порт из tweb)
    scrollSaver.ts        — якорное восстановление скролла
  stores/                 — реактивные сторы для React (signals/zustand)
    chatsStore.ts
    messagesStore.ts
    connectionStore.ts
  sw/
    service-worker.ts     — Service Worker: fetch-перехват, кэш, push
    streamController.ts    — Range-стриминг медиа
    pushHandler.ts         — обработка Web Push
  lib/
    lazyLoadQueue.ts       — очередь ленивой загрузки медиа (≤8 параллельно)
    schedulers.ts          — fastRaf, debounce, throttleWithRaf
    middleware.ts          — cleanup-паттерн (отмена при уходе с экрана)
```

---

## 4. RPC между UI и Core Worker

Сердце многопоточности — типизированный RPC. Порт из tweb `SuperMessagePort`, упрощённый.

### 4.1 ManagersProxy (UI-сторона)

```ts
// rpc/managersProxy.ts
// Вызов managers.messagesManager.sendMessage(args) на UI-потоке
// превращается в сообщение воркеру и возвращает Promise с результатом.
export function createManagersProxy(port: SuperMessagePort) {
  return new Proxy({} as Managers, {
    get: (_t, managerName: string) =>
      new Proxy({}, {
        get: (_t2, method: string) =>
          (...args: any[]) =>
            port.invoke('manager', { name: managerName, method, args })
      })
  })
}
```

UI-код:
```ts
const msg = await managers.messagesManager.sendMessage({ chatId, text, clientMsgId })
```

### 4.2 Обработчик на стороне Core Worker

```ts
// core/worker/index.worker.ts
port.on('manager', async ({ name, method, args }) => {
  const manager = registry[name]      // объект менеджера
  return manager[method](...args)     // результат улетит обратно по taskId
})
```

### 4.3 Ключевые свойства RPC (берём из tweb)
- **taskId-сопоставление:** каждый invoke получает id, ответ с тем же id резолвит Promise.
- **ack-shortcut:** синхронный результат шлётся сразу (без round-trip).
- **батчинг:** таски копятся микротаск, шлются одним `postMessage`.
- **Transferable:** `ArrayBuffer` (медиа/крипта) передаётся zero-copy.
- **подписки:** менеджеры эмитят события (`new_message`, `presence`, …); UI подписан через тот же
  порт (`port.on('event:new_message', cb)`), события приходят push'ем из воркера.

### 4.4 События → реактивные сторы
UI не дёргает менеджеры на каждый рендер. Вместо этого Core Worker эмитит события, тонкий слой на
UI кладёт их в **сторы** (signals/zustand), React перерисовывается. Пример:

```ts
// stores/messagesStore.ts (UI thread)
port.on('event:new_message', ({ chatId, message }) => {
  messagesStore.appendMessage(chatId, message)   // React-компоненты подписаны на стор
})
```

---

## 5. ConnectionManager (protobuf WS, отказоустойчивость)

Живёт в Core Worker. Один WS на аккаунт.

### 5.1 FSM соединения
```
CONNECTING → AUTHENTICATING → READY → (обрыв) → RECONNECTING → …
```
- **Backoff:** экспоненциальный + jitter (0.5,1,2,4,…,≤30с).
- **Heartbeat:** `Ping` каждые ~20с; нет `Pong` за N интервалов → закрыть и реконнект.
- При входе в **READY**: шлём свой `pts` → SyncEngine запускает догон (§7) **до** того, как
  доверять «живому» потоку.

### 5.2 Протокол кадров (JSON)
- Конверт `{ t, seq, d }` (`t` — тип, `d` — payload). Типы кадров — общий TS-файл `protocol/frames.ts`,
  синхронизированный с бэком (без codegen).
- `wsClient.ts` делает `JSON.parse`/`JSON.stringify`, эмитит типизированные события менеджерам по `t`.

### 5.3 Гарантии (application-level, поверх WS/TLS)
- **Ack на отправку:** `SendMessage{client_msg_id}` → ждём `MessageAck{client_msg_id, msg_id, seq}`.
  Нет ack за таймаут → **resend с тем же `client_msg_id`** (бэк дедупит по unique-индексу).
- **Очередь исходящих:** неподтверждённые сообщения хранятся; при реконнекте **resend всех**.
- **Дедуп входящих:** помним последние N серверных `seq`/`msg_id`.
- **Оптимистичный UI:** сообщение сразу рисуется как `pending` (часики) → `sent` (✓ по ack) →
  `read` (✓✓ по read-receipt из sync).

```ts
// упрощённо
async sendMessage(input) {
  const clientMsgId = input.clientMsgId ?? uuid()
  this.outbox.set(clientMsgId, input)               // для resend
  messagesStore.optimisticAppend(input, 'pending')  // UI сразу
  this.ws.send(encode({ type: 'SendMessage', payload: { ...input, clientMsgId } }))
}
onAck({ clientMsgId, msgId, seq }) {
  this.outbox.delete(clientMsgId)
  emit('event:message_ack', { clientMsgId, msgId, seq })  // UI: pending→sent
}
onReconnect() { for (const m of this.outbox.values()) this.resend(m) }
```

---

## 6. SyncEngine — почему сообщения не теряются (главный модуль)

Порт модели `apiUpdatesManager.ts` под наш `GET /sync`. Живёт в Core Worker.

### 6.1 Состояние
```ts
state = { pts: number, date: number /*, qts (Phase 7), seq */ }
channelStates: Map<channelId, { pts: number }>   // отдельный pts на канал (Phase 4)
pendingPtsUpdates: Update[]                        // буфер при дыре
syncing: Promise<void> | null
```

### 6.2 Обработка входящего апдейта (детект дыры)
```ts
processUpdate(u /* несёт pts и pts_count */) {
  if (this.syncing) { this.pendingPtsUpdates.push(u); return }   // идёт догон — буферим
  const expected = this.state.pts + (u.pts_count ?? 0)
  if (expected < u.pts) {                 // ДЫРА: пропустили апдейты
    this.pendingPtsUpdates.push(u)
    this.scheduleGetDifference(6000)      // через ~6с догон (как SYNC_DELAY в TG)
    return
  }
  if (u.pts > this.state.pts) this.state.pts = u.pts
  this.applyUpdate(u)                     // в кэш + эмит события UI
  this.popPending()                       // применить буфер по возрастанию pts
}
```

### 6.3 Догон через REST
```ts
async getDifference() {
  this.syncing = (async () => {
    let more = true
    while (more) {
      const r = await rest.get('/sync', { pts: this.state.pts, date: this.state.date })
      if (r.too_long) { await this.fullResync(r); break }   // слишком много — снапшот
      peersManager.save(r.users, r.chats)
      r.new_messages.forEach(m => this.applyUpdate({ type:'new_message', message:m }))
      r.other_updates.forEach(u => this.applyUpdate(u))
      this.state = r.state
      more = r.slice                       // слайс — звать ещё
    }
  })()
  await this.syncing
  this.syncing = null
  this.popPending()                         // применить накопленный буфер
}
```

### 6.4 Когда запускается
- При старте приложения (восстановили `pts` из IndexedDB → сразу `getDifference`).
- При входе WS в READY (после реконнекта).
- При детекте дыры в `processUpdate`.

**Итог:** даже если WS-push потерялся — клиент догонит. Read-статусы, реакции, правки идут тем же
потоком `updates`, поэтому тоже не теряются.

---

## 7. LocalStore — кэш и персистентность (IndexedDB)

### 7.1 Уровни (как в tweb)
```
in-memory (менеджеры) → IndexedDB (персист) → Cache API (медиа, через SW §10)
```

### 7.2 Схема IndexedDB (по аккаунтам)
БД на аккаунт: `msgr-account-{n}`, stores: `session` (pts/date/настройки), `users`, `chats`,
`dialogs`, `messages`, `drafts`. Общая БД `msgr-common`: настройки, push-ключи, текущий аккаунт.
`durability:'relaxed'`. Запись **throttled через `queueMicrotask`** (батч изменений в одну транзакцию).

### 7.3 In-memory кэши + reference counting
- `peersManager` держит users/chats в Map. Паттерн `requestPeer/releasePeer`: объект в памяти,
  пока нужен какому-то контексту (открытый чат, поиск, список). Иначе — выгружается (экономия RAM
  на длинных сессиях).
- `messagesManager` держит сообщения в `messagesByChat: Map<chatId, Map<seq, Message>>`.

### 7.4 Старт приложения (быстрый)
1. Читаем `pts/date` и список чатов из IndexedDB → **мгновенно рисуем UI из кэша**.
2. Параллельно ConnectionManager поднимает WS, SyncEngine делает `getDifference` → UI обновляется
   диффом. Пользователь видит интерфейс сразу, не дожидаясь сети.

---

## 8. Окно чата: SlicedArray, виртуализация, скролл, медиа

### 8.1 SlicedArray (разреженная история)
Порт `src/helpers/slicedArray.ts` из tweb. История чата = массив **слайсов** `seq`'ов с пометками
концов (`Top/Bottom/Both`). Пропуски между слайсами = неподгруженные диапазоны. Позволяет держать
чат на 100k+ сообщений без полной загрузки.

### 8.2 Загрузка окна (под наш History API §6a бэка)
```ts
// messagesManager.getHistory
async getHistory({ chatId, offsetSeq, addOffset, limit = 40 }) {
  const cached = this.slices.get(chatId).sliceAround(offsetSeq, addOffset, limit)
  if (cached.full) return cached            // всё есть в памяти — без сети
  const r = await rest.get(`/chats/${chatId}/history`,
    { offset_id: offsetSeq, add_offset: addOffset, limit })
  this.slices.get(chatId).insertSlice(r.messages.map(m => m.seq))
  this.cacheMessages(chatId, r.messages)
  return r
}
```
- Скролл вверх → `addOffset>0` (старее); вниз → `addOffset<0` (новее).
- По `count` детектим достижение верха/низа.

### 8.3 Открытие чата
1. Если возвращаемся — восстановить сохранённую позицию скролла (`chatPositions` в session-store).
2. Иначе грузим окно вокруг `last_read_seq` (прыжок на первое непрочитанное).
3. Рисуем пузыри батчем, восстанавливаем скролл через `ScrollSaver`.

### 8.4 Виртуализация (DOM, не данных)
- Удаляем **невидимые DOM-узлы** выше/ниже вьюпорта + буфер (≈2×высота окна), debounce ~3с.
  Сообщения **остаются в памяти**, при скролле перерисовываются. (Проще и надёжнее классического
  virtual-scroll для чатов с группировкой/датами.)
- `ScrollSaver` — якорное восстановление: запоминаем `getBoundingClientRect` видимого пузыря,
  после вставки сверху корректируем `scrollTop`, чтобы контент не прыгал.

### 8.5 Ленивое медиа
- `LazyLoadQueue` (≤8 параллельно, throttle 8мс, `lock()` во время навигации между чатами).
- `IntersectionObserver` — грузим/анимируем только видимое; играет только центральное видео.
- **LQIP:** мгновенно показываем `blur_preview` (из `media.blur_preview`), затем грузим размер под
  вьюпорт из `media.sizes`. Полноразмер — по клику/в фоне.

---

## 9. Service Worker — перехват fetch, стриминг и кэш медиа

Файл `sw/service-worker.ts`. Регистрируется из main. Перехватывает `fetch` для медиа-путей.

### 9.1 Маршруты перехвата
```
/media/stream/{mediaId}   — стриминг видео/аудио с Range (206 Partial Content)
/media/download/{mediaId} — скачивание файла (ReadableStream → диск)
/media/thumb/{mediaId}    — превью (кэшируется агрессивно)
```

### 9.2 Стриминг с Range (под наш бэк/MinIO)
```ts
// sw/streamController.ts
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (url.pathname.startsWith('/media/stream/')) {
    e.respondWith(streamMedia(e.request))   // см. ниже
  }
})

async function streamMedia(req) {
  const range = req.headers.get('Range')                  // "bytes=0-"
  const [start, end] = parseRange(range)
  const mediaId = idFromUrl(req.url)
  // 1) пробуем чанк из Cache API
  const cached = await getChunkFromCache(mediaId, start)
  if (cached) return partialResponse(cached, start, end, totalSize)
  // 2) presigned GET к MinIO с тем же Range (бэк обязан поддерживать Range!)
  const presigned = await getPresignedUrl(mediaId)        // RPC к Core Worker
  const upstream = await fetch(presigned, { headers: { Range: `bytes=${start}-${end}` } })
  await putChunkToCache(mediaId, start, upstream.clone())
  return upstream                                          // 206 пробрасываем как есть
}
```
- Чанки 512KB (или 1MB для видео >75MB), предзагрузка следующих, дедуп параллельных Range к
  одному чанку (RequestSynchronizer), очистка стрима debounce ~150с.
- Кэш — Cache API, отдельное хранилище для медиа-чанков.

### 9.3 Download
ReadableStream c `CountQueuingStrategy({highWaterMark:1})` — один чанк за раз, стриминг прямо на
диск, без удержания всего файла в памяти. Прогресс эмитим в UI через postMessage.

### 9.4 Presigned URL
Service Worker не хранит токены; за presigned-URL ходит в Core Worker по `MessagePort` (RPC), тот
дёргает наш бэк `GET /media/{id}/url`.

---

## 10. Web Push — полный путь под наш бэкенд

### 10.1 Подписка (UI/Core Worker)
```ts
const reg = await navigator.serviceWorker.ready
const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: VAPID_PUBLIC_KEY        // отдаёт наш бэк
})
await managers.authManager.registerPush({       // → POST /push/subscribe
  endpoint: sub.endpoint,
  p256dh: b64(sub.getKey('p256dh')),
  auth: b64(sub.getKey('auth'))
})
```
Бэк кладёт это в `push_subscriptions` (на устройство).

### 10.2 Приём push в Service Worker
```ts
// sw/pushHandler.ts
self.addEventListener('push', e => e.waitUntil(handlePush(e.data)))

async function handlePush(data) {
  const p = data.json()    // { chat_id, msg_id, seq, sender, text, badge, silent }
  // проверки ПЕРЕД показом (как в tweb):
  if (await hasActiveWindow()) return            // онлайн в открытой вкладке — не дублируем
  if (await isMuted(p.chat_id)) return
  if (await isPasscodeLocked()) return showEmpty()
  if (typeof p.badge === 'number') self.navigator.setAppBadge?.(p.badge)
  await self.registration.showNotification(p.sender.name, {
    body: p.text ?? 'Новое сообщение',
    icon: p.sender.avatar, badge: '/badge.png',
    tag: p.chat_id,                              // схлопывание по чату
    data: { chatId: p.chat_id, seq: p.seq },
    silent: p.silent
  })
}
```

### 10.3 Клик по уведомлению
```ts
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window' })
    const client = all[0]
    if (client) { client.focus(); client.postMessage({ type: 'open_chat', chatId: e.notification.data.chatId }) }
    else clients.openWindow(`/#/chat/${e.notification.data.chatId}`)
  })())
})
```

---

## 11. Координация нескольких вкладок

- **SharedWorker** уже даёт один экземпляр менеджеров и один WS на все вкладки — это главный
  механизм (не нужно «мастер-вкладки», пока есть SharedWorker).
- **Fallback без SharedWorker:** `BroadcastChannel('msgr')` синхронизирует события; выбираем
  «мастер»-вкладку (пишем timestamp в `localStorage` каждые ~3с; активная вкладка держит WS,
  остальные слушают broadcast). Порт `singleInstance.ts` из tweb.
- Новой вкладке Core Worker **зеркалит** текущий кэш чатов/сообщений (без повторных запросов).

---

## 12. Мульти-аккаунт

- До N аккаунтов: каждый — своя IndexedDB `msgr-account-{n}` + свои auth-данные (токен устройства)
  в общем хранилище (`account1..n`, `current_account`).
- Core Worker держит реестр менеджеров **по аккаунту**: `managersByAccount[n]`. RPC несёт
  `accountNumber`. Переключение аккаунта = смена активного набора + перерисовка UI.
- Каждый аккаунт — свой WS-коннект и свой `pts`-поток.

---

## 13. Тулинг: типы протокола + воркеры в Vite

### 13.1 Типы WS-протокола (JSON)
- Кадры — обычный JSON. Типы держим в `src/protocol/frames.ts` (discriminated union по полю `t`),
  синхронно с тем, что шлёт/принимает Go-бэк. Никакого codegen и шага сборки.
- (Опционально) валидация входящих кадров через zod/легковесную проверку в dev-режиме.

### 13.2 Воркеры в Vite
- Vite нативно умеет воркеры: `new Worker(new URL('./core/worker/index.worker.ts', import.meta.url), { type: 'module' })`.
- SharedWorker: `new SharedWorker(new URL(...), { type: 'module' })` с фичадетектом.
- Service Worker регистрируем отдельно (`navigator.serviceWorker.register('/service-worker.js')`),
  собираем как отдельный entry (`vite-plugin-pwa` или ручной rollup input).

---

## 14. Интеграция с существующим UI (замена моков)

Существующие компоненты (`Sidebar`, `ChatView`, `ConversationView`, `ChannelPost`, …) рисуют из
типов `Chat`/`ConvMsg` (`src/data.ts`). План замены без переписывания UI:

1. **Сохранить типы как view-модели.** Оставляем `Chat`/`ConvMsg` как форму данных для рендера.
2. **Адаптеры:** менеджеры отдают серверные сущности → мапперы конвертят их в `Chat`/`ConvMsg`.
   Так UI-компоненты меняются минимально (берут данные из сторов вместо `chats` из `data.ts`).
3. **Сторы вместо констант:** `import { chats } from './data'` → подписка на `chatsStore`.
4. **Постепенно:** сначала список чатов из бэка, потом история чата, потом отправка, presence,
   медиа, push — по фазам ниже.

---

## 15. Порядок реализации фронта (фазы под Phase 0 бэка)

| Шаг | Что | Зависит |
|----|-----|---------|
| F0 | Каркас: Core Worker + RPC (`SuperMessagePort`, `managersProxy`) + сторы | — |
| F1 | Типы протокола (`protocol/frames.ts`) + `wsClient` (JSON) + `restClient` | F0 |
| F2 | AuthManager (phone+OTP) + хранение токена + IndexedDB `localStore` | F1 |
| F3 | ConnectionManager (WS, FSM, heartbeat, ack/dedup/resend) | F2 |
| F4 | SyncEngine (`pts`/`pts_count`, `getDifference`, буфер дыр) | F3 |
| F5 | ChatsManager + список чатов из бэка → `chatsStore` (замена мока) | F4 |
| F6 | MessagesManager + SlicedArray + History API + окно чата | F5 |
| F7 | Отправка (оптимистичный UI) + read-receipts + presence/typing | F6 |
| F8 | Виртуализация DOM + ScrollSaver + LazyLoadQueue | F6 |
| F9 | MediaManager + Service Worker (Range-стриминг, кэш, download) + LQIP | F6 |
| F10 | Web Push (подписка, SW push-handler, клик) | F3, F9 |

**Принцип:** на каждом шаге — рабочий вертикальный срез. После F5 уже видим реальные чаты,
после F7 — полноценная переписка realtime, F8–F10 — производительность и медиа/уведомления.

---

## 16. Что НЕ делаем на фронте сейчас (следующие фазы)

Crypto Worker / e2e (Phase 7), rlottie-воркер для анимированных стикеров, webp-воркер,
HLS-стриминг, групповые/канальные специфичные экраны (Phase 3–4), сторис (Phase 6).
Архитектура заложена так, чтобы это добавлялось отдельными воркерами/менеджерами без переделки ядра.
