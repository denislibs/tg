# Backend

Go-сервис мессенджера: REST API + WebSocket-шлюз. Чистая архитектура
(domain → usecase → adapter), DI через [uber/fx](https://github.com/uber-go/fx),
данные в PostgreSQL, кэш/realtime/presence в Redis, медиа в MinIO.

Модуль: `github.com/messenger-denis/backend` · Go 1.25.

## Запуск

```bash
# зависимости (Postgres/Redis/MinIO) проще поднять через корневой docker compose
cd .. && docker compose up -d postgres redis minio && cd backend

export DATABASE_URL="postgres://messenger:messenger@localhost:5432/messenger?sslmode=disable"
export REDIS_URL="redis://localhost:6379"
export DEV_OTP_CODE="12345"
go run ./cmd/server          # слушает :8080
```

Точка входа — `cmd/server/main.go`: `fx.New(app.Module).Run()`. Миграции применяются
автоматически на старте (goose). Healthcheck: `GET /health`.

## Структура

```
cmd/server/main.go              # точка входа (fx)
internal/
├── domain/                     # сущности и инварианты (без зависимостей от фреймворков)
│   ├── user.go message.go chat.go story.go contact.go media.go
│   ├── push.go qrlogin.go reaction.go rights.go update.go token.go
│   ├── phone.go errors.go
├── usecase/                    # бизнес-логика (зависит только от domain + портов)
│   ├── auth/      # OTP-вход, сессии, устройства, QR-логин, гео-алерты
│   ├── chat/      # сообщения, чаты, группы/каналы, реакции, sync, поиск, discussions
│   ├── story/     # истории (постинг, приватность, просмотры, лента)
│   ├── contacts/  # адресная книга
│   ├── media/     # presigned-загрузка, доступ, ffmpeg-превью
│   ├── presence/  # online / last-seen
│   └── push/      # web-push (подписки, очередь, отправка)
├── adapter/
│   ├── delivery/http/          # chi-роутер + *_handler.go
│   ├── delivery/ws/            # WebSocket: handler, hub, conn, frames
│   ├── repo/postgres/          # репозитории (pgx)
│   ├── geoip/                  # MaxMind GeoLite2 lookup
│   └── …                       # storage/minio, cache/redis, realtime/redis, queue/redis, push/webpush, media/ffmpeg
├── store/postgres/migrations/  # SQL-миграции (goose)
├── config/config.go            # чтение переменных окружения
├── app/                        # DI-сборка (app.go, providers.go, server.go)
└── openapi/                    # OpenAPI-спека + Swagger UI
```

Каждый usecase зависит от интерфейсов (`ports.go`), что позволяет подменять репозитории и сервисы в тестах.
Опциональные зависимости (Redis, MinIO, VAPID, GeoIP) деградируют мягко: при их отсутствии
соответствующая функциональность отключается, сервис продолжает работать.

## Архитектура и поток данных

### Слои и направление зависимостей

Зависимости направлены строго внутрь: `domain ← usecase ← adapter`.

- **`domain/`** — сущности и инварианты (value-объекты, ошибки, права). Чистый Go, без импортов
  фреймворков/БД/HTTP. Здесь же — доменные ошибки (`ErrNotFound`, `ErrForbidden`, `ErrTooLong`…).
- **`usecase/<feature>/`** — бизнес-логика. Знает только `domain` и **порты** (`ports.go` —
  интерфейсы репозиториев/сервисов), не конкретные реализации. Санитизация ввода (allow-list схем
  ссылок, лимиты длины/числа сущностей) живёт здесь (`usecase/chat/sanitize.go`). 17 доменов:
  `auth, chat, contacts, folders, iv, media, notify, passkeys, presence, privacy, public, push,
  report, stats, stickers, story`.
- **`adapter/`** — реализация портов: `delivery/http` (chi-хендлеры), `delivery/ws` (WS-шлюз),
  `repo/postgres` (pgx), `storage/minio`, `cache/redis`, `realtime/redis`, `queue/redis`,
  `push/webpush`, `media/ffmpeg`, `geoip`.
- **`app/`** — DI-сборка на uber/fx (`providers.go` — фабрики, `server.go` — wiring). Новый компонент
  регистрируется тут; всё связывается через конструкторы, а не глобальные синглтоны.

Хендлеры **не содержат бизнес-логики**: парсят запрос → зовут usecase → сериализуют ответ; доменные
ошибки мапятся в HTTP-коды (сырые ошибки наружу не уходят).

### Жизненный цикл REST-запроса

```
nginx → chi router → middleware (auth: Bearer → userID) → *_handler.go
   → usecase.<Method>(ctx, input)  ── зовёт порты ──►  repo/postgres, storage/minio, cache/redis
   → domain-результат/ошибка → handler сериализует JSON (или мапит ErrX → 4xx/5xx)
```

### Реалтайм: путь события

Источник истины — Postgres. После коммита usecase публикует апдейт в Redis pub/sub; каждая нода
слушает канал и рассылает событие своим активным WS-соединениям. Это делает бэкенд **горизонтально
масштабируемым**: клиент подключён к одной ноде, но события долетают со всех.

```
usecase (после commit в Postgres)
   → realtime/redis: PUBLISH update  ──►  Redis pub/sub
   → каждая нода: SUBSCRIBE → ws-hub → соединения подписчиков чата
   → кадр {t, d} клиенту
```

Отправка клиента идёт зеркально: WS-кадр `send_message` → `delivery/ws` → `usecase/chat` →
Postgres (назначает монотонный `seq`) → `message_ack` отправителю + `new_message` в pub/sub остальным.

### Консистентность и догон

- **Порядок**: у сообщения есть монотонный `seq` в пределах чата (курсор истории/пагинации).
- **Догон после оффлайна**: `GET /sync` отдаёт апдейты с момента последнего курсора; для каналов —
  `GET /channels/{id}/difference` по `pts`. Клиент применяет их тем же путём, что и live-события.
- **Presence** (online/last-seen) и typing — эфемерны, живут в Redis (TTL), не пишутся в Postgres.

## HTTP API

Роутинг — `internal/adapter/delivery/http/router.go` (chi/v5). Две группы: публичная и защищённая (Bearer-токен).

**Публичные** (без авторизации):

| Метод/путь | Назначение |
|---|---|
| `POST /auth/request_code` | запросить OTP-код |
| `POST /auth/sign_in` | вход по телефону + код (незнакомый номер → `signup_required`) |
| `POST /auth/sign_up` | регистрация нового номера (токен шага + имя) |
| `POST /auth/check_password` | второй шаг при облачном пароле |
| `POST /auth/password/recover` | код сброса пароля на привязанную почту |
| `POST /auth/password/recover/confirm` | подтвердить код, снять пароль, выдать сессию |
| `POST /auth/account/reset` | сброс аккаунта, когда почты для восстановления нет: первый вызов планирует удаление (`409 2fa_confirm_wait` + `retry_after`), вызов после истечения окна — исполняет (`200 {"ok":true}`); вход владельца отменяет (`409 2fa_recent_confirm`) |
| `POST /auth/sign_import` | обменять веб-токен (`#?tgWebAuthToken=`) на сессию |
| `POST /auth/qr/new` | начать QR-логин |
| `GET /auth/qr/{token}` | опрос статуса QR |
| `GET /media/{mediaID}/content` | скачать медиа (авторизация через `?token=`) |
| `GET /health` · `GET /openapi.yaml` · `GET /swagger` | health + документация |

**Защищённые** (основные группы):

- **Профиль/сессии:** `GET/PATCH /me`, `PUT /me/username`, `GET /username/available`, `PUT /me/avatar`, `GET /sessions`, `DELETE /sessions/{deviceID}`, `POST /auth/logout`, `POST /auth/qr/confirm`, `POST /auth/web_token`
- **Чаты/сообщения:** `POST /chats`, `POST /saved`, `GET /chats`, `POST /chats/{id}/messages`, `PATCH|DELETE /chats/{id}/messages/{msgID}`, `POST /chats/{id}/forward`, `POST|DELETE /chats/{id}/messages/{msgID}/pin`, `GET /chats/{id}/pins`, `GET /chats/{id}/messages/{msgID}/viewers`, `GET /chats/{id}/history`, `GET /chats/{id}/search`, `POST /chats/{id}/read`
- **Sync:** `GET /sync` — апдейты с момента последнего запроса
- **Реакции:** `POST|DELETE|GET /chats/{id}/messages/{msgID}/reactions[/{emoji}]`
- **Группы:** `POST /groups`, `GET /chats/{id}/card`, `GET /chats/{id}/members`, `PATCH /chats/{id}`, `POST|DELETE /chats/{id}/members[/{userID}]`, `POST|DELETE /chats/{id}/admins[/{userID}]`, `POST /chats/{id}/mute`, `POST|GET /chats/{id}/invite_links`, `POST /join/{token}`, `GET /chats/{id}/join_requests`, `POST /chats/{id}/join_requests/{userID}/approve|decline`
- **Каналы/обсуждения:** `POST /channels`, `POST /channels/{id}/messages`, `GET /channels/{id}/difference`, `POST /channels/join`, `POST /channels/{id}/discussion`, `POST|GET /channels/{id}/posts/{postId}/comments`, `GET /channels/{id}/comment_counts`
- **Поиск/люди:** `GET /users`, `GET /search`, `GET /presence`
- **Медиа:** `GET /media/token`, `POST /media/upload`, `GET /media/{id}`, `PUT /media/{id}/content`
- **Push:** `GET /push/vapid_public_key`, `POST /push/subscribe`
- **Истории:** `POST|GET /stories`, `POST /stories/{id}/view`, `GET /stories/{id}/viewers`, `DELETE /stories/{id}`
- **Контакты:** `POST|GET /contacts`, `DELETE /contacts/{userID}`

Полный перечень с телами запросов — в OpenAPI (`GET /swagger`) и [`../docs/contracts.md`](../docs/contracts.md).

## WebSocket

`internal/adapter/delivery/ws/`. Подключение `GET /ws?token=<bearer>`. Конверт кадра: `{"t": "<тип>", "d": {…}}`.

| Тип | Направление | Назначение |
|---|---|---|
| `ping` / `pong` | оба | keep-alive |
| `send_message` | client → server | отправка (`chat_id, type, text, entities[], reply_to_id?, media_id?, client_msg_id`) |
| `message_ack` | server → client | подтверждение (`client_msg_id, msg_id, seq, created_at`) |
| `message_error` | server → client | отказ доставки (`client_msg_id, reason`: `too_long` / `failed`) |
| `read` | client → server | прочитано до `up_to_seq` |
| `typing` | client → server | индикатор набора (`action`: typing/voice/video) |
| `subscribe_channel` / `unsubscribe_channel` | client → server | подписка на апдейты канала |

Реалтайм-события (новые сообщения, правки, удаления, реакции, read-receipts, typing, presence,
отзыв сессии) рассылаются через Redis pub/sub.

## Хранилища

**PostgreSQL** — источник истины. Миграции в `internal/store/postgres/migrations/` (goose),
последовательная нумерация `NNNN_name.sql`, применяются **автоматически** на старте (сейчас
`0001`…`0083`, 81 файл). Правило: не менять уже применённые миграции — только добавлять новые
следующим номером. Опорные вехи:

| Файл | Содержимое |
|---|---|
| `0001_init` | пользователи, устройства (сессии) |
| `0002_chats_messages` | чаты (private/group/channel/saved), участники, сообщения (монотонный `seq`) |
| `0003_reactions` · `0015_message_entities` | реакции; rich-text спаны (JSONB) |
| `0006_groups_channels` · `0007_join_requests` · `0008_discussions` | группы/каналы, права (битовая маска), заявки, обсуждения (`thread_root_id`) |
| `0009_stories` | истории + просмотры + allowlist приватности |
| `0011_message_actions` | атрибуция форвардов (`fwd_from_*`), «удалить у меня», закреплённые |
| `0083_star_transactions` | леджер Telegram Stars (транзакции ⭐) |

Полный список — в каталоге миграций; они и есть авторитетный источник схемы.

**Redis** — кэш сессий, QR-store (короткий TTL), publisher/subscriber реалтайма (pub/sub-фан-аут
между нодами), presence-store (online/last-seen, TTL), очередь web-push.

**MinIO** — медиа-объекты; ffmpeg генерирует превью/постеры и снимает размеры/длительность.

## Конфигурация

`internal/config/config.go` — переменные окружения:

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `HTTP_ADDR` | `:8080` | адрес HTTP-сервера |
| `DATABASE_URL` | (обязательна) | строка подключения Postgres |
| `REDIS_URL` | `redis://localhost:6379` | подключение Redis |
| `DEV_OTP_CODE` | `12345` | OTP-код в dev-режиме |
| `ACCOUNT_RESET_WAIT` | `168h` | окно ожидания сброса аккаунта («забыли пароль» без почты). Укорачивать только на стенде: в проде короче недели старт запрещён |
| `SEED_DEMO` | `false` | посев демо-стенда при старте: 20 профилей + каналы, группы, посты, опросы, закрепления и реакции (`internal/demoseed`) |
| `MEDIA_URL_SECRET` | `dev-media-url-secret-change-me` | секрет подписи токенов скачивания медиа |
| `MINIO_ENDPOINT` | `localhost:9000` | адрес MinIO |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | `minioadmin` | доступы MinIO |
| `MINIO_BUCKET` | `media` | бакет |
| `MINIO_USE_SSL` | `false` | HTTPS для MinIO |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | (опц.) | ключи web-push; без них push отключён |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | subject для web-push |
| `GEOIP_DB_PATH` | (опц.) | путь к GeoLite2-City.mmdb; без него гео в login-алертах опускается |

Пример — [`../.env.example`](../.env.example).

`SEED_DEMO` наполняет стенд ЧЕРЕЗ chat-usecase (те же вызовы, что у живого клиента),
поэтому появляются и служебные сообщения, и записи `updates` с pts. Каталоги стикеров
и реакций он не трогает — они гигабайтные, в git их нет и в образ они не попадают.
Залить их на стенд можно отдельными командами (сначала выкачать ассеты):

```bash
tools/.venv/bin/python tools/fetch_stickers.py --reactions --skip-sets   # ассеты реакций
cd backend && DATABASE_URL=... MINIO_ENDPOINT=... go run ./cmd/seed-reactions
cd backend && DATABASE_URL=... MINIO_ENDPOINT=... go run ./cmd/seed-stickers
```

## Тесты

```bash
go test ./...
```

Интеграционные тесты поднимают реальные Postgres/Redis/MinIO через
[testcontainers-go](https://golang.testcontainers.org/) (нужен запущенный Docker);
часть тестов использует `miniredis`. Юнит-тесты покрывают value-объекты домена
(`phone_test.go`, `token_test.go`, `rights_test.go`) и санитизацию сущностей (`usecase/chat/sanitize_test.go`).

## Сборка

`Dockerfile` — multi-stage: сборка на `golang:1.25-alpine`, рантайм на `alpine` с `ffmpeg`
(нужен для обработки медиа) и `ca-certificates`. Сервис слушает `:8080`.
