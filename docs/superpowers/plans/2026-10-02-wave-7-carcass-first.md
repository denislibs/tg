# Волна 7: ускоренный план «каркас сверху вниз»

> **Решение пользователя от 2026-10-02.** Сначала каркас tweb ставится целиком, потом на него по
> одной натягиваются текущие фичи (Solid и классы), без мостов в React. Переход грубый: держать
> работающим всё приложение не нужно — прода нет, разработка только локальная.
>
> Этот файл задаёт **порядок и правила** программы волны 7. План
> [`2026-09-30-wave-7-shell-sidebars.md`](2026-09-30-wave-7-shell-sidebars.md) остаётся
> **справочником по tweb**: карта `appImManager.ts` по блокам A–M, адреса оригинала, сравнение
> «Chat первым», разбор этапов 0а–7. Его порядок этапов, фасады (`ChatFacade`,
> `ChatInputFacade`), предусловие «этапы 2–3 целиком до точки входа», номера О-n и ворота e2e по
> этапам **отменены** этим файлом.
>
> Скилл перед каждой задачей — `tweb-parity` (`.claude/skills/tweb-parity/SKILL.md`): док →
> исходник tweb → код. Оригинал — `/Users/denisurevic/Documents/tweb`, коммит **`812502980`**.
> Наш код — `web-client/src/`, срез **`bd9f1893`** (2026-10-02, после #374).

---

## 1. Правила ускоренного перехода

1. **P0 после каждого влития в `main`.** На стенде работают вход, список чатов, открытие чата,
   история, отправка и приём (realtime), профиль. Всё остальное может временно пропасть. Каждое
   пропавшее — одна строка в разделе 5 «Бэклог»: что пропало, файл tweb, куда вернётся. Номеров
   О-n с диапазонами больше нет. Новые пропажи вписывает в бэклог задача, которая их создала, в
   своём PR.
2. **Мостов «новый код tweb → React-оболочка» нет.** Класс или Solid не монтируется внутрь
   React-дерева и не зовёт React-экран. Обратное направление допустимо: React-остров внутри
   класса tweb (центр, композер, вкладка №0 правой колонки), но только до шага, который его
   снимает. У такого острова в шапке файла и у строки монтирования стоит `// ВРЕМЕННО до К-<n>`.
3. **Старые React-тесты не переносятся.** Они удаляются вместе со своим кодом. Тесты пишутся на
   новую нетривиальную логику: стек чатов, записи навигации, разбор хэша, порядок старта,
   отправка, правила видимости пунктов (`verify`).
4. **Проверки на задачу:** `npx tsc --noEmit`, `vitest run` (только из `web-client/`, полный —
   `--maxWorkers=3` под `heavy.lock`), `npx oxlint --type-aware` по изменённым. Мутаций,
   `dom-parity` и стенда на каждой задаче нет. **Стенд** — P0 через Chrome DevTools MCP **на
   вехах**: после каждого К-n и после каждой пачки бэклога.
5. **Влитие прямо в `main`**, без долгоживущей ветки. Мержит главная сессия после tsc + vitest + P0.
   Если шаг К режется на несколько агентов, они работают в своих ворктри на общей базе с
   непересекающимися файлами. Один из них (ведущий, указан у шага) вливает ветки соседей в свою,
   и в `main` уходит один PR.
6. **Порт файлом 1:1 из tweb.** Мёртвый код удаляется в той же задаче. Имена и места — как у
   tweb (`lib/appImManager.ts`, `components/chat/{chat,topbar,input}.ts`, `src/index.ts`,
   `src/pages/bootstrapIm.ts`, `components/sidebarLeft/index.ts`,
   `components/sidebarRight/tabs/*.solid.tsx`). Строки langpack — ключами tweb. Комментарии и
   коммиты — по-русски.

Остальные Global Constraints плана программы (одноимённый раздел) действуют, если не противоречат
правилам выше. Не действуют «мутация фактически», «стенд и числа в каждом коммите», «врезка —
отдельным последним коммитом».

---

## 2. Где мы на `bd9f1893`

| Что | В `main` | В работе (ворктри) | Судьба в новом плане |
|---|---|---|---|
| Левая колонка: вкладки | 0а-1…0а-5, 2D целиком, 2-2 (бургер), 2-5 (баннер, #374) | — | основа К-1 |
| `AppSidebarLeft` | — | 2-1 (`w7-2-1`: `sidebarLeft/index.ts` 1028 строк, `toolsMenu.ts` в него влит, `columnSlider.ts` удалён; React-мост `bridge` для архива, форума и поиска) | **К-1**: мост `bridge` снимается, архив и форум — в бэклог |
| `#new-menu` | — | 2-4 (`w7-2-4`: 2 коммита, врезка в React `ComposeFab`) | **К-1**: перевешивается на класс без временного монтажа — **сделано** (методы `AppSidebarLeft`, `ComposeFab`/`ComposeMenu` удалены с `Sidebar.tsx` в 2-1) |
| Список чатов | 1-1…1-4, 1-2 (#366) | 1-7 (`w7-1-7`, сохранённые) | 1-7 доливается как есть; 1-5, 1-6, 1-8 — бэклог П-2 |
| Правая колонка | 0б-0, 0б-2, 0б-10, 0б-11 | 0б-3 (`w7-0b-3`), 0б-6 (`w7-0b-6`) | доливаются как есть (Solid-вкладки из React-`GroupEditFlow` — существующее направление, не новый мост); в К-5 их открывает родная `AppEditChatTab` |
| Центр | `ChatBubbles`, `ChatContextMenu`, `ChatSelection` — классы | — | К-2, К-3, К-4 |
| Точка входа | React: `index.html` с `#root` (`:56`), `main.tsx` (39), `App.tsx` (325) | — | К-2 |

---

## 3. Шаги каркаса

```
К-1 AppSidebarLeft + #new-menu + поиск, снос Sidebar.tsx
 └► К-2 index.html + src/index.ts + bootstrapIm + ядро AppImManager, снос main.tsx/App.tsx
     └► К-3 класс Chat + ядро ChatTopbar (композер — React-остров внутри Chat)
         └► К-4 ядро ChatInput, снос React-композера
             └► К-5 AppSharedMediaTab + AppEditChatTab, снос UserInfoPanel/GroupEditFlow
                  ⇒ React остаётся только островом глобальных оверлеев
Бэклог П-1…П-6 — с К-2 (П-2, П-3, П-4), с К-3 (П-5), с К-4 (П-6), с К-5 (П-1) — параллельно
```

Шаги идут строго по очереди: каждый следующий меняет владельца того, на чём стоит предыдущий.
Внутри шага агенты работают параллельно на непересекающихся файлах (правило 5).

---

### К-1: `AppSidebarLeft`, `#new-menu`, глобальный поиск; снос `Sidebar.tsx`

**Порт.** tweb `components/sidebarLeft/index.ts` (1817):
- класс `:118`, `construct` `:154-473`;
- `initNavigation` `:474`;
- `isCollapsed`/`onCollapsedChange` `:491-517`;
- `closeEverythingInside` `:518-545`;
- `onSomethingOpenInsideChange` `:547-569` (`has-open-tabs` `:553`);
- `onTabsCountChange` `:652`;
- `createToolsMenu` `:673-905`;
- `createNewChatsMenuOptions`/`createNewChatsMenuButton` `:1065-1136`;
- `initSearch` `:1137-1691`, `closeSearch` `:1722`;
- `createTab`/`addTab`/`closeTabsBefore` `:1730-1758`;
- синглтон `:1798`.

`ConnectionStatusComponent` создаётся в `appDialogsManager.start` (tweb `appDialogsManager.ts:990`)
с `appSidebarLeft.inputSearch`.

**Что делается сверх 2-1.**
- Мост `bridge` из `w7-2-1` (`index.ts:66`, `:190-208`) снимается целиком: архив, форум и
  «Избранное»/тема через React уходят.
  - «Избранное» из бургера зовёт `appImManager.setPeer` только с К-2, до него пункт скрыт.
  - Переключатель темы — функция `themeController` (порт `switchTheme`, tweb
    `helpers/themeController.ts`, вызов `sidebarLeft/index.ts:924`).
- Поиск — `initSearch` методом класса над нашим классом `sidebarLeft/globalSearch.ts` (692, уже
  порт). `InputSearch` — класс `components/inputSearch.ts`, а не React `shared/ui/InputSearch`.
- `#new-menu` из `w7-2-4` переносится в класс: `createNewChatsMenuButton` в `construct`,
  `ComposeFab.tsx` (77) и `ComposeMenu.tsx` (64) удаляются. **Сделано** (2-4): методы
  `createNewChatsMenuOptions`/`createNewChatsMenuButton`/`createNewChatsSubmenu` класса
  (tweb `:1065-1135`), кнопка в `construct` (`:198-200`), `is-hidden` на поиске — владелец
  поиска `globalSearch.ts` (`:1514`, `:1550-1558`, `:1571`); пины —
  `sidebarLeft/index.newChatsMenu.test.ts`. Конференции нет (О-1 плана программы),
  «Новый секретный чат» — под `SECRET_CHATS_ENABLED=false`.

**Узел `#column-left`.** До К-2 его рисует `App.tsx` статичной разметкой tweb `index.html:91-107`
без логики. Синглтон создаётся из layout-эффекта шелла — это уже сделано в 2-1
(`createAppSidebarLeft`, `index.ts:54-57`), а снимается в К-2 (решение **Р-1**).

**Удаляется.**
- `components/Sidebar.tsx` (546) + `Sidebar.module.scss` (174) + все `Sidebar.*.test.tsx`;
- `core/hooks/useGlobalSearch.ts` (117), `useForumPanel.tsx` (86), `useSidebarStories.tsx` (102);
- `shared/ui/InputSearch/*`, если без потребителей;
- `ComposeFab.tsx`, `ComposeMenu.tsx`, `SidebarEmojiStatusButton.tsx` (41);
- `components/TopicsPanel.tsx` (583) + scss, `StoriesRow.tsx` (405) + scss,
  `folders/FoldersSidebar.tsx` (238) + scss — их места занимает бэклог (П-2, П-3).

**В бэклог:** архив-оверлей и пункт «Архив», форум (`TopicsPanel`), ряд историй, вертикальная
колонка папок, кнопки статус-эмодзи и замка в шапке, плашка «пригласить» (если её держал
`Sidebar.tsx`) — строки Б-1…Б-7 раздела 5.

**Тесты на новое:**
- `sidebarLeft/index.test.ts` (уже пишется в 2-1): `has-open-tabs` — один писатель;
  `closeEverythingInside` закрывает вкладки и поиск; Back/Esc снимают верхнюю вкладку;
- пункты `#new-menu` по флагам (`IS_CONFERENCE_CALL_SUPPORTED`, `SECRET_CHATS_ENABLED`);
- поиск открывается фокусом поля и закрывается Esc (`global-search`/`global-search-focus`).

**Агенты: 2.**

| Агент | Ворктри | Файлы | Роль |
|---|---|---|---|
| **А (ведущий)** | `w7-2-1` | `sidebarLeft/index.ts`, `globalSearch.ts`, `components/inputSearch.ts`, `lib/appDialogsManager.ts`, `App.tsx` (разметка колонки), снос `Sidebar.tsx` и хуков | доводит 2-1, подключает поиск |
| **Б** | `w7-2-4` | новый `sidebarLeft/newChatsMenu.ts` (или методы в `index.ts`, если ведущий отдаст блок `:1065-1136`), тест меню, снос `ComposeFab`/`ComposeMenu` | ребейзится на ветку А, вставка в `construct` — две строки |

**Оценка: 4 агенто-дня, ≈ 3 календарных.** 2-1 написан примерно на две трети (1028 строк
класса, тесты вкладок уже переведены). Остаток — снос моста `bridge` (−~200 строк), поиск
классом вместо React-владельца (`globalSearch.ts` уже класс, меняется только владелец поля) и
снос `Sidebar.tsx` с хуками. На `#new-menu` — день: порт есть, меняется только место монтажа.

**Веха К-1 (стенд, P0):** вход, список, открыть чат из списка и из поиска, отправка и приём,
профиль; «новый чат» → контакты.

---

### К-2: точка входа и ядро `AppImManager`; снос `main.tsx`/`App.tsx`

Решения пользователя по этому шагу: **В4-1 = А** (выход — перезагрузка, синглтоны вечные),
**В4-2 = А** (`draftPeer` удаляется), **В4-3 = А** (`chatTips` — в бэклог).

**Порт: вход.**
- tweb `index.html:87-116`, все узлы — статикой в нашем `index.html`:
  - `#skip-to-content[hidden]` `:87`, `.sidebar-left-overlay` `:88`;
  - `#page-chats[style="display: none;"]` `:89`, `#main-columns` `:90`;
  - `#column-left` с вкладкой №0 `:91-107`;
  - `#column-center[role=main][tabindex=-1]` `:109`, `#column-right` `:110-112`;
  - `#stories-viewer` `:115`;
  - `#svg-defs` `:46` (переезжает из `components/SvgDefs.tsx`, 23 строки).
  - `<script src="/src/index.ts">` `:116`.
- tweb `src/index.ts:417-675` поверх нашего `client/boot.ts` (307). Порядок `waitForUnlock` →
  состояние → лангпак уже наш (`boot.ts:134-209`). Новое:
  - развилка `:613-673`: `mountAuthFlow` `:640-641` или `fadeInWhenFontsReady(#main-columns)`
    `:645-646` и `bootstrapIm()`;
  - анимация входа `should_animate_main` `:650-669` — наш `ANIMATE_MAIN_KEY`
    (`core/accountTransition.ts:14`);
  - `loadFonts`/`setRootClasses` (`main.tsx:15`, `:19`);
  - `pingBackend`, `startVersionCheck` (`App.tsx:271-278`).
- tweb `pages/bootstrapIm.ts:21-70`:
  - идемпотентность `:9`, `:22-23`;
  - показ `#page-chats` `:27-28`;
  - `appDialogsManager.start()` `:51`;
  - `doubleRaf` → снятие `has-auth-pages` `:60-61`;
  - `disposeActiveAuthFlow` через 1 с `:65-67`.
- tweb `pages/mountAuthFlow.tsx:28`, `:62`: модульный `activeDispose` и `disposeActiveAuthFlow`.
  Наша запись `has-auth-pages` (`mountAuthFlow.solid.tsx:102`, `:112`) удаляется: выход теперь
  перезагрузка.
- Успех входа → `bootstrapIm()` (tweb `pages/AuthCardsHost.tsx:105`). Наш `onComplete` из `App.tsx`
  (`AuthCardsHost.solid.tsx:163`, `:210`) уходит.
- Выход — перезагрузка: `logging_out` → `onLoggedOut` (`lib/apiManagerProxy.ts:619-634`,
  `:676-704`) → `appNavigationController.reload(url)` (`components/appNavigationController.ts:499-511`;
  `close`/`focus`/`navigateToUrl` `:513-537` — их нет у нас, шапка `:54`). `persist.clearAll()` —
  до перезагрузки.
- Вечные синглтоны при импорте:
  - `appSidebarRight` (tweb `sidebarRight/index.ts:141-143`) — снимаются
    `createAppSidebarRight`/`destroy` (`sidebarRight/index.ts:181-202`);
  - `appSidebarLeft` (`:1798`) — снимается `createAppSidebarLeft` из К-1;
  - `appDialogsManager` на `#chatlist-container` (`appDialogsManager.ts:765`, `:3064`) — `start()`
    без аргументов, без `destroy()`; уходят расхождения 1, 2, 7, 17, 18 шапки
    `lib/appDialogsManager.ts`;
  - `SidebarSlider.destroy` (`slider.ts:155-170`).

**Порт: ядро `AppImManager`** (`lib/appImManager.ts`; файл уже есть — модуль функций набора, 202
строки, класс ложится рядом):
- **A, B.**
  - Типы `ChatSavedPosition`, `ChatSetPeerOptions`, `ChatSetInnerPeerOptions`, `APP_TABS`
    `:163-213`.
  - `EventListenerBase` с `chat_changing`, `peer_changed`, `peer_changing`, `tab_changing`,
    `premium_toggle` `:252-258`.
  - Поля `:259-302`, синглтон `:3989-3991`.
  - `ChatType` — порт `components/chat/chatType.ts` (значения совпадают с
    `stores/chatStackStore.ts:10`).
- **J.**
  - `selectTab` `:3137-3197`: `is-left-column-shown`, тяжёлая анимация `:3164`,
    `updateColumnAccessibility`, `appSidebarRight.hide()` на мобильном, запись `im`
    `:3178-3188`.
  - `setStaticLandmarkLabels`/`updateColumnAccessibility` `:3199-3208`; `disableTransition` —
    порт `helpers/dom/disableTransition.ts`.
  - Стек чатов: `createNewChat` `:3219`, `spliceChats` `:3233-3290`, `setPeer` `:3292-3390`
    (без `min`-пиров), `setInnerPeer` `:3392-3434`, `chatsSelectTab` `:2766-2805`, `isSamePeer`
    `:3809-3816`.
  - `.chats-container` и `createNewChat()` в `construct` `:368-382`: `chats[0]` существует всегда.
- **G.**
  - `overrideHash` `:3127-3135`, `onHashChange`/`onHashChangeUnsafe` `:1912-2031` (`tgaddr`;
    голый фрагмент — только `@имя` или peerId, `:1947`; `#/im?p=` `:1954-1963`).
  - `open`/`op` `:2050-2157`, `openUsername` `:2165`, `openThread` `:2186`, `openComment` `:2212`.
  - `appNavigationController.onHashChange = this.onHashChange` `:384`, первое применение `:998`.
  - `overrideHash` на `peer_changed` `:835-843`.
- **I (часть).**
  - `setBackground`/`setCurrentBackground`/`applyCurrentTheme` `:2607-2713`;
    `themeController.appChatBackground` `:444-455`.
  - `setSettings` `:2715-2762` (`--messages-text-size`, `animation-level-*`, `no-backdrop`,
    автоплей) — заменяет `client/liteModeSettings.ts` (51).
- **C (часть).**
  - `mediaSizes.changeScreen` `:458-467`, `idleController` `:354-362`.
  - `premium_toggle` `:388-397`.
  - `notificationBuild` `:805-822` — на наш `client/uiNotifications.ts`, «открытый чат» — из
    `appImManager.chat`.
  - `has-chat` + очистка `emojiAnimationContainer` `:835-843`.
  - Звук отправки `:857-877` — по коду `client/realtime/soundSubscriber.ts`.
- **Старт из `useAppBootstrap.ts` (109).** Загрузки, `startRealtime`, `initAppBadge`,
  `watchPushConditions` — в `bootstrapIm`/`appDialogsManager.start` (у tweb это `start` и
  `onStateLoaded`, `appDialogsManager.ts:997`). `ui:toast` → `toastNew` (вместо `useGlobalToast`).

**Центр на К-2 — React-остров `Chat.tsx` на инстанс, минимальный интерфейс.** Файл
`components/chat/reactChatInstance.ts` (`// ВРЕМЕННО до К-3`) — ровно то, что `appImManager` зовёт
у `Chat` на К-2:

| Член | Нужен в |
|---|---|
| `container` (`.chat.tabs-tab`) | `createNewChat`, `spliceChats`, `chatsSelectTab` |
| `peerId`, `threadId`, `type` | `isSamePeer`, хэш, уведомления |
| `inited` | `setInnerPeer` |
| `setPeer(options) → {cached, promise}` | `setPeer` |
| `beforeDestroy`, `destroy` | `spliceChats` |

Остров монтируется лениво, на первом `setPeer` с пиром, через `shared/react/mountReact.tsx`
(зеркало `shared/solid/mountSolid.solid.tsx`: `ErrorBoundary`, `ManagersProvider`, `unmount`).

Чего у острова на К-2 нет — и что поэтому выключено:
- `publishBackground` — фон в теме чата → Б-10;
- позицию ленты по-прежнему пишет `ChatBubbles` сам (`bubbles.ts:6354`), класс её не трогает;
- `sharedMediaTab` — правой колонкой управляет `Chat.tsx`, как сейчас (`:384`, `:394`), до К-3;
- мета треда (заголовок темы, `ChatInstanceDesc.thread`) — опцией `setInnerPeer`, остров отдаёт
  её `Chat.tsx`.

Мост `emoticonsSearchBridge.ts` уходит. Вкладки поиска стикеров и GIF берут
`appImManager.chat.input.sendMessageWithDocument`, а это — метод острова, который отдаёт
`Chat.tsx` (направление «React внутри класса»).

**Остров глобальных оверлеев** — `#react-overlays` в `index.html`, один корень `mountReact`,
монтирует `bootstrapIm`. Внутри — `GroupCallScreen`, `LivestreamScreen`, `CallOverlay`,
`WebAppModal`, `ReportPopup`, `PopupHost` (`components/shell/GlobalOverlays.tsx` без тоста, QR и
`FolderInvitePopup`).

**Удаляется** (тесты — вместе с кодом, правило 3).
- Корень: `main.tsx` (39), `App.tsx` (325), `App.module.scss` (134), `App.*.test.ts`,
  `components/SvgDefs.tsx`.
- Центр: `components/chat/ChatsContainer.tsx` (166) + тест (325).
- Сторы и навигация: `stores/chatStackStore.ts` (197), `stores/navigationStore.ts` (43),
  `core/navigation/chatHistory.ts` (518) + тест (670), `core/navigation/openPeer.ts` (46),
  `startSecretChat.ts` (23).
- Хуки шелла: `core/hooks/{useAuthGate 203, useShellEnterAnimation 42, useLeftColumnShown 24,
  useChatNavigation 35, useNavigationActions 94, useUrlSync 185, useShellTheme 43,
  useThemeToggle 34, useAppBootstrap 109, useGlobalToast 32, useDeepLinks 160, useAppHotkeys 63}`.
- Прочее: `client/liteModeSettings.ts`, `sidebarRight/tabs/emoticonsSearchBridge.ts`,
  `chatsStore.activePeerId`/`setActiveChat` (`stores/chatsStore.ts:28`, `:54`, `:109`, `:162`).

Вызывающие `openPeer`/`selectChat` переходят на `appImManager.setInnerPeer`/`setPeer`:
- `sidebarLeft/tabs/{calls,newChannel,newGroup}.solid.tsx`, `sidebarRight/savedDialogsTab.solid.tsx`,
  `searchGroup.solid.tsx`;
- `popups/deleteDialog.ts:37-38` → `appImManager.setPeer({isDeleting: true})`;
- `lib/appDialogsManager.ts` (`:946` подписка → `appImManager.addEventListener('peer_changed')`,
  tweb `:1178`; `:1578` → tweb `:2094`).

**В бэклог:** диплинки и QR-подтверждение (`useDeepLinks`), хоткеи (`useAppHotkeys`),
автоблокировка и Ctrl+L (`useAutoLock`, `useLockScreenShortcut` — если не переносятся функцией
одной строкой), фон в теме чата, PiP клиента, `chatTips`, `updateStatus`/`goOffline`, тост
вступления, подписки `construct` без предмета — строки Б-8…Б-17.

**Тесты на новое** (`lib/appImManager.test.ts`, `src/index.test.ts`, `pages/bootstrapIm.test.ts`):
- `selectTab`: класс на `body`, одна запись `im`, `inert` колонок на мобильном;
- стек: `setInnerPeer` поверх `inited` даёт новый инстанс; `setPeer({})` на глубине > 0 —
  `spliceChats`, `removeByType('chat', true)` × (N−1), через 350 мс контейнера и React-корня нет;
  `existingIndex` переиспользует инстанс; мобильный `setPeer({})` инстанс не трогает;
- хэш: `#@имя`, `#<id>`, `#/im?p=…&post=`, `#column-center` ничего не открывает;
- старт: без токена — `mountAuthFlow`, с токеном — `bootstrapIm` один раз, `has-auth-pages`
  снимается после `doubleRaf`; `loggingOut` → `reload`.

**Агенты: 2**, одна база, файлы не пересекаются.

| Агент | Файлы |
|---|---|
| **А (ведущий): вход** | `index.html`, `src/index.ts`, `pages/bootstrapIm.ts`, `client/boot.ts`, `components/auth/{mountAuthFlow,AuthCardsHost}.solid.tsx`, `core/navigation/appNavigationController.ts` (`reload` и соседи), синглтоны `sidebarRight/index.ts`, `sidebarLeft/index.ts`, `components/slider.ts`, `shared/react/mountReact.tsx`, остров оверлеев `components/shell/*`, снос `main.tsx`/`App.tsx`/`SvgDefs`/`useAuthGate`/`useShellEnterAnimation`/`useAppBootstrap`/`useGlobalToast` |
| **Б: класс** | `lib/appImManager.ts`, `components/chat/{chatType,reactChatInstance}.ts`, `components/Chat.tsx` (перевод на класс), `lib/appDialogsManager.ts` (целиком: и `start()` без аргументов, и подписки), `client/uiNotifications.ts`, `soundSubscriber.ts`, `stores/chatsStore.ts`, вкладки-вызывающие, `deleteDialog.ts`, вкладки стикеров/GIF, снос сторов навигации, `ChatsContainer`, хуков навигации/хэша/темы |

Стык между агентами — одна строка: `appDialogsManager.start()` в конце зовёт
`appImManager.construct(managers)` (tweb `:988`). Её ставит Б, `bootstrapIm` А зовёт `start()`.

**Оценка: 9 агенто-дней, ≈ 5 календарных.**
- Вход: ≈ 3 дня. Порт короткий (`index.ts` ~180, `bootstrapIm` ~60), объём — в переводе тестов
  на вечные синглтоны (сейчас ~21 тестовый файл поднимает колонки многократно) и в сносе шелла.
- Класс: ≈ 5–6 дней. Около 1 000 строк порта блоков A, B, G, I, J и части C.
- По старому плану то же стоило 24,5 дня (4-1…4-7 в детальном плане от 2026-10-02). Разница — в
  трёх вещах: нет `ChatFacade` (≈ 2 дня), нет переноса 34 пинов `chatHistory`/`ChatsContainer`
  (≈ 2 дня), нет стенда и мутаций на каждой из семи задач (≈ 5 дней).

**Веха К-2 (стенд, P0):** вход и выход (перезагрузка), F5 на `#@имя` и `#<id>`, список, открыть
чат и тред, Back/Esc, отправка и приём, профиль.

---

### К-3: класс `Chat` + ядро `ChatTopbar`

**Порт.**
- tweb `components/chat/chat.ts` (1690) целиком:
  - конструктор `:233-273`, распорки `:279-370`;
  - фон и `publishBackground` `:372-607` — возвращает Б-10;
  - `init` `:613-835`: подкомпоненты `:616-637`, подписки `:650-709`;
  - `destroy`/`cleanup` `:837-883`;
  - `onChangePeer` `:893-1012`: тип, права, флаги, `sharedMediaTab`;
  - `setPeer` `:1035-1156`, `finishPeerChange` `:1198-1254`, права `:1340-1403`.

  `ChatBubbles` (`chat/bubbles.ts` 6472), `ChatContextMenu` (1720), `ChatSelection` (1144) у нас
  уже классы и получают `this`, как у tweb. Клей `ChatContext` (`bubbles.ts:287-~460`) и
  `VanillaFeed.tsx` (501) уходят.
- tweb `components/chat/topbar.ts` (1873), **ядро**:
  - `construct` `:132-307`;
  - клик по шапке → `appSidebarRight.toggleSidebar` `:259-286`, «назад» → `chat.pop()` `:288-306`;
  - `constructPeerHelpers` `:1030-1175`: аватар, заголовок, статус;
  - `finishPeerChange` `:1383-1549`, `setTitle*` `:1550-1641`.

  Меню ⋮ (`:462-903`, 39 пунктов), закреп, поиск, плашки — в бэклог П-5.
- `appImManager` теряет `reactChatInstance.ts`: `createNewChat` строит `new Chat(this, managers,
  true)` (tweb `:3220`). Позиция ленты (`saveChatPosition`/`getChatSavedPosition` `:2640-2688`)
  переезжает из `bubbles.ts:6354` в класс.
- `replaceSharedMediaTab` зовёт класс (`appImManager.ts:3277`, `chat.ts:1239-1242`), а не
  `Chat.tsx`. Вкладка №0 справа — по-прежнему `AppReactProfileTab` с `UserInfoPanel` до К-5.

**Композер — React-остров внутри `Chat`** (`components/chat/reactChatInput.ts`,
`// ВРЕМЕННО до К-4`). У острова только члены, которые зовут `Chat` и соседи:
- `chat.ts:618-648`, `:702`, `:850`, `:876`, `:1010`, `:1223`, `:1383-1396`;
- внешний API `messageInput`, `editMessage`, `initMessageReply`,
  `getChatInputReplyToFromMessage`, `sendMessageWithDocument` — в объёме того, что реально
  зовут `ChatBubbles`/`ChatContextMenu` у нас (сверить `git grep "chat.input\."` при старте).

**Удаляется.**
- `components/Chat.tsx` (1617) + тесты, `chat/VanillaFeed.tsx` (501);
- `conversation/ChatHeader.tsx` (201), `HeaderMenu.tsx` (274), `useHeaderMenuActions.ts` (47);
- `core/hooks/useChatInfoCard.ts` (228), `useTypingLabel.ts`, `useMirrorWindow.ts`,
  `useSetTransition.ts`;
- `core/chat/chatInstanceContext.tsx`;
- всё из `Chat.tsx`, что уходит в бэклог: `PinnedBar`, `TopbarSearch`, `SavedTagsPanel`,
  плашки, `NowPlayingBar`, `SelectionBar`, `ChatDrops`, `ScheduledView`, `SuggestedPostsView`,
  `ChatMsgActionPopups`, кнопки-углы.

**В бэклог:** меню ⋮, закреп, поиск по чату, плашки шапки (заявки, настройки пира, звонок, эфир),
аудиоплеер, панель выделения, drag&drop, отложенные, предложенные посты, клавиатура бота
инлайном — строки Б-18…Б-29.

**Тесты на новое:**
- `chat.test.ts`: `setPeer` → `inited`, `peer_changing` один раз;
- `onChangePeer` считает `type`/флаги и права по пиру (личка, группа, канал, тред);
- `destroy` снимает подкомпоненты и контейнер, не оставляет подписок;
- `topbar.test.ts`: заголовок и статус по типу пира, клик открывает правую колонку, «назад» —
  `chat.pop`.

**Агенты: 3.**

| Агент | Файлы |
|---|---|
| **А (ведущий)** | `components/chat/chat.ts`, `chatType.ts`, правки `bubbles.ts`/`contextMenu.ts`/`selection.ts` под `this`, `lib/appImManager.ts` (создание `Chat`, позиция), снос `VanillaFeed.tsx`, `chatInstanceContext`, `reactChatInstance.ts` |
| **Б** | `components/chat/topbar.ts` (+ тест), снос `ChatHeader`, `HeaderMenu`, `useHeaderMenuActions`, `useChatInfoCard`, `useTypingLabel` |
| **В** | `components/chat/reactChatInput.ts`, `shared/react/*` (если нужен общий хост), разбор `Chat.tsx`: что уходит в бэклог, что — в `chat.ts` (передаёт А списком), снос `Chat.tsx` и его сателлитов |

**Оценка: 12 агенто-дней, ≈ 6 календарных.** По старому плану 6-1 стоил 12 дней (риск) и 6-2 —
8, всего 20 вместе со стендом и мутациями на каждом шаге и переносом 6 тестов `Chat.*`. Здесь
меню ⋮ (≈ 4 дня из 8) уходит в бэклог, тесты не переносятся, класс портируется против
настоящих `ChatBubbles`/`ChatContextMenu`/`ChatSelection`.

**Веха К-3 (стенд, P0):** открыть личку, группу, канал, тред комментариев; история; отправка и
приём (композер — остров); клик по шапке открывает профиль; фон в теме чата.

---

### К-4: ядро `ChatInput`; снос React-композера

**Порт** (tweb `components/chat/input.ts`, 5718; карта — план программы, этап 7):
- `construct` `:487-609`;
- плашки reply/forward/webpage `:652-852`;
- каркас `constructPeerHelpers` `:1055-1682` без эмодзи-дропдауна, send-as, записи и
  автокомплита;
- меню вложений `:1115-1352`, морф `btnSend` `:1398-1416`;
- `finishPeerChange` `:2522-2815`;
- черновики `:2271-2333`, `:2412-2484`;
- ввод `:3129-3532`, превью ссылки `:3533-3634`;
- `updateSendBtn` `:4390-4442`, отправка `:4536-4834`;
- правка/пересылка/ответ `:4859-5204`;
- `clearHelper` `:5265-5318`, `setTopInfo` `:5353-5443`.

Поле ввода — rich-DOM tweb (решение пользователя В-4 = А):
- `components/inputField.ts` до HEAD (904; у нас 381 без rich);
- `inputFieldAnimated.ts` (122);
- `helpers/dom/richInputHandler.ts` (900), `helpers/dom/markdown.ts` (549).

Правило `CLAUDE.md` «инпут хранит сырые markdown-маркеры» меняется в этом шаге.

`Chat.init` строит `new ChatInput(this, appImManager, managers, 'chat-input-main')`
(`chat.ts:618`, `:632`, `:635`).

**Удаляется.**
- `components/Composer.tsx` (786), `components/composer/*` (20 файлов, 1682 строки);
- `core/hooks/useChatSend.ts` (570), `useComposerDraft.ts` (79);
- `core/richtext/markdown.ts` (779) — если без потребителей вне композера;
- `reactChatInput.ts`.

**В бэклог:** запись голоса и кружков, send-as, меню отправки и расписание, тултип разметки,
автокомплит (упоминания, стикеры, эмодзи, команды, инлайн), эмодзи-дропдаун, клавиатура бота,
медленный режим и платные сообщения — строки Б-30…Б-38.

**Вложения** открывают наш React `SendMediaPopup.tsx` (429) через `popupStore`, то есть через
остров оверлеев (вопрос **Р-2**).

**Тесты на новое:**
- `inputField.test.ts` / `richInputHandler.test.ts`: entities из DOM в UTF-16, вставка с
  разметкой, undo;
- `input.send.test.ts`: отправка текста, ответ, правка, пересылка — один RPC с правильными
  полями;
- черновик сохраняется на `finishPeerChange` и восстанавливается;
- морф кнопки по состоянию (пусто, текст, правка).

**Агенты: 3.**

| Агент | Файлы |
|---|---|
| **А** | `components/inputField.ts`, `inputFieldAnimated.ts`, `helpers/dom/{richInputHandler,markdown}.ts` (+ тесты); правка `CLAUDE.md` о модели ввода |
| **Б (ведущий)** | `components/chat/input.ts` (`construct`, `finishPeerChange`, черновики, отправка, `clearHelper`/`setTopInfo`), `chat/replyContainer.ts`, правка `chat.ts:618-648` |
| **В** | `chat/attachMenuButton.tsx`, морф `btnSend`, плашка управления (`controlPlate.tsx`), снос `Composer.tsx`, `composer/*`, `useChatSend`, `useComposerDraft`, `reactChatInput.ts` |

А и В начинают параллельно с Б по договорённому интерфейсу:
- `InputField` — API tweb;
- `ChatInput` вызывает `attachMenu`/`btnSend` через поля класса.

**Оценка: 16 агенто-дней, ≈ 7 календарных.** По старому плану 7-1 + 7-2 = 22 дня, а этап 7
целиком — 45 (+18 с дропдауном). Здесь — только ядро (rich-поле 6, `ChatInput` 7, вложения и
снос 3). Всё вокруг — в П-6.

**Веха К-4 (стенд, P0):** отправка текста с разметкой, ответ, правка, пересылка, вложение фото,
приём в другом окне; F5 сохраняет черновик.

---

### К-5: `AppSharedMediaTab` + `AppEditChatTab`; снос `UserInfoPanel`/`GroupEditFlow`

**Порт.**
- tweb `sidebarRight/tabs/sharedMediaTab.tsx` (135, класс-вкладка) и `sharedMedia.tsx` (924):
  `PeerProfile`, `AppSearchSuper` в одной прокрутке, кнопка «Изменить» `:674-702`, счётчики
  вкладок `:563`, «Сохранённые диалоги» `:727`. У нас уже есть `peerProfile.solid.tsx` (1488),
  `peerProfileAvatars.ts`, `appSearchSuper.ts` (3318).
- Вкладка у инстанса чата — `chat.ts:1003-1008`, `:1178-1185`, `:1218-1242` (класс `Chat` уже
  есть с К-3).
- tweb `sidebarRight/tabs/editChat.tsx` (980) → `sidebarRight/tabs/editChat.solid.tsx` (0б-1).
  Строки, ведущие в непортированные вкладки, скрыты до своей пачки (П-1): реакции, обсуждение,
  админы/участники/удалённые/заявки, статистика. Уже портированные открываются родным
  `createTab`: `chatType`, ссылки (0б-3), права (0б-6), `editContact`.

**Удаляется.**
- `components/UserInfoPanel.tsx` (823) + тесты, `sidebarRight/reactProfileTab.ts` (46);
- `core/hooks/useSearchSuper.ts` (181), `useGroupInfo.ts` (220), `useTransitionSlider`;
- `components/group/GroupEditFlow.tsx` (295) + оставшиеся `group/screens/*`,
  `core/hooks/useGroupEdit.ts` (382);
- `components/userInfo/*`, `ChannelStats.tsx`, `group/AddMembersScreen.tsx` — их места займут
  вкладки П-1.

**В бэклог:** вкладки 0б-4, 0б-5, 0б-7, 0б-8, 0б-9; `PinnedStoriesSection` (истории профиля),
`QrModal` из профиля (2C-17), `KeyVerificationPopup` (Отступление В7-2) — строки Б-39…Б-44.

**Тесты на новое:**
- `sharedMediaTab.solid.test.tsx`: `setPeer` на той же вкладке не пересоздаёт `AppSearchSuper`,
  новая вкладка на другого пира пересоздаёт; `destroy` снимает корень, `AppSearchSuper`,
  `PeerProfileAvatars`;
- кнопка «Изменить» по типу пира;
- **тред комментариев** (решение пользователя 2026-10-03): вкладка открывается как tweb
  `chat.ts:1007` — `sharedMediaTab.setPeer(peerId, threadId)`, где `peerId` — группа обсуждения
  (профиль «Информация о группе» этой группы, не канала). «Участники» — **полный список группы**:
  `canViewMembers` tweb `appSearchSuper.ts:3013-3025` (`!isBroadcast && view_participants &&
  (!threadId || !isForum)`), фильтра «только комментаторы» нет. «Медиа»/«Файлы»/«Ссылки» —
  **только из этого треда**: счётчики и выборка с `threadId` (`appSearchSuper.ts:2728-2729`,
  `sharedMedia.tsx:60-71`). Истории (`:3036`) и подарки (`:3070`) в треде скрыты. Пины: в треде
  участники = все участники группы; медиа треда ≠ медиа всей группы; вкладки историй/подарков нет;
  в теме форума вкладки участников нет. Стенд: тред комментариев канала → клик по шапке → то же;
- `editChat.solid.test.tsx`: сохранение на закрытии (не на каждом изменении); видимость строк
  по правам.

**Агенты: 2.**

| Агент | Файлы |
|---|---|
| **А (ведущий)** | `sidebarRight/tabs/sharedMediaTab.ts`, `sharedMedia.solid.tsx`, `solidJsTabs/tabs.ts` (строка вкладки), правки `chat.ts` (`createSharedMediaTab`/`destroySharedMediaTab`), снос `UserInfoPanel`, `reactProfileTab`, `useSearchSuper`, `useGroupInfo` |
| **Б** | `sidebarRight/tabs/editChat.solid.tsx` (+ тест), строка в `tabs.ts` (точечно), снос `GroupEditFlow`, `group/*`, `useGroupEdit` |

**Оценка: 8 агенто-дней, ≈ 4 календарных.** По старому плану: 3-1 (4,5) + 3-2 (2,5) + 0б-1 (4) =
11. Здесь нет моста `useChatSharedMediaTab` (`Chat` уже класс) и нет поштучной врезки детей в
React-`GroupEditFlow`.

**Веха К-5 (стенд, P0):** профиль лички, группы, канала, треда комментариев (участники группы, медиа треда); общие медиа; «Изменить» → сохранить
название; Back/Esc по уровням.

**После К-5** React остаётся только островом глобальных оверлеев (`#react-overlays`) и
островами волны 4 (`StoryViewer`, `MediaEditor`, части `mediaViewer/base.ts`, пока их пачки не
пройдены).

---

## 4. Сводка шагов и сравнение с остатком старого плана

| Шаг | Агентов | Агенто-дней | Календарно | Тот же объём по старому плану |
|---|---|---|---|---|
| К-1 | 2 | 4 | 3 | 2-1, 2-3, 2-4, 2-9 ≈ 8 |
| К-2 | 2 | 9 | 5 | этап 4 ≈ 24,5 |
| К-3 | 3 | 12 | 6 | 6-1 + 6-2 ≈ 20 |
| К-4 | 3 | 16 | 7 | 7-1 + 7-2 + часть 7-5 ≈ 25 |
| К-5 | 2 | 8 | 4 | 3-1 + 3-2 + 0б-1 ≈ 11 |
| **Каркас** | — | **49** | **≈ 25** | **≈ 88** |
| Бэклог П-1…П-6 | 2–4 на пачку | ≈ 115 | ≈ 35 (пачки параллельно с вехи своего К) | ≈ 120 (остаток этапов 0б, 1, 2, 5, 6, 7) |
| **Итого** | | **≈ 164** | **≈ 60** | **≈ 208** агенто-дней (остаток 0б ≈ 20, 1 ≈ 10, 2 ≈ 16, 3 ≈ 7, 4 ≈ 24,5, 5 ≈ 22, 6 ≈ 40, 7 ≈ 63 с дропдауном; ≈ 130–150 календарных по плану программы) |

Откуда экономия (≈ 20 % агенто-дней и примерно вдвое по календарю):
1. Нет временных фасадов и мостов (`ChatFacade`, `ChatInputFacade`, мосты `ВРЕМЕННО до Э*`) и их
   последующего сноса.
2. Не переносятся React-тесты.
3. Нет стенда и мутаций на каждой задаче.
4. Пачки бэклога портируются сразу в родное место, параллельно, без «врезки по одной» в общий
   React-файл.

Оценки грубые. Самая неточная — К-4 (rich-поле меняет модель ввода).

---

## 5. Бэклог

Каждая строка — то, что пропадает на шаге К. «Куда» — пачка, в которой фича возвращается, уже в
родное место. Пачка стартует после вехи своего К.

| № | Что пропало | Пропадает на | tweb | Куда |
|---|---|---|---|---|
| Б-1 | Архив: пункт бургера, бейдж, список архива (сейчас оверлей `Sidebar.tsx` + `mountArchivedList`) | К-1 | `sidebarLeft/tabs/archivedTab.tsx`, `sidebarLeft/index.ts:681-685`, `:1760` | **закрыто П-2 (архив)**: вкладка `sidebarLeft/tabs/archivedTab.solid.tsx` (`AppArchivedTab`), `openArchiveTab`, пункт «Архив» с бейджем `archived-count` |
| Б-2 | Строка «Архив» в списке — React-остров (`autonomousDialogList/dialogs.ts:56`, `:378`) | К-1 | `components/archiveDialog.tsx` | **закрыто П-2 (архив)**: `components/archiveDialog.solid.tsx` (custom element), `ArchiveRow.tsx` снесён |
| Б-3 | Форум: панель тем `TopicsPanel.tsx` (583), открытие форума из списка | К-1 | `forumTab/*`, `autonomousDialogList/forumTopics.ts` | **закрыто П-2 «форум»** (ветка `feat/w7-p2-forum`): `GroupForumTab` + `AutonomousForumTopicList`, остаток — Б-53, Б-54 |
| Б-4 | Ряд историй над списком (`StoriesRow.tsx` 405, `useSidebarStories.tsx`), просмотр из ряда | К-1 | `components/stories/list.tsx` (474), `appDialogsManager.ts:1095-1125` | **закрыто задачей 2-6** (П-3, PR #383): `components/stories/list.solid.tsx`, вьювер — `stories/viewer.ts` (ВРЕМЕННО до волны 4); остаток — Б-60…Б-62 |
| Б-5 | Вертикальная колонка папок (`FoldersSidebar.tsx` 238) | К-1 | `sidebarLeft/foldersSidebarContent/*` | **закрыто пачкой П-3**: `sidebarLeft/foldersSidebarContent/*` (Solid, 1:1; без кастомных эмодзи в названии — их нет на проводе), `body.has-folders-sidebar` и место в раскладке — `stores/foldersSidebar.solid.ts`, стили — `styles/tweb/_foldersSidebar.scss`, `chatsCount` — `stores/folders.solid.ts` |
| Б-6 | Кнопка статус-эмодзи в шапке колонки (`SidebarEmojiStatusButton.tsx`) | К-1 | `sidebarLeft/index.ts:262`, `emojiStatusPicker.tsx` | **закрыто пачкой П-3**: кнопка и `toggleRightButtons` — `AppSidebarLeft.construct`; выбор — `sidebarLeft/emojiStatusPicker.solid.tsx` (остаток — Б-50) |
| Б-7 | Кнопка замка в шапке колонки | К-1 | `sidebarLeft/index.ts:264`, `:345-361` (у нас `lockButton.solid.tsx` есть) | **закрыто пачкой П-3**: `createLockButton()` по `passcode.enabled`, `is-input-the-last-child` — `AppSidebarLeft.construct` |
| Б-8 | Диплинки `/join/`, `/addlist/`, `?domain=&start=`, QR-подтверждение входа с десктопа (`useDeepLinks.ts` 160, `GlobalOverlays.tsx` QR, `FolderInvitePopup`) | К-2 | `lib/internalLinkProcessor.ts` (1661), `appImManager.ts:1043` | **закрыто П-4 (ссылки)**: `lib/internalLinkProcessor.ts` + `lib/internalLink.ts` (типы с предметом), `helpers/addAnchorListener.ts` (реестр вместо глобалей, делегат `click`/`auxclick` документа); `/join/` и `/addlist/` переведены в хэш tweb `#?tgaddr=tg://join?invite=`/`tg://addlist?slug=` (публичная страница бэкенда, `/addlist/{slug}` — редирект), попап папки — `popups/sharedFolderInvite.solid.tsx`; `?domain=&start=` — `tg://resolve?domain=&start=`; QR — `/qr/<token>` → `appImManager.checkForLoginToken` (наше расширение); остаток — Б-75…Б-79 |
| Б-9 | Хоткеи приложения: Ctrl+F, Ctrl+0 «Избранное», Alt+↑↓, мьют (`useAppHotkeys.ts`, `core/hotkeys.ts`); с К-3 — и Ctrl/Cmd+PageUp/PageDown ленты (`useFeedPageHotkeys.ts`, удалён) | К-2, К-3 | `appImManager.ts:1703-1853` | **закрыто пачкой П-4**: блок F `attachKeydownListener`/`attachCopyListener` (`lib/appImManager.ts`; Alt+↑↓ — `dialogs.getNextDialog` воркера, PageUp/PageDown — фокус ленте, печать в любом месте и Ctrl+PageUp/PageDown — `chat.input.passEventToInput`, у tweb это `input.ts:3187`, ждёт К-4), Ctrl/Alt/Cmd+F и Ctrl/Cmd+0 — `AppSidebarLeft.construct` (tweb `sidebarLeft/index.ts:457-468`), Esc — запись `im` контроллера навигации; мьют-хоткея у tweb нет — снят без замены; остаток — Б-80, Б-81 |
| Б-10 | Фон в теме чата (публикация по активному чату, `useShellTheme`) | К-2 | `chat.ts:372-433` | **закрыто К-3**: `Chat.publishBackground`/`handleBackgrounds` (`components/chat/chat.ts`), возврат по стеку — `spliceChats` (`appImManager.ts:3266-3270`) |
| Б-11 | Автоблокировка по таймеру и Ctrl+L (`useAutoLock`, `useLockScreenShortcut`) — если не переносятся вызовом функции | К-2 | `lib/mainWorker/useAutoLock.ts`, `appImManager.ts:630` | **закрыто пачкой П-4**: автоблокировка — в воркере, как у tweb (`lib/mainWorker/useAutoLock.ts`, реестр вкладок `lib/appManagers/appTabsManager.ts`, проводка `core/workerCore.ts`, простой вкладки — `client/tabState.ts`, видео держит — `lib/mediaPlayer`); сочетание — `lib/appManagers/utils/useLockScreenShortcut.ts` с флагом `appImManager.isShiftLockShortcut`; оконный `core/hooks/useAutoLock.ts` снесён |
| Б-12 | Вынос клиента в окно PiP (`core/pip.ts` переносит `#root`, которого больше нет) | К-2 | `components/clientPip.tsx` (196) | П-6 |
| Б-13 | Карточки пустой колонки и «недавно закрытые» | К-2 | `components/chatTips/*` (734), `appImManager.ts:377`, `:824-833` | П-6 |
| Б-14 | Статус «не в сети» при простое | К-2 (не было) | `appImManager.ts:3210-3217` | бэкенд: ручки `account.updateStatus` нет (`presencestore.go:36-37`) |
| Б-15 | Тост вступления по ссылке (`GlobalOverlays.tsx` `joinToast`) | К-2 | `toastNew` | **закрыто П-4 (ссылки)**: вступление открывает чат (`POST /join/{hash}` отдаёт `updates` с чатом, как `messages.importChatInvite`), заявка — тост `RequestToJoinSent` (tweb `joinChatInvite.tsx:122`) |
| Б-16 | Подписки `construct` без предмета: `ephemeral_*`, `file_speed_limited`, `service_notification`, `payment_sent` | К-2 (не было) | `appImManager.ts:567-628` | бэкенд |
| Б-17 | `singleInstance`, t.me-вход, состояние вкладок (`updateTabState`) | К-2 (не было) | `index.ts:443`, `:487-494`, `appImManager.ts:842`, `:951-957` | вне волны |
| Б-18 | Меню ⋮ шапки (39 пунктов с `verify`; `HeaderMenu.tsx` 274) и попапы его пунктов из `useChatPopups`: тема чата (`ChatThemesPicker`), мьют на срок, удалить/выйти и очистить историю, буст (`BoostPopup`), эфир (`StreamSettingsPopup`), розыгрыш (`CreateGiveawayPopup`), «выбрать сообщения», ⋮ треда («закрыть тему»), кнопки звонка (`CallProvider`) | К-3 | `topbar.ts:462-903` | **закрыто пачкой П-5** (`components/chat/topbar.ts` `constructUtils`, пины `topbar.test.ts`): пункты с `verify` — автоудаление (подменю, `autoDeleteIcon.ts`), поиск, мьют, обсуждение, выбрать/снять выделение, в контакты, блокировка, жалоба, очистить, удалить/покинуть; буст, подарок, статистика и прочие без предмета — Б-85, пункты звонков — Б-88, «закрыть тему» — Б-53; темы чата, розыгрыша и настроек эфира в меню ⋮ у tweb нет (были пунктами React-`HeaderMenu`) |
| Б-19 | Закреп (`PinnedBar`, `PinnedBorder`, `AnimatedSuper`, `usePinnedBar`, экран закрепов) | К-3 | `pinnedMessage.tsx` (841), `pinnedMessageBorder.ts` (204), `ChatType.Pinned` | **закрыто П-5 (закреп+аудио)**: `chat/pinnedMessage.solid.tsx`, `pinnedMessageBorder.ts`, `animatedSuper.ts`, `animatedCounter.ts`, `popups/unpinMessage.ts`, `core/pinnedMessages.ts`; экран закрепов — `ChatType.Pinned` в `bubbles.ts`; монтаж в шапку — П-5 «шапка»; остаток — Б-89, Б-90 |
| Б-20 | Поиск по чату (`TopbarSearch.tsx`, `useChatHeaderSearch.ts`, `useChatSearch.ts`, `stores/searchStore.ts`, `.chat.is-search-active`) | К-3 | `topbarSearch.tsx` (1352) | **закрыто П-5 (поиск)**: `components/chat/topbarSearch.solid.tsx` (порт файлом), `Chat.searchSignal`/`initSearch`/`resetSearch` (`chat.ts`), фильтр отправителя — `GET /chats/{id}/members?q=`; кнопка лупы в шапке — `topbar.ts` (П-5, шапка); остаток — Б-91 |
| Б-21 | Плашки шапки: заявки, настройки пира, звонок, эфир | К-3 | `topbarPlates.ts`, `topbarPlate.tsx`, `requests.tsx`, `actions.tsx`, `topbarGroupCall/*`, `topbarLive/*` | **закрыто пачкой П-5**: `topbarPlate.solid.tsx`, `topbarPlates.ts`, плашки видеочата и эфира (`topbarGroupCall/*`, `topbarLive/*`) поверх `groupCallStore`/`livestreamStore`, `setFloating`; заявки, настройки пира и прочие — Б-86 |
| Б-22 | Аудиоплеер (`NowPlayingBar.tsx` 265) и плашка звонка | К-3 | `chat/audio.tsx` (326), `appImManager.ts:849-855` | **аудиоплеер закрыт П-5 (закреп+аудио)**: `chat/audio.solid.tsx` (монтаж — `appImManager.construct`), `audioAnimatedIcon.ts`, `playbackRateButton.ts`, повтор `round`/`loop` в `core/audio/mediaPlaybackController.ts`; плашка звонка (`topbarCall`) — П-4 |
| Б-23 | Панель выделения (`SelectionBar.tsx`) — кнопки над выделением | К-3 | `chat/selection.ts` (у нас класс, панель — tweb `selection.ts`) | **закрыто П-5 «действия»**: панель `ChatSelection` (удалить · «N сообщений» · переслать) — `chat/selection.ts` (`onToggleSelection`/`onUpdateContainer`/`removeSelectionContainer`, tweb 812502980 :1145-1308) + `chat/controlPlate.solid.tsx` (`ChatInputPlate`); в остров композера — `inputContainer`/`center` (до К-4). «Отправить сейчас» отложенных — Б-25, report-режим — 2C-27 |
| Б-24 | Drag&drop и вставка файлов (`ChatDrops.tsx`, `ChatDragAndDrop.tsx`) | К-3 | `appImManager.ts:2807-3125`, `chat/dragAndDrop.ts` | **закрыто пачкой П-4 (drag&drop)**: блок K `lib/appImManager.ts` (`init`, `attachDragAndDropListeners` со сбросом на строку чатлиста и сторожем 500 мс, `canDrag`, `onDocumentPaste`), зона `components/chat/dragAndDrop.ts`; попап — шов `components/popups/newMedia.ts` (до К-4 открывает остров композера); файловая часть `composer/useComposerClipboard.ts` снята. Остаток — Б-82, Б-83 |
| Б-25 | Отложенные (`ScheduledView.tsx`, `useScheduledMessages`, календарик-счётчик в композере), предложенные посты (`SuggestedPostsView.tsx`) | К-3 | `ChatType.Scheduled`, `appImManager.openScheduled` `:3436` | **закрыто П-5 (отложенные)**: `ChatType.Scheduled` — ключ окна `${peerId}_scheduled` (`chat.ts`), `requestScheduledHistory`, дата-баблы «Scheduled for …», `noScheduledMessages`, `scheduled_new`/`scheduled_delete` (`bubbles.ts`), «Отправить сейчас» (`contextMenu.ts` + `popups/sendNow.ts`), `appImManager.openScheduled`; бэкенд — `date` отложенного = время отправки. Предложенные посты у tweb — не экран, а сообщения монофорума: Б-92; остаток отложенных — Б-92 |
| Б-26 | Теги сохранённых (`SavedTagsPanel.tsx`) | К-3 | `topbarSearch.tsx:376-400`, `:918-1110`, `:1285-1290` (ряд реакций поиска, `getSavedReactionTags`) | **не закрыто П-5**: у tweb панель тегов — ряд реакций внутри поиска по чату, его порт — остаток поиска Б-91 (`topbarSearch.solid.tsx`); ручка `GET /saved/tags` и фильтр ленты (`setMessageId({savedReaction})`) есть |
| Б-27 | Кнопки-углы ленты: упоминания, реакции, опросы (`CornerButton` ×3, без данных); «вниз» — `ChatInput.constructGoDownButton` (К-4, `components/chat/input.ts`) | К-3 | `input.ts:638` (`constructGoDownButton`) | **«вниз» закрыто К-4**; угловые кнопки — П-6 |
| Б-28 | Попапы действий над сообщением из `Chat.tsx` (`ChatMsgActionPopups.tsx`, `useMessageActions.tsx`, `useChatPopups.tsx` 327): удалить, переслать (и плашка пересылки в один чат), закрепить, жалоба, кто реагировал, статистика поста (`PostStats`), факт-чек (`FactCheckEditor`); те же действия из вьювера и из меню элемента shared media профиля, кнопка «переслать» сбоку от поста канала (клик гасится). В меню сообщения эти пункты скрыты `verify` (`ChatContextMenu` без `popups`); «Скачать» остался — `appDownloadManager.downloadToDisc` (tweb `contextMenu.ts:2189`), и в меню shared media тоже | К-3 | попапы 2C | **закрыто П-5 «действия»**: пункты меню с `verify` tweb, клики — попапы напрямую: `popups/unpinMessage.ts`, `popups/deleteMessages.ts` (порты, ВРЕМЕННО до 2C-6 на vanilla `PopupPeer`), мосты в React острова оверлеев `popups/forward.bridge.ts` (до 2C-24; плашка пересылки в один чат — `initMessagesForward` острова композера), `reportAd.bridge.ts` (до 2C-27), `reactedList.bridge.ts` (до 2C-25); факт-чек — `confirmationPopup` + `InputField` (плоский текст до К-4); те же попапы — из вьювера, меню и плашки shared media и кнопки «переслать» у поста канала. Остаток — Б-93, Б-94 |
| Б-29 | Статус и «печатает» в шапке — ядро шапки (`chat/topbar.ts`) держит `setPeerStatus`/`getUserStatus`/`getChatStatus` функциями модуля на зеркалах `chatsStore`/`peerCache`; полная модель статуса и «N онлайн» у групп (`getOnlines`, было в `useChatInfoCard` по присутствию участников) | К-3 | `appImManager.ts:3454-3816` | **закрыто пачкой П-4 (статус)**: блок L — методы `AppImManager` (`getTypingElement`, `getPeerTyping`, `getChatStatus`/`getUserStatus`/`getPeerStatus`/`setPeerStatus`, «N онлайн» по «недавним» участникам с кэшем 60 с), шапка и форум-таб зовут `appImManager.setPeerStatus`; остаток — Б-84 |
| Б-30 | Запись голоса и кружков (`useVoiceRecorder.ts` 366, `VoiceRecordingPanel`, `RoundRecordPreview`, `core/audio/{nativeVoiceRecorder,oggOpusWriter,opusRecorderLoader}.ts` — сняты на К-4; вендор `public/opus/{recorder,encoderWorker}.min.js` оставлен для порта) | К-4 | `chat/recording/*`, `nativeVideoRecorder.ts` | П-6 |
| Б-31 | Send-as (`SendAsButton.tsx`, `useSendAs.ts`) | К-4 | `chat/sendAs.ts` (418) | П-6 |
| Б-32 | Меню отправки, расписание, без звука (`SendMenu`, `SchedulePopup`); расписание и «отправить, когда будет в сети» отключены уже на К-3 (их колбэки и счётчик жили в `Chat.tsx`) | К-3/К-4 | `sendContextMenu.ts` (154), `scheduleSendingPopup.tsx` | П-6 |
| Б-33 | Тултип разметки (`MarkupTooltip.tsx` 395) | К-4 | `chat/markupTooltip.ts` (582) | П-6 |
| Б-34 | Автокомплит: упоминания, стикеры, эмодзи, команды, инлайн-боты (`StickersHelper`, `EmojiHelper`, `MentionsHelper`, `InlineResultsHelper`, `composer/AutocompleteHelpers.tsx`, `useMentionPeers` — сняты на К-4) | К-4 | `autocompleteHelper.ts` и соседи (~1 260) | П-6 |
| Б-35 | Эмодзи/стикер/GIF-дропдаун (`emoji/EmojiDropdown.tsx` 746, вкладки `emoji/{Emoticons,Stickers,Gifs}Tab`, `emojiData`, `useGifs` — сняты на К-4); вкладки поиска стикеров и GIF открывались из него | К-4 | `emoticonsDropdown/**` (4315) | **закрыто П-6 «эмодзи-дропдаун»**: `components/emoticonsDropdown/{index,tab,category}.ts`, `search.solid.tsx`, `emojiTonePicker.solid.tsx`, `tabs/{emoji,stickers,gifs,SuperStickerRenderer}.ts` (порт файлами), `helpers/dropdownHover.ts`, `lib/appManagers/appEmojiManager.ts`, `helpers/dom/createStickersContextMenu.ts`, `components/lazyLoadQueueRepeat.ts`; монтаж в `ChatInput` (`.toggle-emoticons`, `insertAtCaret`/`onEmojiSelected`, недавние в `onMessageSent`); лупа ряда открывает поиск стикеров/GIF правой колонки (tweb `:298-308`); пины — `emoticonsDropdown/index.test.ts`; остаток — Б-130…Б-133 |
| Б-36 | Клавиатура бота (`Chat.tsx` инлайн) и плашка управления; кнопка mini-app бота в строке ввода (`botMenuButton` → `openWebApp`, у tweb `botCommandsToggle`, `input.ts:1131`) | К-3/К-4 | `replyKeyboard.tsx` (188), `controlPlate.tsx` | П-6 |
| Б-37 | Медленный режим, платные сообщения (`useSlowmode`, `chargeStars`): пропадают на К-3 — им нужна полная карточка чата из `useChatInfoCard` | К-3 | `input.ts:4005-4085`, `paidMessagesInterceptor.ts` | П-6 |
| Б-38 | Правка медиа в сообщении | К-4 | `editMessageMedia.ts` (133) | П-6 |
| Б-39 | Реакции чата (0б-4) | К-5 (строка `editChat` скрыта) | `chatReactions.tsx` (208) | П-1 |
| Б-40 | Обсуждение канала (0б-5); строка «Обсуждение» из профиля (наша секция Task 5 `peerProfile.solid.tsx`, снята на К-5) | К-5 | `chatDiscussion.tsx` (317) | П-1 |
| Б-41 | Админы, участники, удалённые, заявки, права участника (0б-7; сейчас `userInfo/RightsEditor`, `group/screens/*`); секция «Заявки» профиля (Task 5) и экран прав `userInfo/RightsEditor.tsx` сняты на К-5 — пункты «Назначить админом»/«Изменить права»/«Ограничить» меню участника скрыты (`createParticipantContextMenu`, без `openUserPermissions`) | К-5 | `chatAdministrators.tsx`, `chatMembers.tsx`, `removedUsers.tsx`, `chatRequests.tsx`, `chatUserPermissions.tsx` | П-1 |
| Б-42 | Добавление участников из профиля (0б-8; `AddMembersScreen.tsx`) | К-5 | `sidebarLeft/tabs/addMembers.tsx` (у нас Solid есть) | **закрыто К-5**: угловая кнопка вкладки профиля (`btnAddMembers`, `sharedMedia.solid.tsx`) → `addChatUsers` (`AppAddMembersTab`), как tweb `sharedMedia.tsx:903-911` |
| Б-43 | Статистика канала (0б-9; `ChannelStats.tsx`); строка «Статистика» профиля (Task 5) снята на К-5 | К-5 | `statistics.tsx` (1156) | П-1 |
| Б-44 | Истории профиля (`PinnedStoriesSection.tsx`), QR из профиля (`QrModal`), проверка ключа секретного чата; кнопка QR строк Username/Link (`QrButton`) и строка «Ключ шифрования» (Task 5) сняты на К-5 | К-5 | `sharedMedia.tsx` (истории), 2C-17, Отступление В7-2 | П-1 |
| Б-45 | `visibility: hidden`/`visible` у `.btn-corner` (a11y-дельта tweb 472e3e76b): у нас угловая кнопка (`#new-menu` и др.) прячется только сдвигом и остаётся в порядке Tab | К-1 (не было) | `scss/partials/_button.scss:54`, `:82`, `_leftSidebar.scss` `.btn-corner:not(.is-hidden)` | **закрыто пачкой П-3**: `_button.scss`, `_leftSidebar.scss`, `_rightSidebar.scss` (`.can-add-members`) 1:1; React-кнопки `MemberScreens`/`AddMembersScreen` (до К-5) несут `is-visible` |
| Б-46 | «Новая конференция» в `#new-menu` и подменю «Создать» (`ConferenceCall.New`) | К-1 (не было) | `sidebarLeft/index.ts:1093-1101`, `environment/conferenceCallSupport.ts` | бэкенд: конференц-звонков нет (О-1 плана программы) |
| Б-47 | Ссылка «пропустить к чату» и имена ориентиров колонок (`attachSkipToContent`, `setLandmarkLabels`): ключей `AccDescr.SkipToConversation`/`ChatList`/`ChatInfo` в лангпаке нет | К-2 (не было) | `helpers/dom/appLandmarks.ts`, `appImManager.ts:349-352`, `:3199-3201` | **закрыто пачкой П-4**: `helpers/dom/appLandmarks.ts` 1:1, вызовы в `AppImManager.construct` и `setStaticLandmarkLabels` (+ `language_change`), ключи tweb в `lang.ts`/`dict.ru.ts`, стили `.sr-only`/`.sr-only-focusable` — `styles/tweb/_accessibility.scss` (tweb `partials/_accessibility.scss`) |
| Б-48 | Хэши страницы бэкенда `#@имя/<seq>` и `#<peerId>/<seq>` (кнопка публичной страницы, `public_page.go:40-41`) — `onHashChange` tweb принимает только `#@имя`, `#<peerId>`, `#/im?p=…&post=` | К-2 | `appImManager.ts:1912-2031` | **закрыто PR #380**: кнопка поста публичной страницы ведёт на `#@имя?post=<seq>` (схема tweb `onHashChangeUnsafe` → `openUsername({lastMsgId})`) |
| Б-49 | Пилюля «доступна новая сборка» (`useUpdateStore`) — только в мессенджере (остров `#react-overlays` монтирует `bootstrapIm`), на экране входа её нет; бейдж `api: ok/down` (dev-индикатор `App.tsx`, не tweb) снят без замены | К-2 | `sidebarLeft/index.ts:202-216`, `:367-384` (`updateBtn`, `checkForUpdates`) | **закрыто пачкой П-3**: `updateBtn` и опрос `version` раз в 30 мин — `AppSidebarLeft.construct` (tweb `:211-227`, `:367-384`), скрытие на время поиска — `globalSearch.ts`; `useUpdateStore`, `core/version/versionCheck.ts` и пилюля острова оверлеев сняты |
| Б-50 | Меню архива: ⋮ вкладки архива и ПКМ по строке «Архив» (`withArchiveContext`), «Скрыть из списка»/«Показать в списке» (`showArchiveInChatList` — строка «Архив» сейчас видна всегда при непустом архиве), «Прочитать всё» (`markFolderAsRead`), вкладка «Настройки архива», попап «Об архиве» | П-2 (не было) | `components/archiveDialogContextMenu.ts` (163), `archivedTab.tsx:47-56`, `appDialogsManager.ts:2341-2345`, `solidJsTabs/tabs.ts` `AppArchiveSettingsTab`, `popups/featureDetails` | П-3 |
| Б-51 | Истории архива: ряд `StoriesList({archive: true})` во вкладке, сегменты историй на аватаре строки «Архив» и открытие просмотра с него, `hasArchive` в verify пункта бургера | П-2 (не было) | `archivedTab.tsx:26-45`, `archiveDialog.tsx:328-437`, `appDialogsManager.ts:2104-2112`, `sidebarLeft/index.ts:686` | П-3 (с историями Б-4) |
| Б-52 | Плашка «N новых чатов» над папкой, вступившей по ссылке (`createTopNotification`/`toggleTopNotification`, `chatlistTopNotification.tsx`), опрос `getChatlistUpdates` по `chatlist_update_period` в `onTabChange` | П-2 (не было) | `appDialogsManager.ts:1406-1548`, `sidebarLeft/chatlistTopNotification.tsx` | бэкенд: нет `chatlists.getChatlistUpdates`/`hideChatlistUpdates` и признака `dialogFilterChatlist` у папки (`domain.DialogFilter`) |
| Б-53 | Меню строки темы (закрепить, заглушить, закрыть/открыть, удалить; у `TopicsPanel` были ещё «Изменить» и «Скрыть») и выделение тем пачкой (`ForumTopicsSelection`, перестановка закрепов `attachPinnedReorder`) | П-2 (1-6) | ветки `threadId` в `dialogsContextMenu.ts` (`:224`, `canManageTopics`), `forumTopicsSelection.ts`, `dialogsPinnedReorder.ts` | П-2 (вторая очередь) / О-30 (выделение) |
| Б-54 | Форум-таб: «Создать тему» и правка темы (`AppEditTopicTab`; у `TopicsPanel` был свой попап), «Информация о группе» из меню ⋮ (`AppSharedMediaTab` в левой колонке), «Вступить»/«Подать заявку» (`joinChat`); живые апдейты списка тем (`dialogs_multiupdate` с `topics`, `dialog_unread`/`dialog_drop`/`peer_typings` темы) — у нас темы перечитываются на каждый показ таба | П-2 (1-6) | `sidebarRight/tabs/editTopic.tsx`, `groupForumTab.ts:96-147`, `autonomousDialogList/forumTopics.ts:24-104` | П-1 (вкладки) / воркер: хранилища тем и событий тем на главном потоке нет |
| Б-55 | Кнопки звонка в шапке (голос и видео в `ChatHeader.tsx`; у tweb — `btnCall` с `verifyCallButton` по `userFull.phone_calls_available`, видео — пункт меню ⋮; групповой звонок `btnGroupCall`/RTMP) | К-3 | `topbar.ts:1035-1057`, `:361-416`, `appImManager.callUser` | **закрыто пачкой П-4 (звонки)**: `btnCall`/`btnGroupCall`/`btnGroupCallMenu` с `verify*` в `chat/topbar.ts`, блок H `appImManager` (`callUser`, `discardCurrentCall` с подтверждением, `joinGroupCall`, `joinLiveStream`, `lib/calls/callTransitionCoordinator.ts`); видео — пункт ⋮ (Б-18, П-5 зовёт `verifyCallButton`), «Stream With...» меню эфира — с попапом эфира (Б-18); остаток — Б-95…Б-98 |
| Б-56 | Замок и зелёное имя секретного чата в шапке (наше расширение, у tweb секретных чатов нет) | К-3 | — | вне волны: секретные чаты на паузе (`SECRET_CHATS_ENABLED=false`) |
| Б-57 | Шапка темы форума: имя темы, иконка, замок закрытой темы, подпись «В <группа>» (`TopicProfileStatus`); наш `PeerTitle` темы не знает | К-3 | `topbar.ts:1625-1636` (`wrapPeerTitle({threadId})`), `:1736-1742` | **закрыто пачкой П-5**: заголовок, значок темы в аватаре (`avatar.ts`, опция `topic`), подпись `TopicProfileStatus` — тема ручкой списка тем (`topbar.ts::loadForumTopic`) |
| Б-60 | Меню ряда историй: «Опубликованные/архив историй» (`AppMyStoriesTab`, О-82), уведомления об историях пира (`toggleStoriesMute`), stealth-режим из меню (`showStoriesStealthModePopup`), скрыть/вернуть истории пира (`toggleStoriesHidden`) и ряд в архиве (`archive: true`) | 2-6 (не было) | `stories/list.tsx:363-439`, `sidebarLeft/tabs/archivedTab.tsx:22-72` | П-3 / бэкенд (`stories_hidden`, уведомления об историях) |
| Б-61 | Вход во вьювер с аватарки с кольцом (`appImManager.openStoriesFromAvatar`/`openStoriesForPeer`): у строки списка и профиля кольца историй нет — `components/avatar.ts` без `StoriesSegments` | — (не было) | `avatarNew.tsx:280-410`, `appImManager.ts:1619-1632`, `appDialogsManager.ts:2104` | П-2 (1-8) / П-1 |
| Б-62 | Публикация своей истории, лист «близкие друзья», архив истёкших (`useSidebarStories`: MediaEditor → `AddStorySheet`/`CloseFriendsSheet`/`StoriesArchiveSheet`) — у tweb публикации нет | К-1 | — | вне волны (решение пользователя: вернуть или снести листы) |
| Б-63 | Выбор статус-эмодзи — настоящий `EmoticonsDropdown` с `EmojiTab({noRegularEmoji: true})` у якоря кнопки и анимация `fireAroundAnimation` нового статуса: сейчас `openEmojiStatusPicker` открывает попап с сеткой юникод-эмодзи (бывший React `EmojiStatusPicker.tsx`), статус — юникод `emoji_status_emoticon` | П-3 (не было) | `sidebarLeft/emojiStatusPicker.tsx`, `sidebarLeft/index.ts:285-314` | **закрыто П-6 «эмодзи-дропдаун»**: `sidebarLeft/emojiStatusPicker.solid.tsx` — автономный `EmoticonsDropdown` с `EmojiTab` у якоря (`is-standalone`, звезда «без статуса»), анимация нового статуса — `fireAroundAnimation` (`sidebarLeft/index.ts`, ветка `reactionEmoji` по эмодзи статуса). Расхождение: вкладка юникод-эмодзи (`noPacks`), а не `noRegularEmoji` над наборами статусов — статус у бэкенда юникод; статус своим эмодзи и на срок — Б-133 |
| Б-64 | Клик по внутренней ссылке Telegram (`data-anchor-action`, t.me) в бабле открывает её новой вкладкой: `internalLinkProcessor` нет (было так и до К-3 — `BubblesNavigation.openInternalLink` никто не передавал) | К-3 (не было) | `bubbles.ts:3014` (`addAnchorListener`), `internalLinkProcessor.ts` | **закрыто П-4 (ссылки)**: делегат `data-anchor-action` на документе (`helpers/addAnchorListener.ts::listenForAnchorClicks`) исполняет обработчики `internalLinkProcessor` |
| Б-65 | Заморозка наблюдателя ленты на неактивном инстансе (`bubbles.observer.toggleObservingNew`, `chat.ts:715`): у нашего `superIntersectionObserver.ts` её нет, `Chat` замораживает только группу анимаций | К-3 (не было) | `helpers/dom/superIntersectionObserver.ts` | П-5 |
| Б-70 | «Геопозиция» и «Контакт» в меню вложений (`AttachMenu.tsx` → `LocationPicker` с живой геопозицией `core/liveShareEngine.ts`/`stores/liveShareStore.ts`, `messages/ChatDialogs::ContactPicker`) — наши пункты: у tweb 812502980 их в меню вложений нет (`input.ts:1115-1300`) | К-4 | — | вне волны (решение пользователя: вернуть своими пунктами или снести ручки `sendGeo`/`sendGeoLive`/контакта) |
| Б-71 | Пункты меню вложений tweb без предмета: «Музыка» (`SharedMusicTab2` → `popups/musicSearch`, `appSavedMusicManager`), «Подарить Premium» (`GiftPremium`: `canGiftPremium` + `premium_gift_attach_menu_icon`), боты меню вложений (`attachMenuBots` в `onOpenBefore`); подарок с плашки (`giftControlBtn`; React `stars/SendGiftPopup.tsx` снят на К-4 — его открывал только остров композера, `stars.send` шлёт только пользователю); «Предложить пост» в канале (`SuggestPostPopup.tsx`, `useSuggestedPosts` — сняты; у tweb `btnSuggestPost` монофорума, `input.ts:1342-1345`) | К-4 | `input.ts:1132-1177`, `:1294-1345`, `:1653-1656`, `popups/sendGift.tsx` | бэкенд / П-6 |
| Б-72 | Меню плашек над строкой ввода и превью ссылки: hover/тач-меню плашек ответа, пересылки и ссылки (`DropdownHover`, radio-группы `ButtonMenuSync`) — «Показать сообщение», «Ответить в другом чате», «Не отвечать»/«Не цитировать», показать/скрыть отправителя и подписи, «Переслать в другой чат»; превью ссылки над строкой (`processWebPage`, плашка `webpage`, `noWebPage`, позиция/размер медиа) — у бэкенда нет ручки `messages.getWebPagePreview` | К-4 | `input.ts:629-852`, `:3533-3634`, `:4246-4299`, `:5205-5247`, `helpers/dropdownHover.ts` | П-6 (меню) / бэкенд (превью) |
| Б-73 | Состояния строки ввода без предмета у класса: кнопка «Вступить» (`joinBtn` — нет `joinChannel` по id), «Разблокировать» (нет `isUserBlocked`), премиум/заморозка/«Открыть чат»/«Открепить всё» на плашке; плашка рукопожатия секретного чата и отправка E2E из строки (секретные чаты на паузе); черновики тредов (у `PUT /chats/{id}/draft` нет `threadId`); отмена «печатает» (`sendMessageCancelAction`); удаление сообщения при пустой правке (`showDeleteMessagesPopup` → `popups/deleteMessages`, П-5); кнопка подарка в строке (`btnSendGift`, нужна приватность подарков `userFull`) | К-4 | `input.ts:1079-1085`, `:1576-1681`, `:2315-2328`, `:3458-3532`, `:4733-4745` | П-6 / П-5 / вне волны |
| Б-74 | Свои эмодзи в поле ввода живьём: `img.custom-emoji-placeholder` рисуется `alt`-глифом — нет `CustomEmojiElement`/`CustomEmojiRendererElement` (`processCustomEmojisInInput`, перепривязка при вставке), BOM-филлеры вокруг них и BOM-каретка `RichInputHandler` (ветки `USING_BOMS`), фильтр своих эмодзи без Premium в `wrapDraftText` (признака Premium у клиента нет) | К-4 (не было) | `inputField.ts:434-496`, `:29-153`, `richInputHandler.ts:80-847`, `wrapRichText.ts:151-176`, `:1030-1072`, `wrapDraftText.ts:13-15` | **закрыто П-6 «эмодзи-дропдаун»**: `lib/customEmoji/{element,renderer}.ts` (без общего холста — медиа в узле, слой поля СОСЕДОМ поля), `processCustomEmojisInInput`/перепривязка в `insertRichTextAsHTML` (`inputField.ts`), прозрачный `src` плейсхолдера (`wrapRichText.ts`), фильтр без Premium (`wrapDraftText.ts`, Premium — из `me` зеркала). BOM-ветки не переносились: у tweb `USING_BOMS = false` — код мёртв и там. Свои эмодзи в баблах — Б-130 |
| Б-75 | Внутренние ссылки без предмета на бэкенде: `invoice`/`$slug`, эфир и групповой звонок (`voicechat`/`livestream`), конференция `t.me/call/…`, `boost`, `premium_offer`, `giftcode`, бизнес-ссылка `m`/`message`, `stars_topup`, `nft`, `addstyle`, `tg://iv`, история/альбом/коллекция подарков (`/s/`, `/a/`, `/c/` у имени), ссылка-телефон (`t.me/+7…`, нет `contacts.resolvePhone`), «поделиться» `share/url`/`msg_url` (нет попапа выбора чата — Б-28); их якорь остаётся браузеру, а `im`/`tg_resolve` такого вида отвечают тостом `Link.NotSupported` | П-4 (не было) | `internalLinkProcessor.ts:232-345`, `:575-985`, `:1169-1211`, `:1271-1617` | бэкенд / П-5 (share) |
| Б-76 | Мини-приложения ботов: подписанный запуск (`requestWebView`/`requestMainWebView`, `initData`, `startParam`), приложения по имени (`t.me/<бот>/<app>`, `getBotApp`), attach-меню (`toggleBotInAttachMenu`, `ATTACH_MENU_BOT`), подтверждения (`confirmBotWebView*`, `appState.confirmedWebViews`), бот-страж вступления (`openJoinChatWebView`/`JoinChatFlow`), игры (`playGame`), url-auth и autologin (`handleUrlAuth`, `handleAutologinDomains`), `handlePeerColors`, Web Share Target (`checkForShare`); у нас главное приложение — кнопка-меню бота (`bots.menuButton`), окно — React `WebAppModal` | П-4 (не было) | `appImManager.ts:1024-1609`, `internalLinkProcessor.ts:1312-1430` | бэкенд / программа вебаппа |
| Б-77 | Клиентские `tg://`-ссылки разделов: `tg://settings/…` (нужен порт `lib/settingsSearch`), `tg://contacts[/sort]` (О-31), `tg://new/…`, `tg://chats/search`/`emoji-status` | П-4 (не было) | `internalLinkProcessor.ts:755-1044` | П-1 / порт `lib/settingsSearch` |
| Б-78 | `start=` бота: кнопка «Запустить» плашки управления (`startParam` → `chat.input.setStartParam`) — сейчас бот запускается сразу (`bots.start`); `startgroup`/`startchannel` — попап выбора чата `showAddBotToChat` (открывается сам бот) | П-4 (не было) | `internalLinkProcessor.ts:1053-1072`, `input.ts:1972-2010`, `popups/addBotToChat` | П-6 (с плашкой управления Б-36) |
| Б-79 | Предпросмотр приглашений: `messages.checkChatInvite` и попап `showJoinChatInvitePopup` (название, участники, «нужно одобрение», платная подписка) — вступление идёт сразу; у папки по ссылке — ветки «уже добавлена»/«добавить недостающие»/«выйти из папки» (`chatlistInviteAlready`, `leaveChatlist`) и выбор вступившей папки (`filter_joined`) | П-4 (не было) | `internalLinkProcessor.ts:1127-1167`, `popups/joinChatInvite.tsx`, `popups/sharedFolderInvite.tsx:41-60`, `stores/folders.ts:201` | бэкенд |
| Б-80 | Правка последнего сообщения по ↑ и ответ на предыдущее по Ctrl/Cmd+↑ (ветка блока F; стрелки сейчас гаснут, в чате без права писать — прокрутка ленты) | П-4 (не было) | `appImManager.ts:1758-1846`, `appMessagesManager.getFirstMessageToEdit` (:7728-7792) | К-4 даёт `ChatInput.editMsgId`/`replyToMsgId`/`isInputEmpty`/`onHelperCancel`; `getFirstMessageToEdit` — метод `messages` воркера (нужен `canEditMessage` с правами чата в воркере) |
| Б-81 | Защита копирования инертна: у баблов нет класса `no-forwards` (`bubbles.ts:11118` `canForward`), бэкенд не знает защиты контента (`noforwards` чата/сообщения, `mtmessage.go:58`) | П-4 (не было) | `bubbles.ts:11118`, `:11240-11262` | бэкенд, затем строка в `bubbles.ts` |
| Б-82 | Вставка и сброс файлов не знают состояний ввода: правки с заменой медиа (`editMessage` → `canUploadAsWhenEditing`, зоны только допустимого вида), эфемерного композера (один файл, тост `Ephemeral.SingleAttachment`), тултипа медленного режима у скрепки (`showSlowModeTooltipIfNeeded`), монофорума (`canPaste`); права по видам вложений (`send_photos`/`send_videos`/`send_docs`) не сужают зоны — гранулярных прав нет | П-4 (не было) | `appImManager.ts:3037-3125`, `input.ts:3334`, `:4079`, `:4487`, `chat/utils.ts:89` | П-6 (с Б-37, Б-38) |
| Б-83 | Зоны сброса внутри открытого попапа медиа (`mediaDropsContainer`, `newMediaPopup.appendDrops`, «Добавить N» `Preview.Dragging.AddItems`): сброс поверх попапа ничего не делает, вставка в попап дописывает файлы (`addFiles`) | П-4 (не было) | `appImManager.ts:2879-2895`, `popups/newMedia.tsx` | порт `popups/newMedia.tsx` |
| Б-84 | «N онлайн» в подписи группы больше 100 участников (`messages.getOnlines`) и фильтр «недавние» (`channelParticipantsRecent`) у списка участников: сейчас онлайн считается по первой странице `/chats/{id}/members` (100), у больших групп не считается | П-4 (не было) | `appProfileManager.ts:1170-1210` | бэкенд: ручки `messages.getOnlines` и фильтра у `ListMembers` нет |
| Б-85 | Пункты меню ⋮ шапки без предмета у нас: `FilterActions`/`CompactDiffView` (нет журнала `ChatType.Logs`), `TopicViewAsTopics`/`SavedViewAsChats` (О-88), `ChannelDirectMessages.*` и `PaidMessages.*Fee` (монофорум, О-4), `AddToGroup`/`BotAddToGroupOrChannel`/`AddToChannel` (нет `bot_info`, `showAddBotToChat`), `ShareContact` (выбор получателя — только React-мост до 2C-24), `Chat.Menu.SendGift` (до 2C-20), `Statistics` (Б-43), `BoostChannel`/`BoostGroup` (`openBoosts`), бот-`Settings` (`attachMenuBots`), `Translate`, `DisableSharing`/`EnableSharing` (нет `noforwards_*` у `userFull`), `WelcomeMessages.DeleteAll` | П-5 (не было) | `topbar.ts:462-902` | П-1 (статистика, буст), 2C-20/2C-24 (подарок, «поделиться контактом»), бэкенд (остальное) |
| Б-86 | Плашки шапки без предмета: заявки на вступление (`requests.tsx` — нет `requests_pending`/`recent_requesters` у `channelFull` и вкладки `AppChatRequestsTab`, Б-41), настройки пира (`actions.tsx` — бэкенд не производит `PeerSettings`, события `peer_settings` нет), бизнес-бот, плата монофорума, перевод, спонсорские; «Stream With…» меню эфира | П-5 (не было) | `topbarPlates.ts`, `requests.tsx`, `actions.tsx`, `chatAutomation.tsx`, `removeFee.tsx`, `translation.tsx`, `topbarSponsored.tsx` | П-1 (заявки) / бэкенд (`PeerSettings`) |
| Б-87 | Мьют темы форума из меню ⋮ (`isPeerLocalMuted`/`togglePeerMute` с `threadId`): ручки мьюта темы нет, `groups.setMute` глушит весь чат — в теме пунктов «Без звука»/«Со звуком» нет; удалить тему из ⋮ (`showDeleteDialogPopup(…, threadId)`) — О-3 | П-5 (не было) | `topbar.ts:502-511`, `:855-867` | бэкенд (мьют темы) / П-2 (удаление темы) |
| Б-88 | Пункты ⋮ звонков `Call`/`VideoCall`/`LiveStream`/`VoiceChat` (`:528-547`): `verify*`-методы — в ветке П-4 (`feat/w7-p4-status-calls`), в ветке П-5 их нет; кто вливается в `main` вторым, добавляет пункты после `ViewDiscussion` | П-5 | `topbar.ts:528-547` | влитие П-4/П-5 |
| Б-89 | Плашка закрепа: кнопка действия справа — одиночная инлайн-кнопка бота у закрепа (`getKeyboardButtonHandler`) и «Присоединиться к звонку» (`getWebPageActionOnClick`, `PinnedJoinCall`); превью закрепа с размытием чувствительного медиа (`isSensitive`); закрепы темы форума (у бэкенда `GET /chats/{id}/pins` без темы — список на весь чат); «Открепить все» — по одному (ручки `messages.unpinAllMessages` нет), `silent`/`pm_oneside` закрепления сервер не принимает | П-5 (не было) | `pinnedMessage.tsx:669-747`, `components/wrappers/keyboardButton.ts`, `getWebPageActionOnClick.ts`, `appMessagesManager.ts:6838-6890` | П-6 (клавиатура бота, Б-36) / бэкенд (темы, unpinAll, silent) |
| Б-90 | Экран закрепов: вместо поля ввода — кнопка «Открепить все»/«Скрыть закреплённые» (`pinnedControlBtn`, класс `can-pin`); сейчас там композер острова | П-5 (не было) | `input.ts:2093`, `:2600`, `:2698-2703` | К-4 (ядро `input.ts`; попап — `popups/unpinMessage.ts`, ключи в словаре) |
| Б-91 | Поиск по чату, остаток: теги «Избранного» в поиске (строка реакций, премиум-замок, `reaction` в `initSearch`; с Б-26); поиск по хэштегу «в моих»/«в публичных» и лента-выдача `ChatType.Search` (`SEARCH_TYPES`, `updateChatSearchContext`); подсветка найденного слова в бабле (`highlight: {type: 'search'}`); поиск в треде/теме (`top_msg_id` — ручка `/chats/{id}/search` его не принимает); `initSearch({focus})` из `internalLinkProcessor`; живые вставки в выдачу (`toggleHistoryKeySubscription`) | П-5 (не было в К-3) | `topbarSearch.tsx:470-523`, `:744-753`, `:925-1098`, `:916-920`, `chat.ts:1331-1338` | П-5 (с Б-26) / бэкенд (`top_msg_id`, `channels.searchPosts`) / П-4 (`focus`) |
| Б-92 | Отложенные, остаток: кнопка-календарик `btnScheduled` и отправка в ленте отложенных (у нас композер ленты отложенных шлёт ОБЫЧНОЕ сообщение — до К-4/Б-32), «Изменить время» (`MessageScheduleEditTime` → `input.scheduleSending`, Б-32) и правка текста отложенного (ручки `PATCH` текста нет — пункт «Изменить» скрыт), «Отправить выбранные сейчас» панели выделения (Б-23), удаление отложенного — попап удаления с `ChatType.Scheduled` (`deleteScheduledMessages`, Б-28), заголовок «Отложенные»/«Напоминания» и скрытие лупы у `Scheduled` в шапке (`topbar.ts:1455`, `:1586`), «напоминание сохранено» в «Избранное» (тост `appImManager.ts:729-732`), живые отложенные с других устройств (кадров `updateNewScheduledMessage` у бэкенда нет — события шлёт только своя вкладка через воркер). Предложенные посты (`SuggestedPostsView.tsx`, снесён в К-3): у tweb отдельного экрана нет — это сообщения монофорума канала с `suggested_post` и кнопками в бабле (`bubbleParts/suggestedPostReplyMarkup.ts`, `suggestPostPopup/*`); у нас модель другая (`/channels/{id}/suggested_posts`, монофорумов нет) | П-5 (не было в К-3) | `input.ts:923-943`, `:2181`, `contextMenu.ts:964-987`, `popups/deleteMessages.ts:70`, `topbar.ts:1455`, `:1586`, `bubbleParts/suggestedPost*` | К-4/П-6 (Б-32), П-5 (шапка, действия, выделение), бэкенд (монофорум для предложки) |
| Б-93 | Пункты «Статистика» и «Статистика опроса» в меню сообщения (`ViewStatistics`/`PollStats.View`): открывают вкладку `AppStatisticsTab` правой колонки, а её нет | П-5 (не было с К-3) | `chat/contextMenu.ts:1293-1304`, `:2333-2345`, `sidebarRight/tabs/statistics.tsx` | П-1 (с Б-43) |
| Б-94 | Закреп без чекбоксов «Уведомить всех участников» и «Закрепить также у …» (ручка `POST /chats/{p}/messages/{seq}/pin` не принимает `silent`/`pm_oneside`); удаление чужих сообщений в мегагруппе без попапа «забанить / пожаловаться / удалить всё от участника» (`showDeleteMegagroupMessagesPopup`, список админов) — идёт обычным попапом «удалить у всех» | П-5 (не было) | `popups/unpinMessage.ts:82-107`, `popups/deleteMessages.ts:40-55`, `popups/deleteMegagroupMessages.ts` | бэкенд (флаги закрепа) / П-1 |
| Б-110 | Чужой комментарий не появляется живьём в открытом треде канала (виден после переоткрытия). Окно треда адресовано номером ПОСТА (`hkey(группа, пост)`), а кадр `new_message` несёт корень номером ЗЕРКАЛА в группе (`reply_to_top_id`, `discussion_mirror.go::ExternalizeThreadRoots`) — `messages.cacheLive` кладёт его в окна по зеркалу, мимо окна треда. Своя отправка закрыта (эхо финализирует окна временного бабла, `checkPendingMessage`); проверено на стенде 2026-10-03. У tweb тред комментариев открывается номером зеркала (`getDiscussionMessage` → `threadId` = mid в группе), и ключи совпадают by construction | баг-фиксы после П-5 (найдено) | `appMessagesManager.ts` `getDiscussionMessage`, `bubbles.ts` `openDiscussion` (:3327-3341) | **закрыто** (ветка `fix/thread-live-comments`): тред адресуется номером зеркала — ручка `GET /channels/{id}/posts/{seq}/discussion` (порт `getDiscussionMessage`), `thread_root`/`thread_root_id` — номер корня в том же пире; `openDiscussion`, `appImManager.openComment`; обход эха PR #394 снят; плашка треда без эвристики `saved_from_peer` |
| Б-130 | Свои эмодзи в баблах ленты рисуются глифом: рендерер своих эмодзи (`lib/customEmoji/renderer.ts`) к `wrapRichText`/баблам не подключён (у tweb — `customEmojis`/`customEmojiRenderer` опций `wrapMessageText`), партиал `_customEmoji.scss` перенесён выдержкой (`_bridge.scss`): его общие правила `.custom-emoji` рассчитаны на пустой узел поверх холста и ломают глиф-фолбэк | П-6 (не было) | `lib/richTextProcessor/wrapRichText.ts:415-470`, `bubbles.ts` (`customEmojiRenderer`), `scss/partials/_customEmoji.scss` | П-6 / лента |
| Б-131 | Поиск эмодзи и групп: ключевые слова эмодзи — локальный пакет `config/emojiKeywords.ts` (нет `messages.getEmojiKeywordsDifference`); ряда групп эмодзи под полем поиска эмодзи/стикеров/GIF (`addSearchCategories`, `groupFetcher`, `emojiGroupPremium`) нет — нет `messages.getEmojiGroups` и `messages.searchCustomEmoji` | П-6 (не было) | `appEmojiManager.ts:111-176`, `:418-452`, `emoticonsDropdown/search.tsx:16-148` | бэкенд |
| Б-132 | Свой набор стикеров/эмодзи группы в дропдауне (`GroupSetController`, `groupSet.ts`, `groupSetSection.ts`; заголовок со «скрыть/показать», «настроить» у админа) — у чата нет набора на бэкенде (`channelFull.stickerset`/`emojiset`) | П-6 (не было) | `emoticonsDropdown/groupSet.ts` (142), `groupSetSection.ts` (89), `tabs/{emoji,stickers}.ts` (`initGroupSet`) | бэкенд / П-1 |
| Б-133 | Остаток эмодзи-дропдауна без предмета: «выбирает стикер» (`choosing_sticker`), порядок наборов на лету (`stickers_top`/`stickers_order`), лимит избранных (`getLimit('favedStickers')`), удаление одного недавнего стикера (`saveRecentSticker(unsave)`), премиум-стикеры и замок; статус своим эмодзи и на срок (`SetAsEmojiStatus`, `SetEmojiStatusUntil*`, наборы статусов); «Отправить с подписью / без звука / по расписанию» из меню стикера и GIF (Б-32); общий холст своих эмодзи (`compositor`) и перекраска цветом текста (`textColor`) | П-6 (не было) | `emoticonsDropdown/tabs/stickers.ts`, `helpers/dom/createStickersContextMenu.ts`, `lib/customEmoji/renderer.ts` | бэкенд / П-6 (Б-32) |
| Б-140 | В «Избранном» в шапке кнопка «Позвонить»: бэкенд ставил `phone_calls_available`/`video_calls_available` и своей карточке (`privacy.Profile` при viewer == target, `profile_handler.go::userJSON`) | баг-фиксы после П-4 (найдено) | `topbar.ts` `verifyCallButton` (:409-415) — решает только по флагам `userFull` | **закрыто** (ветка `fix/thread-live-comments`): своей карточке флагов звонка нет (`usecase/privacy/privacy.go`, `profile_handler.go`), тест `privacy/profile_test.go` |
| Б-141 | «Skip to conversation» и подписи колонок для диктора по-английски при русском интерфейсе: кэш пакета старта без ключей `AccDescr.*`, свежий пакет того же языка (`catchUpLangPack`) объявляет только `language_apply`, а ссылка подписана строкой, ориентиры — на `language_change` | баг-фиксы после П-4 (найдено) | `helpers/dom/appLandmarks.ts`, `appImManager.ts:349-352`, `:3199-3201` | **закрыто** (ветка `fix/thread-live-comments`): подпись ссылки — узел `i18n()`, ориентиры — на `language_apply` (расхождение 2 `appImManager.ts`) |

| Б-95 | Подписки звонков `construct`: `acceptCallOverride` (принять входящий при идущем видеочате/эфире — подтверждение `discardCurrentCall` и выход из текущего) и тост `incompatible` | К-2 (не было) | `appImManager.ts:880-920` | П-6 / программа звонков: принятие идёт кнопкой острова `CallOverlay` прямо в `callEngine.accept` |
| Б-96 | Попап `Call.PrivacyErrorMessage` при звонке тому, кто запретил звонки (`userFull.pFlags.phone_calls_private`) | П-4 (не было) | `appImManager.ts:2234-2262` | бэкенд: признака `phone_calls_private` в `userFull` нет (кнопка гаснет по `phone_calls_available`, звонок отклоняется `call_decline reason=privacy`) |
| Б-97 | Вход в видеочат по ссылке/плашке с `groupCallId`: «Видеочат закончился» / «Начать новый?» (`VoiceChat.Chat.Ended`/`StartNew`) | П-4 (не было) | `appImManager.ts:2348-2389` (`getGroupCallFull`) | бэкенд: полной карточки звонка (`phone.getGroupCall`) нет |
| Б-98 | Право `manage_call` (кто заводит видеочат и видит меню эфира): бита нет, клиент спрашивает `hasRights(chat, 'just_admin')`, а бэкенд (`ws/conn.go` `group_call_join`) пускает заводить звонок любого участника | П-4 (не было) | `hasRights.ts` (`manage_call`), `topbar.ts:340-407` | бэкенд: бит `manage_call` в `chatAdminRights` и проверка в `JoinGroupCall` |

| Б-100 | Меню ⋮ шапки профиля (`btnMenu`: «Показать как сообщения» у «Избранного», фильтр фото/видео вкладки «Медиа», меню историй и подарков) и контекст-меню ряда вкладок «Сделать главной»; подзаголовок «Медиа» — «N медиафайлов», а не «N фото, M видео» | К-5 (не было) | `sharedMedia.tsx:449-547`, `:809-893`, `sharedMediaFilters.ts`, `buttonMenuCheckboxFilters.ts` | П-1 (нужны `setMediaInputFilter`/`onMediaCountersChange` у `AppSearchSuper` и ручка `setMainProfileTab`) |
| Б-101 | «Изменить» темы форума (`AppEditTopicTab`) и бота (`AppEditBotTab`) — карандаш у них скрыт; профиль в левой колонке (`AppSharedMediaTab.open`: инфо темы форума, «Сохранённые диалоги») | К-5 | `sharedMedia.tsx:675-703`, `sidebarRight/tabs/editTopic.tsx`, `editBot.tsx`, `sharedMediaTab.tsx:126-134` | П-1 (вкладки), Б-54 (левая колонка) |
| Б-102 | Строка инвайт-ссылки приватной группы/канала в профиле (ветка `exported_invite` строки `Link`; прежде — отдельный поход `useGroupInfo` → `groups.listInvites`) | К-5 | `peerProfile.tsx:999-1004` | бэкенд: `exported_invite` в `ChannelFull`/`ChatFull`, затем строка — П-1 |
| Б-105 | Строки редактора чата без предмета: личные сообщения канала (монофорум, `AppDirectMessagesTab`), приветственные сообщения (layer 229, `ChatType.Welcome`), «Недавние действия» (админ-лог, `AppAdminRecentActionsTab`/`ChatType.Logs`) | К-5 (не было; `GroupEditFlow` их не рисовал) | `editChat.tsx:720-731`, `:763-790`, `:377-406` | бэкенд: монофорумов, приветственных сообщений и журнала действий админов нет |
| Б-106 | Секции редактора чата без бэкенда: доходы (`TransactionHistorySection`), стикеры и эмодзи группы (`AppGroupStickersTab`), автоперевод канала (уровень буста `channel_autotranslation_level_min`), сообщество (`CommunityLinkSection`, `AppAddGroupToCommunityTab`); `handleChannelsTooMuch` у тумблеров тем и истории | К-5 (не было) | `editChat.tsx:812-847`, `:875-893`, `:940-965`, `popups/channelsTooMuch.ts` | бэкенд |

### Пачки бэклога

| Пачка | Состав (строки) | Старт | Агентов | Агенто-дней | Разбиение файлов |
|---|---|---|---|---|---|
| **П-1** вкладки правой колонки | 0б-4, 0б-5, 0б-7, 0б-8, 0б-9; Б-39…Б-44 (0б-3, 0б-6 — уже в работе) | после К-5 | 3 | ≈ 13 | агент на вкладку или группу: (0б-4 + 0б-5), (0б-7), (0б-8 + 0б-9); общий — только `solidJsTabs/tabs.ts`, строки точечно |
| **П-2** список | архив 1-5 (Б-1, Б-2), форум 1-6 (Б-3), сохранённые 1-7 (в работе), ядро 1-8 | после К-2 | 3 | ≈ 11 | архив — `archivedTab`, `archiveDialog`; форум — `forumTab/*`, `forumTopics.ts`; 1-8 — `lib/appDialogsManager.ts` (единственный владелец файла) |
| **П-3** левая колонка | истории (Б-4), колонка папок (Б-5), кнопки шапки (Б-6, Б-7) | после К-2 | 2 | ≈ 7 | истории — `stories/list.tsx` + вызов в `appDialogsManager` (через владельца П-2/1-8); папки + кнопки — `foldersSidebarContent/*`, строки в `sidebarLeft/index.ts` |
| **П-4** подсистемы `AppImManager` | хоткеи (Б-9), drag&drop (Б-24), `internalLinkProcessor` (Б-8, Б-15), звонки (5-5), боты/вебапп (5-6), статус/typing (Б-29), автоблокировка (Б-11) | после К-3 | 4 | ≈ 25 | каждый — свой файл (`internalLinkProcessor.ts`, `chat/dragAndDrop.ts`, …), в `lib/appImManager.ts` — методы блоками F/K/L/D/H; врезка в класс по очереди |
| **П-5** чат и шапка | меню ⋮ (Б-18), закреп (Б-19), поиск по чату (Б-20), плашки (Б-21), аудио (Б-22), выделение (Б-23), отложенные (Б-25), теги (Б-26), попапы (Б-28) | после К-3 | 4 | ≈ 27 | `topbar.ts` — у одного (меню ⋮ + плашки); `pinnedMessage.tsx`, `topbarSearch.tsx`, `chat/audio.tsx` — отдельные агенты; врезка в `chat.ts`/`topbar.ts` по очереди |
| **П-6** композер и прочее | запись (Б-30), send-as (Б-31), меню отправки (Б-32), тултип (Б-33), автокомплит (Б-34), эмодзи-дропдаун (Б-35), клавиатура бота (Б-36), медленный режим (Б-37), правка медиа (Б-38), PiP (Б-12), `chatTips` (Б-13); медиаредактор, вьювер историй — волна 4 | после К-4 | 4 | ≈ 32 | дропдаун — один агент целиком (`emoticonsDropdown/**`); запись — `chat/recording/*`; автокомплит + тултип — `autocomplete*`, `markupTooltip.ts`; остальное — четвёртый; врезка в `input.ts` по очереди |

Строки Б-14, Б-16, Б-17 ждут бэкенда или вне волны. Их порт не планируется, пока нет предмета.

---

## 6. Острова React по шагам

| После | React-корни |
|---|---|
| К-1 | `#root` (`main.tsx` → `App.tsx`: центр, оверлеи, хуки), остров строки «Архив» снят вместе с архивом |
| К-2 | остров инстанса чата (`reactChatInstance.ts`, `ВРЕМЕННО до К-3`), `#react-overlays`, острова волны 4 |
| К-3 | остров композера внутри `Chat` (`reactChatInput.ts`, `ВРЕМЕННО до К-4`), вкладка №0 справа (`reactProfileTab.ts`, до К-5), `#react-overlays`, волна 4 |
| К-4 | вкладка №0 справа, `#react-overlays`, волна 4 |
| К-5 | `#react-overlays`, волна 4 |

---

## 7. Что нужно решить пользователю

| № | Вопрос | Рекомендация |
|---|---|---|
| **Р-1** | В К-1 класс `AppSidebarLeft` создаётся из layout-эффекта `App.tsx` над статичной разметкой колонки: это «класс внутри React» до К-2, а правило 2 его запрещает. Он уже написан в 2-1. Варианты: **А** — принять как исключение на один шаг (снимается К-2 через ~3 дня); **Б** — слить К-1 и К-2 в один шаг | **А**: 2-1 почти готов, а слияние делает К-2 вдвое больше при одной вехе P0 |
| **Р-2** | Вложения в К-4 открывают наш React `SendMediaPopup` через `popupStore` (остров оверлеев): класс → React-попап. Варианты: **А** — допустить до порта `popups/newMedia.tsx` (2328, отдельная пачка); **Б** — убрать вложения в бэклог, отправка только текстом | **А**: вложение фото — часть P0 («отправка»), а попап живёт в уже разрешённом острове |
| **Р-3** | 0б-3 и 0б-6 в работе открывают Solid-вкладки из React-`GroupEditFlow`. Варианты: **А** — долить как есть, в К-5 их откроет `AppEditChatTab`; **Б** — остановить и ждать К-5 | **А**: порт вкладок — родной код, меняется только вызывающий |

---

## 8. Ссылки на справочник

- Разбор tweb по старым задачам 4-1…4-7 (адреса `index.ts`, `bootstrapIm`, `appImManager` по
  блокам, подписки `construct`) — в истории этой ветки, коммит `3e12342c`
  (`2026-10-02-wave-7-stage-4-entry-appimmanager.md`, удалён). Его содержание перенесено в К-2.
- Карта `appImManager.ts` по блокам A–M и члены `Chat`, к которым обращается класс, — план
  программы, этап 4 (`2026-09-30-wave-7-shell-sidebars.md`).
- Карта `input.ts` — там же, этап 7. `chat.ts`/`topbar.ts` — этап 6.
- Архитектура tweb — `docs/tweb/app-architecture.md`.
