# CLAUDE.md

Инструкции для работы с этим репозиторием. Это монорепо клона Telegram:
Go-бэкенд (`backend/`) + React/TS-фронтенд (`web-client/`). Обзор — в [`README.md`](README.md).

## Как работать

- **Отвечать по-русски.**
- **Референс — tweb** (Telegram Web K). Любую вёрстку/разметку/поведение брать **1:1 из tweb**,
  не выдумывать. Перед тем как утверждать «в Telegram так» — **проверить в исходниках tweb**.
- **Без отсебятины.** Если не уверен, как сделано в оригинале, — сначала изучить tweb, потом писать.
- **Мёртвый код удалять** агрессивно: не оставлять заглушки, неиспользуемые ветки и эксперименты.
- Проверять результат (сборка/тесты/поведение) прежде, чем говорить «готово».

## Стек

- **Backend:** Go 1.25, chi/v5, uber/fx (DI), pgx/v5, go-redis, minio-go, goose (миграции),
  gorilla/websocket, webpush-go, geoip2-golang. Чистая архитектура: `domain → usecase → adapter`.
- **Frontend:** React 19, TypeScript (strict), Vite 8, SCSS-модули (sass; **MUI убран** — не возвращать),
  Zustand 5, prismjs, vitest (**framer-motion убран** — не возвращать: анимации на CSS-классах tweb).
  Логика/сеть в Web/SharedWorker (RPC через SuperMessagePort).
- **Хранилища:** Postgres (данные), Redis (кэш/realtime/presence/очередь), MinIO (медиа).

Детали — в [`backend/README.md`](backend/README.md) и [`web-client/README.md`](web-client/README.md).

## Сборка и запуск

Полный стек (postgres + redis + minio + backend + nginx) — корневой `docker-compose.yml`:

```bash
# фронт собрать в client-build/ (раздаётся nginx)
cd web-client && npx vite build --outDir ../client-build && cd ..
docker compose up -d --build          # приложение на http://localhost:8080
```

Команды для разработки и зональные правила — в [`backend/CLAUDE.md`](backend/CLAUDE.md)
и [`web-client/CLAUDE.md`](web-client/CLAUDE.md).

## Кросс-каттинг (общее для обеих частей)

- **Rich-text:** `MessageEntity` (bold/italic/underline/strike/code/pre/spoiler/blockquote/text_link),
  offset/length в **UTF-16**. Инпут хранит сырые markdown-маркеры, разбор — на отправке; на бэке сущности санитизируются.
- **Realtime:** WebSocket `/ws?token=` с кадрами `{t, d}`; `send_message` → `message_ack`/`message_error`.
- В dev OTP-код входа — `12345` (`DEV_OTP_CODE`).
