# Боты и Mini-Apps

Документация по созданию ботов и mini-app'ов и их интеграции с мессенджером.
API — Telegram-подобное; если вы знакомы с Telegram Bot API, всё узнаваемо.

## Страницы

1. [**Создание бота**](creating-bots.md) — через @BotFather в приложении.
2. [**Bot API**](bot-api.md) — методы, апдейты, long-poll и webhook, полный пример.
3. [**Mini-Apps**](mini-apps.md) — создание mini-app, JS-мост `Telegram.WebApp`, точки входа.

## В двух словах

- **Бот** — это отдельный сервис, который вы пишете сами. Он общается с сервером
  по HTTP через **Bot API** (`/api/bot/<token>/<method>`), получая апдейты
  (long-poll или webhook) и отвечая методами `sendMessage` и др.
- **@BotFather** — системный бот в приложении: создаёт ботов, выдаёт токены,
  настраивает команды и mini-app'ы.
- **Mini-App** — веб-страница, которая открывается внутри приложения в iframe и
  общается с ним через `window.Telegram.WebApp`.

## Быстрый старт

```bash
# 1. В приложении: чат с @BotFather → /newbot → имя → username → получите токен
# 2. Запустите готовый пример бота с этим токеном:
BOT_TOKEN=777123:abcdef... node examples/bot/demo-bot.mjs
# 3. Напишите боту /start в приложении
```

Исходник примера: [`examples/bot/demo-bot.mjs`](../../examples/bot/demo-bot.mjs).

## Что поддерживается

Реализовано **подмножество** Telegram Bot API, достаточное для полноценных ботов
и mini-app'ов: текстовые сообщения, inline/reply-клавиатуры, callback-кнопки,
inline-режим, команды, mini-app'ы (web_app-кнопки и кнопка-меню), long-poll и
webhook. Медиа-методы (`sendPhoto`, `sendDocument`, …), платежи и редактирование
сообщений пока не входят — см. [Bot API](bot-api.md#не-реализовано).
