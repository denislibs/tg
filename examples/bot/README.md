# Пример бота-сервиса (Bot API)

Внешний бот на нашем **Bot API** (Telegram-подобный): long-poll `getUpdates` +
`sendMessage` / `answerCallbackQuery` / `answerInlineQuery`.

## 1. Создать бота

В приложении откройте чат с **@BotFather** и создайте бота:

```
/newbot
→ имя (например «Мой бот»)
→ username (латиницей, должен заканчиваться на «bot», например my_demo_bot)
```

BotFather пришлёт **токен** вида `777123:abcdef…`.

## 2. Запустить бота

```bash
BOT_TOKEN=777123:abcdef... node examples/bot/demo-bot.mjs
```

Переменные окружения:

- `BOT_TOKEN` — токен от BotFather (обязательно)
- `API_BASE`  — база Bot API (по умолчанию `https://localhost:38443/api`)
- `WEBAPP_URL`— URL mini-app для webapp-кнопки (по умолчанию `/webapp-demo.html`)

Теперь напишите боту в приложении: `/start`, нажмите inline-кнопки,
или наберите в любом чате `@<username> запрос` (inline-режим).

## Транспорты

- **Long-poll** (этот пример): бот сам опрашивает `getUpdates`.
- **Webhook**: `POST /bot/<token>/setWebhook {"url":"https://…/hook"}` — сервер
  сам будет POST'ить апдейты на ваш URL (тело — объект `Update`).

## Поддержанные методы Bot API

`getMe`, `getUpdates`, `setWebhook`, `deleteWebhook`, `sendMessage`
(`reply_markup`: inline/reply-клавиатуры, web_app-кнопки), `answerCallbackQuery`,
`answerInlineQuery`, `setMyCommands`, `setChatMenuButton`.

Базовый путь метода: `<API_BASE>/bot/<token>/<method>`.
