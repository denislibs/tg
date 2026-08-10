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
- **Анимации — только CSS-классами tweb**; JS их лишь переключает. **framer-motion убран** — не возвращать
  (как и MUI). Механика: `core/hooks/useSetTransition` (порт `singleTransition.ts` — классы
  `forwards`/`backwards`/`animating`) и `core/hooks/useMountTransition` (роль `AnimatePresence`: узел живёт
  в DOM, пока играет exit). Гейт — `body.animation-level-0/2`, ставит `App.tsx` по настройке «Без анимаций».
  Тяжёлые переходы объявлять через `core/dom/heavyAnimation` — на их время `animationIntersector` глушит
  стикеры/видео. **TS strict** — без `any`, неиспользуемые переменные не пройдут сборку.
- **Ловушка CSS-модулей:** Vite хеширует любое имя в `animation`, включая ссылку на глобальный кейфрейм
  партиала — `animation: fade-in-opacity` внутри `*.module.scss` станет `_fade-in-opacity_xxx` и молча
  ничего не сыграет (ни сборка, ни тайпчек не поймают). Нужен локальный `@keyframes`-дубль;
  `animation: :global(name)` не компилируется.
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
- Читать персист (`core/store/persist`) из `stores/`, `components/`, `core/hooks/`. Модель tweb: одно
  батч-чтение `State` до первого рендера (`client/boot.ts` → `loadStateOnce`), дальше только
  синхронные чтения из `stores/appState` и write-through записи через `setAppState`. Асинхронное
  чтение после первого кадра = рваная гидрация: список уже есть, папки приезжают позже, вёрстка
  прыгает. Держит `core/state/noAdHocReads.test.ts`. Менеджеры воркера (`core/managers/*`) —
  исключение: там чтение кэша это офлайн-фолбэк внутри RPC, который UI и так ждёт.
- Класть в `AppState` сущности (диалоги, сообщения, юзеров, `me`). `setAppState` пишет значение
  ключа целиком, поэтому там только конфиг — как и в tweb, где сущности лежат в отдельных
  сторах IndexedDB.
- Задавать порядок списка позицией в массиве или ручным `splice`. Порядок диалогов — производная
  от данных (`core/dialogs/dialogIndex.ts`, порт tweb `generateDialogIndex`), считается в
  единственном месте — `applyDialogs`. Два правила сортировки = список перетасовывается между
  кэшем и ответом сети. Держит `stores/noManualOrder.test.ts`.
- Применять ответ сети полной подменой коллекции. Сводить через `core/store/reconcile`:
  неизменившиеся записи сохраняют ссылки, а совпавший с памятью ответ не даёт ни перерисовки,
  ни записи в IDB (порт tweb `saveDialogFilter`).
- Опрашивать сеть на каждом старте за тем, что уже есть в памяти. Cache-first: сеть только при
  пустой памяти или по апдейту сервера (порт tweb `getDialogFilters`). Если событие несёт
  абсолютный снимок — применять его, а не ходить за списком (`folder_update`, `chat_update`).
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
