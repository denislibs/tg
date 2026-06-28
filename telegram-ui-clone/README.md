# Frontend — Telegram Web Remake

Пиксель-в-пиксель ремейк интерфейса Telegram Web (K) на React + TypeScript,
работающий с **реальным бэкендом** этого репозитория (REST + WebSocket): оптимистичная
отправка, rich-text, медиа, истории, группы/каналы, реакции, звонки, push.

> Изначально это был mock-only UI (демо: https://denislibs.github.io/telegram-remake/).
> Сейчас фронт подключён к Go-бэкенду — см. корневой [`../README.md`](../README.md) и [`../backend/README.md`](../backend/README.md).

## Стек

- **React 18** + **TypeScript** (strict)
- **Vite 6** — сборка и dev-сервер
- **MUI 6** (`@mui/material`, emotion) — компоненты и стили (`sx`)
- **Zustand 5** — глобальное состояние (чаты, истории, звонки, аудио)
- **framer-motion** — анимации
- **prismjs** — подсветка кода в блоках
- **qr-code-styling** — QR для логина; **vitest** + happy-dom — тесты

## Команды

```bash
npm install
npm run dev      # dev-сервер :5173 (проксирует /api и /ws на бэкенд :38080)
npm run build    # tsc -b + vite build → dist/
npm test         # vitest
```

`vite.config.ts`: dev-сервер проксирует `/api` → `http://localhost:38080` и `/ws` → `ws://localhost:38080`
(бэкенд за nginx). Прод-сборка для раздачи nginx делается в корне:
`npx vite build --base=/ --outDir ../client-build`.

## Структура

```
src/
├── main.tsx              # точка входа: монтаж React, регистрация sw.js, шрифты
├── App.tsx               # Shell: startClient() → loadChats() → startRealtime() → setupPush()
├── theme.ts settings.tsx # темы (light/dark/пресеты), контекст настроек
├── data.ts               # ConvMsg / Chat / OpenPeer — формы для рендера
├── i18n/                 # локализация
│
├── core/                 # «движок» клиента (сеть, состояние, домен)
│   ├── models.ts             # серверные схемы: Dialog, Message, MessageEntity
│   ├── messageToConvMsg.ts   # Message → ConvMsg (out/in, статусы, reply, forward)
│   ├── markdown.ts           # contenteditable ↔ {text, entities} (UTF-16 offsets)
│   ├── mediaUrl.ts dayLabel.ts tgico-icons.ts
│   ├── auth/tokenStore.ts    # токен сессии (IndexedDB + память)
│   ├── net/                  # restClient.ts (GET/POST/PUT/PATCH/DELETE), wsClient.ts
│   ├── realtime/             # connectionManager.ts (стейт-машина + outbox + heartbeat),
│   │                         #   events.ts (типы RT-событий), syncEngine.ts
│   ├── managers/             # messagesManager, mediaManager, chats/groups/channels,
│   │                         #   profile, stories, contacts, presence, push, auth, health
│   ├── hooks/                # useMessageWindow (пагинация окна), useVoiceRecorder,
│   │                         #   useChatSearch, useTypingLabel, useEvent, …
│   ├── history/slicedArray.ts # разрежённый seq-кэш истории
│   ├── dom/                  # scrollSaver, getViewportSlice, smoothScrollToElement, …
│   ├── audio/                # звуки звонков, плеер, waveform
│   └── store/idbKv.ts        # key-value в IndexedDB
│
├── stores/               # Zustand: chatsStore, storiesStore, callStore, audioStore,
│                         #   voicePlayedStore, connectionStore
├── client/               # bootstrap.ts (startClient), realtimeBridge.ts (RT → UI), pushSetup.ts
├── rpc/                  # superMessagePort.ts, managersProxy.ts (RPC к воркеру)
├── protocol/frames.ts    # кодирование WS-кадров {t, d}
│
└── components/
    ├── Composer.tsx          # contenteditable-инпут + reply/edit-бар + voice + emoji
    ├── MarkupTooltip.tsx     # тулбар форматирования над выделением
    ├── RichText.tsx          # рендер текста по entities (bold/italic/…/spoiler/link)
    ├── CodeBlock.tsx         # блок кода: prism-подсветка + копирование (20+ языков)
    ├── ConversationView.tsx  # основная область чата (окно сообщений, заголовок, меню)
    ├── Sidebar.tsx           # список чатов (папки, поиск)
    ├── messages/             # MessageRow, MessageBubbles, RealMediaBubble, VoiceMessage,
    │                         #   ChatFeed (дни-разделители, группировка), MediaLightbox
    ├── conversation/         # ChatHeader, MessageContextMenu, TypingIndicator, …
    ├── auth/AuthFlow.tsx     # вход по коду / QR
    ├── StoryViewer.tsx EmojiPicker.tsx CallScreen.tsx SearchView.tsx SettingsView.tsx
    └── NewGroupFlow / NewChannelFlow / NewPrivateChat / ContactsView / AddContactView …
```

## Как устроена работа с бэкендом

- **REST** (`core/net/restClient.ts`) — Bearer-токен в заголовке; `.contentUrl()`/`.mediaUrl()`
  строят ссылки с токеном для `<img>`/`<video>`.
- **WebSocket** (`core/net/wsClient.ts` + `core/realtime/connectionManager.ts`) — кадры `{t, d}`,
  авто-реконнект с экспоненциальным backoff, heartbeat (ping/pong), **outbox** неподтверждённых
  отправок: по `message_ack` сообщение помечается доставленным, по `message_error` — удаляется.
- **Оптимистичная отправка** (`core/hooks/useMessageWindow.ts`) — бабл появляется сразу
  (`client_msg_id`, временный seq), затем сверяется с ответом сервера (`reconcileAck` / `failOptimistic`).
- **Кэш истории** (`slicedArray` + `messagesManager`) — разрежённые seq-диапазоны; пагинация
  `loadOlder/loadNewer`, прыжок к сообщению `jumpTo`.
- **Состояние** — Zustand-сторы (диалоги, presence, typing, истории, звонки) обновляются
  realtime-мостом `client/realtimeBridge.ts`.

## Rich-text (`core/markdown.ts`)

Инпут — contenteditable; модель совпадает с бэкендом (`MessageEntity` с UTF-16 offset/length).
- `serialize()` — DOM → `{text, entities}`.
- `apply()` — переключение формата на выделении (B/I/U/S через execCommand; code/spoiler/quote/link — ручной wrap).
- `parseMarkdown()` — разбор markdown при **отправке** (инпут хранит сырые маркеры, как в Telegram Web K).
- Типы: bold, italic, underline, strikethrough, code, pre, spoiler, blockquote, text_link.
- Блоки кода: язык = текст до первого перевода строки во fence; рендер через prism (`CodeBlock.tsx`),
  с ограничением длины для защиты от ReDoS; ссылки фильтруются по allow-list схем (XSS).

## Возможности

Сообщения (текст/медиа/голос/альбомы), reply/forward, правка/удаление, закрепления, реакции,
поиск; rich-text и блоки кода; вложения (вставка/drag-n-drop, альбомы, лайтбокс); группы и каналы
(создание, участники, админы, инвайты, заявки), обсуждения/комментарии; истории; звонки (аудио,
UI-состояния); presence, typing, read-receipts; темы light/dark; вход по коду или QR; push.

## Бэклоги и заметки

- [`docs/state-architecture.html`](docs/state-architecture.html) — диаграмма состояния.
- [`backlogs/frontend/`](backlogs/frontend) — задел: подрезка окна сообщений, кэш в IndexedDB, загрузка медиа, действия над сообщениями.
