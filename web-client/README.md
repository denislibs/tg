# Frontend — Telegram Web Remake

Пиксель-в-пиксель ремейк интерфейса Telegram Web (K) на React + TypeScript,
работающий с **реальным бэкендом** этого репозитория (REST + WebSocket): оптимистичная
отправка, rich-text, медиа, истории, группы/каналы, реакции, звонки, push.

> Изначально это был mock-only UI (демо: https://denislibs.github.io/telegram-remake/).
> Сейчас фронт подключён к Go-бэкенду — см. корневой [`../README.md`](../README.md) и [`../backend/README.md`](../backend/README.md).

## Стек

- **React 19** + **TypeScript** (strict)
- **Vite 8** — сборка (watch-режим вместо dev-сервера)
- **SCSS-модули** (`*.module.scss` + `sass`) — стилизация; глобальные дизайн-токены —
  CSS custom properties в `src/styles/_tokens.scss`, тема через атрибут `data-theme` на `<html>`.
  **MUI больше не используется** (историческая база была на MUI/`sx`, полностью мигрирована на SCSS).
- **Zustand 5** — глобальное состояние (чаты, сообщения, истории, звонки, аудио…)
- **framer-motion 12** — анимации
- **prismjs** — подсветка кода в блоках
- **qr-code-styling** — QR для логина; **vitest** + happy-dom — тесты

## Команды

```bash
npm install
npm run dev      # vite build --watch → ../client-build; раздаёт nginx стенда (:38080)
npm run build    # tsc -b + vite build → dist/
npm test         # vitest
```

Dev-сервера нет: `npm run dev` пересобирает бандл в `../client-build` при каждом изменении,
а nginx стенда монтирует эту папку — после ребилда достаточно обновить страницу
на http://localhost:38080. Разовая прод-сборка та же: `npx vite build --base=/ --outDir ../client-build`.

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

## Архитектура и поток данных

Строго **однонаправленный** поток (детали и обоснование — в
[`../docs/research/2026-06-29-frontend-refactor-plan.md`](../docs/research/2026-06-29-frontend-refactor-plan.md)):

```
вверх (данные):  сервер → smp → realtimeBridge → store → селектор → View
вниз (команды):  View → хук (use*) → manager → worker → сервер
```

### Слои и кто за что отвечает

- **View** (`components/*`) — только рендер + колбэки. Не фетчит, не слушает сокет, не держит данные.
- **ViewModel-хуки** (`core/hooks/use*`) — presentation logic: читают стор селектором, отдают
  компоненту данные + действия (`useChatSend`, `useMessageWindow`, `useMessageActions`, …).
- **Store** (`stores/*`, Zustand) — нормализованное хранилище сущностей по id, **единственный
  источник истины** на клиенте (~25 сторов: `chatsStore`, `messagesStore`, `storiesStore`,
  `callStore`, `navigationStore`, `searchStore`, …).
- **realtimeBridge** (`client/realtimeBridge.ts`) — **единственный** канал «сервер → store».
- **managers** (`core/managers/*`) — команды/запросы к бэку (REST/WS); не знают про React/DOM
  (~40 менеджеров: `messagesManager`, `mediaManager`, `chatsManager`, `channelsManager`,
  `storiesManager`, `callsManager`, `secretManager`, …).

### Web Worker + RPC

Менеджеры и сетевой слой живут в **Web/SharedWorker**, а не в UI-потоке. Общение — через
`SuperMessagePort` (`rpc/superMessagePort.ts`): `invoke`/`handle`/`emit`. UI дергает менеджеров
через прокси (`rpc/managersProxy.ts`, доступ из React — `useManagers()`, вне React —
`startClient().managers`). Так тяжёлая работа (крипта секретных чатов, разбор кадров, кэш истории)
не блокирует рендер.

### Транспорт

- **REST** (`core/net/restClient.ts`) — Bearer-токен в заголовке; `.contentUrl()`/`.mediaUrl()`
  строят ссылки с токеном для `<img>`/`<video>`.
- **WebSocket** (`core/net/wsClient.ts` + `core/realtime/connectionManager.ts`) — кадры `{t, d}`,
  авто-реконнект с экспоненциальным backoff, heartbeat (ping/pong), durable **outbox**
  неподтверждённых отправок (переживает перезагрузку): по `message_ack` — доставлено, по
  `message_error` — ошибка; после реконнекта — переотправка + `GET /sync` для догона.

### Отправка и кэш истории

- **Оптимистичная отправка** (`core/hooks/useMessageWindow.ts`) — бабл появляется сразу
  (`client_msg_id`, временный отрицательный id), затем сверяется с `message_ack`
  (`reconcileAck` / `failOptimistic`).
- **Кэш истории** (`core/history/slicedArray.ts` + `messagesManager`) — разрежённые `seq`-диапазоны;
  пагинация `loadOlder`/`loadNewer`, прыжок к сообщению `getAround`/`jumpTo`.

### Инварианты (НЕ нарушать)

- Подписка на сокет — **только** в `realtimeBridge`. Компоненты и хуки **читают из стора**, не из сокета.
- Одна сущность живёт в сторе один раз (нормализовано по id). Не дублировать realtime-данные и не
  держать в `useState` копию того, что уже в сторе (производные — мемо-селектором).
- `useEffect` — для честных side-effect'ов (DOM-listener, императивный скролл), не для синхронизации стора.

### Пример: путь команды через слои

Отправка текста «сверху вниз» и приезд эха «снизу вверх» — как слои стыкуются на конкретном действии:

```
[View]        Composer.onSubmit(text)
   │ колбэк
[ViewModel]   useChatSend(): оптимистичный бабл в messagesStore (client_msg_id),
   │          затем вызывает команду менеджера
[RPC]         managersProxy.messages.send(...)  ──SuperMessagePort.invoke──►  (граница Worker)
   │
[Worker]      messagesManager.send() → connectionManager (outbox) → wsClient
   │          кадр {t:"send_message", d:{…, client_msg_id}}
[Backend]     nginx → ws → usecase/chat → Postgres (seq)
   ▲
   │  {t:"message_ack"|"new_message"}  ──SuperMessagePort.emit──►  (граница Worker → UI)
[Bridge]      client/realtimeBridge.ts: rt:ack → messagesStore.reconcileAck;
   │          rt:new_message → messagesStore.applyIncoming (dedup по id)
[Store→View]  Zustand уведомляет селекторы → бабл «дорастает» до отправленного/прочитанного
```

Каждый слой знает только соседний: View не знает про сокет, менеджеры не знают про React/DOM,
`realtimeBridge` — единственный, кто пишет в стор из realtime.

### Авторизация

Токен сессии — Bearer, живёт в **IndexedDB** (`core/auth/tokenStore.ts` поверх `core/store/idbKv.ts`) и в
памяти воркера (у SharedWorker нет `localStorage`). Все REST/WS-запросы берут токен из `tokenStore`.

- **Вход по телефону + OTP:** `AuthFlow` (View) → `managers.auth` → worker `authManager`:
  `requestCode(phone)` → `POST /auth/request_code`; `signIn(phone, code)` → `POST /auth/sign_in` →
  сервер возвращает `session_token` (+ профиль) → менеджер кладёт токен в `tokenStore`. В dev OTP = `12345`.
- **Гейтинг сессии:** на старте `client/bootstrap.ts` (`startClient`) зовёт `managers.auth.me()`
  (`GET /me`): токен валиден → рисуем оболочку; иначе — `AuthFlow`. Перезагрузка вкладки сохраняет вход
  (токен из IndexedDB; `tokenStore.ready()` защищает от гонки при старте).
- **2FA (облачный пароль):** если включён, `sign_in` возвращает `password_token` → шаг пароля
  (`POST /auth/check_password`) → `session_token`.
- **QR-логин:** desktop `POST /auth/qr/new` → рендер QR, кодирующего `${origin}/qr/{token}`, + поллинг
  `GET /auth/qr/{token}`; уже авторизованное устройство открывает `/qr/{token}` → `POST /auth/qr/confirm` →
  desktop получает `session_token` из статуса и входит.
- **Passkeys (WebAuthn):** begin/finish выполняются в **UI-потоке** (`core/webauthnBrowser.ts`,
  `navigator.credentials`) — WebAuthn недоступен в воркере.
- **Passcode-lock:** локальная блокировка приложения (PBKDF2-хэш в IndexedDB, `stores/lockStore.ts`),
  независима от серверной сессии.

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
