# Messenger (Telegram clone)

Полнофункциональный клон Telegram: **Go-бэкенд** (clean architecture, PostgreSQL + Redis + MinIO)
и **React/TypeScript-фронтенд** (пиксель-в-пиксель ремейк Telegram Web K) с реальной серверной
частью — REST + WebSocket, оптимистичная отправка, rich-text, медиа, истории, группы/каналы, звонки.

Это монорепозиторий: бэкенд и фронтенд лежат рядом и поднимаются единым `docker compose`.

```
messenger-denis/
├── backend/            # Go-сервис (API + WebSocket). См. backend/README.md
├── telegram-ui-clone/  # React/TS SPA. См. telegram-ui-clone/README.md
├── nginx/              # nginx.conf — раздаёт статику фронта и проксирует на backend
├── docs/               # contracts.md, ui-kit-migration.md, research/
├── client-build/       # собранная статика фронта (раздаётся nginx)
├── docker-compose.yml  # postgres + redis + minio + backend + nginx
└── .env.example        # пример переменных окружения
```

## Архитектура

```
                 ┌─────────────────────────────┐
   браузер ────► │ nginx (:8080)               │
                 │  /         → статика фронта  │
                 │  /api, /ws → backend:8080    │
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │ backend (Go, chi + fx)      │
                 │  REST + WebSocket            │
                 └───┬──────────┬──────────┬───┘
                     │          │          │
              ┌──────▼───┐ ┌────▼────┐ ┌───▼─────┐
              │ Postgres │ │  Redis  │ │  MinIO  │
              │ (данные) │ │(кэш/RT/ │ │ (медиа) │
              │          │ │presence)│ │         │
              └──────────┘ └─────────┘ └─────────┘
```

- **Postgres** — основное хранилище (пользователи, чаты, сообщения, реакции, истории, контакты…).
- **Redis** — кэш сессий, QR-логин, pub/sub реалтайма, presence (online/last-seen), очередь web-push. Опционален: при недоступности сервис деградирует мягко.
- **MinIO** — объектное хранилище медиа; сервер генерирует превью через ffmpeg. Опционален: без него медиа отключается.

Подробности слоёв — в [`backend/README.md`](backend/README.md) и [`telegram-ui-clone/README.md`](telegram-ui-clone/README.md).

## Быстрый старт (Docker)

Поднять всё разом:

```bash
# 1. собрать фронтенд в client-build/ (раздаётся nginx)
cd telegram-ui-clone && npm install && npx vite build --base=/ --outDir ../client-build && cd ..

# 2. поднять стек
docker compose up -d --build
```

Сервисы и порты (из `docker-compose.yml`):

| Сервис   | Образ                  | Порт (host)   | Назначение                          |
|----------|------------------------|---------------|-------------------------------------|
| nginx    | `nginx:alpine`         | `8080` → 80   | статика фронта + прокси на backend  |
| backend  | `./backend/Dockerfile` | (внутр. 8080) | Go API + WebSocket                  |
| postgres | `postgres:16-alpine`   | `5432`        | база данных                         |
| redis    | `redis:7-alpine`       | `6379`        | кэш / realtime / presence / очередь |
| minio    | `minio/minio:latest`   | `9000`, `9001`| хранилище медиа (S3 + консоль)      |

Миграции Postgres применяются автоматически при старте бэкенда (goose).
Приложение открывается на **http://localhost:8080**.

Учётные данные по умолчанию (dev): postgres `messenger/messenger`, MinIO `minioadmin/minioadmin`,
OTP-код для входа — `12345` (`DEV_OTP_CODE`).

> Если порты 5432/6379/8080 заняты другими проектами — переопредели проброс в `docker-compose.yml`.

## Разработка

**Бэкенд** (нужны Postgres/Redis/MinIO — можно поднять только их через compose):

```bash
cp .env.example backend/.env   # или экспортировать переменные
cd backend && go run ./cmd/server
go test ./...                  # интеграционные тесты на testcontainers (нужен Docker)
```

**Фронтенд** (dev-сервера нет — watch-сборка в `client-build/`, раздаёт nginx стенда):

```bash
cd telegram-ui-clone
npm install
npm run dev      # vite build --watch → ../client-build (открывать http://localhost:38080)
npm test         # vitest
```

## Документация

- [`docs/contracts.md`](docs/contracts.md) — контракты API.
- [`backend/internal/openapi`](backend/internal/openapi) — OpenAPI-спека + Swagger UI (`GET /swagger`).
- [`docs/bots/`](docs/bots/README.md) — **боты и mini-apps**: создание, Bot API, интеграция.
- [`docs/ui-kit-migration.md`](docs/ui-kit-migration.md) — заметки по UI-kit.

## Технологии

**Backend:** Go 1.25, chi/v5, uber/fx, pgx/v5, go-redis, minio-go, goose, gorilla/websocket,
webpush-go, geoip2-golang, testcontainers-go.

**Frontend:** React 18, TypeScript, Vite 6, MUI 6, Zustand, framer-motion, prismjs, vitest.
