# Telegram-клон: бэкенд — дизайн

**Дата:** 2026-06-23
**Статус:** черновик на ревью
**Фронтенд:** `telegram-ui-clone/` (React + MUI, пиксель-в-пиксель ремейк Telegram Web K, полностью моковый)

## 1. Цель

Сделать полноценный бэкенд для клона Telegram, кормящий уже готовый фронт:
группы, каналы, обсуждения, сторис, мульти-аккаунт, QR-авторизация, e2e-шифрование
(секретные чаты). Старт — с realtime-ядра, остальное доклеивается фазами.

## 2. Стек

- **Go** — бэкенд (модульный монолит, N реплик)
- **PostgreSQL** — источник правды
- **Redis** — presence, pub/sub fan-out, кэш сессий, счётчики, rate-limit, очередь push
- **MinIO** — объектное хранилище (S3 API) для медиа
- **Nginx** — reverse-proxy, TLS, маршрутизация, статика фронта
- **JSON** — формат кадров WebSocket (общие TS-типы с фронтом, без codegen)
- **Web Push (VAPID)** — push-уведомления при закрытом приложении
- **Docker / docker-compose** — весь стек

## 3. Ключевые архитектурные решения

### 3.1 Модульный монолит, не микросервисы
Один Go-бинарь с чёткими внутренними пакетами. Горизонтальное масштабирование — N реплик
за nginx, связанных через Redis pub/sub. Микросервисы пока YAGNI; границы пакетов держим
чистыми, чтобы при росте нагрузки вынести WS-gateway или media отдельно.

### 3.2 E2E только в секретных чатах (важное ограничение)
E2E-шифрование возможно **только** в личных «секретных чатах» (1-на-1, Phase 7).
Группы, каналы, обсуждения, сторис — cloud-чаты: TLS на транспорте, на сервере хранятся
в открытом виде (сервер обязан делать fan-out и синхронизацию между устройствами).
«E2E + каналы на миллионы» для одного чата одновременно невозможно. Это нормальная
модель Telegram: cloud-чаты по умолчанию + отдельные секретные e2e-чаты.

### 3.3 Realtime: Redis для скорости, Postgres для правды
WS — это **ускоритель, а не канал доставки правды**. Правда живёт в Postgres, гарантию
«дошло» даёт не сокет, а догон по курсору `pts`. Сокет может рваться сколько угодно —
ничего не теряется. Подробности — §5.

### 3.4 Протокол на JSON
Кадры WS — JSON в конверте `{ t, seq, d }` (`t` — тип события, `d` — payload), роутинг по `t`.
Просто отлаживать (читаемо в DevTools), без шага codegen. Типы кадров держим в общем TS-файле
с фронтом. При необходимости компактности позже можно перейти на бинарь — меняется только
сериализация транспорта, логика и роутинг по `t` не трогаются.

## 4. Топология

```
Клиент (React, HTTPS + WSS)
        │
        ▼
     Nginx  ── TLS, статика фронта, маршрутизация
        │
        ├── /api/*  ──▶ Go backend (REST)      ┐
        ├── /ws     ──▶ Go backend (WebSocket)  ├─ N реплик
        └── /media/*──▶ MinIO (presigned)       ┘
                          │        │
                          ▼        ▼
                     PostgreSQL  Redis
```

## 5. Realtime-ядро: надёжная доставка

### 5.1 Три гарантии
1. **Ничего не теряется** — `persist-before-notify` + догон по `pts` при реконнекте.
   WS-push — лишь оптимизация; не дошёл (обрыв/падение реплики/Redis моргнул) → клиент
   вытянет пропущенное при следующем подключении.
2. **Нет дублей** — `client_msg_id` (UUID с клиента) при отправке; `msg_id`/`seq` при приёме.
3. **Порядок** — клиент сортирует по `seq` (монотонный в чате), не по времени прихода.

### 5.2 Жизненный цикл соединения (FSM)
```
CONNECTING → AUTHENTICATING → READY → (обрыв) → RECONNECTING → READY
```
- **Backoff** при реконнекте: экспоненциальный + jitter (0.5s,1s,2s,4s… до ~30s).
- **Heartbeat:** клиент `ping` каждые ~20с, сервер `pong`; мёртвые соединения дропаются
  после N пропущенных пингов; presence-TTL привязан к heartbeat.
- При входе в **READY** клиент отдаёт свой `pts` → сервер реплеит пропущенный дифф.

### 5.3 Update log (`pts` + `pts_count`, по модели Telegram)
Догоняем не только сообщения, но и события (read-receipts, реакции, правки, удаления).
Модель сверена с tweb (`apiUpdatesManager.ts`) — берём её ключевые свойства:

```sql
updates (user_id, pts BIGINT, pts_count INT, type, payload JSONB, created_at,
         PRIMARY KEY(user_id, pts))   -- pts монотонен на юзера
```
- **`pts` + `pts_count`:** каждый апдейт несёт текущий `pts` И сколько единиц он добавил.
  Это позволяет клиенту детектить дыру: если `localPts + pts_count < pts` пришедшего апдейта —
  пропуск, клиент буферизует апдейт и дёргает догон. (Просто инкремент этого не даёт.)
- **Отдельный поток pts на канал** (Phase 4): у каждого канала свой `channel_pts`
  (таблица `channel_states(user_id, channel_id, pts)` / поле в `chat_members`).
  Каналы не мешаются с pts личного бокса — как `getChannelDifference` в TG.
- **`qts`** — отдельный поток для секретных чатов (Phase 7).
- Любое адресованное юзеру событие → строка в `updates` (инкремент `pts`) + быстрый push в Redis.

**Эндпоинт догона `GET /sync` = аналог `updates.getDifference`:**
```
GET /sync?pts={last}&date={last}     →
  {
    new_messages: [...],        // новые сообщения
    other_updates: [...],       // read/реакции/правки/удаления
    chats: [...], users: [...], // связанные сущности (чтобы клиент не до-запрашивал)
    state: { pts, date },       // новое состояние
    slice: bool,                // отдан кусок — звать ещё раз (differenceSlice)
    too_long: bool              // слишком много пропущено → клиент делает полный ресинк
  }
```
- **Слайсы:** при большом диффе отдаём частями (`slice:true`), клиент звёт `/sync` повторно.
- **Too long:** разрыв огромен (юзера не было неделю) → `too_long:true` + снапшот (список чатов
  + последние сообщения), клиент сбрасывает локальный кэш и ресинкается.
- Write-amplification (строка на получателя события) на нашем масштабе приемлема; так сделан TG.

### 5.4 Отправка пошагово (с учётом отказов)
```
1. A → SendMessage {chat_id, text, client_msg_id}      (UI: «часики», pending)
2. Сервер: транзакция PG — INSERT message(seq) + INSERT updates для A и B
3. Сервер → A: MessageAck {client_msg_id, msg_id, seq} (UI: «✓ отправлено»)
4. Сервер: PUBLISH user:{B} (быстрый путь)
5a. B онлайн → реплика B пушит NewMessage в сокет
5b. B офлайн → догонит по pts при connect (+ ушёл push, §«Уведомления»)
6. B прочитал → Read {chat_id, up_to_seq} → updates для A → A видит «✓✓ прочитано»
```
Если ack (шаг 3) не дошёл — A по таймауту повторяет с тем же `client_msg_id`; уникальный
индекс ловит дубль, сервер просто отдаёт ack повторно.

### 5.5 Read receipts («о просмотре»)
`Read {chat_id, up_to_seq}` → сервер двигает `chat_members.last_read_seq`, пересчитывает
`unread`, пишет `updates` остальным участникам. Статус прочтения — обычный апдейт, поэтому
переживает реконнект и догоняется по `pts` (галочки «✓✓» не теряются).

### 5.6 Presence / typing
Эфемерные, только в Redis. `presence:{user}` TTL ~30с по heartbeat. `typing` — PUBLISH без БД.

## 6. Модель данных (Postgres, ядро Phase 0)

```sql
users        (id, phone, username, display_name, bio, avatar_url, created_at)
devices      (id, user_id, name, platform, token_hash, last_active, created_at)
chats        (id, type['private'|'group'|'channel'|'saved'], created_at)
chat_members (chat_id, user_id, role, joined_at, last_read_seq, unread_count,
              muted, PRIMARY KEY(chat_id,user_id))
messages     (id, chat_id, seq, sender_id, type, text, reply_to_id,
              media_id NULL, client_msg_id, edited_at, deleted_at, created_at,
              UNIQUE(chat_id, seq), UNIQUE(chat_id, sender_id, client_msg_id))
media        (id, owner_id, bucket, object_key, mime, size, width, height,
              duration, waveform, blur_preview BYTEA, sizes JSONB, created_at)
              -- blur_preview: крошечный (~8x8) blurred JPEG для LQIP-плейсхолдера
              -- sizes: список доступных размеров [{w,h,object_key}] для фото/видео-превью
reactions    (message_id, user_id, emoji, PRIMARY KEY(message_id,user_id,emoji))
contacts     (user_id, contact_user_id, alias)
updates      (user_id, pts BIGINT, type, payload JSONB, created_at,
              PRIMARY KEY(user_id, pts))           -- журнал апдейтов для догона (§5.3)
push_subscriptions (id, device_id, endpoint, p256dh, auth, created_at)  -- Web Push (§ниже)
```

- `seq` per chat генерим атомарно (sequence на чат / advisory lock + `MAX(seq)+1`).
- Личный чат = `chats(type=private)` + 2 строки в `chat_members`. Единая модель для всех
  типов чатов — группы/каналы переиспользуют её в следующих фазах.
- Unread инкрементально в `chat_members.unread_count`, дублируется в Redis.

## 6a. History API (контракт по образцу `messages.getHistory`)

Фронт (см. отдельный документ по архитектуре фронта) хранит историю как **разреженные слайсы**
(SlicedArray) и грузит «окно» вокруг точки. Поэтому эндпоинт истории должен уметь отдавать
сообщения в обе стороны от опорного:

```
GET /chats/{chat_id}/history?offset_id={seq}&add_offset={n}&limit={k}   →
  {
    messages: [...],   // k сообщений начиная с offset_id со сдвигом add_offset
    count: N,          // всего сообщений в чате (для оценки концов/скролл-бара)
    chats: [...], users: [...]
  }
```
- `offset_id` — опорный `seq` (0/пусто = «с конца», т.е. свежие).
- `add_offset` — сдвиг: отрицательный → берём сообщения **новее** опорного (скролл вниз),
  положительный/0 → **старее** (скролл вверх). Позволяет грузить окно в обе стороны.
- `limit` — размер окна (обычно 30–50).
- Клиент по `count` и числу отданных детектит «достигнут верх/низ истории».
- Доступ к чату проверяется по `chat_members`. Удалённые сообщения отдаются как `deleted` (tombstone).

**Прыжок на первое непрочитанное:** клиент берёт `chat_members.last_read_seq` (отдаётся в списке
чатов) и грузит окно вокруг него — как `readMaxId` в TG.

## 7. Redis: использование

| Назначение | Ключ / структура | TTL |
|-----------|------------------|-----|
| Pub/sub доставка | канал `user:{id}` | — |
| Онлайн-статус | `presence:{user}` | ~30с |
| Карта «юзер → реплики» | set `routes:{user}` | по heartbeat |
| Кэш сессии по токену | `session:{token_hash}` | срок токена |
| Счётчики unread | `unread:{user}:{chat}` | — |
| Rate-limit | `rl:{user}:{action}` | окно |
| Typing | PUBLISH `typing:{chat}` | — |
| Очередь push | Redis Stream `push:queue` | — |

## 8. Протокол WebSocket (Phase 0, JSON)

Все кадры — JSON в конверте `{ t, seq, d }`, роутинг по `t`. Типы кадров — в общем TS-файле
с фронтом (без codegen). Перечень сообщений (`t` → `d`):

```
→ auth          {token}
→ send_message  {chat_id, type, text, reply_to_id?, client_msg_id}
← message_ack   {client_msg_id, msg_id, seq, created_at}
← new_message   {chat_id, message{...}}
→ read          {chat_id, up_to_seq}
← read_receipt  {chat_id, user_id, up_to_seq}
→ typing        {chat_id}
← typing        {chat_id, user_id}
← presence      {user_id, online, last_seen}
→ ping / ← pong heartbeat
```

REST — для не-живого: логин, список чатов, история, `GET /sync?pts=`, профиль, медиа,
регистрация push-подписки.

## 9. Аутентификация (Phase 0)

Phone + OTP по телеграмной модели, но в dev код **не отправляется реально** — фиксированный
код, логируется в консоль. Замена на реального SMS-провайдера не меняет модель данных.

```
POST /auth/request_code {phone}       → код в логи (dev)
POST /auth/sign_in      {phone, code} → создаёт user (если нет) + device, выдаёт токен
```

Токен устройства → хранится хэшем в `devices.token_hash`, кэш в Redis. Каждое устройство =
отдельная сессия (фундамент под мультиустройство/мульти-аккаунт в Phase 1).

## 10. Структура Go-проекта

```
backend/
  cmd/server/main.go
  internal/
    config/
    transport/http/      — REST
    transport/ws/        — WS-хаб, сессии соединений
    auth/                — регистрация, токены, устройства
    chat/                — чаты, участники
    message/             — отправка, история, seq
    presence/            — онлайн/typing (Redis)
    media/               — presigned URL, MinIO
    realtime/            — Redis pub/sub, fan-out
    sync/                — update log (pts), getDifference/getState
    push/                — Web Push: подписки, очередь, worker, VAPID
    store/postgres/      — репозитории, миграции
    store/redis/         — клиент, ключи
  migrations/
  proto/                 — .proto-схемы (общие с фронтом), Makefile codegen
  Dockerfile
docker-compose.yml
nginx/nginx.conf
```

Стиль: чистые границы пакетов, репозитории за интерфейсами, `context.Context` везде,
graceful shutdown.

## 11. Docker / Nginx / медиа

- `docker-compose.yml`: `nginx`, `backend` (scalable), `postgres`, `redis`, `minio`,
  `minio-init` (создаёт бакеты). Volume’ы для PG/MinIO, healthcheck’и, `.env` для секретов.
- **Nginx**: апстрим на реплики backend; `proxy_pass` для `/api/`; `/ws` с `Upgrade`/
  `Connection` и длинным `proxy_read_timeout`; `/media/` на MinIO; gzip, лимиты загрузки.
- **Медиа-флоу**: клиент просит presigned PUT-URL → грузит файл напрямую в MinIO → шлёт
  `media_id` в сообщении. Скачивание — presigned GET. Байты файлов не идут через бэкенд.
- **HTTP Range обязателен** (MinIO/S3 умеет, nginx проксирует `Range`/`206 Partial Content`):
  фронтовый Service Worker стримит видео/аудио и докачивает чанками — это требование к раздаче.
- **Превью**: на загрузке бэкенд (или клиент) генерит `blur_preview` (LQIP) и `sizes`; клиент
  показывает blurred-плейсхолдер мгновенно, грузит подходящий размер под вьюпорт.

## 11a. Уведомления

Два вида:
1. **In-app** (приложение открыто) — покрыто сокетом: `NewMessage` → бейдж/звук/тост.
2. **Push при закрытом приложении / офлайне** — Web Push (Phase 0).

**Поток push:**
```
При fan-out события сервер смотрит routes:{user} в Redis:
  • есть активный сокет → доставлено по WS, push не шлём
  • нет сокета → кладём задачу в Redis Stream push:queue
                 → worker берёт и шлёт через Web Push (VAPID)
```
- **Web Push + VAPID:** браузер получает уведомление с закрытой вкладкой через Service Worker.
  Подписки — таблица `push_subscriptions` (на устройство). На фронт добавляется Service Worker.

**Контракт payload push** (сверен с tweb `push.ts`):
```json
{
  "chat_id": "...", "msg_id": "...", "seq": 42,
  "sender": { "name": "...", "avatar": "..." },
  "text": "превью текста",          // опускается если nopreview
  "badge": 5,                        // общий счётчик непрочитанных (для setAppBadge)
  "silent": false
}
```
- Service Worker перед показом проверяет: есть ли **активное окно** (если онлайн — не показывать),
  `muted`-чат/snooze, passcode-lock (тогда пустое уведомление). Клик → focus + переход в `chat_id`.
- **Мобилки (позже):** APNs/FCM — та же очередь, другой отправитель.
- **Настройки:** `muted`-чаты не пушим (позже — `@mention` пробивает mute; превью скрываемо `nopreview`).
- **Надёжность:** очередь с ретраями; протухшие подписки (410 Gone) чистим.

## 12. Границы Phase 0

**Входит:**
- Регистрация/логин (phone + dev-OTP), сессии/устройства
- Личные чаты
- Отправка/получение текста в реальном времени (JSON WS + Redis fan-out)
- Надёжная доставка: update log (`pts`), дедуп, reconnect-догон (§5)
- Presence (онлайн/last seen), typing, read-статусы
- История сообщений + `GET /sync?pts=`
- Реакции
- Аватары и медиа через MinIO (presigned)
- **Web Push** (VAPID, очередь, worker, Service Worker на фронте)
- Полный docker-compose со стеком и nginx

**НЕ входит (следующие фазы):** группы, каналы, обсуждения, сторис, QR-логин,
e2e/секретные чаты, голос/видеозвонки, APNs/FCM.

## 13. Дорожная карта фаз

| # | Подсистема | Зависит от |
|---|-----------|-----------|
| 0 | Ядро: auth + realtime + личные чаты | — |
| 1 | Мультиустройство и мульти-аккаунт | 0 |
| 2 | QR-авторизация | 0, 1 |
| 3 | Группы (роли/права, служебные сообщения) | 0 |
| 4 | Каналы + обсуждения (посты, просмотры, комментарии) | 0, 3 |
| 5 | Медиа (расширенное: видео-транскод, превью) | 0 |
| 6 | Сторис (TTL 24ч, лента, просмотры) | 0, 5 |
| 7 | Секретные чаты (E2E) | 0, 1 |
