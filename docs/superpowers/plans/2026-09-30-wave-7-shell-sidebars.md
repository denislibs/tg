# Волна 7: точка входа, обе колонки, `appImManager`, композер и `Chat` на архитектуре tweb — план программы

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ: `superpowers:subagent-driven-development` (или
> `superpowers:executing-plans`). Шаги помечены чекбоксами (`- [ ]`). Перед каждой задачей —
> скилл `tweb-parity` (`.claude/skills/tweb-parity/SKILL.md`): док → исходник tweb → код.

**Цель.** Каркас клиента приводится к структуре tweb `812502980`. Три колонки статично лежат в
`index.html`, `src/index.ts` делает bootstrap → `mountAuthFlow` или `bootstrapIm`. Левая колонка —
класс `AppSidebarLeft extends SidebarSlider`, правая — синглтон `AppSidebarRight` с Solid-вкладками.
Центральный владелец — класс `AppImManager` 1:1 с tweb: стек чатов, колонки, хэш, правая колонка,
подписки. Внутри чата — классы `ChatInput` (композер) и `Chat` + `ChatTopbar`, как у оригинала.
React-корень `main.tsx`/`App.tsx`, `Sidebar.tsx`, `UserInfoPanel.tsx`, `ChatsContainer.tsx`,
`Chat.tsx`, `Composer.tsx` и хуки шелла **удаляются**.

**Архитектура.** Программа идёт от листьев к корню, чтобы ни на одном шаге не понадобился обратный
мост (React внутри Solid). Сначала React-экраны обеих колонок становятся Solid-вкладками (этапы 0а,
0б). Затем строка и список диалогов переходят на классы и Solid tweb (этап 1), после них — оболочки
колонок (этапы 2, 3), точка входа и ядро `AppImManager` (этап 4), его подсистемы (этап 5), класс
`Chat` с шапкой (этап 6) и композер `ChatInput` (этап 7). До этапа 6 центр — React-остров на каждый
инстанс чата. `AppImManager` держит его через временный фасад `ChatFacade` (Э4-3). На этапе 6 фасад
заменяется классом `Chat`, а `AppImManager` при этом не меняется. С этапа 6 до этапа 7 `Chat`
держит React-остров композера за временным фасадом `ChatInputFacade` (Э6), на этапе 7 его сменяет
`new ChatInput(…)` (tweb `chat.ts:618`).

**Стек.** TypeScript strict, Solid (`solid-js` 1.9.x стоковый, `*.solid.tsx` + прагма), классы tweb
(`SidebarSlider`, `SliderSuperTab`, `scaffoldSolidJSTab`), vitest + happy-dom, Playwright-стенд
(`docs/testing/e2e-scenarios.md`, ветка `origin/docs/e2e-scenarios-plan`).

**Оригинал:** `/Users/denisurevic/Documents/tweb`, коммит **`812502980`**. Все адреса ниже — по
нему. «Старая база» — `e52b5d931` в `/Users/denisurevic/Documents/tweb-e52b5d931`
(`appImManager.ts`: 3383 → 3991, +608). Наш код — `web-client/src/`, срез `e5d7f44e` (2026-09-30).

**Место в программе.** Спека `docs/superpowers/specs/2026-08-28-solid-migration-design.md` § 8 —
волна 7. Решением пользователя от 2026-09-30 в неё **вливаются волна 6 (композер) и часть волны 8
(класс `Chat`)**. За волной 8 остаются сторы `chatsStore`/`appState` на Solid, React-острова вне
каркаса (вьювер историй, медиаредактор, эмодзи-дропдаун, если его не забрал этап 6, звонки,
вебапп) и снос React из зависимостей (см. «Что остаётся волне 8»). Спека § 8 обновлена в этом же PR.

**Детальность.** Этапы 0а–3 расписаны по задачам с файлами, шагами, тестами и мутациями. Этапы 4–7
расписаны крупнее. **Детальный план каждого из этапов 4, 5, 6, 7 пишется отдельным файлом
`docs/superpowers/plans/<дата>-wave-7-stage-<N>-*.md` перед стартом этапа**, как спека § 8 делает
для волны 3: внутренности `appImManager`, `input.ts` и `chat.ts` вскроются только при переносе.

---

## Решения пользователя (обязательные, не пересматриваются)

1. **Точка входа — не React, как в tweb.** Три колонки статично в `index.html` (tweb
   `index.html:89-112`), `src/index.ts` делает bootstrap → `mountAuthFlow` или `bootstrapIm`
   (tweb `src/index.ts:613-672`, `pages/bootstrapIm.ts:21-70`).
2. **Левая колонка — `AppSidebarLeft extends SidebarSlider`** (tweb `sidebarLeft/index.ts:118`).
   **Правая — единственный класс `AppSidebarRight`** (tweb `sidebarRight/index.ts:16-138`,
   синглтон `:141`) с вкладками `SliderSuperTab`/Solid.
3. **`AppImManager` переносится ПОЛНОСТЬЮ** (tweb `lib/appImManager.ts`, 3991 строка), а не
   «lite». Всё, что у tweb живёт в нём, переходит в него, а дублирующие React-хуки шелла
   удаляются. Обращения к инстансу `Chat` до этапа 7 идут через явный временный фасад с номером
   задачи.
4. **Класс `Chat` переносится в этой программе** (tweb `chat/chat.ts` 1690 + `chat/topbar.ts` 1873).
5. **Композер переносится в этой программе отдельным этапом** (tweb `chat/input.ts` 5718) — это
   волна 6 спеки.
6. **1:1 с tweb.** Расхождения приводятся к tweb (DoD 2a). Подгонки клиента допускаются только
   временно и с номером задачи у строки. Мёртвый код удаляется.
7. **Без стековых PR.** Каждая задача — отдельный PR от `main`, порядок задаёт этот план.

## Поправки к постановке (проверены в коде)

1. **`client/bootstrap.ts` — только транспорт** (92 строки: `startClient` `:22-38`, `attachLock`
   `:64-92`). Холодный старт — `client/boot.ts` (307, `bootstrap()` `:100`). Его импортирует
   `main.tsx:6`. Порт tweb `index.ts` строится поверх `boot.ts`.
2. **`popupStore.openPopup` возвращает id (`number`), а не ReactNode** (`stores/popupStore.ts:68`).
   ReactNode возвращает переданная render-функция. Реальных вызовов 26 в 7 файлах, из них 20 — в
   `core/hooks/useChatPopups.tsx`.
3. **Колонок в `index.html` нет вовсе** (`web-client/index.html`, 63 строки: `#root` `:56`,
   `#stories-viewer` `:60`). `#main-columns` и `#column-center` рисует `App.tsx:209`, `:184`,
   `#column-left` — `Sidebar.tsx:368`, `#column-right` — портал `UserInfoPanel.tsx:627`/`:637`.
   Порталы в `#main-columns` делают также `RightSearchTab.tsx:133` и `FoldersSidebar.tsx:240`.
4. **Колоночного слайдера у левой колонки ещё нет.** `.sidebar-slider` в `Sidebar.tsx:389` —
   только разметка. Вкладки идут через отдельный хост `createSettingsSliderHost`
   (`Sidebar.tsx:175`, `sidebarLeft/settingsSliderHost.ts:171`). Перенос на колоночный слайдер —
   задача **2D-28** (не сделана, `SettingsView.tsx` 391 и `SettingsSubScreen.tsx` 44 на месте).
   Адреса в тексте 2D-28 устарели: `Sidebar.tsx:350` → `:389`, `:228` → `:370`/`:245`.
   **Снято задачей 2D-28** (PR feat/2d-28-settings-root-tab): колоночный слайдер —
   `sidebarLeft/columnSlider.ts` (`SidebarSlider` на `#column-left`, `'left'`, вкладка №0 —
   `.item-main`, `item-secondary` у вкладок). React-колонка открывает вкладку
   `getColumnSlider().createTab(AppXxxTab).open(…)` (ВРЕМЕННО до 2-1 — роль синглтона
   `appSidebarLeft`), изнутри вкладки — `tab.slider.createTab(…)`; `has-open-tabs` колонка
   пишет по `onTabsCountChange` слайдера. Хоста `settingsSliderHost.ts` больше нет.
5. **`has-open-tabs` пишет только `Sidebar.tsx`**, двумя путями: className `:370` и
   `setOpenTabsLeftSidebar` `:245` (объявлен в `core/dom/updateColumnWidths.ts:139`).
6. **`is-right-column-shown` в JS пишет только счётчик** `core/hooks/useRightColumnShown.ts:17-30`.
   Его потребители — `UserInfoPanel.tsx:63` и `rightSidebar/RightSearchTab.tsx:86`. У tweb
   класс ставит `AppSidebarRight.toggleSidebar` (`sidebarRight/index.ts:128`), а снимает `hide`
   (`:96`).
7. **Правого `SidebarSlider` нет.** `new SidebarSlider` создаётся ровно один раз —
   `settingsSliderHost.ts:171`. В нашем `solidJsTabs/tabs.ts` (477, 38 вкладок против 87 у tweb)
   нет ни одной вкладки `sidebarRight`.
8. **`useNavLayer` — 10 потребителей** (`core/hooks/useNavLayer.ts:21`). Единственный с типом
   `'right'` — `UserInfoPanel.tsx:55`. С типом `'left'` — `ContactsView:41`, `CallsView:83`,
   `SettingsView:123-124`, `WalletView:40`. Сам `appNavigationController` уже портирован
   (`core/navigation/appNavigationController.ts`, 614; нет `reload`/`close`/`focus`/`navigateToUrl`,
   `:54`). Часть `appImManager` про записи `im`/`chat` и хэш живёт в `core/navigation/chatHistory.ts`
   (478, план `2026-09-03-chat-navigation-im.md`), и на этапе 4 она уходит в класс.
9. **Deep links у tweb — не в `appImManager`**, а в `lib/internalLinkProcessor.ts` (1661).
   `AppImManager` его только инициализирует (`:326`) и зовёт для share (`:1043`). У нас порта нет:
   `useDeepLinks.ts` (160) и `overrideAddress` в контроллере (`:365-370`).
10. **Сообществ (communities) на бэкенде нет** (grep по `backend/internal` пуст). У tweb это
    `autonomousDialogList/communityDialogs.ts` (844), `createCommunityDialogElement.ts` (49),
    `forumTab/communityChats.tsx`, коммиты 2d2f188e1 и b9d75a088. **Монофорума и direct messages
    нет** (`domain/mtsaveddialog.go:55`, `mtchat.go:296`). **Форумы есть** (миграции `0031`, `0047`,
    `0058`, ручки `router.go:209-221`). **Сохранённые диалоги есть** (`/saved/dialogs` `:174`), своей
    таблицы у них нет. Отсюда граница этапа 1 — см. задачи 1-6, 1-7 и «Отложено».
11. **Бэкенд правой колонки есть почти весь** (`router.go`): статистика `:379-380` (канал и
    супергруппа, только админы), ссылки `:341-346`, заявки `:348-350`, реакции `:324`, обсуждение
    `:361-364`, тип/права/история/звёзды `:322-325`, баны `:327-329`, ограничения `:330-332`, админы
    `:335-336`, участники `:317`, `:333-334`, бусты `:235-236`, контакты `:435-443`. Нет ручки
    проголосовавших в опросе (`pollResults`) — вне волны (О-7).
12. **`appDialogsManager.start()` — фактический конструктор каркаса у tweb**
    (`lib/appDialogsManager.ts:847-998`): `DialogsContextMenu` `:850`, ряд папок `:919-947`,
    `appSidebarLeft.construct` `:983`, `appSidebarRight.construct` `:984`, контроллеры звонков
    `:985-987`, `appImManager.construct` `:988`, `ConnectionStatusComponent` `:990`. Его зовёт
    `bootstrapIm.ts:51`. Наш `lib/appDialogsManager.ts` (686) — пока только срез папок (`FolderList`
    `:202`, `start` `:318`).
13. **Синглтоны tweb создаются при импорте** (`appImManager.ts:3989`, `sidebarRight/index.ts:141`)
    и берут узлы из `index.html`. Пока колонки рисует React (этапы 0–3), конструкторы классов
    вызываются из `useLayoutEffect` React-хоста **после** монтирования узла. С этапа 4 — при
    импорте, как у оригинала.

## Ключевой шов — кто владеет узлом на каждом этапе

| Узел | сейчас | после 0а/0б | после 1 | после 2 | после 3 | после 4 | после 6 | после 7 |
|---|---|---|---|---|---|---|---|---|
| `#column-left` | React `Sidebar.tsx` | React + вкладки на колоночном слайдере (2D-28) | React-хост, список — класс `appDialogsManager` | **`AppSidebarLeft`** (узел пока из React-разметки `App.tsx`) | = | узел из `index.html` | = | = |
| `#column-right` | портал `UserInfoPanel` | **`AppSidebarRight`** (0б-0), вкладка №0 — React-панель | = | = | вкладка `AppSharedMediaTab` (Solid) | узел из `index.html` | = | = |
| `#column-center` | React `App.tsx` + `ChatsContainer` | = | = | = | = | **`AppImManager.chatsContainer`**, инстанс = `ChatFacade` + React-остров | **класс `Chat`**, композер — React-остров за `ChatInputFacade` | `Chat` + **класс `ChatInput`** |
| корень | `main.tsx` → `App.tsx` | = | = | = | = | **`src/index.ts`**; React — только острова | = | = |

**Правило «листья раньше родителей»** (из 2D). Solid-вкладка не открывает React-экран, обратного
моста нет и не заводится (спека § 6). Поэтому родитель переезжает, только когда все его дети уже
вкладки. Порядок этапов выстроен по нему: сначала экраны (0а, 0б), потом строки и списки (1), потом
оболочки (2, 3), потом корень (4).

**React-острова, которые переживают этап 4** (и почему):

| Остров | Хост | Почему остаётся | Кто снимает |
|---|---|---|---|
| Инстанс чата (`Chat.tsx` целиком) | `ChatFacade.container` (`.chat.tabs-tab`), свой `createRoot` на инстанс (мост `shared/react/mountReact.tsx`, Э4-3) | класс `Chat` — этап 6 | Э6 |
| Композер (`Composer.tsx` + `composer/*`) | с Э6 — `ChatInputFacade.container` внутри `Chat.container`, тот же мост | класс `ChatInput` — этап 7 | Э7 |
| Глобальные оверлеи (`GroupCallScreen`, `LivestreamScreen`, `CallOverlay`, `WebAppModal`) + `PopupHost` | `#react-overlays` в `body`, один `createRoot` | звонки и вебапп — отдельные подсистемы tweb (`groupCallsController`, `callsController`, `webApp.tsx`), их порта нет ни в одной волне; React-попапы уходят с 2C (пакеты B, C) | программы звонков и вебаппа, 2C, волна 8 |
| `StoryViewer`, `MediaEditor` | свои хосты | волна 4 спеки | волна 4 |
| `EmojiDropdown` | внутри острова композера | волна 5 спеки; связка с `ChatInput` двусторонняя (см. этап 7) | Э7 при ответе «А» на вопрос В-2, иначе волна 5 |

`FolderInvitePopup` и `ReportPopup` из `GlobalOverlays` уходят раньше — задачами **2C-21** и
**2C-27**. Тост вступления и QR-подтверждение (`GlobalOverlays.tsx:51-63`, `:90-114`) переходят на
`toastNew` и `confirmationPopup` в задаче Э4-7.

## Мосты чтения, пока сторы не переехали (паттерн программы)

`chatsStore` (58 импортёров без тестов) и `appState` (13) по спеке § 5 уезжают последними (волна 8).
Классы и Solid этой программы читают их через **готовые мосты**, вторую копию факта не заводят:

1. **Solid/класс читает Zustand** — `helpers/solid/subscribeExternal.ts` (31):
   `subscribeExternal(subscribe, getSnapshot) → Accessor`, с `onCleanup(unsubscribe)`. Образцы:
   `stores/peers.solid.ts:64` (`usePeer`/`useChat`/`useUser` `:83-91`), `stores/fullPeers.solid.ts:230`
   (`useFullPeer` `:260`), `peerProfile.solid.tsx:742-748` (presence),
   `sidebarRight/savedDialogsTab.solid.tsx:83` (`meId`), `stores/appSettings.solid.ts:199`
   (`useSettingsStore`). Снимок без подписки — `useChatsStore.getState().x`: только в обработчике
   события, не в рендере.
2. **Класс читает зеркало синхронно** — `cachedPeer`/`cachedChat` (`core/peerCache.ts`), как
   `peerProfileAvatars.ts:191`, `:593`, `:842`. Сеть — `this.managers.*`.
3. **Класс пишет** только экшеном стора-владельца (`useChatsStore.getState().setX`). Своего поля с
   тем же фактом у класса нет — это правило «Владение фактами» из `web-client/CLAUDE.md`.
4. **React-остров читает класс** (обратное направление, этапы 4–7) — `useSyncExternalStore` поверх
   события `EventListenerBase` класса и геттера. Пример: `AppImManager` диспатчит
   `peer_changed`/`chat_changing`/`tab_changing` (tweb `appImManager.ts:252-258`), а `AppSidebarRight` —
   `right_sidebar_toggle` (`sidebarRight/index.ts:101`, `:136`). Хелпер — `core/hooks/useClassEvent.ts`
   (заводится в 0б-0, первом потребителе), один на программу. Ручные подписки в
   `useEffect` не пишутся.
5. **Сторы, которые уходят со своим экраном** (спека § 5), удаляются в той же задаче, что и экран:
   `chatStackStore` (10 импортёров) и `navigationStore` (9) — в Э4-3, их факт становится
   `AppImManager.chats[]`/`selectTab`. `popupStore` (9) уходит с 2C и оверлеями. `foldersStore` (16),
   `notifyStore` (11) и `secretChatStore` (5) остаются, их читают через п. 1.

## Global Constraints

- **Источник порта — файл tweb `812502980`, а не наш React** (спека § 6a). Наши компоненты —
  только список сценариев. Каждый сценарий, которого нет у tweb, либо обосновывается комментарием
  у строки с номером «Отступления», либо удаляется. В постановках не писать «сохрани текущее
  поведение» (память `port-anchor-tweb-not-react`).
- **Definition of Done — спека § 9, все 14 пунктов.** Особо: п. 3–4 (мутация прогнана ФАКТИЧЕСКИ,
  реальный вывод vitest — в теле коммита), п. 5 (владелец снимает то, что создал; пин «после
  `destroy()` в DOM нет узлов»), п. 10 (стенд, числа «было/стало» в коммите), п. 14 (старый
  React-файл удалён в том же PR, число `.tsx` с `from 'react'` уменьшилось; на `e5d7f44e` их
  **171** без тестов).
- **DoD 2a.** Чего нет на бэкенде, то сначала делается на бэкенде (отдельный PR `backend/`), а клиент
  остаётся дословным. Если бэкенд не входит в волну — пункт «Отложено» с номером (О-n) и
  комментарий у строки `// О-n волна 7`.
- **Временные мосты — только с номером.** `ChatFacade`, React-остров инстанса, хост вкладки №0,
  вызовы классов из React-хоста. Шапка файла и строка вызова несут `// ВРЕМЕННО до Э<N>-<k>`.
  Задача, которая мост снимает, проверяет `git grep -n "ВРЕМЕННО до Э<N>-<k>"` → пусто.
- **Имена и места — как у tweb.** `components/sidebarLeft/index.ts`, `components/sidebarRight/index.ts`,
  `components/sidebarRight/tabs/<имя>.solid.tsx`, `lib/appImManager.ts`, `lib/appDialogsManager.ts`,
  `components/chat/{chat,topbar,input}.ts`, `src/index.ts`, `src/pages/bootstrapIm.ts`. JSX — `.solid.tsx`
  с прагмой `/** @jsxImportSource solid-js */` (маска `shared/solid/fileRuntime.ts:12`), импортов
  `react` нет (скан `shared/solid/boundary.test.ts:87-94`).
- **Вкладка = `scaffoldSolidJSTab`** в `solidJsTabs/tabs.ts` (как tweb `solidJsTabs/tabs.ts`, адреса
  вкладок правой колонки `:455-723`, `:1012`). Своих оболочек экрана (шапка, скроллер, переход) нет.
- **Виртуальный список диалогов не переизобретается** (`docs/tweb/roadmap.md:241`). Ядро
  портируется файлом с tweb, а «Отступления» спек `docs/superpowers/specs/2026-08-1[23]-*`
  читаются до правки и либо сохраняются с номером, либо снимаются с причиной в коммите.
- **Zustand не заменяет `rootScope`** — это осознанное расхождение (`roadmap.md`, «Что в план НЕ
  входит»). Подписки `AppImManager.construct` на `rootScope` (tweb `:494-628`) портируются на наши
  типизированные операции воркера (`client/realtimeBridge.ts` → `realtime/storeProjection`). Второй
  шины не заводится.
- **Врезка — последовательно, порт — параллельно.** Порт пишется в новых файлах и может идти
  параллельно с соседями. Врезка (правки `solidJsTabs/tabs.ts`, `Sidebar.tsx`, `UserInfoPanel.tsx`,
  `Chat.tsx`, `App.tsx`, `lang.ts`/`dict.*`, `styles/tweb/_index.scss`, удаление старого файла) —
  последний коммит задачи, по одной за раз, после ребейза на свежий `main`.
- **Никакого `git add -A` и `git stash`.** Только явные пути: рядом работают другие агенты
  (память `no-git-add-all-while-agents-run`).
- **vitest — только из `web-client/`** (`cd web-client && npx vitest run …`). Перед каждым коммитом
  полный прогон, `npx tsc --noEmit`, `npx oxlint --type-aware`. `realtimeBridge` флакает ~1 из 10:
  перепроверять изолированно, это не регрессия.
- **Строки langpack — ключами tweb** (план `2026-08-30-i18n-langpack.md`): нового ключа нет в
  `web-client/src/lang.ts` — он берётся из tweb `src/lang.ts` дословно, переводы — в
  `src/i18n/dict.*.ts`.
- **Комментарии и коммиты — по-русски**, объясняют ПОЧЕМУ. Шапка порта — `порт tweb/src/…:строки`,
  расхождения — нумерованным списком в шапке.
- **Каждая задача обновляет «у нас»** в своём референсе в том же PR: `docs/tweb/left-sidebar.md`,
  `right-sidebar.md`, `state-and-layout.md` § 5, § 6, § 9, `folders-tabs.md`, `composer.md`,
  `chat-feed.md`.
- **Стенд** — `msgrverify` на `:38080`/`:38443` (память `messenger-verify-stack`). Во встроенном
  браузере — `?noSharedWorker=1`, в Chrome — DevTools MCP.
- **E2E-сторожа на каждом шаге стенда** (`e2e-scenarios.md:9-28`): ошибка в консоли, ответ 4xx/5xx,
  `NaN`/`undefined`/`null` в адресе запроса, вечный лоадер, необработанный reject в воркере.

## Порядок этапов и зависимости

```
                      2D-28 (корень настроек на колоночном слайдере)  2C-5 ✅ (оболочка попапов)
                         │                                              │
ЭТАП 0а  экраны левой колонки → вкладки (зависят от 2D-28)              │
  0а-1 контакты (+ «новый личный чат»)  0а-2 новая группа  0а-3 новый канал  0а-4 звонки  0а-5 снос SidebarScreens
ЭТАП 0б  правая колонка: класс + вкладки
  0б-0 AppSidebarRight + вкладка №0 (React-панель) ──► 0б-1 … 0б-11 (порт параллельно, врезка по очереди)
      0б-1 editChat  0б-2 chatType  0б-3 ссылки  0б-4 реакции  0б-5 обсуждение  0б-6 права группы
      0б-7 админы/участники/удалённые/заявки/права участника  0б-8 добавление участников
      0б-9 статистика  0б-10 editContact  0б-11 поиск стикеров и GIF
ЭТАП 1   строка и список диалогов (параллельно с 0а/0б; файлы не пересекаются)
  1-1 DialogElement полный ──► 1-2 dialogsContextMenu
  1-3 deferredSortedVirtualList.solid ──► 1-4 sortedDialogList + autonomousDialogList (снос React-списка)
  1-5 архив: archiveDialog + AppArchivedTab (1-4, 2D-28)   1-6 форум: forumTopics + форум-таб (1-4)
  1-7 savedDialogs (1-4)
  1-8 ядро appDialogsManager: клик, активность, плейсхолдеры, верхние плашки (1-4)
ЭТАП 2   AppSidebarLeft (0а, 1)
  2-1 класс на колоночном слайдере ──► 2-2 бургер  2-3 поиск  2-4 #new-menu  2-5 баннеры
      2-6 истории  2-7 foldersSidebarContent  2-8 кнопки шапки ──► 2-9 снос Sidebar.tsx
ЭТАП 3   AppSidebarRight целиком (0б)
  3-1 AppSharedMediaTab (Solid) вместо UserInfoPanel ──► 3-2 API для центра, is-right-column-shown, Back/Esc
ЭТАП 4   точка входа + ядро AppImManager (2, 3) — детальный план отдельным файлом
  4-1 index.html + src/index.ts + bootstrapIm ──► 4-2 AppImManager: каркас, selectTab, колонки
      ──► 4-3 стек чатов + ChatFacade ──► 4-4 хэш-роутинг  4-5 фон/тема/позиции  4-6 подписки construct
      ──► 4-7 снос main.tsx/App.tsx, остров оверлеев
ЭТАП 5   подсистемы AppImManager (4) — детальный план отдельным файлом; задачи параллельно
  5-1 хоткеи/копирование  5-2 drag&drop/вставка  5-3 статус/typing  5-4 internalLinkProcessor
  5-5 звонки (фасад)  5-6 боты/вебапп/url-auth (фасад)  5-7 истории/подарки/эмодзи-клик
ЭТАП 6   Chat + ChatTopbar (4, 5-3) — детальный план отдельным файлом; снос ChatFacade,
         композер — React-остров за ChatInputFacade
ЭТАП 7   ChatInput (+ EmoticonsDropdown при «А» на В-2) (6) — детальный план отдельным файлом;
         снос ChatInputFacade и React-композера
```

**Почему этот порядок, а не «оболочки сразу».** `AppSidebarLeft` открывает вкладки контактов,
новой группы, канала, звонков и архива (tweb `sidebarLeft/index.ts:1066-1111`, `:1760`). Архив-вкладку
можно положить на колоночный слайдер 2D-28 ещё до класса, поэтому она в этапе 1 (задача 1-5). Если класс
придёт раньше экранов, ему пришлось бы открывать React (обратный мост), поэтому 0а идёт первым. То же
справа: `sharedMedia.tsx:674-702` открывает `editChat`/`editContact`, значит, 0б предшествует 3-1.
Точка входа (4) требует, чтобы ни одна колонка не рисовалась React-ом, поэтому она после 2 и 3.

**Почему `Chat` раньше композера (этап 6 → этап 7).** У tweb `Chat` сам создаёт `ChatInput`
(`chat.ts:618`). При любом порядке один временный фасад неизбежен. Сравнение по коду:

| | А. Композер первым | **Б (выбран). `Chat` первым** |
|---|---|---|
| Временный фасад | `ChatFacade` должен отдать всё, что читает `ChatInput`: **~60 членов**. Это `peerId` (64 обращения), `type` (44), `threadId` (23), `canSend()` (21), флаги `isBroadcast`/`isBot`/`isAnyGroup`/`isForum`/`isMonoforum`/`noInput`/`isStartButtonNeeded`/`isUserBlocked`/…, `getMessageSendingParams`, `getAutoDeletePeriod`, `bubbles.*` (8 членов), `topbar.onJoinClick`, `selection.isSelecting`, `appImManager.*` (input.ts `:462`–`:5531`) | `ChatInputFacade` поверх React-композера отдаёт то, что зовут `Chat` и соседи. Это конструирование, `finishPeerChange`, `clearHelper`, `clearInput`, `cleanup`, `destroy` (`chat.ts:618-648`, `:702`, `:850`, `:876`, `:1010`, `:1223`), поля отправки (`:1383-1396`, `:1599`) и внешний API `chat.input.*`: `messageInput`, `editMessage`, `initMessageReply`, `getChatInputReplyToFromMessage`, `onMessageSent`, `canSendPlain`, `setUnreadCount`, `scheduleSending`, `paidMessageInterceptor` — **~25 членов**. У нас они уже есть как React-клей: 39 обращений `onComposer*` в `Chat.tsx`, `ChatFeedApi` в `VanillaFeed.tsx:54-78` |
| Флаги и права чата | фасаду пришлось бы считать их самому, то есть повторить `chat.ts:893-1012` (`onChangePeer`). Это вторая копия факта | их считает настоящий `Chat` (`onChangePeer`) |
| Мост | класс `ChatInput` внутри React-острова (`useImperativeIsland`) | React-остров композера внутри класса. Мост тот же — `mountReact`, уже заведённый в Э4-3 для острова чата; нового не появляется |
| Против чего идёт порт | `ChatInput` (5718 строк) портируется против фасада | `Chat` портируется против настоящих `ChatBubbles`, `ChatContextMenu`, `ChatSelection` — у нас это уже классы. Фасад остаётся только у композера, и он уже существует как клей |
| Итог этапа 7 | — | `new ChatInput(this, appImManager, managers, 'chat-input-main')` в `Chat.init` — ровно tweb `chat.ts:618`, `:632`, `:635` |

Решает первая строка: фасад Б в два с половиной раза уже и не вычисляет флаги чата. При порядке А
`ChatInput` портировался бы против самодельной копии `onChangePeer`, и расхождения этой копии
перешли бы в порт.

## Оценка объёма (дни одного исполнителя; порт + тесты + стенд + ревью)

| Этап | Задачи | Строк tweb | Дней |
|---|---|---|---|
| 0а | 0а-1…0а-5 | ~1 100 | **8** |
| 0б | 0б-0…0б-11 | ~7 900 | **30** |
| 1 | 1-1…1-8 | ~4 900 (из `appDialogsManager` 3066, списки ~2 400) | **25** |
| 2 | 2-1…2-9 | ~2 900 (из `sidebarLeft/index.ts` 1817, поиск, истории, папки) | **19** |
| 3 | 3-1…3-2 | ~1 200 | **7** |
| 4 | 4-1…4-7 | ~2 300 (`index.ts` 675, `bootstrapIm` 70, ядро `appImManager` ~1 550) | **22** |
| 5 | 5-1…5-7 | ~4 100 (`appImManager` ~2 400, `internalLinkProcessor` 1661) | **22** |
| 6 | `Chat` + `ChatTopbar` (+ `topbarSearch.tsx`, `pinnedMessage`, плашки, `ChatAudio`) | ~6 500 (`chat.ts` 1690, `topbar.ts` 1873, `topbarSearch.tsx` 1352, `pinnedMessage.tsx` 841 + 204, плашки ~1 000 из ~2 000; уточняется) | **40** |
| 7 | `ChatInput`, запись, хелперы | ~11 000 (`input.ts` 5718, `chatRecording.ts` 1312 + голос/видео ~1 400, хелперы ~1 200, `sendAs` 418, `markupTooltip` 582, `inputField` 904, `richInputHandler` 900, `markdown` 549; уточняется) | **45** |
| 7+ | `EmoticonsDropdown` (при «А» на В-2) | 4 315 (`emoticonsDropdown/**`) | **+18** |
| **Итого** | | | **≈ 218** (≈ 236 с `EmoticonsDropdown`) |

С параллелизмом (порт в новых файлах; этап 1 идёт параллельно с 0а/0б, этап 5 — параллельно
внутри) календарно ≈ 130–150 дней при двух исполнителях. Критический путь:
2D-28 → 0а → 2 → 4 → 6 → 7. Оценки этапов 6 и 7 уточняются их детальными планами. Если детальный
план даст расхождение больше 25 %, это выносится пользователю до старта.

---

## E2E-сценарии — ворота этапов

Каталог — `docs/testing/e2e-scenarios.md` (ветка `origin/docs/e2e-scenarios-plan`, 267 строк; план
прогона — `docs/superpowers/plans/2026-09-27-e2e-scenarios-tweb.md`). Пока Playwright-набор не
влит, сценарий прогоняется на стенде вручную по тексту каталога, со сторожами, и результат
записывается в PR. **До** — на `main` перед стартом задачи, **после** — на ветке задачи. Регресс
по сравнению с «до» блокирует мерж.

| Этап | P0 (обязательно зелёные до и после) | P1 (прогон, регресс блокирует) |
|---|---|---|
| 0а | GR-01 (создание группы), CH-01 (создание канала), SE-01 (человек без диалога — через «новый личный чат») | LS-10 (контакты), LS-12 (бургер) |
| 0б | RS-06 (участники, админы, права), GR-05 (добавить участника), GR-09 (смена названия/описания/фото) | RS-07, RS-08 (редактирование из правой колонки), GR-06, GR-07, GR-08, GR-10, CH-15, CH-17; CH-18 (P2, статистика) |
| 1 | LS-01, LS-02, DM-01, DM-06, DM-07, DM-15, DM-16, P0-03 | LS-03, LS-04, LS-05, LS-09 (P2), GR-15 (P2, форум) |
| 2 | LS-01, SE-01, P0-02 | LS-05, LS-06, LS-11 (P2), LS-12, SE-02, SE-03, AUTH-08 (кнопка замка) |
| 3 | RS-01, RS-06 | RS-02, RS-03, RS-04, RS-05, RS-07, RS-08, RS-09, GR-16, CH-17 |
| 4 | AUTH-01, AUTH-02, AUTH-12, P0-01…P0-10 целиком | AUTH-08, AUTH-10, AUTH-11, CH-02 (подписка по ссылке), GR-10 |
| 5 | P0-01…P0-10 | ME-10 (Esc во вьювере), SE-05, GR-10, LS-08 (P2, ссылка на папку) |
| 6, 7 | P0-01…P0-10, DM-*, RE-01, RE-05, RE-07, ME-01, CH-03, CH-05, CH-06 | весь раздел 2–4 каталога |

**Пробел каталога.** Отдельных сценариев на навигацию (Back/Esc/хэш) и на диплинки в каталоге нет
(`e2e-scenarios.md`, разделы 0–12). Задача 3-2 добавляет в каталог (PR в его ветку или, после
влития, в `main`) сценарии **NAV-01…NAV-06** и прогоняет их, начиная с этапа 3:

- **NAV-01** — открыть чат → Back браузера → список, хэш пуст; Forward → чат (tweb
  `appImManager.ts:3137-3198`, запись `im`).
- **NAV-02** — тред комментариев поверх чата → Esc закрывает тред, второй Esc — чат (записи `chat`,
  `:2766-2805`, `:3252`).
- **NAV-03** — открыть профиль → вкладка «Изменить» → Esc/Back закрывают по одному уровню, третий —
  колонку (`'right'`, `sidebarRight/index.ts:86-92`, `:94-102`).
- **NAV-04** — настройки → подэкран → Back дважды → чатлист (`'left'`, слайдер).
- **NAV-05** — F5 на `#@username` и на `#<peerId>` открывает тот же чат (`onHashChange`, `:1912-2032`).
- **NAV-06** — диплинки `/join/<token>`, `/addlist/<slug>`, `?domain=&start=` (`useDeepLinks.ts`
  сейчас, `internalLinkProcessor` после 5-4).

---

## Этап 0а — оставшиеся React-экраны левой колонки → Solid-вкладки

**Сверка с 2C/2D (не дублируется).** Экраны `SidebarScreens.tsx:22-24` по состоянию `e5d7f44e`:

| Экран (`SidebarScreen`) | React сейчас | Кто покрывает | tweb |
|---|---|---|---|
| `settings` | `SettingsView.tsx` 391 + `SettingsSubScreen.tsx` 44 | **2D-28** (не сделана), 2D-15/20/21/22/23/26/27 (открыты). **Снято**: все восемь влиты; последний React-экран настроек («Конфиденциальность») и обратный мост `sidebarLeft/reactScreenTab.tsx` (`scaffoldReactScreenTab`) снесены задачей 2D-23 — в настройках только Solid-вкладки колоночного слайдера | `tabs/settings.tsx` 451 |
| `wallet` | `stars/WalletView.tsx` 115 | **2C-19** (попап звёзд). Вкладки у tweb нет (`popups/stars.tsx`), экран уходит вместе с попапом | — |
| `contacts` | `ContactsView.tsx` 141 | **0а-1** (2C-26 — только попап «новый контакт», врезка `ContactsView.tsx:113`) | `tabs/contacts.tsx` 109 |
| `newPrivate` | `NewPrivateChat.tsx` 119 | **0а-1**: у tweb «новый личный чат» = `AppContactsTab` (`sidebarLeft/index.ts:1079-1083`, `:1105-1109`) | — |
| `newSecret` | `NewPrivateChat.tsx` (режим) | **0а-1**, Отступление В7-1 (секретных чатов у tweb нет) | — |
| `newGroup` | `NewGroupFlow.tsx` 221 | **0а-2** (2D-16 ✅ дал `AppAddMembersTab`, 2D-30 — только `AvatarCropper` внутри) | `tabs/newGroup.tsx` 270 + `addMembers.tsx` 167 + `createNewGroupTab.ts` 13 |
| `newChannel` | `NewChannelFlow.tsx` 69 | **0а-3** | `tabs/newChannel.tsx` 108 |
| `calls` | `CallsView.tsx` 134 | **0а-4** | `tabs/calls.tsx` 439 + `newCall.tsx` 182 |

Архив (`Sidebar.tsx:135`, `:474-497`, `ArchiveList` `:581-638`) и форум (`useForumPanel` →
`TopicsPanel.tsx`) экранами `SidebarScreens` не являются. Они — задачи 1-5 и 1-6.

**Общее для задач 0а.** Врезка — через колоночный слайдер 2D-28: React-колонка открывает вкладку
`slider.createTab(AppXxxTab).open()` тонким мостом, а пункт `SidebarScreens` и React-экран удаляются
в том же PR. **Зависимость всех задач 0а — 2D-28** (без колоночного слайдера вкладку не на что
положить). Порт можно писать параллельно с 2D-28; врезка идёт после неё.

### Задача 0а-1: «Контакты» — `AppContactsTab`; «новый личный чат» и «новый секретный чат»

**Порт:** tweb `sidebarLeft/tabs/contacts.tsx` (109) → `sidebarLeft/tabs/contacts.solid.tsx`,
регистрация `solidJsTabs/tabs.ts` как tweb `:209-222` (`AppContactsTabOptions`, `noSame = true`).
Список — `sortedUserList.ts` (уже есть, потребитель `dialogRow.ts`), поиск — `InputSearch`
(`components/inputSearch.ts`, 123). Кнопка «добавить контакт» — `showCreateContactPopup` (**2C-26**;
до неё — вызов React-попапа функцией, `// ВРЕМЕННО до 2C-26`).

**Отступление В7-1.** «Новый секретный чат» — наш продукт (E2E), у tweb пары нет. Пункт меню
передаёт вкладке опцию `{secret: true}`: клик по контакту открывает секретный чат вместо обычного.
Одна строка в `onClick` с комментарием `// Отступление В7-1`. Отдельного экрана нет.

**Файлы:**
- Создать: `web-client/src/components/sidebarLeft/tabs/contacts.solid.tsx`, `contacts.solid.test.tsx`
- Изменить: `components/solidJsTabs/tabs.ts`, `components/Sidebar.tsx` (пункты меню → `createTab`),
  `components/MainMenu.tsx` / `ComposeMenu.tsx` (точки входа — до 2-2/2-4)
- Удалить: `components/ContactsView.tsx` (+ `.module.scss`, `ContactsView.test.tsx`),
  `components/NewPrivateChat.tsx` (+ scss, тест), ветки `contacts`/`newPrivate`/`newSecret` в
  `SidebarScreens.tsx`, вызов `useNavLayer` `ContactsView:41`

- [ ] **Шаг 1: прочитать** tweb `contacts.tsx`, `solidJsTabs/tabs.ts:209-222`, `sidebarLeft/index.ts:1065-1111`,
  наш `ContactsView.tsx`, `NewPrivateChat.tsx` (только список сценариев), `sortedUserList.ts`.
- [ ] **Шаг 2: падающие тесты** (`contacts.solid.test.tsx`, реальная вкладка через колоночный
  слайдер): (а) `open()` → `.tabs-tab.contacts-container` (класс по tweb) с `InputSearch` в шапке и
  списком `ul.chatlist`; (б) ввод в поиск фильтрует строки по имени/username; (в) клик по строке
  открывает чат пира (стаб `openPeer` из `core/navigation/openPeer.ts`) и закрывает вкладку; (г) с
  `{secret: true}` клик зовёт создание секретного чата (стаб менеджера), а не `openPeer`;
  (д) повторный `createTab(AppContactsTab)` при открытой вкладке не создаёт вторую (`noSame`);
  (е) после закрытия и 250 мс в DOM нет `.contacts-container` — пин шва.
- [ ] **Шаг 3: убедиться, что падают.** **Мутации (фактически):** снять `noSame` → (д) краснеет;
  убрать `dispose` на `onCloseAfterTimeout` → (е) краснеет.
- [ ] **Шаг 4: реализовать** дословно; расхождения — в шапку.
- [ ] **Шаг 5: врезка** (последний коммит): пункты «Контакты», «Новый личный чат», «Новый
  секретный чат» открывают вкладку; React-экраны и ветки `SidebarScreens` удалены.
- [ ] **Шаг 6: стенд:** LS-10, SE-01 (через «новый личный чат»); Esc/Back закрывают вкладку одним
  шагом (NAV-04 для этой вкладки); числа перехода (250 мс, `translate3d`) — в коммит.

**Готово когда:** `git grep -n "ContactsView\|NewPrivateChat" web-client/src` пуст; `dom-parity`
вкладки против дампа контактов (если есть в `docs/tweb/dom/dumps/`, иначе — снять эталонную разметку
из tweb-исходника и записать в `docs/tweb/left-sidebar.md`); P0 GR-01/CH-01 не задеты.
**Оценка:** 1,5 дня. **Зависимости:** 2D-28.

### Задача 0а-2: «Новая группа» — `createNewGroupTab` → `AppAddMembersTab` → `AppNewGroupTab`

**Порт:** tweb `tabs/createNewGroupTab.ts` (13): сначала `AppAddMembersTab` (у нас есть,
`sidebarLeft/tabs/addMembers.solid.tsx` 120, 2D-16), потом `tabs/newGroup.tsx` (270) →
`sidebarLeft/tabs/newGroup.solid.tsx`. Аватар — `AvatarEdit` (2D-27; до неё `// ВРЕМЕННО до 2D-27`
через текущий `AvatarCropper` функцией). Создание — `managers.chats.createChat` (наш провод; сверить
сигнатуру и ответ с `appChatsManager.createChat` tweb, расхождение провода — в бэкенд, DoD 2a).

**Файлы:**
- Создать: `sidebarLeft/tabs/newGroup.solid.tsx`, `sidebarLeft/tabs/createNewGroupTab.ts`, тесты
- Изменить: `solidJsTabs/tabs.ts`, точки входа меню
- Удалить: `components/NewGroupFlow.tsx` (+ `.module.scss`), ветку `newGroup` `SidebarScreens.tsx`

- [ ] **Шаг 1: прочитать** tweb `newGroup.tsx`, `createNewGroupTab.ts`, `addMembers.tsx`, наш
  `addMembers.solid.tsx`, `NewGroupFlow.tsx` (сценарии: TTL? тема? — только список).
- [ ] **Шаг 2: падающие тесты:** (а) «Новая группа» → первая вкладка — выбор участников, «далее»
  открывает `AppNewGroupTab` с выбранными (история слайдера = 2 вкладки); (б) пустое название
  блокирует кнопку создания (`btn-corner` без `is-visible`); (в) создание зовёт менеджер один раз с
  названием и участниками; после ответа — `sliceTabsUntilTab`/закрытие обеих вкладок и открытие
  нового чата; (г) Back со второй вкладки возвращает на выбор с сохранённым выбором.
- [ ] **Шаг 3: падают.** **Мутация:** закрывать только верхнюю вкладку после создания — (в)
  краснеет (выбор участников остаётся в истории).
- [ ] **Шаг 4: реализовать; шаг 5: врезка; шаг 6: стенд** — GR-01 (P0) до и после, числа.

**Готово когда:** `git grep -n "NewGroupFlow" web-client/src` пуст; GR-01 зелёный; служебное
«создал(а) группу» приходит у всех трёх аккаунтов. **Оценка:** 2 дня. **Зависимости:** 2D-28
(2D-27 — не блокирует, мост помечен).

### Задача 0а-3: «Новый канал» — `AppNewChannelTab`

**Порт:** tweb `tabs/newChannel.tsx` (108) → `sidebarLeft/tabs/newChannel.solid.tsx`, регистрация как
tweb `solidJsTabs/tabs.ts:262-270`. После создания — `AppAddMembersTab` (как tweb, `newChannel.tsx`),
затем открытие канала. Аватар — как в 0а-2.

**Файлы:** создать `sidebarLeft/tabs/newChannel.solid.tsx` + тест; изменить `solidJsTabs/tabs.ts`;
удалить `components/NewChannelFlow.tsx` (+ scss), ветку `newChannel`.

- [x] **Шаг 1–3:** прочитать; тесты: (а) название обязательно; (б) описание уходит в запрос;
  (в) после создания открывается выбор подписчиков, «пропустить» открывает канал; (г) владелец
  снимает остров. **Мутация:** не передавать описание — (б) краснеет.
- [x] **Шаг 4–6:** реализация, врезка, стенд — CH-01 (P0).

**Готово когда:** `git grep -n "NewChannelFlow" web-client/src` пуст; CH-01 зелёный.
**Оценка:** 1 день. **Зависимости:** 2D-28.

### Задача 0а-4: «Звонки» — `AppCallsTab` (+ `newCall`)

**Порт:** tweb `tabs/calls.tsx` (439) и `newCall.tsx` (182) → `sidebarLeft/tabs/calls.solid.tsx`,
`newCall.solid.tsx`. Регистрация — как tweb `solidJsTabs/tabs.ts:225-230` (`noSame`). Данные — наш
`core/hooks/useCallsLog.ts` → перенос логики в вкладку (Solid-ресурс поверх `managers.calls`).
Хук удаляется, если у него не остаётся потребителей. Конференц-звонки (`ConferenceCall.New`,
`sidebarLeft/index.ts:1097-1104`, `IS_CONFERENCE_CALL_SUPPORTED`) — только если есть на бэкенде.
Проверить `backend/internal/adapter/delivery/http/router.go` на конференции; нет — О-1.

**Файлы:** создать `sidebarLeft/tabs/calls.solid.tsx`, `newCall.solid.tsx`, тесты; изменить
`solidJsTabs/tabs.ts`; удалить `components/CallsView.tsx` (+ scss), `useNavLayer` `CallsView:83`,
ветку `calls`.

- [x] **Шаг 1–3:** тесты: (а) журнал рисует строки с направлением/пропущенным (классы tweb);
  (б) клик по строке звонит (стаб `callUser` — до 5-5 это наш звонковый вызов, `// ВРЕМЕННО до 5-5`);
  (в) «новый звонок» открывает выбор контакта. **Мутация:** перепутать входящий/исходящий — (а) краснеет.
  *Сделано:* (в) снят — у tweb `newCall.tsx` целиком конференция, строка «Начать новый звонок»
  под `IS_CONFERENCE_CALL_SUPPORTED` (`calls.tsx:421`); конференций на бэкенде нет → О-1,
  `newCall.solid.tsx` не создаётся.
- [x] **Шаг 4–6:** реализация, врезка (пункт бургера «Звонки» → `AppCallsTab`), стенд (CA-01 — P2).

**Оценка:** 2,5 дня. **Зависимости:** 2D-28.

### Задача 0а-5: снос `SidebarScreens.tsx`

**Предусловия:** 0а-1…0а-4, 2D-28 (`settings`), 2C-19 (`wallet`). **Удалить:** `SidebarScreens.tsx`,
состояние экрана в `Sidebar.tsx:133`, открытия `:348-359`, `:510-513`, `:522`; `useNavLayer` в
`WalletView:40`/`SettingsView:123-124` уходит вместе с экранами. `somethingOpenInside`
(`Sidebar.tsx:201`) теряет слагаемое `screen`.
**Тест:** `Sidebar.chatlist.test.tsx`/`Sidebar.foldersMode.test.tsx` — зелёные без правок; новый пин
«`has-open-tabs` пишет один писатель» (он появился в 2D-28) — зелёный.
**Готово когда:** `git grep -n "SidebarScreen" web-client/src` пуст; `useNavLayer` с `'left'` —
0 вызовов. **Оценка:** 1 день. *Сделано в PR задачи 0а-4:* `wallet` к этому моменту снесла 2-2,
последним экраном были «Звонки».

**Риски этапа 0а.** (1) 2D-28 ещё не влита — весь этап ждёт её; порт пишется заранее, врезка после.
(2) Потеря сценариев React-экранов (TTL группы, тема канала): перед удалением сверить их список с
tweb. Чего нет у tweb — удалить, и написать об этом в PR. (3) `AvatarEdit` (2D-27) и `showCreateContactPopup`
(2C-26) могут отстать — мосты помечены, снимаются своими задачами.

---

## Этап 0б — правая колонка: класс `AppSidebarRight` и подэкраны → Solid-вкладки

**Откуда задачи.** 2D-30 отдала групповые экраны и прочие вкладки правой колонки «отдельной волне
правой колонки» (решение пользователя 2026-09-26, план 2D `:1216-1227`). Эта волна — здесь.
Предусловие 2D-31 (снос `settings/kit.tsx`) выполняется, когда 0б опустошит импортёров кита вне
настроек: `group/**` (11), `userInfo/RightsEditor.tsx`, `EditContactView.tsx`. Остальных
(`stars/*`, `Premium*`, `QrModal`, `EmojiStatusPicker`, `folders/FolderInvitePopup`) снимает 2C.

**Шов этапа.** Вкладке нужен слайдер, а слайдер — это класс колонки. Поэтому этап начинается с
**0б-0**: настоящий `AppSidebarRight` на статичном узле `#column-right`, а React-панель
`UserInfoPanel` становится содержимым вкладки №0. Это прямой аналог 2D-28 для левой колонки
(`.item-main` у React, вкладки у слайдера). React-панель открывает подэкраны тонким мостом
`appSidebarRight.createTab(AppXxxTab).open(…)` — так же, как tweb `sharedMedia.tsx:674-702`. На
этапе 3 вкладку №0 займёт Solid `AppSharedMediaTab`, и мост исчезнет.

**Чем заменяется общий React UI.** `settings/kit.tsx` (`SettingsScreen` `:39`, `Section` `:237`,
`EntryRow` `:267`, `Row` `:355`) → вкладка `scaffoldSolidJSTab` + `Section`
(`components/section.solid.tsx`, 182) + `Row` (`components/rowTsx.solid.tsx`, 578). Всё это на HEAD
после 2D-0/2D-1. `shared/ui` в Solid-вкладках не используется, у tweb на каждый его компонент есть
своя пара:

| `shared/ui` (React) | Solid/класс tweb у нас |
|---|---|
| `Input` | `inputFieldTsx.solid.tsx` / `inputField.ts` |
| `IconButton`, `Button` | `buttonTsx.solid.tsx`, `buttonIcon.ts` |
| `Avatar` | `avatar.ts` (`avatarNew` — Э6) |
| `Checkbox`, `Slider` | `checkboxFieldTsx.solid.tsx`, `rangeSelectorTsx.solid.tsx` (2D-2) |
| `PeerSelector` | `appSelectPeers.solid.tsx` (2D-16) |
| `Spinner`, `Preloader` | `putPreloader.ts`, `preloader.ts` |
| `Text`, `dateNodes`, `peerStatus` | `i18n`-узлы, `helpers/date.ts`, `getUserStatusString` — порт по месту |
| `SidebarSection` | `section.solid.tsx` (снос — 2D-31) |

**Правило «листья раньше родителей» внутри 0б.** `editChat` открывает `chatType`, ссылки,
реакции, обсуждение, права, админов, участников и удалённых (tweb `editChat.tsx`). Поэтому 0б-1 —
**последняя** врезка этапа. Порт 0б-1 можно писать параллельно, но в React-`GroupEditFlow`
(`group/GroupEditFlow.tsx:119-127`, роутинг `sub === …`) дочерние экраны заменяются вкладками по
одному: React-родитель открывает Solid-ребёнка мостом.

### Задача 0б-0: `AppSidebarRight` — класс, статичный `#column-right`, вкладка №0 под React-панель

**Порт:** tweb `sidebarRight/index.ts` (143) → `components/sidebarRight/index.ts`, дословно:
`RIGHT_COLUMN_ACTIVE_CLASSNAME` `:14`, конструктор `:20-28` (`canHideFirst: true`,
`navigationType: 'right'`, `inert`), `construct` `:30-41` (`changeScreen` → `toggleSidebar(false)`,
`installColumnWidthsUpdater`, `installColumnResize` — у нас `core/dom/installColumnResize.ts`),
`createSharedMediaTab` `:43-48`, `replaceSharedMediaTab` `:50-84`, `onCloseTab` `:86-92`, `hide`
`:94-102`, `toggleSidebar` `:104-138`, синглтон `:141-143`.

**Временное (с номерами):**
- `#column-right.tabs-tab.sidebar.sidebar-right.main-column[role=complementary] >
  .sidebar-content.sidebar-slider.tabs-container` (tweb `index.html:110-112`) рисует статично
  `App.tsx` в `#main-columns`, а не портал `UserInfoPanel.tsx:627`/`:831`. Конструктор синглтона
  зовётся из `useLayoutEffect` шелла после монтирования узла — `// ВРЕМЕННО до Э4-1` (поправка 13).
- «Вкладка общих медиа» до этапа 3 — `AppReactProfileTab` (`sliderTab.ts` `SliderSuperTab` с
  хост-`div`), в который **активный** инстанс чата порталит свою `UserInfoPanel` —
  `// ВРЕМЕННО до 3-1`. `createSharedMediaTab` возвращает её; `replaceSharedMediaTab` вызывает
  `Chat.tsx` при становлении инстанса активным (порт смысла `chat.ts:1239-1242`) — `// ВРЕМЕННО до Э6`.
- `toggleSidebar` `:125` зовёт `appImManager.selectTab(…)`. Класса до Э4-2 нет, поэтому строка
  зовёт существующий мобильный переход (`core/navigation/chatHistory.ts`, та же функция, что сейчас
  переключает `is-left-column-shown`) — `// ВРЕМЕННО до Э4-2`.
- `is-right-column-shown` пишет **только класс** (`:96`, `:128`). `useRightColumnShown` из счётчика
  превращается в тонкий мост `open ? toggleSidebar(true) : toggleSidebar(false)` для двух оставшихся
  потребителей (`UserInfoPanel:63`, `RightSearchTab:86`) — `// ВРЕМЕННО до 0б-11` и `3-2`.
- Запись навигации `'right'` ставит слайдер (`pushNavigationItem`, `:130-132`). `useNavLayer(…,'right')`
  в `UserInfoPanel:55` снимается в этой же задаче (второй писатель той же записи).
  `useTransitionSlider` (`UserInfoPanel:625`) и оверлеи `.sidebar-slider` внутри панели
  (`GroupEditFlow :797`, `AddMembersScreen :802`, `ChannelStats :811`, `RightsEditor :820`) живут до
  своих задач 0б-1…0б-9.

**Файлы:**
- Создать: `web-client/src/components/sidebarRight/index.ts`, `sidebarRight/index.test.ts`,
  `sidebarRight/reactProfileTab.ts` (временная вкладка №0)
- Изменить: `App.tsx` (статичный `#column-right`, вызов `construct`), `UserInfoPanel.tsx` (портал в
  хост вкладки, снять `useNavLayer`/`installColumnResize` — их делает класс), `useRightColumnShown.ts`
  (мост), `Chat.tsx` (открытие/закрытие через `appSidebarRight.toggleSidebar`, а не свой `infoOpen`
  `:363`: состояние открытия — у класса, React читает его через новый `core/hooks/useClassEvent.ts`
  по `right_sidebar_toggle`, tweb `:101`, `:136`)
- Тесты: `sidebarRight/index.test.ts`; правка `Chat.infoPanelMount.test.ts`,
  `useRightColumnShown.test.ts`, `UserInfoPanel.shell.test.ts`

- [x] **Шаг 1: прочитать** tweb `sidebarRight/index.ts`, `slider.ts:1-140` (наш `components/slider.ts`
  398 — сверить `canHideFirst` `:28`, `:46`, `:83`), `docs/tweb/right-sidebar.md` §1–§2, наш
  `UserInfoPanel.tsx:40-120`, `:620-660`, `Chat.tsx:360-370`, `:1005-1015`, `:1490-1505`.
- [x] **Шаг 2: падающие тесты** (`sidebarRight/index.test.ts`, реальный DOM happy-dom, реальный
  `appNavigationController`): (а) `toggleSidebar(true)` → `body.is-right-column-shown`,
  `sidebarEl.inert === false`, в стеке навигации одна запись `'right'`; (б) повторный
  `toggleSidebar(true)` — no-op (записей по-прежнему одна); (в) `toggleSidebar(false)` →
  класс снят, `inert`, записи нет, событие `right_sidebar_toggle(false)`; (г) Esc при открытой
  колонке закрывает её (через контроллер, не свой обработчик); (д) `replaceSharedMediaTab(b)` при
  активной `a` — `b.container` на месте `a` и с `active`, `a.container` не в DOM; (е)
  `replaceSharedMediaTab(undefined)` без предыдущей — не бросает (tweb `:78-80`); (ж) `changeScreen`
  `large → medium` закрывает колонку; (з) `onCloseTab` последней вкладки закрывает колонку.
  Интеграционно (`Chat.infoPanelMount.test.ts`): клик по шапке открывает колонку, в DOM ровно один
  `#column-right`.
- [x] **Шаг 3: убедиться, что падают.** **Мутации (фактически):** убрать проверку
  `findItemByType('right')` `:130` → (б) краснеет (две записи); убрать ветку `else if(tab)` `:78` →
  (е) краснеет; оставить старый счётчик писателем параллельно → скан «один писатель
  `is-right-column-shown`» (новый, `sidebarRight/index.test.ts`: `git grep`-скан на
  `classList.*is-right-column-shown` вне `sidebarRight/index.ts`) краснеет.
- [x] **Шаг 4: реализовать** дословно; шапка — `порт tweb/src/components/sidebarRight/index.ts:1-143`,
  расхождения нумерованным списком (все временные строки выше).
- [x] **Шаг 5: стенд:** RS-01, RS-06 до/после; профиль открывается и закрывается кликом, Esc,
  Back (NAV-03 в объёме одного уровня); ширина колонки тянется (resize-хэндл); на `medium` колонка
  закрывается при сужении. Числа: время выезда (`_rightSidebar.scss` transition), `inert`.

**Готово когда:** `#column-right` в DOM ровно один и статичный; писатель `is-right-column-shown` —
только `sidebarRight/index.ts`; `useNavLayer` с `'right'` — 0 вызовов; P0 RS-01/RS-06 зелёные.
**Оценка:** 2,5 дня. **Зависимости:** нет (параллельно с 0а).

**Сделано (2026-09-30).** Отличия исполнения от постановки:
- `core/hooks/useClassEvent.ts` **не заведён**: после врезки у `right_sidebar_toggle` нет ни
  одного React-читателя — панель больше не держит `open` (видео, `inert`, навигацию, ресайз ведёт
  класс), `onOpenAfterTimeout` зовёт слайдер на вкладке №0. Хелпер заводит первый настоящий
  потребитель (мост чтения п. 4). Событие в `rootScope` объявлено (tweb `rootScope.ts:239`).
- `useOpenAfterTimeout` снесён: его роль — хук вкладки `AppReactProfileTab.onOpenAfterTimeout`.
- Срез `appImManager.selectTab` для CHAT ↔ PROFILE — `selectProfileTab` в
  `core/navigation/chatHistory.ts` (своей функции «мобильного перехода» там не было).
- Оверлеи `GroupEditFlow`/`AddMembersScreen`/`ChannelStats`/`RightsEditor` — соседи вкладки №0 в
  `.sidebar-slider` (только у активного инстанса), а не её дети: правила
  `.profile-container .sidebar-header` (`_profile.scss:625`) задели бы их шапки.
- `useRightColumnShown` — мост только для `RightSearchTab` (панель в нём больше не нуждается):
  открывает колонку классом и закрывает её, лишь если открывал сам.
- «Отложено» у задачи нет (О-50…О-54 не заняты).

### Задачи 0б-1…0б-11: вкладки правой колонки

Все вкладки следуют одной форме. Для каждой ниже указаны только отличия.

**Форма задачи (обязательна для каждой 0б-k):**
- Порт: `tweb/src/components/sidebarRight/tabs/<имя>.tsx` → `components/sidebarRight/tabs/<имя>.solid.tsx`,
  регистрация в `solidJsTabs/tabs.ts` строкой-двойником tweb `solidJsTabs/tabs.ts:<строка>`;
  открытие — `appSidebarRight.createTab(AppXxxTab).open(payload)`.
- **Шаг 1:** прочитать исходник tweb целиком, его регистрацию в tweb `tabs.ts`, `docs/tweb/channels.md`
  (права/редактирование) и `right-sidebar.md`; наш React-экран — только как список сценариев.
- **Шаг 2 — падающие тесты на результат:** классы и порядок узлов вкладки (секции, строки, подписи —
  по tweb); сетевой вызов в момент, когда его делает tweb (на сохранении/закрытии, а не на каждом
  изменении); закрытие по Esc/Back снимает Solid-корень (пин шва: через 250 мс нет узла вкладки);
  открытие дочерней вкладки кладёт её в историю слайдера (Back возвращает).
- **Шаг 3 — мутации (фактически, вывод vitest в коммит):** минимум две на вкладку — «сохранять на
  каждом изменении вместо закрытия» и «не снимать корень на `onCloseAfterTimeout`».
- **Шаг 4 — реализация** дословно; `Отложено` (О-n) — там, где нет бэкенда.
- **Шаг 5 — врезка:** React-экран удаляется в том же PR; его вызывающий (React-панель или
  React-`GroupEditFlow`) открывает вкладку мостом.
- **Шаг 6 — стенд:** сценарии из колонки «E2E» таблицы ниже, числа в коммит; `dom-parity` по
  дампам `docs/tweb/dom/dumps/15-right-*` (эталон снят со старой базы — расхождения из-за
  `812502980` объявляются, а не подгоняются).

| Задача | tweb (строк; регистрация в `tabs.ts`) | Удаляется у нас | Бэкенд | E2E | Дней |
|---|---|---|---|---|---|
| **0б-1** `AppEditChatTab` (корень редактирования) — **врезка последней** | `editChat.tsx` 980; `:723` | `group/GroupEditFlow.tsx` 274, `group/screens/shared.tsx` 48, `core/hooks/useGroupEdit.ts` 394 (+тесты) | `PATCH /chats/{id}` `:318`, фото `:320` | GR-09, RS-08 | 4 |
| **0б-2** `AppChatTypeTab` | `chatType.tsx` 416; `:536` | `group/screens/ChatTypeScreen.tsx` 119 | тип/история `:322-323` | CH-01 (публичный/частный), RS-07 | 1,5 |
| **0б-3** ссылки: `AppChatInviteLinksTab`, `AppEditChatInviteLinkTab`, `AppChatInviteLinkTab` | `chatInviteLinks.tsx` 618, `editChatInviteLink.tsx` 381, `chatInviteLink.tsx` 250, `chatInviteLinkShared.ts` 153; `:680`, `:695`, `:710` | `group/screens/InviteLinkScreens.tsx` 416 | `:341-346` | GR-10 | 3,5 |
| **0б-4** `AppChatReactionsTab` | `chatReactions.tsx` 208; `:473` | `group/screens/ReactionsScreen.tsx` 61 | `:324` | RE-05 | 1 |
| **0б-5** `AppChatDiscussionTab` | `chatDiscussion.tsx` 317; `:530` | `group/screens/DiscussionScreen.tsx` 111 | `:361-364` | CH-07 | 1,5 |
| **0б-6** `AppGroupPermissionsTab` | `groupPermissions/groupPermissions.tsx` 428, `sharedPermissions.ts` 470, `chargeForMessasgesSection.tsx` 114, `doNotRestrictBoostersSection.tsx` 98; `:645` | `group/screens/PermissionsScreen.tsx` 113 | права `:322-325`, звёзды `charge_stars`; бусты `:235` | GR-08 | 3 |
| **0б-7** админы, участники, удалённые, заявки, права участника: `AppChatAdministratorsTab`, `AppChatMembersTab`, `AppRemovedUsersTab`, `AppChatRequestsTab`, `AppUserPermissionsTab` | `chatAdministrators.tsx` 225 + `chatAdministratorsSource.ts` 85 + `administratorsSource.ts` 44 + `attachAdminRightsCaption.ts` 28; `chatMembers.tsx` 118; `removedUsers.tsx` 140 + `removedUsersSource.ts` 30 + `chatRemovedUsersSource.ts` 75; `chatRequests.tsx` 95; `chatUserPermissions.tsx` 567 + `userPermissions.tsx` 15; `:500`, `:479`, `:455`, `:467`, `:572` | `group/screens/{AdminScreens 132, MembersScreen 82, MemberScreens 168}.tsx`, `userInfo/RightsEditor.tsx` 139, оверлей `RightsEditor` в `UserInfoPanel.tsx:820` | админы `:335-336`, участники `:317`, `:333-334`, баны `:327-329`, ограничения `:330-332`, заявки `:348-350` | RS-06, GR-06, GR-07, CH-15 | 5 |
| **0б-8** добавление участников | tweb — `sidebarLeft/tabs/addMembers.tsx` (у нас `addMembers.solid.tsx`, 2D-16 ✅); открытие из профиля и `editChat` | `group/AddMembersScreen.tsx` 131, оверлей `UserInfoPanel.tsx:802` | `:333` | GR-05 | 1 |
| **0б-9** `AppStatisticsTab` | `statistics.tsx` 1156 (классовая `SliderSuperTab`, как у tweb) | `ChannelStats.tsx` 155, оверлей `UserInfoPanel.tsx:811`; `StatChart.tsx` 169 остаётся, пока его зовут `PostStats`/`StoryStats` | `/channels/{id}/stats` `:379`, пост `:380`; чего нет в `domain/stats.go:39-45` против `stats.broadcastStats` — О-2 | CH-18 (P2) | 3 |
| **0б-10** `AppEditContactTab` | `editContact.tsx` 373; `:512`; открытия tweb — `sharedMedia.tsx:685`, `topbar.ts:905-906` | `EditContactView.tsx` 176, `openEditContact` в `useChatPopups.tsx:162-163` | `/contacts` `:435-443` | RS-02 | 1,5 |
| **0б-11** поиск стикеров и GIF: `AppStickersTab`, `AppGifsTab` | `stickers.tsx` 231, `gifs.tsx` 128; `:524`, `:461`; открытие — как tweb `emoticonsDropdown/index.ts:303-308` (`isTabExists` → `createTab(…).open()`) | `rightSidebar/{RightSearchTab 135, StickersSearchTab 321, GifsSearchTab 72, StickerSetSkeleton 24}.tsx`, kind `'right-search'` в `popupStore`, потребитель `useRightColumnShown` `RightSearchTab:86` | — | RE-07 | 2,5 |

**Порядок врезок:** 0б-0 → {0б-2, 0б-3, 0б-4, 0б-5, 0б-6, 0б-7, 0б-8, 0б-9, 0б-10, 0б-11 — по
готовности, по одной} → **0б-1 последней** (после 0б-2…0б-8 `GroupEditFlow` пустеет и удаляется).

**Особые пункты:**
- **0б-7:** `useGroupInfo.ts` (220) после задачи зовёт только панель (`UserInfoPanel:131`); `RIGHTS` и
  `RealMember` (`AdminScreens:12`, `RightsEditor:22`) переезжают в `core/` (чистые данные) или в
  порт `sharedPermissions.ts` — туда, где они у tweb.
- **0б-10:** день рождения в редакторе контакта — `showBirthdayPopup` (**2C-14**); до неё
  `// ВРЕМЕННО до 2C-14` (React `BirthdayModal` функцией). Аватар — `AvatarEdit` (2D-27).
- **0б-9:** графики у tweb — `lovely-chart` (`statistics.tsx`). Если его нет в зависимостях, решение
  «взять пакет tweb» выносится в PR. Свою `StatChart` внутрь Solid-вкладки не тащить (React).
- **Не входит в 0б:** `QrModal.tsx` (**2C-17**), `components/secret/KeyVerificationPopup.tsx`
  (наш продукт, пары у tweb нет — Отступление В7-2: переводится на `PopupElement` 2C-5 в задаче
  3-1, где уходит его вызывающий), `PinnedStoriesSection.tsx` (часть `sharedMedia` — задача 3-1).

**Готово этапа 0б:** `git grep -n "settings/kit" web-client/src/components/{group,userInfo} web-client/src/components/EditContactView.tsx`
пуст (каталоги `group/` и `userInfo/` удалены целиком); `GroupEditFlow`, `AddMembersScreen`,
`ChannelStats`, `RightsEditor`, `EditContactView`, `rightSidebar/*` удалены; в `UserInfoPanel.tsx`
нет оверлеев `.sidebar-slider`, `useTransitionSlider` без потребителей и удалён.

**Риски этапа 0б.** (1) **Две модели сохранения**: наш React пишет на каждое изменение, tweb — на
закрытии/кнопке. Переход меняет видимое поведение, и это ожидаемо (6a), но пропущенный вызов на
закрытии теряет данные. Пин на сетевой вызов при закрытии обязателен. (2) `editChat` —
последняя врезка: если она задержится, React-`GroupEditFlow` живёт дольше с детьми-вкладками.
Порядок это допускает. (3) **Регресс RS-06** (прокрутка участников) — `chatMembers` у tweb
построен на `sortedUserList`/`appSearchSuper` вкладке участников; сверить с `appSearchSuper.members.test.ts`.

---

## Этап 1 — строка и список диалогов на классах и Solid tweb

**Что было и что будет.** Строку `DialogElement` уже портировала 2D-29 (`components/dialogRow.ts`
559, класс `:166`, `attachRowController` `:84`). Но это узкий порт: поиск, участники, папочные
вкладки. Главный список рисует React: `ChatList.tsx` 230 → `ChatListItem.tsx` 330, данные —
`core/hooks/useDialogListSource.ts` 399 + `useChatList.ts` 48, ядро — React
`components/virtual/{DeferredSortedVirtualList 426, VerticalVirtualList 260, useAnimatedTop 125,
useShouldAnimate 144, LoadingDialogSkeleton 70}`. У tweb то же самое — классы и Solid:
`lib/appDialogsManager.ts` (строка `:290-720`, менеджер `:764-3064`), `components/sortedDialogList.ts`
454, `components/autonomousDialogList/*`, Solid-ядро `components/deferredSortedVirtualList.tsx` 449
поверх `verticalVirtualList.tsx` 248.

**Граница с портированной программой списка (не переизобретать, `roadmap.md:241`).** Слой данных
(воркер `dialogsManager`, зеркало, `dialog_op`, пагинация, `count`) — **не трогается**. Его
«Отступления» — это расхождения провода, и они остаются объявленными:
`2026-08-12-dialogs-ownership-and-virtual-list-design.md:303` п. 1–2,
`2026-08-13-dialogs-pagination-design.md:243` п. 1–3, `2026-08-13-dialogs-count-and-refresh-design.md:110`
п. 1–3. Переносится представление — ядро виртуального списка и строка. Отступления ядра
(`2026-08-13-virtual-chatlist-design.md:222`) пересматриваются по пунктам в задаче 1-3:

| Отступление ядра | Судьба в этапе 1 |
|---|---|
| 1. shrink (`EXTRA_ITEMS_TO_KEEP`) не портирован | **портируется** — в Solid-ядре tweb он есть, а причина отступления (React-состояние) уходит |
| 2. анимация пишет в DOM мимо состояния React | **снимается**: у Solid-ядра одно владение |
| 3. класс позиционирования навешивается layout-эффектом после каждого коммита | **снимается** тем же |
| 4. скелетон первой загрузки — canvas (`chatlist/dialogsPlaceholder.ts` 425) | **остаётся**: это порт tweb `dialogsPlaceholder.ts`, не отступление — запись в спеке поправить |
| `2026-08-13-remaining-lists-design.md:79` п. 1–6 (темы форума, архивный `ul`, 72px «Избранного») | пересматриваются в 1-5, 1-6 по tweb `forumTopics.ts`/`archivedTab.tsx` |

**Мост до этапа 2.** Пока колонка React, список монтирует наш `lib/appDialogsManager.ts` (он уже
владеет контейнерами папок: `FolderList` `:202`, `start` `:318`). React-`Sidebar.tsx` зовёт его
через `useImperativeIsland` (`core/hooks/useImperativeIsland.ts:85`) — `// ВРЕМЕННО до 2-9`.

### Задача 1-1: `DialogElement` полностью + `setLastMessage`/`setUnreadMessages`

**Порт:** tweb `lib/appDialogsManager.ts:133-720` (хелперы `DialogDom` `:142`,
`setPromiseMiddleware` `:193`, `disposeTextHighlight` `:209`, `DialogElementOptions` `:244`,
`BadgeState` `:266`, класс `:290-720`: `setMuted` `:508`, `create{Pinned,Sortable,Unread,UnreadAvatar,
Mentions,Reactions,PollVotes}Badge` `:533-578`, `setBadgeState` `:586`, `toggleBadgeByKey` `:692`)
и методы менеджера, которые пишут в строку: `setLastMessage` `:2382-2677`, `setUnreadMessages`
`:2678-2824`, `getDialog` `:2825`, `initDialog` `:2931`, `addDialogNew` `:3007`, `setDialogActiveStatus`
`:1281-1318`. Включить запаркованные коммиты дельты: **0af53a342** (сигнатура входов подзаголовка —
без перерисовки неизменной строки; `setBadgeState` без перехода при неизменном состоянии;
`docs/tweb/delta/part-2.md:51`, `:89`, `:114`) и **b2df09771** (перекраска частиц bluff-спойлера
при активации, `part-3.md:15`). **Место — как у tweb:** `class DialogElement` переезжает из
`components/dialogRow.ts` в `lib/appDialogsManager.ts`. Импортёры (`sortedUserList.ts`,
`appSelectPeers.solid.tsx`, `globalSearch.ts`, `appSearchSuper.ts`) переводятся, `dialogRow.ts`
удаляется, пин `rowTsxSafeMigrations` переименовывается под новый путь.

**Файлы:**
- Изменить: `web-client/src/lib/appDialogsManager.ts`, импортёры `DialogElement`
- Удалить: `components/dialogRow.ts` (тест `dialogRow.test.ts` → `lib/appDialogsManager.dialogElement.test.ts`)
- Доки: `docs/tweb/left-sidebar.md` (чатлист, «у нас»), `docs/tweb/delta/part-2.md:51`, `part-3.md:15` (статус → DONE)

- [x] **Шаг 1: прочитать** tweb `appDialogsManager.ts:133-720`, `:1281-1318`, `:2382-3024`,
  `git -C /Users/denisurevic/Documents/tweb show 0af53a342 b2df09771`, наш `dialogRow.ts`,
  `ChatListItem.tsx` (сценарии: бейджи, «Избранное», 777000 — PR #329/#330, секретный замок,
  черновик, typing).
- [x] **Шаг 2: падающие тесты** (`lib/appDialogsManager.dialogElement.test.ts`): (а) непрочитанное
  → `.dialog-subtitle-badge-unread` с числом; mute → класс `is-muted` у бейджа; (б) закреп —
  `.dialog-subtitle-badge-pinned`, при непрочитанном закреп скрыт (порядок `setBadgeState`);
  (в) упоминание/реакция → свои бейджи, порядок узлов как tweb; (г) **0af53a342:** повторный
  `setLastMessage` с тем же сообщением не меняет `.dialog-subtitle` (тот же узел,
  `MutationObserver` без записей); (д) повторный `setBadgeState` с тем же состоянием не ставит
  класс перехода; (е) ~~**b2df09771:** `setDialogActiveStatus(true)` перекрашивает частицы спойлера
  (цвет берётся из `getTextColor(true)`)~~ — **не пинится: О-74** (до 4184843ff перекрашивать нечего); (ж) «Избранное» и «Telegram» — как в пинах PR #330;
  (з) `destroy()` снимает Solid-корень строки (`attachRowController` → `dispose`).
- [x] **Шаг 3: падают.** **Мутации:** убрать сравнение сигнатуры → (г) краснеет; всегда ставить
  переход → (д) краснеет.
- [x] **Шаг 4: реализовать** дословно; расхождения провода (превью у нас из зеркала, не из
  `historyStorage`) — в шапку с номером Отступления В7-3.
- [x] **Шаг 5:** полные прогоны поиска (`globalSearch.test.ts`), участников (`appSearchSuper.members.test.ts`),
  выбора (`appSelectPeers.solid.test.tsx`) — зелёные.

**Готово когда:** `git grep -n "components/dialogRow" web-client/src` пуст; `DialogElement` в
`lib/appDialogsManager.ts` с адресами tweb в шапке. **Оценка:** 4 дня. **Зависимости:** нет.

### Задача 1-2: `DialogsContextMenu` — контекст-меню диалога классом

**Порт:** tweb `components/dialogsContextMenu.ts` (702, класс `:64`) → `components/dialogsContextMenu.ts`;
создаётся в `appDialogsManager.start`, как tweb `:850`. Меню — `ButtonMenu` + `contextMenuController`
+ `positionMenu` (уже есть: `buttonMenu.ts`, `helpers/contextMenuController.ts`, `helpers/positionMenu.ts`),
пункты — `verify`-списком tweb. Попапы — `confirmationPopup`, `showMutePopup`, `showDeleteDialogPopup`:
если 2C-6/2C-7 ещё не влиты, зовётся текущий vanilla-`popupPeer.ts` (**`// ВРЕМЕННО до 2C-6`**).
**Удаляется** React-меню строки `ChatListItem.tsx:85` (`MW=220, MH=320` — захардкоженные габариты,
`roadmap.md` этап 2) — вместе с `ChatListItem` в 1-4. До 1-4 меню вешается на React-строку через
`data-peer-id` (tweb ищет строку `findUpClassName`, так же).

- [ ] **Шаги:** прочитать; тесты — (а) ПКМ по строке → `.btn-menu.contextmenu` с пунктами для
  лички/группы/канала/«Избранного» ровно по `verify` tweb; (б) «Закрепить» зовёт менеджер и не
  закрывает меню раньше ответа (как tweb); (в) «Архивировать» переносит диалог (стаб); (г) Esc
  закрывает меню (запись `'menu'`); (д) позиция считается по фактическому размеру меню (пин:
  подменить `getBoundingClientRect` меню — флип меняется). **Мутация:** захардкодить размер →
  (д) краснеет. Стенд — LS-03, LS-04, LS-05, LS-09.

**Оценка:** 2,5 дня. **Зависимости:** 1-1 (строка), 2C-6/7 — мягкая.

### Задача 1-3: Solid-ядро — `deferredSortedVirtualList.solid.tsx` поверх `verticalVirtualList.solid.tsx`

**Порт:** tweb `components/verticalVirtualList.tsx` (248) — довести наш
`components/verticalVirtualList.solid.tsx` (217; потребитель — `sidebarRight/savedDialogsTab.solid.tsx`)
до HEAD; tweb `components/deferredSortedVirtualList.tsx` (449) →
`components/deferredSortedVirtualList.solid.tsx`, включая reveal пачкой **108d3f301**
(`delta/part-2.md:89`, `:114`) и shrink `EXTRA_ITEMS_TO_KEEP`. React-ядро `components/virtual/*` пока
**не** удаляется: его ещё держат React-потребители (`ChatList`, `ArchiveList`, `TopicsPanel`).
Удаление — в последней задаче, которая снимает потребителя (1-6).

- [x] **Шаг 1:** прочитать tweb оба файла, наши `virtual/*` и все пять спек 2026-08-1[23]-* (разделы
  «Отступления»).
- [x] **Шаг 2: тесты — перенос пинов React-ядра на Solid** (сценарии те же, форма новая, спека § 5 «тесты-предохранители
  переписываются, а не удаляются»): `useAnimatedTop.test.ts` (167), `useShouldAnimate.test.ts` (290),
  `LoadingDialogSkeleton.test.tsx` (125) → `deferredSortedVirtualList.solid.test.tsx`: вставка сверху
  не сдвигает видимую строку; перестановка анимирует `top` только видимых; reveal пачкой — одна
  запись в DOM на пачку; shrink снимает строки за `EXTRA_ITEMS_TO_KEEP`.
- [x] **Шаг 3: мутации:** убрать shrink → пин shrink краснеет; анимировать невидимые → пин
  анимации краснеет.
- [x] **Шаг 4:** реализовать; спеку `2026-08-13-virtual-chatlist-design.md` § «Отступления»
  поправить по таблице выше в том же PR.

**Оценка:** 3 дня. **Зависимости:** нет.

**Сделано** (ветка `feat/w7-1-3-deferred-sorted-virtual-list`). `verticalVirtualList.solid.tsx` уже был
на HEAD 812502980 (сверено построчно, правок нет). Новое: `components/deferredSortedVirtualList.solid.tsx`
(порт файлом, с 108d3f301, 2b00c4dae `onItemDiscard`, ee6f7f9c2 `onItemMount`),
`components/loadingDialogSkeleton.solid.tsx`; SCSS скелетона переехал на место tweb
(`components/loadingDialogSkeleton.module.scss`), React-копия `virtual/LoadingDialogSkeleton.tsx` берёт
его оттуда до своего сноса. Пины: `deferredSortedVirtualList.solid.test.tsx` (35: тесты tweb discard и
reveal, дырки/скелетоны, `requestItemForIdx`, закреплённые, reveal пачкой, снятие с очереди, `clear`,
shrink, анимация переезда, `blockAnimation`, `onItemMount`/`onItemUnmount`),
`verticalVirtualList.solid.test.tsx` (9: границы `useShouldAnimate` с React-носителя),
`loadingDialogSkeleton.solid.test.tsx` (8). Мутации — 17, все красные (тело коммита). Отложенного
(О-75…О-79) нет. **API для 1-4** — как у tweb `sortedDialogList.ts:64-141`: `createDeferredSortedVirtualList({
scrollable, getItemElement, onItemMount, onItemUnmount, onItemDiscard, onListShrinked, requestItemForIdx,
sortWith, itemSize, noAvatar, onListLengthChange, extraPaddingBottom})` → `{list, dispose, setTotalCount,
sortedItems, itemsLength, addItems, addPinnedItems, ensurePinnedItems, removePinnedItem, removeItem,
updateItem, setWasAtLeastOnceFetched, blockAnimation, clear, has, get, getAll}`; `list` в скроллер кладёт
владелец.

### Задача 1-4: `SortedDialogList` + `AutonomousDialogList` вместо React-списка

**Порт:** tweb `components/sortedDialogList.ts` (454), `components/autonomousDialogList/base.ts`
(434), `dialogs.ts` (854), `constants.ts` (1) → те же пути у нас. Список папки создаёт
`appDialogsManager` на `setFilterId`, как tweb `xds[filterId]` (`:828-829`, `:1144-1158`). Источник
данных — наш воркер через текущий канал `dialog_op`: адаптер в `autonomousDialogList/dialogs.ts`
заменяет `rootScope`-подписки tweb (`dialogs_multiupdate`, `dialog_drop`, …) на наши операции.
Это объявленное расхождение (Отступление 2 спеки 2026-08-12), новой шины нет.
`useDialogListSource.test.tsx` (774) — предохранитель данных. Его сценарии переносятся на
`autonomousDialogList/dialogs.test.ts`, а не выбрасываются.

**Удалить:** `ChatList.tsx` (+ тест), `ChatListItem.tsx` (+ 4 теста, `.module.scss`),
`core/hooks/useDialogListSource.ts` (+ тест), `useChatList.ts` (+ тест), портал папок
`ChatList.tsx:80`.

- [ ] **Шаги:** прочитать; тесты — порядок по последнему сообщению и закрепу, пагинация вниз
  (стаб менеджера), вставка нового диалога сверху, удаление, смена папки не пересоздаёт строки
  другой папки (tweb держит `xds` по фильтрам), `activeElement` подсвечивается при открытом чате
  (`setDialogActive` `:1300`), `destroy` папки снимает все строки. **Мутации:** сортировать без
  закрепа → пин порядка краснеет; пересоздавать `xd` на каждый `setFilterId` → пин «строки
  переиспользуются» краснеет.
- [ ] **Стенд:** LS-01, LS-02, DM-01, DM-06, DM-07, DM-15, DM-16, P0-03 до/после; скролл 500
  диалогов — FPS и число узлов (`document.querySelectorAll('.chatlist-chat').length`) до/после в коммит.

**Оценка:** 5 дней (риск). **Зависимости:** 1-1, 1-3.

### Задача 1-5: архив — `ArchiveDialog` строкой и `AppArchivedTab` вкладкой

**Порт:** tweb `components/archiveDialog.tsx` (467; используется `appDialogsManager.ts:117`,
`autonomousDialogList/dialogs.ts:9`) и `sidebarLeft/tabs/archivedTab.tsx` (117, `FOLDER_ID_ARCHIVE`
`:19`, `AutonomousDialogList` `:24`). Вкладка открывается на колоночном слайдере (2D-28), клик по
строке архива — `openArchiveTab` (tweb `sidebarLeft/index.ts:1760-1763`). До 2-1 это
`slider.createTab(AppArchivedTab).open()` из моста — `// ВРЕМЕННО до 2-1`.
**Удалить:** `ArchiveRow.tsx` (+ scss, тест), React-оверлей архива `Sidebar.tsx:135`, `:474-497`,
`ArchiveList` `:581-638`, `Sidebar.archive.test.tsx` → перенос сценариев в `archivedTab.solid.test.tsx`.
Отступление `remaining-lists` п. 6 (архивный `ul` без классов) снимается.

- [ ] **Тесты:** строка архива показывает счётчик и превью (как tweb), скрывается при пустом архиве;
  клик открывает вкладку с тем же `AutonomousDialogList(FOLDER_ID_ARCHIVE)`; Back закрывает;
  страница `/chats?folder_id=1` уходит при открытии вкладки (память `dialogs-virtual-list-program`:
  архив был недостижим). **Мутация:** не запрашивать страницу архива → пин краснеет.
- [ ] **Стенд:** LS-05, CH-16 (P2).

**Оценка:** 2 дня. **Зависимости:** 1-4, 2D-28.

### Задача 1-6: форум — `AutonomousForumTopicList` и форум-таб

**Порт:** tweb `autonomousDialogList/forumTopics.ts` (125), `forumTab/{forumTab 177, groupForumTab 230,
register 24, fillRegister 32, findForumTabByPeerId 10}.ts`, менеджерная часть
`appDialogsManager.ts:1819-2054` (`toggleForumTab`, `transitionDrawersParent`, `hasForumOpenFor`,
`toggleForumTabByPeerId`, `forumsSlider` `.topics-slider`, запись навигации `'forum'`).
**Удалить:** `TopicsPanel.tsx` (583, + тест), `core/hooks/useForumPanel.tsx` (87), `.topics-slider`
в `Sidebar.tsx:518`, последний потребитель React-ядра → **удалить `components/virtual/*` целиком**
(с тестами, сценарии которых перенесены в 1-3).
**Не входит:** `botforumTab.ts` (148) + `botforumTopics.ts` (122) — форумов ботов на бэкенде нет
(О-3); `monoforumTab.ts` (106) + `monoforumThreads.ts` (47) — монофорума нет (О-4); сообщества —
О-5. Отступления `remaining-lists` п. 1, 4, 5 пересматриваются по tweb `forumTopics.ts`.

- [ ] **Тесты:** клик по форуму открывает таб тем поверх списка (`.topics-slider`, класс
  перехода tweb); Esc/Back закрывает (запись `'forum'`); открытие темы → `setInnerPeer` с
  `threadId`; скрытые темы — секция. **Мутация:** не снимать запись `'forum'` при закрытии → Esc
  второй раз закрывает не то (пин порядка).
- [ ] **Стенд:** GR-15 (P2), NAV-02 для темы.

**Оценка:** 4 дня. **Зависимости:** 1-3, 1-4.

### Задача 1-7: сохранённые диалоги — `AutonomousSavedDialogList` в `AppSearchSuper`

**Порт:** tweb `autonomousDialogList/savedDialogs.ts` (67); tweb зовёт его из `appSearchSuper.ts:101`,
`:441` (вкладка «Сохранённые диалоги» у «Избранного», `sharedMedia.tsx:563`, `:727`, `:803`).
**Удалить:** собственный список `sidebarRight/savedDialogsTab.solid.tsx` (191), если после порта у
него не остаётся роли. Иначе он сводится к тому, что у tweb делает `appSearchSuper`.
**Координация:** `appSearchSuper.ts` — зона программы shared media; прогнать все `appSearchSuper.*.test.ts`.

- [ ] **Тесты:** вкладка у «Избранного» рисует строки `DialogElement` с `isMainList: false`, клик —
  `setInnerPeer` (сохранённый диалог). **Мутация:** `isMainList: true` → пин классов строки краснеет.
- [ ] **Стенд:** RS-04.

**Оценка:** 1,5 дня. **Зависимости:** 1-3, 1-4.

### Задача 1-8: ядро `AppDialogsManager` — клик, активность, плейсхолдеры, верхние плашки

**Порт:** tweb `appDialogsManager.ts`: `setListClickListener` `:2072-2347` (открытие чата, Ctrl/⌘ —
новая вкладка `openDialogInNewTab` `:2055`, клик по аватару с историями `:2104`, архив `:2137`),
`setDialogActive` `:1300`, пустые плейсхолдеры `:1624-1818` (`generateEmptyPlaceholder`,
`checkIfPlaceholderNeeded`, контакты-плейсхолдер `ChatlistContacts`), `createTopNotification`/`toggleTopNotification`
`:1483-1548`, `onStateLoaded` `:1319-1396`, `onTabChange` `:1397`, `changeFiltersAllChatsKey` `:1592`.
Клик до Э4-3 зовёт `openPeer` (`core/navigation/openPeer.ts`) — `// ВРЕМЕННО до Э4-3` (там станет
`appImManager.setPeer`/`setInnerPeer`, tweb `:2094`).

- [ ] **Тесты:** пустая папка → плейсхолдер tweb (класс, текст ключом langpack); клик по строке →
  активная строка подсвечена ровно одна; Ctrl-клик не открывает чат в текущей вкладке.
  **Мутация:** не снимать `active` с прежней строки → пин «ровно одна» краснеет.
- [ ] **Стенд:** LS-01, P0-02.

**Оценка:** 3 дня. **Зависимости:** 1-4.

**Риски этапа 1.** (1) **Самый нагруженный путь клиента** — любой регресс списка виден сразу; ворота
— все P0 списка до/после плюс замер FPS/узлов. (2) Адаптер `dialog_op` → события tweb — место,
где легко завести второй источник порядка (пин `stores/noManualOrder.test.ts` должен остаться
зелёным). (3) Перенос `DialogElement` задевает программы поиска и shared media — брать, когда у них
нет открытых веток (`git log`). (4) Флакающий `realtimeBridge` — не путать с регрессом.

---

## Этап 2 — `AppSidebarLeft`: оболочка левой колонки классом

**Что заменяется.** `Sidebar.tsx` (638): `FoldersSidebar` `:374`, `SidebarMenuButton` `:404`
(→ `MainMenu.tsx` 276), `InputSearch` `:406` (React `shared/ui/InputSearch` 353 + 122),
`SidebarEmojiStatusButton` `:413`, остров `lockButton` `:330-338`, `ConnectionStatusComponent`
`:102-108`, `StoriesRow` `:419` (405, + `useSidebarStories.tsx` 103), список `:453`, баннер
`PendingSuggestion` `:466`, `#search-container` `:504`, `ComposeFab` `:508` (77, + `ComposeMenu.tsx` 59),
`has-open-tabs` `:370`/`:245`, `dialogsManager.start` `:313`. Сторы `Sidebar.tsx`: `chatsStore` `:8`,
`navigationStore` `:40`, `chatStackStore` `:41`, `popupStore` `:43`, `foldersStore` `:51`, `settings`
`:26`. Все, кроме `navigationStore`/`chatStackStore` (уходят в Э4-3), читаются мостом п. 1.

**Оригинал:** tweb `sidebarLeft/index.ts` (1817): класс `:118`, `construct` `:154-473` (`InputSearch`
`:158`, кнопка «назад» `:162`, `createToolsMenu` `:165`, бейдж уведомлений, `ButtonIcon('
sidebar-emoji-status')` `:262`, `createLockButton()` `:264`, `toggleRightButtons` `:345-361`),
`initNavigation` `:474`, `isCollapsed`/`hasFoldersSidebar`/`onCollapsedChange` `:491-517`,
`hasSomethingOpenInside`/`closeEverythingInside(Naturally)` `:518-545`, `onSomethingOpenInsideChange`
`:547-569` (`has-open-tabs` `:553`), `showCtrlFTip` `:636`, `initSidebarResize` `:651`, `onTabsCountChange`
`:652`, `createToolsMenu` `:673-905`, `createMoreSubmenu` `:916-1064`, `createNewChats*` `:1065-1136`,
`initSearch` `:1137-1691`, `watchChannelsTabVisibility` `:1692`, `closeSearch` `:1722`, `createTab`
(переопределение) `:1730-1741`, `addTab` `:1748`, `closeTabsBefore` `:1755`, `openArchiveTab` `:1760`,
`addAccount` `:1766`, синглтон `:1798`.

**Узел.** До Э4-1 `#column-left` с разметкой tweb `index.html:91-107` (`.sidebar-slider.tabs-container >
.item-main.active > .sidebar-header.main-search-sidebar-header` с `.animated-menu-icon` и
`.sidebar-back-button`, `.sidebar-content.transition.zoom-fade > #chatlist-container > #folders-container`,
`#search-container`) рисует `App.tsx` **статичной разметкой без логики**. `appSidebarLeft.construct`
зовётся из `useLayoutEffect` шелла — `// ВРЕМЕННО до Э4-1`.

### Задача 2-1: класс `AppSidebarLeft` на колоночном слайдере

**Порт:** конструктор (`navigationType: 'left'`), `construct` без кнопок шапки (они — 2-2…2-8),
`initNavigation`, `isCollapsed`/`hasFoldersSidebar`/`onCollapsedChange`, `hasSomethingOpenInside`/
`closeEverythingInside`, `onSomethingOpenInsideChange` (единственный писатель `has-open-tabs` и
`setOpenTabsLeftSidebar`), `onTabsCountChange`, `initSidebarResize` (наш `installColumnResize`),
`createTab`/`addTab`/`closeTabsBefore`/`openArchiveTab`. Колоночный слайдер 2D-28 **становится этим
классом**: хост `settingsSliderHost.ts` сводится к `appSidebarLeft` (как у tweb — хоста нет).
`ConnectionStatusComponent` создаётся в `appDialogsManager.start`, как tweb `:990`, с `appSidebarLeft.inputSearch`.
`appDialogsManager.start` зовёт `appSidebarLeft.construct` (tweb `:983`) и `onCollapsedChange` (`:996`).

**Файлы:** создать `components/sidebarLeft/index.ts`, `index.test.ts`; изменить `lib/appDialogsManager.ts`,
`App.tsx` (разметка + вызов), `Sidebar.tsx` (сжимается до того, что ещё не переехало),
`sidebarLeft/settingsSliderHost.ts` (удаляется или сводится к реэкспорту — решает задача по коду);
тесты `Sidebar.*.test.tsx` переезжают на класс по мере переноса.

- [ ] **Шаг 2: падающие тесты** (`sidebarLeft/index.test.ts`): (а) открытие любой вкладки →
  `#column-left.has-open-tabs`, закрытие последней — снят; писатель один (скан как в 0б-0);
  (б) `closeEverythingInside` закрывает вкладки и поиск, возвращает `true`, если было что закрыть;
  (в) на `medium` колонка — плавающая, `.sidebar-left-overlay` кликом закрывает; (г) `createTab`
  при свёрнутой колонке — О-27 2D (не портируется, пин на объявленное поведение); (д) Back/Esc
  закрывают верхнюю вкладку (`'left'`).
- [ ] **Мутации:** оставить React-запись `has-open-tabs` → скан краснеет; не пушить запись `'left'` →
  (д) краснеет.
- [ ] **Стенд:** LS-01, P0-02, NAV-04.

**Оценка:** 3 дня (риск). **Зависимости:** 0а-5, 1-4, 2D-28.

### Задача 2-2: бургер — `createToolsMenu` + `createMoreSubmenu`

**Порт:** `sidebarLeft/index.ts:673-905` (`ButtonMenuToggle({…})` `:772`, пункты с `verify`,
`createTab(AppSettingsTab)` `:765`, `:841`, ночной режим, «Мои звёзды», версия `getVersionLink` `:1802`,
бейдж уведомлений) и `:916-1064` (подменю «Ещё»). `ButtonMenuToggle` у нас есть (`buttonMenuToggle.ts`).
Мультиаккаунт (`addAccount` `:1766`, `saveEncryptionKeyBeforeSwitchingAccounts` `:906`) — у нас одна
сессия на браузер (`core/auth/accounts.ts:1-5`). Пункт аккаунтов портируется в объёме нашей модели
(переключение = смена токена + перезагрузка) — Отступление В7-4 со ссылкой на 2D О-1.
**Удалить:** `SidebarMenuButton.tsx` 93, `MainMenu.tsx` 276 (+ тест; потребитель `folders/FoldersSidebar.tsx:11`
переводится на ту же функцию меню — у tweb бургер в колонке папок тот же, `foldersSidebarContent`).

- [ ] **Тесты:** пункты ровно по `verify` tweb (премиум/не премиум, звёзды, «Ночной режим»);
  клик по «Настройкам» открывает `AppSettingsTab`; иконка бургера ↔ «назад» при открытой вкладке
  (`.animated-menu-icon` классы tweb). **Мутация:** инвертировать `verify` звёзд → пин краснеет.
- [ ] **Стенд:** LS-12, AUTH-12 (выход из меню).

**Оценка:** 3 дня. **Зависимости:** 2-1.

### Задача 2-3: поиск — `InputSearch` на HEAD и `initSearch` методом класса

**Порт:** tweb `components/inputSearch.ts` (261) — довести наш `components/inputSearch.ts` (123);
`initSearch` `:1137-1691` — наш `sidebarLeft/globalSearch.ts` (680) портирован по старой базе
(`:1084-1554`, шапка файла) → перенос в метод `AppSidebarLeft.initSearch` + дельта до HEAD,
`closeSearch` `:1722`, `watchChannelsTabVisibility` `:1692`, `showCtrlFTip` `:636`.
**Удалить:** `shared/ui/InputSearch/*` (353 + 122 + тест 358), если после 2-3 и 0б-11 у него нет
потребителей (`RightSearchTab` уходит в 0б-11); `useGlobalSearch.ts` — если остаётся без потребителей.

- [ ] **Тесты:** перенос `Sidebar.globalSearch.test.tsx` и `globalSearch.test.ts` на класс; Ctrl+F —
  фокус поиска; Esc закрывает поиск (запись `'global-search'`/`'global-search-focus'`).
  **Мутация:** не снимать `'global-search-focus'` на blur → Esc закрывает не тот слой.
- [ ] **Стенд:** SE-01, SE-02, SE-03, P0-02.

**Оценка:** 2,5 дня. **Зависимости:** 2-1. **Координация:** программа global search.

### Задача 2-4: `#new-menu` — кнопка «новый чат»

**Порт:** `sidebarLeft/index.ts:1065-1136` (`createNewChatsMenuOptions`: канал → `AppNewChannelTab`,
группа → `createNewGroupTab`, конференция по `IS_CONFERENCE_CALL_SUPPORTED`, личный → `AppContactsTab`;
`createNewChatsMenuButton` — `ButtonMenuToggle`, `direction: 'top-left'`, `id = 'new-menu'`, иконки
`newchat_filled`/`close`). Пункт «новый секретный чат» — Отступление В7-1.
**Удалить:** `ComposeFab.tsx`, `ComposeMenu.tsx`.

- [ ] **Тесты:** меню открывается вверх-влево, пунктов 3 (+1 секретный, +1 конференция по флагу);
  кнопка скрыта при открытой вкладке/поиске (классы tweb). **Мутация:** `direction` → пин класса
  направления краснеет. **Стенд:** GR-01, CH-01.

**Оценка:** 1 день. **Зависимости:** 2-1, 0а-1…0а-3.

### Задача 2-5: баннеры над списком — `pendingSuggestion`

**Порт:** tweb `sidebarLeft/{pendingSuggestion.tsx 158, pendingSuggestionItem.tsx 86,
pendingSuggestionController.ts 6, selectPendingSuggestion.ts 15, pendingSuggestion.module.scss 109}`
→ `*.solid.tsx`; оверлей `.chatlist-overlay` над `#folders-container` с `--chatlist-overlay-height`
(tweb `appDialogsManager.ts:864-874`). У нас React: `sidebarLeft/{pendingSuggestion 86,
pendingSuggestionItem 85, notificationsSuggestion 77}.tsx` — удаляются. `notificationsSuggestion` у tweb
— один из видов `pendingSuggestion` (сверить; если отдельный — перенести так же).

- [ ] **Тесты:** баннер «включить уведомления» при `Notification.permission === 'default'`, закрытие
  запоминается; высота оверлея пишется в переменную. **Мутация:** не писать переменную → пин краснеет.

**Оценка:** 1,5 дня. **Зависимости:** 2-1.

### Задача 2-6: истории — `StoriesList`

**Порт:** tweb `components/stories/list.tsx` (474), монтирование `appDialogsManager.ts:1095-1125`
(`_renderStories`, `renderStories`, `resizeStoriesList`, `.stories-list` `:877-878`). Открытие
просмотра — `appImManager.openStoriesFromAvatar`/`openStoriesForPeer` (tweb `:1619-1632`). Вьювер у
нас React (`StoryViewer.tsx`, волна 4), поэтому до 5-7 вызов идёт функцией открытия нашего вьювера —
`// ВРЕМЕННО до 5-7` (функция, не компонент — обратного моста нет).
**Удалить:** `StoriesRow.tsx` 405 (+ scss, тест), `core/hooks/useSidebarStories.tsx` 103.

- [ ] **Тесты:** ряд сворачивается при скролле списка (классы tweb), клик открывает вьювер с нужным
  пиром, свои истории — первыми. **Мутация:** порядок «свои первыми» → пин краснеет.
- [ ] **Стенд:** LS-11 (P2).

**Оценка:** 3 дня. **Зависимости:** 2-1, 1-4.

### Задача 2-7: вертикальная колонка папок — `foldersSidebarContent`

**Порт:** tweb `sidebarLeft/foldersSidebarContent/{index.tsx 249, folderItem.tsx 111, utils.ts 47,
folderAnimatedIcon.tsx 45, extractEmojiFromFilterTitle.ts 44, types.ts 12}` → `*.solid.tsx`; стор
`stores/foldersSidebar.solid.ts` (уже есть). Отложено волной 3 (`2026-09-07-solid-wave-3-folders-tabs.md:655`,
пункт 17).
**Удалить:** `components/folders/FoldersSidebar.tsx` 264 (портал `:240` в `#main-columns`).

- [ ] **Тесты:** `body.has-folders-sidebar` при включённом режиме, бургер в колонке — то же меню
  2-2, «добавить чаты» открывает `AppEditFolderTab`, бейдж непрочитанного у папки. **Мутация:** не
  ставить `has-folders-sidebar` → пин ширин (`updateColumnWidths.ts:199-203` у tweb) краснеет.
- [ ] **Стенд:** LS-06, LS-07 (P2).

**Оценка:** 2,5 дня. **Зависимости:** 2-1, 2-2.

### Задача 2-8: кнопки шапки — статус-эмодзи и замок

**Порт:** `sidebarLeft/index.ts:258-361` (`ButtonIcon(' sidebar-emoji-status')` `:262`,
`openEmojiStatusPicker` — tweb `sidebarLeft/emojiStatusPicker.tsx` 120, Solid; `createLockButton()`
`:264` — у нас `sidebarLeft/lockButton.solid.tsx` 67 уже есть; `toggleRightButtons` `:345-361`,
`is-input-the-last-child`). **Удалить:** `SidebarEmojiStatusButton.tsx` 41; React-обёртку острова
замка `Sidebar.tsx:330-338`. `EmojiStatusPicker.tsx` (React-попап) — 2C О-14: если он не переехал,
`openEmojiStatusPicker` порта `emojiStatusPicker.tsx` его и заменяет (Solid, у tweb — не попап
2C-оболочки, а `emojiStatusPicker.tsx`).

- [ ] **Тесты:** премиум → кнопка статуса в шапке; код-пароль включён → замок; оба выключены →
  `is-input-the-last-child`. **Мутация:** забыть класс → пин краснеет. **Стенд:** AUTH-08 (кнопка
  замка запирает).

**Оценка:** 1 день. **Зависимости:** 2-1.

### Задача 2-9: снос `Sidebar.tsx`

**Предусловия:** 2-1…2-8, 1-1…1-8. **Удалить:** `Sidebar.tsx` (+ `.module.scss`, все
`Sidebar.*.test.tsx` — сценарии к этому моменту перенесены на класс, проверить поимённо),
`useImperativeIsland`-мост списка (1-x). `App.tsx` рисует только статичную разметку колонки.
**Готово когда:** `git grep -n "components/Sidebar'" web-client/src` пуст; число React-`.tsx`
уменьшилось на все удалённые файлы этапа (перечислить в PR).
**Оценка:** 1,5 дня.

**Риски этапа 2.** (1) Поиск и список делят `#column-left`: `closeEverythingInside` и запись
`'global-search'` должны закрывать слои в порядке tweb (NAV-04). (2) `has-open-tabs` раньше писали
два пути (поправка 5): пин «один писатель» обязателен. (3) Мультиаккаунт — наша модель; пункт меню
не должен тянуть tweb `addAccount` с открытием новой вкладки браузера.

---

## Этап 3 — `AppSidebarRight` целиком: вкладка общих медиа и API для центра

### Задача 3-1: `AppSharedMediaTab` (Solid) вместо `UserInfoPanel`

**Порт:** tweb `sidebarRight/tabs/sharedMediaTab.tsx` (135, класс-вкладка) и `sharedMedia.tsx` (924,
Solid-содержимое: `PeerProfile`, `AppSearchSuper`, кнопка «Изменить» `:674-702` → `AppEditChatTab`/
`AppEditContactTab`/`AppEditTopicTab`, вкладки-счётчики `:563`, «Сохранённые диалоги» `:727`). У нас
уже есть `peerProfile.solid.tsx` (1489), `peerProfileAvatars.ts` (1250), `appSearchSuper.ts` (3318) —
вкладка собирает их, как tweb, **без** React-хука `useSearchSuper.ts` (172; класс создаётся вкладкой).
`PinnedStoriesSection.tsx` → часть `sharedMedia` (истории профиля, как tweb). `KeyVerificationPopup` —
на `PopupElement` (Отступление В7-2). `QrModal` — `showMyQrCodePopup` (2C-17) или
`// ВРЕМЕННО до 2C-17`.
**Удалить:** `UserInfoPanel.tsx` 833 (+ 4 теста — сценарии переносятся на
`sharedMediaTab.solid.test.tsx`), `useSearchSuper.ts` (+ тест), `useGroupInfo.ts` (+ тест), если без
потребителей, временную вкладку №0 `reactProfileTab.ts` (0б-0).

- [ ] **Шаг 2: тесты:** (а) `createSharedMediaTab()` + `setPeer(peerId)` рисует `PeerProfile` и
  `AppSearchSuper` в одной прокрутке, шапка липнет (`--super-offset`, пин `useSearchSuper.test.tsx`
  переносится); (б) кнопка «Изменить» открывает правильную вкладку по типу пира (tweb `:674-702`);
  (в) смена пира на той же вкладке не пересоздаёт класс `AppSearchSuper` (tweb `setPeer`), а новая
  вкладка на другого пира — пересоздаёт (живёт у своего инстанса чата); (г) `destroy` снимает Solid-корень,
  `AppSearchSuper.destroy`, `PeerProfileAvatars.destroy`.
- [ ] **Мутации:** не звать `appSearchSuper.destroy` → пин (г) краснеет; пересоздавать класс на
  `setPeer` → пин (в) краснеет.
- [ ] **Стенд:** RS-01…RS-09, GR-16, CH-17 до/после; `dom-parity` по `15-right-*`.

**Оценка:** 4,5 дня. **Зависимости:** 0б-0…0б-11.

### Задача 3-2: API колонки для центра, `is-right-column-shown`, Back/Esc

**Что делаем.** (а) Вкладка общих медиа живёт **у инстанса чата**, как tweb `chat.ts:1003-1008`
(`createSharedMediaTab` + `setPeer`), `:1178-1185` (`destroySharedMediaTab`), `:1218-1242`
(`fillProfileElements`, `loadSidebarMedia(true)`, `replaceSharedMediaTab`). До Э6 это делает
React-`Chat.tsx` через хук `useChatSharedMediaTab` — порт этих строк, `// ВРЕМЕННО до Э6`. (б)
Открытие/закрытие — `appSidebarRight.toggleSidebar()` (tweb `topbar.ts:259-286`), состояние открытия
читается у класса. `infoOpen` в `Chat.tsx:363` и его проводка `:1011`, `:1198`, `:1278`, `:1501`
удаляются. (в) `useRightColumnShown.ts` (мост из 0б-0) удаляется: писатель класса — единственный.
(г) Back/Esc — запись `'right'` слайдера; `useNavLayer` остаётся только у `'popup'`/`'menu'`/`'esg'`
(`Popup.tsx:92`, `Menu.tsx:79`, `EmojiDropdown:399`) — их снимают 2C и Э7. (д) В каталог e2e
добавляются NAV-01…NAV-06 (раздел «E2E-сценарии»).

- [ ] **Тесты:** переключение чата A → B при открытой колонке: вкладка B встала на место A,
  колонка открыта, в DOM одна вкладка общих медиа (tweb `replaceSharedMediaTab`); закрытие чата
  снимает его вкладку (`destroySharedMediaTab`); `toggleSidebar` на `mobile` зовёт переход таба
  (пока мост 0б-0). **Мутации:** не звать `replaceSharedMediaTab` → две вкладки в DOM; оставить
  `useRightColumnShown` → скан «один писатель» краснеет.
- [ ] **Стенд:** RS-01, RS-06, NAV-01, NAV-03; переключение A↔B при открытой колонке — без мигания,
  числа (кадры) в коммит.

**Готово этапа 3:** `git grep -n "UserInfoPanel\|useRightColumnShown\|useTransitionSlider\|useSearchSuper" web-client/src`
пуст; `roadmap.md` этап 3 «Готово, когда» для правой колонки выполнен (отметить там).
**Оценка:** 2,5 дня. **Зависимости:** 3-1.

**Риски этапа 3.** (1) Вкладка на инстанс чата означает N вкладок в памяти при стеке тредов —
tweb так и делает (`sharedMediaTabs[]`), снимает их `destroySharedMediaTab`. Пин на отсутствие утечки
(после закрытия трёх чатов — ноль лишних `.tabs-tab` в `#column-right`). (2) `appSearchSuper` —
зона программы shared media, его тесты прогоняются целиком.

---

## Этап 4 — точка входа и ядро `AppImManager`

> **Детальный план этапа пишется отдельным файлом перед стартом** —
> `docs/superpowers/plans/<дата>-wave-7-stage-4-entry-appimmanager.md`, в той же форме, что этапы 0а–3
> (шаги, тесты, мутации). Ниже — состав задач, границы, фасад и ворота. Детальный план не меняет их
> без согласования с пользователем.

**Карта `appImManager.ts` (3991) по подсистемам** — отчёт исследования от 2026-09-30:

| Блок | Строки tweb | Этап/задача |
|---|---|---|
| A. Типы/enum (`ChatSetPeerOptions` `:182`, `APP_TABS` `:209`, `JoinChatFlow` `:215`, …) | 163–250 | 4-2 |
| B. Поля и события (`chat_changing`/`peer_changed`/`peer_changing`/`tab_changing`/`premium_toggle` `:252-258`, `columnEl` `:259`, `chats` `:272`, геттер `chat` `:300`) | 252–322 | 4-2 |
| C. `construct()` и подписки | 324–1018 | 4-6 (+ части в 4-2, 4-5, 5-x, Э6) |
| D. Боты/вебапп/игры/url-auth | 1024–1609 | 5-6 |
| E. Истории/хелперы | 1619–1701 | 5-7 |
| F. Хоткеи/защита копирования | 1703–1895 | 5-1 |
| G. Хэш-роутинг и открытие пиров | 1897–2225 | 4-4 |
| H. Звонки/конференции/эфиры | 2227–2605 | 5-5 |
| I. Фон/тема/позиции/настройки | 2607–2762 | 4-5 |
| J. Стек чатов и колонки (ядро) | 2766–2805, 3127–3441 | 4-2, 4-3 |
| K. Drag&drop/вставка | 2807–3125 | 5-2 |
| L. Статус/typing | 3454–3816 | 5-3 |
| M. Подарки/телефон/эмодзи-клик | 3818–3986 | 5-7 |

**Шов с центром — `ChatFacade` (Э4-3 → снимается в Э6).** Интерфейс ровно из тех членов `Chat`, к
которым обращается `AppImManager` (по коду tweb; строка вызова → строка определения в `chat.ts`):

| Член | Вызовы в `appImManager.ts` | `chat.ts` | Нужен с |
|---|---|---|---|
| `container` | 1648, 2767, 2927, 3226, 3258 | `:83` | 4-3 |
| `peerId`, `threadId`, `monoforumThreadId`, `type` | 498…3936 (19 мест), 814…3936, 2685/3812, 1758/2641/2681 | `:99-101`, `:118` | 4-3 |
| `setPeer(options) → {cached, promise}` | 3325, 3366 | `:1035` | 4-3 |
| `beforeDestroy()`, `destroy()` | 3281, 3287 | `:837`, `:843` | 4-3 |
| `inited`, `sharedMediaTab` | 3421, 3277 | `:139`, `:144` | 4-3 |
| `appImManager` | 2044 | `:234` | 4-3 |
| `savedReaction` | 2653 | `:102` | 4-5 |
| `currentTheme`, `currentWallPaper`, `preferredBackgroundTransition` (запись), `publishBackground()` | 498, 3426, 3268 | `:177-179`, `:378` | 4-5 |
| `setMessageId()` | 1818 | `:1187` | 5-1 |
| `canSend()`, `getMessageSendingParams()` | 1784, 3040; 2852 | `:1340`, `:1378` | 5-1, 5-2 |
| `bubbles`: `getBubble`, `scrollable` (`getDistanceToEnd`, `scrollPosition`, `loadedAll`), `getRenderedLength`, `getViewportSlice`, `sliceViewport`, `getRenderedHistory`, `getMiddleware`, `scrollToBubble`, `highlightBubble`, `lazyLoadQueue.queueId` | 532, 533, 1727, 1783, 1812, 1815, 1816, 2651-2660, 2749, 3967 | `bubbles.ts` (у нас класс `ChatBubbles`, `components/chat/bubbles.ts:668`) | 4-5, 5-1 |
| `input`: `messageInput`, `canSendPlain`, `editMsgId`, `isInputEmpty`, `replyToMsgId`, `onHelperCancel`, `initMessageReply`, `getChatInputReplyToFromMessage`, `initMessageEditing`, `recording`, `passEventToInput`, `isEphemeralComposerMode`, `editMessage`, `showSlowModeTooltipIfNeeded`, `attachMenu`, `getEphemeralSendingSnapshot`, `canPaste`, `willAttachType` | 1722, 1761-1844, 2898-2899, 3037-3117 | `input.ts` | 5-1, 5-2 |
| `topbar.pinnedMessage` (`pinnedMessages`, `setCorrectIndex(0)`) | 2649, 2747 | `topbar.ts:108`, `pinnedMessage.tsx:99`, `:341` | 4-5 |
| `selection.isSelecting` | 1840 | `selection.ts:61` (у нас класс) | 5-1 |

`bubbles` и `selection` в фасаде — **настоящие наши классы** (`VanillaFeed.tsx:237`, `:346` их уже
создаёт), фасад лишь отдаёт ссылку. `input` и `topbar.pinnedMessage` — подфасады над React
(`Composer.tsx`, `PinnedBar.tsx`). Каждый член фасада несёт `// ВРЕМЕННО до Э6` (а `input.*` — `до Э7`, он
переходит в `ChatInputFacade`). Реализация — `components/chat/chatFacade.ts`; React-остров
монтируется мостом `shared/react/mountReact.tsx` (зеркало `mountSolid`, обязательный `ErrorBoundary`,
провайдеры `ManagersProvider` и контекст инстанса) — `// ВРЕМЕННО до Э6` (после Э7 мост нужен только
оверлеям).

| Задача | Порт (tweb) | Удаляется у нас | Дней |
|---|---|---|---|
| **4-1** `index.html` + `src/index.ts` + `pages/bootstrapIm.ts` | `index.html:87-116` (`#skip-to-content`, `.sidebar-left-overlay`, `#page-chats[display:none]`, `#main-columns`, три колонки, `#stories-viewer`, svg defs); `src/index.ts:416-672` поверх нашего `client/boot.ts` (`waitForUnlock` `:453`, состояния `:478`, лангпак `:510`, развилка `:613`: `mountAuthFlow` `:640` / `bootstrapIm` `:648-672`, `fadeInWhenFontsReady` `:645`); `pages/bootstrapIm.ts:21-70` (показ `#page-chats`, `appDialogsManager.start()`, `doubleRaf`, снятие `has-auth-pages`, `disposeActiveAuthFlow` через 1 с) | `core/hooks/useAuthGate.ts` 228 (+тест), `useShellEnterAnimation.ts` 42, вызов `mountAuthFlow` из `App.tsx:262-266`, разметка колонок в `App.tsx`; `main.tsx` сжимается до монтирования острова центра | 3 |
| **4-2** класс `AppImManager`: каркас, `selectTab`, колонки | A, B; `selectTab` `:3137-3198` (`is-left-column-shown`, `tab_changing`, `dispatchHeavyAnimationEvent`, запись `im` `:3179-3180`), `setStaticLandmarkLabels`/`updateColumnAccessibility` `:3199-3209`, `updateStatus`/`goOffline` `:3210-3218`, `mediaSizes` `:458-477`; `appDialogsManager.start` зовёт `appImManager.construct` (`appDialogsManager.ts:988`) | `useLeftColumnShown.ts` 24 (+тест), `shared/lib/useMediaQuery.ts` в шелле (`App.tsx:88`), мост `selectTab` из 0б-0 | 2,5 |
| **4-3** стек чатов + `ChatFacade` | J: `createNewChat` `:3219`, `spliceChats` `:3233-3291` (`removeByType('chat', true)` `:3252`), `chatsSelectTab` `:2766-2805`, `setPeer` `:3292-3391`, `setInnerPeer` `:3392-3435`, `openScheduled` `:3436`, `toggleViewAsMessages` `:3443`, `isSamePeer` `:3809`, `.chats-container` `:364-380`, `replaceSharedMediaTab(chatTo.sharedMediaTab)` `:3277` | `chat/ChatsContainer.tsx` 166, `stores/chatStackStore.ts` 194 (10 импортёров), `stores/navigationStore.ts` 40 (9), `core/navigation/chatHistory.ts` 478 (+тест 670 → пины на класс), `useChatNavigation.ts` 35, `useNavigationActions.ts` 74, `core/navigation/openPeer.ts` 42, мосты `// ВРЕМЕННО до Э4-3` этапов 1–3 | 6 (риск) |
| **4-4** хэш-роутинг | G: `openUrl` `:1897`, `onHashChange` `:1912-2032` (`#/im?p=`, `@username`, `peerId`, `tgaddr`, story, call), `open` `:2050`, `op` `:2062`, `openUsername` `:2165`, `openThread` `:2186`, `openComment` `:2212`; `appNavigationController.onHashChange` `:382` | `core/hooks/useUrlSync.ts` 185 (+ `useUrlSync.applyHash.test.ts` → пины на класс), `bootstrapHash` в `client/boot.ts` | 3 |
| **4-5** фон, тема, позиции | I: `setCurrentBackground` `:2607`, `setBackground` `:2629`, `saveChatPosition` `:2640`, `getChatSavedPosition` `:2680`, `applyCurrentTheme` `:2690`, `setSettings` `:2715`; из `construct` — предкэш обоев `:334-345`, `appChatBackground.attach` `:364`, `themeController` `:444-455`, позиция на `peer_changing` `:479-492` | `useShellTheme.ts` 43, `App.tsx:242-246` (`setBackground`), О-39 2D (публикация фона шеллом) частично снимается | 2 |
| **4-6** подписки `construct` | C: `:494-628` (`theme_changed`, `choosing_sticker`, `peer_title_edit`, `peer_typings`, `message_error`, `ephemeral_*`, `file_speed_limited`, `service_notification`, `payment_sent`) — на наши операции воркера; `:630` `useLockScreenShortcut`; `:632-752` `onSpoilerClick`/`onFormattedDateClick`; `:756-803` hover-to-play и тосты стикеров/GIF; `:805-822` `notificationBuild` (`uiNotificationsManager` `:328`, `:821`); `:826-843` `peer_changed` → `has-chat`/хэш; `:951` `singleInstance`; `:998-1004` финал | `core/hooks/useAppBootstrap.ts` 109 (+2 теста → в `bootstrapIm`/`appDialogsManager.start`), `useGlobalToast.ts` 32 (→ `toastNew`), вызовы `useAutoLock`/`useLockScreenShortcut` из шелла (модули остаются, зовёт класс) | 3 |
| **4-7** снос `main.tsx`/`App.tsx`, остров оверлеев | корневой вход — `src/index.ts`; `updateBtn`/`hasUpdate` левой колонки (`sidebarLeft/index.ts:142-143`) вместо пилюли `App.tsx:309-331`; svg defs — в `index.html`; `pingBackend`/`startVersionCheck`/`watchLiteModeSettings` — в `index.ts` | `main.tsx`, `App.tsx` (+`App.module.scss`, `App.*.test.ts` → пины на `index.ts`), `SvgDefs.tsx`, бейдж `api:` (`App.tsx:332-337`, dev-отладка — удалить или dev-only DOM). Остаётся **один** остров `#react-overlays` (`GlobalOverlays` без `FolderInvitePopup`/`ReportPopup` + `PopupHost`) | 2 |

**Ворота этапа 4:** AUTH-01, AUTH-02, AUTH-12, P0-01…P0-10, NAV-01…NAV-06 до/после; `vite build`
живой, нет `#root`. `git grep -n "createRoot" web-client/src` — только `mountReact.tsx`,
`mediaViewer/base.ts` (волна 4) и остров оверлеев.
**Риски.** (1) **4-3 — самое опасное место программы**: стек чатов, записи навигации и хэш
сходятся в одном классе. `chatHistory.test.ts` (670 строк пинов) переносится первым, до кода.
(2) N React-корней (по инстансу) вместо одного: контексты и `StrictMode` — на каждый остров;
замерить память стека из 5 чатов до/после. (3) `boot.ts` ↔ `index.ts`: порядок `waitForUnlock` →
состояния → лангпак нельзя менять (AUTH-08 «без сетевых запросов до ввода»).

---

## Этап 5 — подсистемы `AppImManager`

> **Детальный план пишется отдельным файлом перед стартом** —
> `docs/superpowers/plans/<дата>-wave-7-stage-5-appimmanager-subsystems.md`. Задачи независимы,
> идут параллельно (общий файл — `lib/appImManager.ts`: врезки по очереди).

| Задача | Порт (tweb) | Удаляется у нас | Зависит от непортированного | Дней |
|---|---|---|---|---|
| **5-1** хоткеи и защита копирования | F: `attachKeydownListener` `:1703-1853` (Alt+↑↓, ↑/Ctrl+↑ правка/ответ, PageUp/Down, печать в любом месте → `passEventToInput`), `attachCopyListener` `:1854` (no-forwards) | `useAppHotkeys.ts` 63, `useFeedPageHotkeys.ts` 32, `core/hotkeys.ts` 99 (остаток — фолбэк Esc уже снят) | `chat.input.*` — через `ChatFacade.input` до Э7 | 2,5 |
| **5-2** drag&drop и вставка | K: `init` `:2807`, `attachDragAndDropListeners` `:2815-3036` (сброс на `.chatlist-chat` открывает чат, watchdog 500 мс), `canDrag` `:3037`, `onDocumentPaste` `:3052`; `chat/dragAndDrop.ts` 97 | `conversation/ChatDrops.tsx` 199, `ChatDragAndDrop.tsx` 89, файловая часть `composer/useComposerClipboard.ts` | `showNewMediaPopup` — наш React `SendMediaPopup.tsx` функцией (попап tweb `newMedia.tsx` 2328 — вне волны, О-8) | 3 |
| **5-3** статус и набор | L: `getTypingElement` `:3454`, `getPeerTyping` `:3508`, `getChatStatus` `:3677`, `getUserStatus` `:3712`, `getPeerStatus` `:3743`, `setPeerStatus` `:3755`, `setChoosingStickerTyping` `:3805` | `useTypingLabel.ts` 82 (+тест), дубли статуса в `useChatInfoCard.ts` | потребитель — React-шапка до Э6 (через `useClassEvent`) | 3 |
| **5-4** диплинки — `internalLinkProcessor` | `lib/internalLinkProcessor.ts` (1661) + `lib/internalLink.ts` в объёме типов, которые есть на бэкенде: `MESSAGE`, `PRIVATE_POST`, `JOIN_CHAT`, `ADD_LIST`, `STICKER_SET`/`EMOJI_SET`, `USER_PHONE_NUMBER`, `SHARE`, `STORY`, `VOICE_CHAT`; `addAnchorListener`; `processInternalLink` для share (`appImManager.ts:1043`) | `useDeepLinks.ts` 160 (+тест), отступление `overrideAddress` контроллера (`:365-370`) — снимается, если пути `/join/`, `/addlist/`, `/qr/` переходят в хэш-формат tweb (бэкенд/nginx отдают те же ссылки — DoD 2a) | прочие типы (`INVOICE`, `BOOST`, `PREMIUM_FEATURES`, `GIFT_CODE`, `STARS_TOPUP`, `UNIQUE_STAR_GIFT`, `BUSINESS_CHAT`, `ATTACH_MENU_BOT`, `WEB_APP`, `INSTANT_VIEW`, `CONFERENCE_CALL`) — О-9 | 5 |
| **5-5** звонки | H: `callUser` `:2227`, `discard*` `:2269-2333`, `joinGroupCall` `:2344`, `joinLiveStream` `:2584`; подписки `:880-947`; `callTransitionCoordinator` | прямые вызовы звонков из React (`CallProvider.tsx` 53, кнопки шапки — вызовы переводятся на класс) | движок звонков у нас свой (`CallOverlay`, `GroupCallScreen`, `LivestreamScreen`, сторы) — методы класса делегируют в него через `CallsFacade` (`// ВРЕМЕННО до программы звонков`); конференции (`joinConference` `:2401`, `createConference` `:2414-2472`) — только если есть на бэкенде, иначе О-10 | 3 |
| **5-6** боты, вебапп, url-auth | D: `checkForShare` `:1024`, `confirmBotWebView*` `:1050-1183`, `openWebApp` `:1200`, `openJoinChatWebView` `:1333`, `JoinChatFlow` `:1360-1392`, `playGame` `:1394`, `handleUrlAuth` `:1419`, `handleAutologinDomains` `:1511`, `handlePeerColors` `:1594` | React-вызовы `WebAppModal` из шапки/композера → `appImManager.openWebApp` | `WebAppModal.tsx` 469 остаётся React в острове оверлеев (`WebAppFacade`, `// ВРЕМЕННО до программы вебаппа`); игры, url-auth, autologin — нет на бэкенде → О-11; спонсорские (`clickIfSponsoredMessage` `:1610`, `onSponsored*` `:2033-2048`) — вне продукта (`roadmap.md`) | 3 |
| **5-7** истории, подарки, эмодзи | E: `openStoriesFromAvatar` `:1619`, `openStoriesForPeer` `:1630`, `getStackFromElement` `:1634`, `deleteFilesIterative` `:1660`, `toggleChatGradientAnimation` `:1688`, `appendEmojiAnimationContainer` `:1696`; M: `giftPremium` `:3818`, `requestPhone` `:3827`, `initGifting` `:3839`, `onEmojiStickerClick` `:3847` | мосты `// ВРЕМЕННО до 5-7` из 2-6; клик по эмодзи-стикеру из `bubbles.ts` → класс | `StoryViewer` — React, волна 4 (вызов функцией); подарки/премиум — после 2C-18/20 | 2,5 |

**Ворота этапа 5:** P0-01…P0-10; ME-10, SE-05, GR-10, LS-08, NAV-05, NAV-06; для 5-5 — CA-01…CA-03 (P2)
прогоном.

---

## Этап 6 — класс `Chat` и `ChatTopbar`

> **Детальный план пишется отдельным файлом перед стартом** —
> `docs/superpowers/plans/<дата>-wave-7-stage-6-chat.md`. Вливает часть волны 8 (`Chat.tsx` → `chat.ts`
> + `topbar.ts`) и часть волны 5 (`TopbarSearch`: у tweb его монтирует сам `Chat`, `chat.ts:740-834`).

**Что у нас уже классом** (переиспользуется, не переписывается): `ChatBubbles` (`chat/bubbles.ts`
6494, `:668`), `ChatContextMenu` (`contextMenu.ts` 1722, `:384`), `ChatSelection` (`selection.ts` 1144,
`:896`), `BubbleGroups` (815), `ChatReactionsMenu` (436), `PeerTitle` (172), `appChatBackground`
(Solid, `bubbles/chatBackground.solid.tsx` 697), `gradientRenderer` (`core/chat/gradientRenderer.ts`
365). Роль tweb `Chat` для ленты сейчас играет интерфейс `ChatContext` (`bubbles.ts:287-~460`) и
`ChatFeedApi` (`VanillaFeed.tsx:54-78`). Класс `Chat` их заменяет: `ChatBubbles` получает `this`, как
у tweb.

| Задача | Порт (tweb) | Удаляется у нас | Дней |
|---|---|---|---|
| **6-1** ядро `Chat` | `chat.ts` целиком (1690): конструктор `:233-273`, распорки `:279-370`, фон `:372-607`, `init` `:613-835` (создание подкомпонентов `:616-637`, подписки `:650-709`), `destroy`/`cleanup` `:837-883`, `onChangePeer` `:893-1012` (тип, права, флаги, `sharedMediaTab`), `setPeer` `:1035-1156`, `finishPeerChange` `:1198-1254`, права `:1340-1403`, `ChatType` (`chat/chatType.ts`); `input` — **`ChatInputFacade`** над React-композером (см. этап 7, `// ВРЕМЕННО до Э7`) | `ChatFacade` (Э4-3), `chat/VanillaFeed.tsx` 502, `ChatContext`-клей, `core/chat/chatInstanceContext.tsx` 26, `Chat.tsx` (до остатка композера и шапки), `useChatInfoCard.ts` 228, `useMirrorWindow.ts` 52, `useChatAutoDownload.ts` 37, `useSetTransition.ts` 40 | 12 (риск) |
| **6-2** `ChatTopbar` | `topbar.ts` (1873): `construct` `:132-307`, `verify*` `:309-461`, меню ⋮ — 39 пунктов с `verify` `:462-903`, `constructPeerHelpers` `:1030-1175`, `finishPeerChange` `:1383-1549` (`avatarNew`, `createStatus`), `setTitle*` `:1550-1641`, клик по шапке → `appSidebarRight.toggleSidebar` `:259-286`, «назад» → `chat.pop()` `:288-306` | `conversation/ChatHeader.tsx` 201, `HeaderMenu.tsx` 262, `useHeaderMenuActions.ts` 51, шапка треда `Chat.tsx:1273-1311`, `openHeaderMenu` в `useChatPopups.tsx:266` | 8 |
| **6-3** закреп | `pinnedMessage.tsx` 841, `pinnedMessageBorder.ts` 204 (`createChatPinnedMessage`, `topbar.ts:1325`) | `PinnedBar.tsx` 137, `PinnedBorder.tsx` 99, `AnimatedSuper.tsx` 73, `usePinnedBar.ts` 93, `PinnedMessagesScreen.tsx` 136 (→ `ChatType.Pinned`) | 4 |
| **6-4** плашки шапки | `topbarPlates.ts` 71, `topbarPlate.tsx` 307; из видов — те, что есть на бэкенде: `requests.tsx` 164 (заявки есть), `actions.tsx` 643 (настройки пира), `topbarGroupCall/*` 173, `topbarLive/*` 164; `translation.tsx` 210, `removeFee.tsx` 166, `chatAutomation.tsx` 206 — по наличию бэкенда, иначе О-12; `topbarSponsored.tsx` — вне продукта | React-баннеры `Chat.tsx:1211-1229`, `:1507-1526` | 5 |
| **6-5** поиск по чату | `topbarSearch.tsx` 1352 (Solid; монтирует `Chat`, `chat.ts:784`) | `conversation/TopbarSearch.tsx` 599, `useChatHeaderSearch.ts` 264, `stores/searchStore` 136 (если без потребителей) | 5 |
| **6-6** аудиоплеер и плашка звонка | `chat/audio.tsx` 326 (`createChatAudio`, `appImManager.ts:854`), `topbarCall` `:849-852` | `NowPlayingBar.tsx` 265 (сейчас — в каждом инстансе, `Chat.tsx:1270`) | 2 |
| **6-7** снос `Chat.tsx` | — | `Chat.tsx` 1561 (+ 6 тестов → пины класса), остаток `useChatPopups.tsx` (попапы 2C), `SelectionBar.tsx` 68 (→ `ChatSelection`), `ChatMsgActionPopups.tsx` 97, `SavedTagsPanel.tsx` 110 (→ по tweb) | 4 |

**Ворота этапа 6:** P0-01…P0-10, DM-*, RE-01/05/07, ME-01, CH-03/05/06, NAV-01…NAV-06, SE-05; FPS
ленты и число узлов — до/после.
**Риски.** (1) Спека § 10: `Chat.tsx` может держать логику, которой у tweb нет места. Каждый такой
сценарий — либо Отступление с номером, либо удаление; список составляет детальный план. (2)
`TopbarSearch` и шапка делят `topbar.container` — порядок монтирования tweb (`createEffect` `:740-834`).
(3) Меню ⋮ — 39 пунктов против наших 26: пункты без бэкенда — О-12, остальные идут по `verify`.

---

## Этап 7 — композер: класс `ChatInput`

> **Детальный план пишется отдельным файлом перед стартом** —
> `docs/superpowers/plans/<дата>-wave-7-stage-7-chat-input.md`. Вливает волну 6 спеки целиком.

**Шов.** С Э6 `Chat.input` — `ChatInputFacade` над React-композером (`components/chat/chatInputFacade.ts`).
Члены — то, что зовут `Chat` (`chat.ts:618-648`, `:702`, `:850`, `:876`, `:1010`, `:1223`, `:1383-1396`,
`:1599`), `AppImManager` (таблица фасада Э4-3, строка `input`) и соседи. Внешний API tweb `chat.input.*` —
23 файла: `contextMenu.ts` 23 обращения, `bubbles.ts` 22, `newMedia.tsx` 19, `appImManager.ts` 14; частые
члены — `messageInput` 11, `editMessage` 10, `initMessageReply` 7, `getChatInputReplyToFromMessage` 6,
`paidMessageInterceptor` 5, `onMessageSent` 5, `canSendPlain` 5, `setUnreadCount` 4, `scheduleSending` 4.
Этап 7 заменяет фасад на `new ChatInput(this, appImManager, managers, 'chat-input-main')`
(`chat.ts:618`, `:632`, `:635`).

**Карта `input.ts` (5718) и что у нас.** `construct` `:487-609`; плашки reply/forward/webpage
`:652-852`; кнопки упоминаний/отложенных/клавиатуры бота/команд `:853-1047`; `constructPeerHelpers`
`:1055-1682` (эмодзи, подарок, меню вложений `:1115-1352`, автокомплит `:1384-1393`, морф `btnSend`
`:1398-1416`, `SendMenu` `:1426-1472`, эмодзи-дропдаун `:1484-1498`, плашка управления `:1576-1681`);
`finishPeerChange` `:2522-2815`; черновики `:2271-2333`, `:2412-2484`; ввод `:3129-3532`; превью ссылки
`:3533-3634`; автокомплит `:3796-3987`; `updateSendBtn` `:4390-4442`; отправка `:4536-4834`;
правка/пересылка/ответ `:4859-5204`; `clearHelper` `:5265-5318`; `setTopInfo` `:5353-5443`; правка медиа
`:5505-5718`. У нас: `Composer.tsx` 779 + `composer/*` 1504 + сателлиты 890 + хуки 1187 + плашка 480 =
**4840 строк React**. Классом уже есть: `inputField.ts` 381 (без rich), `buttonMenuToggle.ts`,
`chat/replyContainer.ts` 122 (фабрика), `wrappers/messageForReply.ts` 233, `core/audio/nativeVoiceRecorder.ts`
268, `oggOpusWriter.ts` 218; нет — `dropdownHover`, `richInputHandler`, `inputFieldAnimated`,
`singleTransition`, `emoticonsDropdown/*`.

| Задача | Порт (tweb) | Удаляется у нас | Дней |
|---|---|---|---|
| **7-1** rich-поле ввода | `inputField.ts` 904 (HEAD), `inputFieldAnimated.ts` 122, `helpers/dom/richInputHandler.ts` 900, `helpers/dom/markdown.ts` 549 | `composer/MessageInput.tsx` 75, `useInputHeight.ts` 83, `shared/lib/caret.ts`; `core/richtext/markdown.ts` 779 — по решению В-4 | 8 |
| **7-2** ядро `ChatInput` | `construct`, `constructPeerHelpers` (каркас), `finishPeerChange`, `setChatListeners`, черновики, плашки reply/edit/forward/webpage (`clearHelper`, `setTopInfo`), отправка (`sendMessage`, `sendMessageWithDocument`, `sendMessageWithForward`), `updateSendBtn` (морф 7 иконок), `inputState/*` | `Composer.tsx`, `ReplyWrapper.tsx` 146, `SendButton.tsx` 98, `useComposerDraft.ts` 79, `useChatSend.ts` 570, `ComposerMenus.tsx` 118, `useHostClasses.ts` 19, `ChatInputFacade` | 14 (риск) |
| **7-3** запись голоса и кружков | `chat/recording/chatRecording.ts` 1312, `voiceRecording/{voiceRecordingPanel 179, liveWaveform 213}.ts`, `recording/videoRecordingPanel.tsx` 192, `helpers/videoRecorder/nativeVideoRecorder.ts` 520 | `useVoiceRecorder.ts` 366 (+тест), `VoiceRecordingPanel.tsx` 111, `RoundRecordPreview.tsx` 67, `composer/liveWaveform.ts` 54 | 6 |
| **7-4** автокомплит и тултип разметки | `autocompleteHelper.ts` 190, `autocompleteHelperController.ts` 51, `autocompletePeerHelper.ts` 149, `stickersHelper.ts` 137, `emojiHelper.ts` 206, `mentionsHelper.ts` 71, `commandsHelper.ts` 67, `inlineHelper.ts` 340, `botCommands.ts` 49, `markupTooltip.ts` 582 | `MentionsHelper.tsx` 96, `StickersHelper.tsx` 114, `EmojiHelper.tsx` 80, `InlineResultsHelper.tsx` 90, `MarkupTooltip.tsx` 395, `AutocompleteHelpers.tsx` 76, `useComposerAutocomplete.ts` 195, `useMentionPeers.ts` 30 | 7 |
| **7-5** send-as, меню отправки, вложения, клавиатура бота, плашка управления | `sendAs.ts` 418, `sendContextMenu.ts` 154, `selectedEffect.tsx` 63, `attachMenuButton.tsx` 89, `replyKeyboard.tsx` 188 (+ `helpers/dropdownHover.ts` 310), `controlPlate.tsx` 42, `_center` `:1886-1971` | `SendAsButton.tsx` 111, `useSendAs.ts` 96, `composer/SendMenu.tsx` 62, `AttachMenu.tsx` 75, `ChatInputControl.tsx` 229, `useChatInputCenter.ts` 122, `controlPlates.ts` 41, клавиатура бота инлайном `Chat.tsx:1432-1450` (отступление снимается), `CornerButton.tsx`/`ScrollDownFab.tsx` (→ `constructGoDownButton` `:638`) | 6 |
| **7-6** медленный режим, звёзды, расписание, эфемерный режим, правка медиа | `showSlowModeTooltipIfNeeded` `:4005-4085`, `paidMessagesInterceptor.ts` 235, `scheduleSendingPopup.tsx` 157, эфемерный режим `:3330-3457`, `editMessageMedia.ts` 133, предложенные посты `:5444-5504` — по наличию бэкенда, иначе О-13 | `useSlowmode.ts` 46, `SchedulePopup.tsx` 40 | 4 |
| **7-7** (при «А» на В-2) `EmoticonsDropdown` | `emoticonsDropdown/**` 4315 (`index.ts` 753, `tab.ts` 539, `tabs/{emoji,stickers,gifs}.ts`, `search.tsx`, `emojiTonePicker.tsx`) — связка с `ChatInput` двусторонняя: `input.ts:10`, `:416`, `:479`, `:1346`, `:1452`, `:1485-1497`, `:3255-3277`, `:3759`, `:4012-4066` ↔ `emoticonsDropdown/index.ts:182-183`, `:247-248`, `:316`, `:365`, `:475`, `:685` | `components/emoji/*` 2397 (`EmojiDropdown.tsx` 738, вкладки, `useDropdownHover.ts` 76); запись `useNavLayer('esg')` | 18 |

**Ворота этапа 7:** весь раздел 2–4 каталога e2e (DM, RE, ME), P0-01…P0-10, AUTH-08 (фокус/ввод
после замка), CH-03, GR-03 (упоминание); пины `Composer.botCommands.test.tsx`/`Composer.hotkeys.test.tsx`
переносятся на класс до кода.
**Риски.** (1) **Модель ввода**: `CLAUDE.md` («Инпут хранит сырые markdown-маркеры, разбор — на
отправке») против tweb (rich-DOM + `getRichValue`, entities из DOM). Порт 1:1 меняет это правило —
вопрос В-4. (2) `newMedia.tsx` (2328) не входит: `ChatInput` зовёт наш React `SendMediaPopup`
функцией до его волны (О-8). (3) Без 7-7 каждый вызов эмодзи-дропдауна из класса идёт через
адаптер к React `EmojiDropdown` — `// ВРЕМЕННО до волны 5`.

---

## Отступления программы (объявленные, с номером у строки)

| № | Что | Почему | Где |
|---|---|---|---|
| В7-1 | «Новый секретный чат»: опция `{secret: true}` вкладки контактов и пункт `#new-menu`. **Входы скрыты флагом `SECRET_CHATS_ENABLED`** (`config/app.ts`, `false`; решение пользователя 2026-10-01 — фича на паузе): пункта в `#new-menu` нет, меню = tweb; опция вкладки контактов в коде осталась без вызывающего; существующие секретные чаты и их лента не тронуты | секретные E2E-чаты — наш продукт, у tweb их нет | 0а-1, 0а-2, 2-4 |
| В7-2 | `KeyVerificationPopup` — наш попап на `PopupElement` (2C-5) | пары у tweb нет (секретные чаты) | 3-1 |
| В7-3 | Превью строки диалога берётся из зеркала диалогов, а не из `historyStorage` | модель данных списка (Отступление 1 спеки 2026-08-12) | 1-1 |
| В7-4 | Пункт аккаунтов в бургере — наша модель «одна сессия на браузер» | `core/auth/accounts.ts:1-5`; модель tweb — 2D О-1 | 2-2 |
| В7-5 | Подписки `construct` на наши типизированные операции воркера вместо `rootScope` | осознанное расхождение `roadmap.md` («Что в план НЕ входит») | 1-4, 4-6 |
| В7-6 | Перезвон из журнала звонков есть и в Firefox: `IS_CALL_SUPPORTED` = `RTCPeerConnection` + `getUserMedia`, без `!IS_FIREFOX` tweb `environment/webrtcSupport.ts` | звонит наш движок (`core/calls/callEngine.ts`), и в Firefox он работает; UA-гейт tweb — про их MTProto-звонки (решение пользователя) | 0а-4 (`environment/callSupport.ts`, `calls.solid.tsx`) |

Временные мосты (`// ВРЕМЕННО до …`) — не отступления: у каждого есть задача, которая его снимает.

## Отложено — с предметом (DoD 13)

| № | Что | Почему | Что разблокирует |
|---|---|---|---|
| О-1 | Конференц-звонки во вкладке звонков и в `#new-menu` (`ConferenceCall.New`, `sidebarLeft/index.ts:1097-1104`), а с ними строка «Начать новый звонок» и вкладка `AppNewCallTab` (`tabs/newCall.tsx` 182 — целиком конференция: пустая, по ссылке, с приглашёнными; у tweb строка стоит под `IS_CONFERENCE_CALL_SUPPORTED`, `calls.tsx:421`) | проверено в 0а-4: конференций на бэкенде нет (`domain/mtmessage.go:894`, в `router.go` ручек нет) | конференции |
| О-45 | «Удалить все звонки» в меню «⋮» вкладки звонков (`calls.tsx:331-348`, `messages.deletePhoneCallHistory`) | ручки на бэкенде нет | очистка журнала звонков |
| О-46 | Блок «Активные видеочаты» вкладки звонков (`calls.tsx:166-230`, `appGroupCallsManager.getActiveGroupCalls`) | бэкенд не производит флаг `call_not_empty` у карточек чатов (`domain/mtchat.go:170`) | список идущих видеочатов |
| О-2 | Поля статистики вне `domain/stats.go:39-45` (сравнение с `stats.broadcastStats`/`megagroupStats` tweb) | отдельной статистики супергрупп нет | `statistics.tsx` 1:1 |
| О-3 | Форумы ботов (`forumTab/botforumTab.ts` 148, `autonomousDialogList/botforumTopics.ts` 122) | нет на бэкенде | бот-форумы |
| О-4 | Монофорум и direct messages каналов (`monoforumTab.ts` 106, `monoforumThreads.ts` 47, `channelDirectMessages.tsx` 90) | нет на бэкенде (`domain/mtsaveddialog.go:55`, `mtchat.go:296`) | DM каналов |
| О-5 | Сообщества (`communityDialogs.ts` 844, `createCommunityDialogElement.ts` 49, `forumTab/community*`, коммиты 2d2f188e1, b9d75a088) | нет на бэкенде вовсе | Telegram Communities |
| О-6 | Премиум-бот и премиум-ссылки из хэша (`openPremiumBot` `appImManager.ts:2159`) | премиум-бота нет | — |
| О-7 | Результаты опроса вкладкой (`sidebarRight/tabs/pollResults.tsx` 160) | нет ручки проголосовавших (`router.go:228-229` — только голос и закрытие) | список проголосовавших |
| О-8 | Попап отправки медиа tweb (`popups/newMedia.tsx` 2328) | крупный попап вне 2C; `ChatInput` и drag&drop зовут наш React `SendMediaPopup.tsx` функцией | попап медиа 1:1 (2C-пакет C или отдельная волна) |
| О-9 | Типы внутренних ссылок без бэкенда: `INVOICE`, `BOOST`, `PREMIUM_FEATURES`, `GIFT_CODE`, `STARS_TOPUP`, `UNIQUE_STAR_GIFT`, `STAR_GIFT_COLLECTION`, `BUSINESS_CHAT`, `ATTACH_MENU_BOT`, `WEB_APP`, `INSTANT_VIEW`, `CONFERENCE_CALL`, `ADD_AI_STYLE` | нет предмета на бэкенде | соответствующие фичи |
| О-10 | `joinConference`/`createConference`/`joinConferenceInternal` (`appImManager.ts:2401-2582`) | как О-1 | конференции |
| О-11 | Игры (`playGame` `:1394`), url-auth (`handleUrlAuth` `:1419`), autologin-домены (`:1511`) | нет на бэкенде | боты с логином/играми |
| О-12 | Пункты меню ⋮ и плашки шапки без бэкенда: перевод чата, снятие платы, автоматизация, бусты (если нет), `CompactDiffView`, `WelcomeMessages.DeleteAll` | детальный план Э6 составит точный список | шапка 1:1 |
| О-13 | Возможности композера без бэкенда: эфемерный режим, предложенные посты, эффекты (если нет), AI-редактор (`inputState/aiEditorButton`) | детальный план Э7 составит точный список | композер 1:1 |
| О-14 | ~~Проверка занятости имени чата (`channels.checkUsername`)~~ — **снято**: ручка `GET /chats/{peerID}/username/available` (#340), клиент `groups.checkUsername` в `UsernameInputField` (0б-2) | — | — |
| О-15 | Секция вступления вкладки типа чата: «вступать, чтобы писать», заявки на вступление, бот-привратник `guard_bot_id` (`chatType.tsx:270-372`) | флагов `join_to_send`/`join_request` у `channel` нет (`domain/mtchat.go`, `ChannelFlags`) | секция 1:1 |
| О-16 | «Запрет копирования» (`noforwards`, `messages.toggleNoForwards`, `chatType.tsx:374-407`) | флаг не объявлен у `channel`, механики нет | секция 1:1 и гейт копирования/пересылки |
| О-17 | Коллекция имён `usernames` (несколько имён, порядок, скрытие, покупка на Fragment): `UsernamesSection`, `purchaseUsernameCaption` | у чата одно поле `username` (`core/peers/predicates.ts`, `isPublic`) | `usernamesSection.tsx` 1:1 |
| О-30 | Выделение контактов во вкладке контактов: `ContactsSelection` (`contactsSelection.ts` 50), меню строки `attachContactsContextMenu` (45), попап `confirmDeleteContacts` (`popups/deleteContacts.ts` 22), ключи `ContactsSelected`/`DeleteContactsTitle`/`DeleteContactsSubtitle` (коммит ee6f7f9c2) | база `DialogsSelectionBase` (`dialogsSelectionBase.ts` 531, коммит 60a83a6f1 — выделение чатов и тем) не портирована; бэкенд есть (`DELETE /contacts/{id}`) | порт выделения списков (60a83a6f1 → ee6f7f9c2, `docs/tweb/delta/part-5.md` группа 4) |
| О-31 | `highlight: 'sort'` у `AppContactsTab`: ссылка `tg://contacts/sort` вспыхивает кнопкой сортировки (`flashControl`, `lib/settingsSearch/highlight.ts`) | нет ни обработчика внутренних ссылок, ни поиска по настройкам | `internalLinkProcessor` (Э5-4) и порт `lib/settingsSearch` |
| О-35 | Попап «пригласить ссылкой» для пропущенных при создании группы (`handleMissingInvitees`, tweb `addChatUsers.ts:15-120`; вызов — `newGroup.tsx:187`) | нет `showPickUserPopup` (попап выбора пользователей, 2C) и премиум-веток (`premium_required_for_pm`/`premium_would_allow_invite`); бэкенд пропущенных уже отдаёт (`messages.invitedUsers.missing_invitees`, 0а-2) | порт `showPickUserPopup` |
| О-40 | Лимит каналов: `handleChannelsTooMuch` + `showChannelsTooMuchPopup` (`popups/channelsTooMuch.tsx`) в «Новом канале» (`newChannel.tsx:52`) | бэкенд не знает отказа `CHANNELS_TOO_MUCH` и лимита каналов (0а-3) | попап лимита 1:1 |
| О-41 | `handleMissingInvitees` (`addChatUsers.ts:15-133`) — приглашение ссылкой тех, кого нельзя добавить, премиум-ветка | `POST /chats/{id}/members` отвечает `boolTrue`, `missingInvitees` нет (0а-3) | приглашение ссылкой после отказа |
| О-42 | Приглашение списком (`inviteToChannel(id, peerIds)`/`addChatUser(id, peerIds, fwdLimit)`) и чекбокс «показать последние 100 сообщений» (`addChatUsers.ts:169-190`) | ручка приглашает одного пользователя, `fwd_limit` нет (0а-3) | один запрос на выбор, чекбокс истории для групп |
| О-43 | Тост `InviteToGroupError` на отказе приватности (`addChatUsers.ts:211-217`) | бэкенд отдаёт текст `privacy` (`group_handler.go:43-44`), а не `USER_PRIVACY_RESTRICTED` — ветка тоста не срабатывает (0а-3) | тост вместо необработанного отказа |
| О-44 | Диалог нового канала из ответа создания: у tweb `channels.createChannel` отдаёт `Updates`, `processUpdateMessage` ставит диалог (`appChatsManager.ts:587-593`); у нас вкладка зовёт `dialogs.refresh()` (`newChannel.solid.tsx`, расхождение 8) | `POST /channels` отвечает `messages.chatFull` без диалога, кадра о новом канале нет; служебного «канал создан» тоже нет (0а-3) | снятие перезапроса, пилюля `messageActionChannelCreate` |
| О-70 | Закреп внутри пользовательской папки: `dialogsStorage.isDialogPinned(peerId, filterId)` по `filter.pinnedPeerIds` (`storages/dialogs.ts:452-462`) — строка `DialogElement` в такой папке закреп не показывает | у `Folder` нет `pinned_peers` (`core/managers/foldersManager.ts`, ручки `/folders`), порядок закрепов ведётся только для «Всех чатов» (`dialogsManager`, `pinnedOrders[ALL_FOLDER_ID]`) (1-1) | закреп в папке 1:1 (бейдж и порядок) |
| О-71 | Непрочитанное форума по темам в строке: `getForumUnreadCount` (`count` тем вместо сообщений, `hasUnmuted` → `no-unmuted-topic`), повторный `setUnreadMessagesN` по доезду счёта (`appDialogsManager.ts:2711-2722`, `:2760`) | на проводе диалога нет суммы по темам (`core/models.ts::RawDialog`, `core/folders/folderUnreadCounts.ts` расхождение 2) (1-1) | бейдж форума 1:1 |
| О-72 | «Отметить непрочитанным»: `pFlags.unread_mark` в `getDialogUnreadCount` (`appMessagesManager.ts:14249`) и пункт меню `MarkAsUnread` | флага нет ни на бэкенде (`domain/mtdialog.go:45`), ни в модели (1-1) | бейдж «•» без числа, пункт меню 1-2 |
| О-73 | Бейдж голосов опроса: `createPollVotesBadge`, `pollVotes` в `setBadgeState` (`appDialogsManager.ts:578-584`, `:2786`, `:2803`) | `unread_poll_votes_count` бэкенд не считает (`domain/mtdialog.go:48`) (1-1) | бейдж `.dialog-subtitle-badge-pollvote` |
| О-74 | Перекраска частиц блеф-спойлера активной строки: `DotRenderer.setInlineSpoilersTextColor` в `setDialogActiveStatus` (b2df09771, `appDialogsManager.ts:1296-1297`) | наш инлайн-спойлер — путь `mask-image` (до 4184843ff, `delta/part-2.md`): частицы — сам узел, цвет даёт CSS, канваса с цветом нет (1-1) | порт 4184843ff (канвас блеф-спойлера), затем b2df09771 |
| О-80 | Боты меню вложений в бургере: `getAttachMenuBots`, `show_in_side_menu`, иконка `iconDoc` и бейдж `new` пункта (`sidebarLeft/index.ts:777-808`, `buttonMenu.ts:178-183`) | на бэкенде нет attach-menu ботов (2-2) | пункты ботов перед «Настройками» |
| О-81 | Бейдж непрочитанного других аккаунтов: на кнопке бургера и у строки аккаунта (`notification_count_update`, `getNotificationsCountForAllAccounts`, `:175-188`, `:850-854`) | воркер не считает непрочитанное неактивных аккаунтов (одна сессия на браузер, В7-4) (2-2) | счётчик в `sidebar-tools-button-notifications` |
| О-82 | «Мои истории» — вкладка `AppMyStoriesTab` (`sidebarLeft/tabs/myStories`, `:715-722`); до порта пункт открывает наш `StoriesArchiveSheet` | вкладка историй не портирована (волна 4 спеки) (2-2) | пункт 1:1 |
| О-83 | verify «Архива» целиком: `!isDialogsLoaded(FOLDER_ID_ARCHIVE)` и `appStoriesManager.hasArchive()` (`:681-685`); у нас — только «есть архивные диалоги» | нет признака «архив догружен» и архива историй скрытых пиров (2-2) | пункт до первой загрузки архива |
| О-84 | Клавиатурная навигация меню: `menuKeyboard`, `focusTrap`, `activateFocus` в `contextMenuController`, 5-й аргумент `addAdditionalMenu` (фокус в подменю) | срез a11y `contextMenuController` не портирован (2-2) | стрелки/Enter/Esc по пунктам бургера и подменю |

## Что остаётся волне 8 (после этой программы)

- `stores/chatsStore.ts` (58 импортёров) и `stores/appState.ts` (13) → Solid `createStore` с формой
  tweb; мосты `subscribeExternal` этой программы переписываются на прямое чтение. Сканы-инварианты
  спеки § 5 (`noDuplicateMe`, `noManualOrder`, `noAdHocReads`, `scrollWriters`, `noDuplicatePeers`,
  `noDuplicateMediaUrl`, `noDuplicateMediaToken`) переписываются под новую форму.
- `useSettingsStore` (`src/settings.tsx`, ~39 импортёров) → `appSettings` tweb (2D О-2).
- React-острова вне каркаса: `StoryViewer`, `MediaEditor` (волна 4), остров оверлеев (звонки,
  вебапп — их программы), `mediaViewer/base.ts` `createRoot` (`:1380`, `:1415`), `EmojiDropdown`
  (если «Б» на В-2).
- Снос `react`, `react-dom`, `@vitejs/plugin-react`, `"jsx": "react-jsx"`, `ManagersProvider`,
  `useImperativeIsland`, `SolidIsland`, `mountReact`.

## Открытые вопросы пользователю

| № | Вопрос | Варианты | Рекомендация |
|---|---|---|---|
| **В-1** | Сообщества, монофорум, бот-форумы — у tweb есть, у нас нет бэкенда | А — вне волны (О-3…О-5), отдельная программа «бэкенд первым»; Б — сначала бэкенд, потом порт в этапе 1 (+ ~15 дней клиента и бэкенд) | **А**: этап 1 и так на критическом пути, а предмета на сервере нет |
| **В-2** | `EmoticonsDropdown` (волна 5) — связка с `ChatInput` двусторонняя | А — включить задачей 7-7 (+18 дней); Б — адаптер к React `EmojiDropdown` до волны 5 | **А**: иначе класс `ChatInput` живёт с React-адаптером по 9 точкам связки, а волна 5 потом переписывает их второй раз |
| **В-3** | `chatsStore`/`appState` — для класса `Chat` | А — оставить на мостах (волна 8); Б — перевести на Solid в этапе 6 | **А**: `Chat` читает пиров/полный пир/настройки через готовые мосты `peers.solid.ts`/`fullPeers.solid.ts`/`appSettings.solid.ts`; перенос 58 импортёров удвоит этап 6 и смешает две программы |
| **В-4** | Модель ввода: правило `CLAUDE.md` «инпут хранит сырые markdown-маркеры» против rich-поля tweb | А — порт 1:1 (rich-DOM, entities из DOM), правило в `CLAUDE.md` меняется в 7-1; Б — оставить наш markdown-ввод Отступлением | **А**: DoD 2a; провод (`MessageEntity`, UTF-16) не меняется, меняется только редактор |
| **В-5** | Подсистемы `AppImManager` поверх непортированного (звонки, вебапп, истории, подарки) | А — порт методов класса сейчас, делегирование в наши движки через фасады с номером (5-5…5-7); Б — вне волны, хуки остаются | **А**: решение «переносим полностью»; фасады тонкие (вызов функции), движки меняются своими программами без правки класса |
| **В-6** | Ворота e2e: Playwright-набор ещё на ветке `origin/docs/e2e-scenarios-plan` | А — до старта этапа 4 влить P0-набор и гонять автоматически; Б — ручной прогон по каталогу на всех этапах | **А**: этапы 4–7 меняют каркас целиком, ручной прогон P0-01…P0-10 на каждом PR ненадёжен |

## DoD программы

Спека § 9, пункты 9–14, плюс предметно:

- [ ] `vite build` живой; `vitest run`, `tsc --noEmit`, `oxlint --type-aware` зелёные из `web-client/`.
- [ ] **Корень не React:** нет `main.tsx`, `App.tsx`, `#root`; вход — `src/index.ts`; колонки статично в
  `index.html`. `git grep -n "createRoot" web-client/src` — только разрешённые острова («Что
  остаётся волне 8»).
- [ ] **Колонки — классы tweb:** `components/sidebarLeft/index.ts` (`AppSidebarLeft`),
  `components/sidebarRight/index.ts` (`AppSidebarRight`); нет `Sidebar.tsx`, `SidebarScreens.tsx`,
  `UserInfoPanel.tsx`, `GroupEditFlow.tsx`, `components/group/`, `components/userInfo/`, `rightSidebar/`.
- [ ] **Центр — классы tweb:** `lib/appImManager.ts`, `components/chat/{chat,topbar,input}.ts`; нет
  `ChatsContainer.tsx`, `Chat.tsx`, `Composer.tsx`, `components/composer/`, `chatStackStore`,
  `navigationStore`, `chatHistory.ts`, хуков шелла из поправки и таблиц этапа 4.
- [ ] **Временных мостов нет:** `git grep -n "ВРЕМЕННО до Э\|ВРЕМЕННО до [0-9]" web-client/src` пуст
  (кроме мостов с номером задач 2C/волн 4, 5, 8 — они перечислены в PR этапа 7).
- [ ] **Писатели классов состояния — по одному:** `is-left-column-shown` — `AppImManager.selectTab`;
  `is-right-column-shown` — `AppSidebarRight`; `has-open-tabs` — `AppSidebarLeft`; скан-тесты зелёные.
- [ ] **React убыл:** число `.tsx` с `from 'react'` без тестов (на `e5d7f44e` — **171**) уменьшилось на
  число удалённых файлов программы; список — в PR каждой задачи.
- [ ] Стенд: ворота e2e каждого этапа, NAV-01…NAV-06; чеклисты «Проверка после порта»
  `state-and-layout.md`, `left-sidebar.md`, `right-sidebar.md`, `composer.md`, `chat-feed.md`.
- [ ] `node tools/tweb-parity/ownership-audit.mjs` — находок в каркасе нет; `dom-parity` по
  `01-skeleton`, `15-right-*`, `14-left-*` — только объявленные расхождения.
- [ ] Секции «у нас» обновлены; `roadmap.md` этап 3 — «Готово, когда» выполнено для обеих колонок.
