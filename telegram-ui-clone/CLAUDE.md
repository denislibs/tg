# CLAUDE.md — frontend

React/TS-клиент (Telegram Web K remake). Общие мандаты — в корневом [`../CLAUDE.md`](../CLAUDE.md).
Структура и связь с бэком — в [`README.md`](README.md).

## Команды

```bash
npm run dev    # :5173, проксирует /api и /ws на бэкенд :38080
npm test       # vitest
npm run build  # tsc -b + vite build (типы должны проходить)
# прод-сборка для nginx (из этой папки):
npx vite build --base=/ --outDir ../client-build
```

## Главное правило: 1:1 с tweb

Вёрстку, размеры, отступы, переменные css анимации поведение брать **из исходников tweb**, не выдумывать. 
Перед «в Telegram так» — открыть tweb и проверить. Не уверен в оригинале — сначала изучи tweb, потом пиши. 
Без отсебятины. Не выдумывай 

## Стек и стиль

- **React 18 + MUI 6** — стилизация через `sx`, не отдельные CSS-классы (кроме `index.css` с глобальными
  токенами/palette prism).
- **Zustand** — глобальное состояние (`src/stores/*`). Не плодить React-контексты под то, что уже в сторах.
- **framer-motion** — анимации. **TS strict** — без `any`, неиспользуемые переменные не пройдут сборку.
- Тяжёлые списки: `MessageRow`/`ChatFeed` мемоизированы — не ломай стабильность пропсов/рефов.

## Архитектура клиента (инварианты — НЕ нарушать)

Однонаправленный поток. Подробности и обоснование — в
[`../docs/research/2026-06-29-frontend-refactor-plan.md`](../docs/research/2026-06-29-frontend-refactor-plan.md).

```
вверх (данные):  сервер → smp → realtimeBridge → store → селектор → View
вниз (команды):  View → хук (use*) → managers → сервер
```

**Слои и кто за что:**
- **View** (`components/*`) — только рендер + колбэки. Не фетчит, не слушает сокет, не держит данные.
- **ViewModel-хуки** (`core/hooks/use*`) — presentation logic: читают стор селектором, отдают данные + действия.
- **Store** (`stores/*`) — нормализованное хранилище сущностей по id, единственный источник истины.
- **realtimeBridge** (`client/realtimeBridge.ts`) — **единственный** канал «сервер → store».
- **managers** (`core/managers/*`) — команды/запросы к бэку; не знают про React/DOM.

**НЕЛЬЗЯ:**
- Подписываться на сокет (`smp.on` / `uiEvents.on(RT.*)`) где-либо, кроме `realtimeBridge`.
  Компоненты и хуки **читают из стора**, а не из сокета.
- Дублировать realtime-данные: одна сущность живёт в сторе один раз (нормализовано по id).
  `connectionManager.outbox` (worker) — **только** транспортный буфер resend, не источник для UI.
- Держать в `useState` копию того, что уже в сторе. Производные значения — мемо-селектором, не дублем поля.
- Складывать бизнес-логику в `useEffect` ради синхронизации состояния (эффект — для честных side-effect'ов:
  DOM-listener, императивный скролл).

**МОЖНО:**
- Фетчить через `managers` (REST) из хука — это read/command-путь, не подписка на сокет.
- `store.getState()/.setState()` из не-React кода (worker/`realtimeBridge`).
- Вынести кластер логики в свой `core/hooks/useChat*.ts` (как `useChatSelection`/`useChatInfoCard`/`usePinnedBar`).

**Известное исключение (не копировать):** `ConversationView` слушает `RT.newMessage` ради UI read-marker
(markRead/unread-below зависят от scroll/focus). Это осознанный временный трейд-офф — новый код так не делает.

## Безопасность (критично)

- **НИКОГДА не рендерить пользовательский контент как сырую HTML-строку** (ни raw-HTML React-пропами,
  ни присваиванием разметки в DOM). Сущности и код — только React-нодами (`RichText.tsx`, `CodeBlock.tsx`);
  DOM строить через `createElement`/`createTextNode`.
- Ссылки — только по allow-list схем (`http/https/mailto/tel/tg`); остальное отбрасывать.
- Лимит длины кода в prism (ReDoS), лимит числа entities (O(n²) рендер) — не убирать.

## Rich-text (`src/core/markdown.ts`)

- Модель `MessageEntity` совпадает с бэком: offset/length в **UTF-16** (обычные индексы JS-строки).
- Инпут хранит **сырые** markdown-маркеры; разбор — на **отправке** (`parseMarkdown`), как в tweb.
  Не делать live-WYSIWYG для блоков кода.
- Язык блока кода = текст **до первого перевода строки** во fence (точное правило tweb), не угадывать по содержимому.
- Большая вставка — одним text-node через Range, **не** `execCommand('insertText', …)` (иначе фриз на тысячах нод).

## Связь с бэком

- REST + WS через `core/net/*`; реалтайм и outbox — `core/realtime/connectionManager.ts`.
- Оптимистичная отправка: бабл сразу (`client_msg_id`), затем `reconcileAck`/`failOptimistic` по ответу WS.
- Dev ходит на бэкенд `:38080` (за nginx) через прокси Vite.
