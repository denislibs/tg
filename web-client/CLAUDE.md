# CLAUDE.md — frontend

React/TS-клиент (Telegram Web K remake). Общие мандаты — в корневом [`../CLAUDE.md`](../CLAUDE.md).
Структура и связь с бэком — в [`README.md`](README.md).

## Команды

```bash
npm run dev        # watch-сборка в ../client-build (dev-сервера нет; раздаёт nginx :38080)
npm test           # vitest
npm run typecheck  # tsc --noEmit на TS7 native (@typescript/native)
npm run lint       # oxlint (typeAware); lint:fix — с автофиксом
npm run build      # tsc --noEmit + vite build (типы должны проходить)
# разовая прод-сборка для nginx (из этой папки):
npx vite build --outDir ../client-build
```

## Главное правило: 1:1 с tweb

Вёрстку, размеры, отступы, переменные css анимации поведение брать **из исходников tweb**, не выдумывать. 
Перед «в Telegram так» — открыть tweb и проверить. Не уверен в оригинале — сначала изучи tweb, потом пиши. 
Без отсебятины. Не выдумывай 

## Стек и стиль

- **React 19 + Vite 8 (Rolldown) + TS strict.** Тайпчек — **TS7 native** (`@typescript/native`,
  нативный `tsc`); линт — **Oxlint** (typeAware, `.oxlintrc.json`). Воркеры собираются как отдельные
  ESM-чанки (`worker.format: 'es'` в `vite.config.ts` + `new Worker(new URL(..., import.meta.url), {type:'module'})`).
  Стилизация — **SCSS-модули** (`*.module.scss` + `sass`); глобальные дизайн-токены (CSS custom properties)
  в `src/styles/_tokens.scss`, тема через атрибут `data-theme` на `<html>`. **MUI убран** — не добавлять
  `@mui`/`sx`/emotion, только SCSS-модули.
- **Zustand** — глобальное состояние. Отдельно стоящие сущностные сторы — в `src/stores/*`;
  маленький стор, колокейтед со своей фичей (`settings`, `i18n`, `pip`, `pwa`, `webapp`), живёт
  рядом с ней — это норма (не растаскивать по `stores/` в ущерб когезии). Не плодить
  React-контексты под то, что уже в сторах.
- **framer-motion** — анимации. **TS strict** — без `any`, неиспользуемые переменные не пройдут сборку.
- Тяжёлые списки: `MessageRow`/`ChatFeed` мемоизированы — не ломай стабильность пропсов/рефов.
- **Импорт-алиасы** (tsconfig + vite + vitest, держать синхронно): `@core @stores @shared @rpc
  @lib @helpers @components @config @environment @vendor @customEmoji @/*`. Раскладка кросс-каттинга:
  `shared/lib` — чистые переиспользуемые утилиты; `lib` — толстые вендор-подсистемы (lottie,
  customEmoji, `twebMessagePort`); `helpers` — легаси-корзина, новое туда не класть.

## Архитектура клиента (инварианты — НЕ нарушать)

Однонаправленный поток. Подробности и обоснование — в
[`../docs/research/2026-06-29-frontend-refactor-plan.md`](../docs/research/2026-06-29-frontend-refactor-plan.md).

```
вверх (данные):  сервер → smp → eventBus → {Store-проектор, Sound, Notifications, …} → селектор → View
вниз (команды):  View → хук (use*) → managers → сервер
```

**Слои и кто за что:**
- **View** (`components/*`) — только рендер + колбэки. Не фетчит, не слушает сокет, не держит данные.
- **ViewModel-хуки** (`core/hooks/use*`) — presentation logic: читают стор селектором, отдают данные + действия.
- **Store** (`stores/*`) — нормализованное хранилище сущностей по id, единственный источник истины.
- **eventBus** (`core/realtime/eventBus.ts`) — шина realtime-событий воркера. Насос в
  `realtimeBridge` (единственный потребитель `smp`) публикует в неё; кросс-каттинг-подписчики
  (Store-проектор, `client/realtime/soundSubscriber`, `notificationSubscriber`, будущие Analytics/Logger)
  подписываются на неё через `eventBus.subscribe`.
- **realtimeBridge** (`client/realtimeBridge.ts`) — насос `smp → eventBus` + Store-проектор
  (событие → мутация стора: реестр `APPLY` + особые обработчики).
- **managers** (`core/managers/*`) — команды/запросы к бэку; не знают про React/DOM.

**НЕЛЬЗЯ:**
- Подписываться на сокет (`smp.on`) где-либо, кроме насоса в `realtimeBridge`. Нужны realtime-события
  в новом модуле — подписывайся на `eventBus.subscribe`, а не на `smp`. Компоненты/хуки **читают из стора**.
- Дублировать realtime-данные: одна сущность живёт в сторе один раз (нормализовано по id).
  `connectionManager.outbox` (worker) — **только** транспортный буфер resend, не источник для UI.
- Держать в `useState` копию того, что уже в сторе. Производные значения — мемо-селектором, не дублем поля.
- Складывать бизнес-логику в `useEffect` ради синхронизации состояния (эффект — для честных side-effect'ов:
  DOM-listener, императивный скролл).

**МОЖНО:**
- Фетчить через `managers` (REST) из хука — это read/command-путь, не подписка на сокет.
- `store.getState()/.setState()` из не-React кода (worker/`realtimeBridge`).
- Вынести кластер логики в свой `core/hooks/useChat*.ts` (как `useChatSelection`/`useChatInfoCard`/`usePinnedBar`).
- **Грузить медиа-**bytes** прямым `fetch` к аутентифицированному media-эндпоинту** (URL строит
  `core/mediaUrl`: `mediaContentUrl`/`primeMediaToken`), НЕ через `managers`. Бинарь идёт на main-thread,
  а не сериализуется через worker-RPC (SuperMessagePort) — как в tweb (`wrapSticker`, загрузка файлов).
  Так делают `StickerMedia.loadStickerContent` (инспекция Content-Type → lottie/video/image + кэш) и
  `messages/RealMediaBubble` (стрим файла с прогрессом/отменой через `ReadableStream`). Это про **bytes**;
  метаданные/URL-резолв — по-прежнему через `managers` (`useMediaThumb`/`useMediaContentUrl`).

**Известное исключение (не копировать):** `useChatScroll` слушает `RT.newMessage` ради UI read-marker —
markRead живого сообщения, когда вьюпорт прижат к низу и вкладка в фокусе (это решение зависит от
scroll/focus, которых нет в сторе). Счётчик unread-below при этом **производный из стора**
(`newestSeq − lastReadSeq`), а не накапливается из потока событий. Осознанный трейд-офф — новый код так не делает.

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
