# Папки чатов: ряд вкладок и слайдер папок 1:1 с tweb — план реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ: `superpowers:subagent-driven-development`.
> Шаги помечены чекбоксами (`- [ ]`).

**Цель:** ряд вкладок папок над списком чатов рисует **Solid-компонент
`foldersTabs.solid.tsx`** (дословный порт tweb `src/components/foldersTabs.tsx`, 61)
поверх **Solid-обёртки `tabs.solid.tsx`** (порт `src/components/tabs.tsx`, 172);
контейнеры папок создаёт, упорядочивает, переключает и снимает **чистый TS-владелец**
`lib/appDialogsManager.ts` (срез оригинала `src/lib/appDialogsManager.ts`, ~300 строк
из 2695) через уже портированные `horizontalMenu` + `TransitionSlider.slideTabs`;
React-`components/FolderTabs.tsx` (50), `TabSlide` из `ChatList.tsx` и React-меню
папки из `useSidebarFolders.tsx` **удаляются**. Строки списка (виртуальный `ul`)
остаются React'ом и рисуются порталом ВНУТРЬ контейнера владельца.

**Место в программе:** волна 3 Solid-миграции
(`docs/superpowers/specs/2026-08-28-solid-migration-design.md`), **этап 4**. По карте
§ 4 спеки `appDialogsManager.ts` целиком — волна 7 («оболочка сайдбара и диалоги →
классы»). Сюда вынесен ТОЛЬКО его папочный срез — потому что (а) дефект перехода папок
живёт именно в `TabSlide` и виден пользователю каждый день, (б) всё, на чём этот срез
стоит (`horizontalMenu`, `slideTabs`, `handleTabSwipe`, `positionElementByIndex`,
`scrollable2.solid`), уже приехало этапом 3. Остальной менеджер (строка диалога,
клики, контекстное меню диалога, форум-табы, сторис) — по-прежнему волна 7.

**Оригинал:** `/Users/denisurevic/Documents/tweb`, коммит `e52b5d931`.
**Разбор с адресами — [`docs/tweb/folders-tabs.md`](../../tweb/folders-tabs.md)**;
каркас колонки, стор папок и вертикальная колонка —
[`docs/tweb/left-sidebar.md`](../../tweb/left-sidebar.md) (часть 1 § 5, часть 5 § 8);
полоса вкладок как механизм — [`docs/tweb/shared-media.md`](../../tweb/shared-media.md) § 1.4.

---

## Три поправки к постановке (проверены в исходниках)

Прежде чем брать задачи — три вещи, которые постановка и наш код считают
«как в tweb», а в оригинале их НЕТ или они устроены иначе. Адреса —
`docs/tweb/folders-tabs.md` § 0.

1. **Памяти `scrollTop` папки в tweb нет.** `selectFolderByIndex` чистит целевой
   список ПЕРЕД переключением (`appDialogsManager.ts:786`, `xds[id].clear()`), а
   `onTransitionEnd` полосы чистит все неактивные (`:798-804`); `onTabChange`
   заново просит первую страницу (`:1092-1101` → `base.ts:144-146`), и хранилище
   отдаёт её из кэша без сети (`storages/dialogs.ts:1700-1710`; наш
   `dialogsManager.getDialogs` — тот же порт, кэш-первый). Контейнер-скроллер
   живёт один (создан в `addFilter`), содержимое — нет. Наш `keepMounted` с
   «папка помнит позицию, как в tweb» (`useSidebarFolders.tsx:54-59`) и пины
   `Sidebar.chatlist.test.tsx:131`, `ChatList.test.tsx:566,585` — **наше
   отступление, а не порт**. В этом плане оно снимается: переключение папки =
   список с начала; если продукт захочет память позиций — это будет осознанное
   отступление отдельной постановкой, здесь его нет.
2. **`changeFiltersAllChatsKey` мёртв в форке.** `allChatsIntlElement`
   (`:539`, `:636-638`, `:1295`) никуда не вставляется, ряд всегда рендерит
   `i18n('FilterAllChatsShort')` (`foldersTabs.tsx:20-22`). Не портируется, как и
   слушатель `resize` `:700-702`.
3. **Свайп — это клик по соседней вкладке**, а не жест над кадрами:
   `handleTabSwipe` (`:617-634`) зовёт `folders.onClick()(index)` — тот же
   `selectTab`. `lockTouchScroll` папкам не нужен (он у `appSearchSuper.ts:498-542`).

## Ключевой шов — его ещё нет, и это главная работа

У shared media шов был готов: узел класса уже ехал в Solid пропом. Здесь наоборот —
контейнер папки СЕЙЧАС создаёт React (`TabSlide`-кадр, `ChatList.tsx:129-151`), а
слайдер tweb адресует кадры **индексом в живом DOM** (`content.children[id]`,
`horizontalMenu.ts:56`; `transition.ts:300-352`). Значит владение контейнером
обязано переехать в TS, а React обязан рисовать внутрь чужого узла.

Правило шва (спека § 7) в этой программе разложено так:

| Узел | Владелец | Кто внутри |
|---|---|---|
| `.connection-status-bottom` | React (`Sidebar.tsx`) — хост, отдаётся владельцу через `useImperativeIsland({mode:'host'})` | TS-владелец `start(host)` |
| `.chatlist-overlay`, `suggestionContainer`, градиент, ряд вкладок, `#folders-container` | **TS-владелец** (`appDialogsManager.ts:587-604`, `:654-686`, `:1079-1082`) — создаёт, `destroy()` снимает | ряд — Solid-узлы из `createRoot` (без хоста, как `:684-685`); плашка-подсказка — React-портал в `suggestionContainer` |
| `.folders-scrollable` (скроллер папки), `.chatlist-top`, `.chatlist-bottom` | **TS-владелец** (`addFilter` `:1261-1287`) | React-`ChatListFolder` порталом рисует `ul.chatlist.virtual-chatlist` в `.chatlist-top` и владеет ТОЛЬКО им |
| `ul` и строки | React (виртуальный список прошлой программы — **не переписывать**) | — |

Обратный мост (React → TS) — это `createPortal` в TS-узел; прецедент —
`FoldersSidebar.tsx:123` (портал в `#main-columns`). Роль `xd`
(`AutonomousDialogList`) исполняет пара: TS-объект `FolderList` у владельца
(скроллер, узлы, `clear/reset/onChatsScroll`) + React-хэндл, который
`ChatListFolder` регистрирует в нём после монтирования (`useDialogListSource`
получает `reset()`). Первый `onChatsScroll` владелец делает синхронно на старте
(`:1064-1065`), когда хэндла ещё нет, — `FolderList` держит его отложенным до
регистрации (единственная адаптация шва, объявляется у строки).

## Что у нас уже есть и переиспользуется без изменений

`components/horizontalMenu.ts` (порт целиком, объектная форма `horizontalMenu({...})`,
`ScrollableXLike = {container}` — под `ScrollableContextValue.container`),
`components/transition.ts` (`TransitionSlider` с `slideTabs` `:102-116`),
`helpers/dom/{handleTabSwipe,positionElementByIndex}.ts` (1:1),
`components/scrollable.ts` (`Scrollable(undefined, 'CL', 500)` + `attachBorderListeners`),
`components/scrollable2.solid.tsx` (Solid-скроллер с `axis`/`contextRef`, `:81-111`),
`shared/solid/mountSolid.solid.tsx` (мост с `ErrorBoundary`),
`core/hooks/useImperativeIsland.ts`, `helpers/solid/subscribeExternal.ts`,
`core/navigation/appNavigationController.ts` (`'filters'` в типах `:82-86`,
`spliceItems` `:467`, `removeItem` `:477`), `helpers/dom/createContextMenu.ts`,
`helpers/fastSmoothScroll.ts:79-91` (`fastSmoothScrollToStart`),
`environment/{touchSupport,userAgent}.ts`, `lib/langPack.ts:914` (`i18n`),
стили `styles/tweb/_leftSidebar.scss:278-325, 407-437` и `_slider.scss` (1:1),
виртуальный список `components/virtual/*` и источник `core/hooks/useDialogListSource.ts`
(программа «Dialogs virtual list», спеки `docs/superpowers/specs/2026-08-1[23]-*`).

## Чего нет вовсе и что заводится здесь

`components/tabs.solid.tsx` (обёртка `Tabs.*`), `components/badge.solid.tsx` (26),
`stores/folders.solid.ts` (проекция папок для Solid + `onClick`-сигнал),
`components/foldersTabs.solid.tsx` (61), `lib/appDialogsManager.ts` (срез: папки),
`helpers/dom/createFolderContextMenu.ts` (75), эффект body-классов
`has-horizontal-folders`/`has-vertical-folders` (`stores/foldersSidebar.ts:90-112`),
`reset()` у `useDialogListSource`, второй экспорт моста — Solid-узлы без хоста
(`createRoot` + `children().toArray()` под `ErrorBoundary`).

## Global Constraints

- **Источник порта — компонент tweb, а не наш React** (спека § 6a). Наши
  `FolderTabs.tsx`, `TabSlide.tsx`, `useSidebarFolders.tsx` — НЕ образец. Их
  расхождения перечислены в `docs/tweb/folders-tabs.md` § 2.2-2.3; переносить их в
  порт запрещено, в частности память `scrollTop` (поправка 1), условный рендер ряда
  вместо `hide` и порядок кадров «по первому показу» (`TabSlide.tsx:134-140`).
- **Definition of Done** — спека § 9, все 14 пунктов. Особо: п. 4 (мутацию
  ФАКТИЧЕСКИ прогнать, вывод падения — в тело коммита), п. 5 (владелец снимает
  то, что создал — пин на `destroy()`), п. 14 (React обязан убыть, а не удвоиться).
- **DoD 2a — расхождение правится в источнике, а не узаконивается в клиенте.**
  Чего нет на бэкенде/в воркере — в «Отложено» с предметом (лимит папок,
  сущности в названии, `markFolderAsRead`), в клиенте — комментарий у строки с
  номером задачи, а не молчаливая подгонка.
- **Никакого `git add -A`.** Коммитить только явно перечисленные пути: индекс
  ворктри общий, рядом работают другие агенты (в том числе программа глобального
  поиска, которая сносит `SearchView.tsx`).
- **Комментарии и сообщения коммитов — по-русски**, объяснять ПОЧЕМУ.
- Каждый порт несёт в шапке файла ссылку вида `порт tweb/src/components/foldersTabs.tsx`,
  со строками там, где взята нетривиальная деталь; расхождения — нумерованным
  списком в шапке, как в `components/appSearchSuper.ts:29-140`.
- **Пины — на результат, а не на форму вызова.** Проверять узлы в DOM (`active`,
  `to`/`from`, `data-filter-id`, порядок детей), `scrollTop`, пустой `ul` после
  перехода, отсутствие сетевого вызова — не «стор позван с такими аргументами».
- **vitest запускать только из `web-client/`** (`cd web-client && npx vitest run …`);
  тесты слайдера — с НАСТОЯЩИМ `transitionend`, по образцу
  `components/appSearchSuper.scroll.test.ts:14-26` (стаб только геометрии).
- **Виртуальный список не трогать**: `components/virtual/*`, строки, курсор —
  предмет прошлой программы; здесь меняется только то, КУДА список рисуется и кто
  просит первую страницу.

## Порядок и зависимости

```
1 tabs.solid + badge.solid ──┬─→ 4 foldersTabs.solid ──┐
3 folders.solid ─────────────┘                          ├─→ 5 владелец ─→ 6 ШОВ + снос ─┬─→ 7 меню папки
2 AppSearchSuper → Tabs.MenuGradient (независима)                                       ├─→ 8 body-классы
                                                                                        └─→ 9 ForwardPicker, shared/ui/Tabs
```

Задачи 1-3 независимы и могут идти параллельно; 2 — отдельный маленький PR.
Задача 6 — единственная точка, где меняется видимое поведение; до неё приложение
работает на старом React-ряду и `TabSlide`. 7, 8, 9 независимы между собой.

---

### Задача 1: `tabs.solid.tsx` и `badge.solid.tsx` — Solid-обёртка над `.menu-horizontal-*`

**Что делаем.** Порт tweb `src/components/tabs.tsx` (172) в объёме, который нужен
потребителям у нас: `Tabs` (`:7-20`), `Tabs.Menu` (`:22-39`), `Tabs.MenuTab`
(`:41-54`), `Tabs.MenuScrollable` (`:56-69`, поверх нашего `scrollable2.solid.tsx` с
`axis="x"` и `contextRef`), `Tabs.MenuGradient` (`:71-95`). И порт
`src/components/badge.tsx` (26) — `badge badge-{size} badge-{color} [is-badge-empty]`
через `Dynamic`.

`Tabs.Content`/`Tabs.ContentTab`/`Tabs.Simple` (`:97-170`) **не портируются**:
потребители у tweb — `sidebarRight/tabs/boosts.tsx:139-286` и `popups/stars.tsx:760`,
которых у нас нет; `Tabs.Simple` к тому же зовёт позиционную `horizontalMenu`,
которую мы сознательно не портировали (`components/horizontalMenu.ts`, отступление 2).
Отложенная задача 18.

**Файлы:**
- Создать: `web-client/src/components/tabs.solid.tsx`, `web-client/src/components/badge.solid.tsx`
- Тесты: `web-client/src/components/tabs.solid.test.tsx`, `badge.solid.test.tsx`

- [ ] **Шаг 1: прочитать** `tweb/src/components/tabs.tsx` целиком, `badge.tsx`,
  `scrollable2.tsx:26-56, :269-293` и наш `components/scrollable2.solid.tsx:81-111`.
- [ ] **Шаг 2: падающий тест на разметку**: `MenuScrollable > Menu > MenuTab`
  даёт дерево `div.menu-horizontal-scrollable > div.scrollable.scrollable-x >
  div.menu-horizontal-div > div.menu-horizontal-div-item > i.menu-horizontal-div-item-background
  + div.menu-horizontal-div-item-span` — сверить с дампом
  `docs/tweb/dom/dumps/14-left-01-chatlist.json:48-56` (нумерация по развёрнутому
  тексту); `contextRef` отдаёт объект с `container` — тем самым
  `.scrollable.scrollable-x`; `MenuGradient({color:'surface', smaller:true,
  className:'folders-tabs-gradient'})` даёт `div.menu-horizontal-gradient-container.folders-tabs-gradient-container
  > div.menu-horizontal-gradient.menu-horizontal-gradient-color-surface.menu-horizontal-gradient-smaller.folders-tabs-gradient`
  (дамп `:46-47`); `Badge` при пустом `children` несёт `is-badge-empty`
  (`badge.tsx:19`). Мутация: убрать `i.menu-horizontal-div-item-background` —
  тест обязан покраснеть (без него полоска Jolly Cobra `horizontalMenu.ts`
  не найдёт индикатор).
- [ ] **Шаг 3: убедиться, что тесты падают.**
- [ ] **Шаг 4: реализовать** дословно (`/** @jsxImportSource solid-js */`,
  имя файла по `SOLID_FILE_PATTERN`).

**Готово когда:** дерево совпадает с дампом; `MenuGradient` вызывается и как
функция (`Tabs.MenuGradient({...}) as HTMLElement`, `appSearchSuper.ts:597`), и как
JSX (`foldersTabs.tsx:53`) — оба пути в тесте.

---

### Задача 2: `AppSearchSuper` собирает градиент через `Tabs.MenuGradient`

**Что делаем.** Закрываем расхождение 1 в шапке `components/appSearchSuper.ts:31-39`:
свой `createMenuGradient` (`:895-900`) заменяется вызовом `Tabs.MenuGradient({color:
'background', className: 'search-super-tabs-gradient'}) as HTMLElement` — ровно как
`tweb/src/components/appSearchSuper.ts:596-600`. Второй потребитель у tweb —
`selectorSearch.ts:78`, у нас его нет.

**Файлы:**
- Изменить: `web-client/src/components/appSearchSuper.ts` (`:31-39`, `:768`, `:895-900`)
- Тест: `web-client/src/components/appSearchSuper.dom.test.ts` (существующий пин на
  градиент остаётся зелёным — это и есть проверка эквивалентности)

- [ ] **Шаг 1:** снести `createMenuGradient`, снять пункт 1 из списка расхождений
  в шапке (перенумеровывать остальные не надо — оставить «снято задачей 2 плана
  папок»).
- [ ] **Шаг 2:** `appSearchSuper.dom.test.ts` зелёный без правок; `git grep
  createMenuGradient` пуст.

**Готово когда:** у `menu-horizontal-gradient*` в репозитории один строитель —
`tabs.solid.tsx`.

---

### Задача 3: `stores/folders.solid.ts` — проекция папок для Solid и `onClick`-сигнал

**Что делаем.** Порт `tweb/src/stores/folders.ts` (222) в той части, которая у нас
имеет предмет: `folderItems: StoredFolder[]` (`:9-17`, `:55`), `onClick`/`setOnClick`
(`:58-63`, `:215-216`), счётчики `{count, muted}` по правилу
`getNotificationCountForFilter` (`:19-30`), порядок (`:32-51` — у нас `pos, id`, как
`foldersStore.ts:152-157`), `hydrate` с подписками (`:155-207`).

**Три решения, объявляемые в шапке файла:**

1. **Это проекция, а не второе зеркало факта.** Определения папок живут в
   `appState.folders` (Zustand, «уезжает последним» по спеке § 5), выбор —
   в `foldersStore.selectedId`. Стор наполняется ТОЛЬКО подпиской на них
   (`useAppStateStore.subscribe`, `useChatsStore.subscribe`, `useFoldersStore.subscribe`
   для `contactIds`, `useNotifyStore` для muted) — как `stores/peers.solid.ts`
   не заводит `createStore` рядом с `peerCache`, а адаптирует зеркало. Писатель
   ровно один — подписка; `setFolderItems(reconcile(...))`.
2. **`selectedFolderId`/`selectedFolderIndex` (`:54`, `:56`) здесь НЕТ** — факт
   уже в Zustand, второго держателя быть не должно («Владение фактами»,
   `web-client/CLAUDE.md`). Индекс активной папки владелец считает сам от
   `this.filterId` (нужен свайпу, `:622`).
3. **Счётчик считается одной чистой функцией `core/folders/folderUnreadCounts.ts`**
   (вынос `useSidebarFolders.tsx:46-52` + правило `muted` из `folders.ts:28`), и ею
   же пользуется вертикальная колонка. Воркерного `getFolderUnreadCount` у нас
   нет — отложенная задача 16; расхождение объявлено (`docs/tweb/folders-tabs.md` § 3).

`chatsCount` (`:16`, `:97`) не заводится — единственный читатель у tweb это кнопка
«добавить чаты» пустой папки в вертикальной колонке (`foldersSidebarContent:180-194`),
которая у нас React и в этот план не входит. `filter_joined`/`premium_toggle`
(`:193-206`) — событий нет, задача 15.

**Файлы:**
- Создать: `web-client/src/stores/folders.solid.ts`, `web-client/src/core/folders/folderUnreadCounts.ts`
- Тесты: `web-client/src/stores/folders.solid.test.ts`, `web-client/src/core/folders/folderUnreadCounts.test.ts`

- [ ] **Шаг 1: прочитать** `tweb/src/stores/folders.ts` целиком, наш
  `stores/foldersStore.ts`, `stores/peers.solid.ts:1-40` (образец «без второго
  зеркала»), `helpers/solid/subscribeExternal.ts`.
- [ ] **Шаг 2: падающий тест на проекцию**: после `hydrate()` `folderItems` =
  «Все чаты» (`id: ALL`, `localId: 0`) + папки в порядке `pos, id`; добавление
  папки в `appState` появляется в `folderItems` на своём месте, удаление —
  исчезает, переупорядочивание — переставляет; `dispose()` снимает подписки
  (после него `setAppState('folders', …)` стор не меняет).
- [ ] **Шаг 3: падающий тест на счётчики**: у «Все чаты» — число непрочитанных
  НЕзамьюченных, у папки — всех непрочитанных, подходящих под правило папки;
  `muted === true` ровно когда непрочитанное есть, но всё замьючено. Мутация:
  считать «Все чаты» по всем непрочитанным — тест красный.
- [ ] **Шаг 4: убедиться, что тесты падают.**
- [ ] **Шаг 5: реализовать.** Существующий `useSidebarFolders.folderUnread` пока
  остаётся (уходит задачей 6), но обязан звать ту же функцию — дублей правила
  не заводить.

**Готово когда:** `git grep "c.unread && chatMatchesFolder"` находит ровно одно
место — `folderUnreadCounts.ts`.

---

### Задача 4: `foldersTabs.solid.tsx` — ряд вкладок

**Что делаем.** Дословный порт `tweb/src/components/foldersTabs.tsx` (61): пропсы
`scrollableProps`/`menuProps`/`gradientProps` (`:11-15`), `For each={folderItems}`
(`:56`), вкладка с `ref.dataset.filterId` (`:34-36`), `span.text-super` (`:37-39`),
`Badge tag="div" size={20} color={muted ? 'gray' : 'primary'}` (`:40-46`), для
`ALL` всегда `i18n('FilterAllChatsShort')` (`:20-22`).

**Расхождение, объявляемое в шапке:** название папки — `item.filter.title` текстом
вместо `wrapFolderTitle(...)` → `documentFragmentToNodes` (`:24-30`): на проводе
`Folder.title` — строка без сущностей (`core/managers/foldersManager.ts:5-17`),
`custom-emoji-renderer` не портирован. Отложенная задача 11.

**Файлы:**
- Создать: `web-client/src/components/foldersTabs.solid.tsx`
- Тест: `web-client/src/components/foldersTabs.solid.test.tsx`

- [ ] **Шаг 1: прочитать** оригинал целиком и `docs/tweb/folders-tabs.md` § 1.2, § 1.4.
- [ ] **Шаг 2: падающий тест**: при трёх папках в `folders.solid` — четыре
  `div.menu-horizontal-div-item` с `data-filter-id`, у первой `span.text-super` =
  «All» (короткий ключ), у остальных — заголовок папки; бейдж `div.badge.badge-20`,
  `badge-gray` у замьюченной, `badge-primary` у остальных, `is-badge-empty` при 0;
  `gradientProps` не переданы → градиента нет (`:53`); переданы —
  `.folders-tabs-gradient-container` первым узлом; `ref`-ы `scrollableProps`/`menuProps`/
  `gradientProps` получают узлы; удаление папки из стора снимает её вкладку без
  пересоздания соседних (ссылки узлов те же — `For`).
- [ ] **Шаг 3: убедиться, что тест падает.**
- [ ] **Шаг 4: реализовать.**

**Готово когда:** дерево вкладки 1:1 с дампом `14-left-01-chatlist.json:51-56`;
компонент **не** читает выбранную папку и не ставит `active` (это делает полоса).

---

### Задача 5: `lib/appDialogsManager.ts` — TS-владелец контейнеров папок и переключения

**Что делаем.** Порт папочного среза `tweb/src/lib/appDialogsManager.ts` классом
`AppDialogsManager` (экземпляр, а не модульный синглтон — колонка у нас
монтируется/размонтируется, и тесты поднимают её многократно; объявить в шапке).
Оригинал живёт на `document.getElementById('chatlist-container')`; у нас узлы
приходят в `start(host, chatsContainer, hooks)`:

| Что | Оригинал | Порт |
|---|---|---|
| `bottomPart` + `foldersOverlay` + `#folders-container.tabs-container` | `:587-597` (`#folders-container` из `index.html:100`) | `host` = React-`.connection-status-bottom`; оверлей и контейнер владелец создаёт сам и кладёт в `host` (`prepend`/`append`) |
| `ResizeObserver(overlay)` → `--chatlist-overlay-height` на `bottomPart` | `:601-604` | дословно (`useMeasuredHeight` в `Sidebar.tsx:139-144` уходит) |
| `suggestionContainer` в оверлее | `:1079-1082` | создаётся в `start()`, наружу отдаётся для React-портала `PendingSuggestion` |
| ряд `FoldersTabs` → узлы прямо в оверлей | `:654-686` (`createRoot` + `children().toArray()`) | второй экспорт моста `shared/solid/mountSolid.solid.tsx`: `createSolidNodes(Component, props) → {nodes, dispose}` — тот же `createRoot`, но под `ErrorBoundary` (обязателен, спека § 6); узлы аппендятся в оверлей БЕЗ хоста, как `:685` — иначе `.folders-tabs-gradient-container { inset: 0 }` (`_leftSidebar.scss:319-324`) считался бы от лишней обёртки, а `dom-parity` показал бы чужой узел |
| `onRef`: `setFilterId(ALL)` + `addFilter(all)`, `selectFolderByIndex`, `horizontalMenu({...})`, `setOnClick(selectTab)` | `:729-822` | дословно; `closeEverythingInsideNaturally` (`:756-758`) — колбэк из `hooks` (у нас закрытие поиска/экрана/архива/форума — состояние `Sidebar.tsx`); лимит папок (`:742-748`) — `available = true` с комментарием и номером задачи 10 |
| навигационная запись `'filters'` | `:760-777` | дословно через `appNavigationController.spliceItems(1, 0, …)`/`removeItem`, гейт `IS_MOBILE_SAFARI` |
| повторный клик → к началу | `:779-782` | `fastSmoothScrollToStart(xds[id].scrollable.container, 'y')` |
| `setSelectedFolderId(id)` | `:784` | `useFoldersStore.getState().select(id)` — **единственный писатель** `selectedId` после задачи 6 |
| `xds[id].clear()` → `setFilterIdAndChangeTab(id)` → `onTabChange` (`xd.reset()`, `xd.onChatsScroll()`) | `:786-790`, `:851-858`, `:1092-1101` | дословно поверх `FolderList` (ниже); chatlist-апдейты `:1103-1165` — задача 13 |
| `onTransitionEnd` → `clear()` неактивных | `:798-804` | дословно |
| `onChange` → перекраска custom-emoji | `:806-809` | не портируется (задача 11), у строки — комментарий |
| `l(filter)` / `addFilter(filter)` | `:1170-1176`, `:1249-1290` | `FolderList`: `new Scrollable(undefined, 'CL', 500)` (`dialogs.ts:209`), `container.dataset.filterId` (`:210`), классы `tabs-tab chatlist-parts folders-scrollable` (`:1262`), `attachBorderListeners()` (`:1263`), `div.chatlist-top` + `div.chatlist-bottom` (`:1268-1275`), `positionElementByIndex(container, folders.container, localId)` (`:1281`); `localId` = позиция в `folderItems` (0 — «Все чаты»; у tweb пространство с дыркой под архив — на `positionElementByIndex` это не влияет, объявить) |
| `onFiltersLengthChange` | `:1298-1322` | дословно: `pause(0)`, `length > 1`, `hide` на ряд и градиент, `has-filters` на `chatsContainer`, `setHasFolders(show)` (сигнал для задачи 8) |
| события `filter_update`/`filter_delete`/`filter_order` | `:924-968` | одна подписка на `folders.solid.folderItems` (после задачи 3 это и есть наш поток «добавили/удалили/переставили»): новая → `addFilter`, пропавшая → `container.remove()` + `xds[id].destroy()` + `onFiltersLengthChange()` + если была активной — `selectTab(0)` (порт `stores/folders.ts:130-133` **без** `length >= selectedId` — сравнение длины с id, дефект оригинала, объявить), порядок → `positionElementByIndex` по новому `localId` |
| `state_cleared` | `:640-652` | подписка на сброс `appState` при логауте (`stores/logoutReset.test.ts`): контейнеры пользовательских папок снимаются, «Все чаты» остаётся |
| свайп | `:617-634` | дословно под `IS_TOUCH_SUPPORTED`; `verifyTouchTarget` — `!forumOpen` из `hooks` |
| первый показ | `:1064-1065` (`filterId = -1; onClick(0, false)`) | дословно в `start()` |
| `destroy()` | у оригинала нет (синглтон живёт вечно) | **наше**: снять подписки и `ResizeObserver`, `dispose` Solid-корня, `xds[*].destroy()` (`Scrollable.destroy`), снять оверлей и `#folders-container` из `host` — DoD 5 |

`FolderList` (роль `xd`): `{id, scrollable, container, top, bottom, handle?: DialogListHandle}`;
`clear()`/`reset()`/`onChatsScroll()` делегируют в `handle`, а `onChatsScroll` без
хэндла запоминается и выполняется при `register(handle)` — см. «Ключевой шов».
`DialogListHandle = {clear(): void; reset(): void; onChatsScroll(): void}`.
Наружу для React: `subscribe(cb)`/`getRendered(): readonly FolderList[]`
(под `useSyncExternalStore`), `suggestionContainer`, `xd` (активный список — его
`scrollable.container` нужен ряду историй, `:829`).

**Файлы:**
- Создать: `web-client/src/lib/appDialogsManager.ts`
- Изменить: `web-client/src/shared/solid/mountSolid.solid.tsx` (`createSolidNodes`)
- Тесты: `web-client/src/lib/appDialogsManager.dom.test.ts`,
  `appDialogsManager.switch.test.ts`, `appDialogsManager.filters.test.ts`,
  `shared/solid/mountSolid.solid.test.tsx` (дописать)

- [ ] **Шаг 1: прочитать** `appDialogsManager.ts:480-530, :577-727, :729-822,
  :851-858, :924-968, :1014-1101, :1170-1176, :1249-1322`, `autonomousDialogList/base.ts:144-150,
  :347-380`, `dialogs.ts:207-238`, `docs/tweb/folders-tabs.md` § 1.6.
- [ ] **Шаг 2: падающий тест на DOM** (`dom.test`): после `start(host, chatsContainer)`
  в `host` лежат `.chatlist-overlay` (первым) и `#folders-container.tabs-container`
  (последним); в оверлее — `suggestionContainer`, `.folders-tabs-gradient-container.hide`,
  `.folders-tabs-scrollable.hide` (в этом порядке, дамп `14-left-01-chatlist.json:30-48`);
  в `#folders-container` — один `.folders-scrollable[data-filter-id="0"].active` с
  `.chatlist-top` + `.chatlist-bottom` (`:74-76`); при трёх папках в
  `folders.solid` — четыре контейнера в порядке `localId`, у ряда и градиента
  `hide` снят, у `chatsContainer` — `has-filters`; `ResizeObserver` оверлея пишет
  `--chatlist-overlay-height` на `host` (стаб `ResizeObserver` — happy-dom его не
  даёт); после `destroy()` в `host` пусто и в документе нет ни одного
  `.folders-scrollable` (DoD 5).
- [ ] **Шаг 3: падающий тест на переключение** (`switch.test`, главный пин
  задачи; живые `horizontalMenu` + `TransitionSlider`, настоящий `transitionend`,
  геометрия стабом — образец `appSearchSuper.scroll.test.ts`): клик по вкладке 1 →
  `onClick` получает `index 1`, `hooks.closeEverythingInsideNaturally` позван;
  контейнер папки 1 получил `active to`, папки 0 — `from`, `#folders-container` —
  `animating`; инлайновые `transform` = `translate3d(±width)` в момент старта
  (уходящий — `-width`, приходящий — `+width`, `slideTabs` `transition.ts:63-70`);
  клик обратно на 0 добавляет `backwards`; по `transitionend`: у уходящего сняты
  `active from` и `transform`, `handle.clear()` неактивной папки позван РОВНО один
  раз, а у активной — `reset()` и `onChatsScroll()`; `foldersStore.selectedId` = id
  папки 1. Мутации, каждая обязана покраснить: убрать `xds[id].clear()` (`:786`);
  убрать `onTransitionEnd` (`:798-804`); поменять местами элементы в `slideTabs`.
  Плюс: повторный клик по активной → `fastSmoothScrollToStart` с её контейнером,
  `selectedId` не меняется; `hooks.closeEverythingInsideNaturally` вернул `false` →
  вкладка не переключилась (`selectTarget` `:55-62`); `onChatsScroll` до
  регистрации хэндла → выполняется один раз при `register`, после регистрации —
  сразу.
- [ ] **Шаг 4: падающий тест на события** (`filters.test`): новая папка в стор →
  новый контейнер на позиции `localId`, ряд показан; папка удалена → её
  контейнер и `Scrollable` сняты, если была активной — активной стала «Все чаты»
  (через `selectTab(0)`, то есть с `from`/`to`); переупорядочивание → порядок
  детей `#folders-container` = порядок `folderItems`; осталась одна папка → ряд и
  градиент `hide`, `has-filters` снят; логаут → пользовательские контейнеры сняты.
  Свайп (стаб `IS_TOUCH_SUPPORTED`): `xDiff < 0` → следующая, в последней —
  остаётся (`clamp`).
- [ ] **Шаг 5: убедиться, что тесты падают.**
- [ ] **Шаг 6: реализовать** `createSolidNodes` (пин в `mountSolid.solid.test.tsx`:
  узлы отданы без обёртки, `dispose` не роняет соседей, ошибка внутри уходит в
  `ErrorBoundary`), затем владельца.

**Готово когда:** клик по i-й вкладке активирует контейнер с тем же
`data-filter-id`, что у вкладки (пин на порядок); все три мутации шага 3
подтверждены выводом vitest в теле коммита.

---

### Задача 6: шов — владелец въезжает в колонку, React-ряд и `TabSlide` удаляются

**Единственная задача, меняющая видимое поведение.** Ряд, контейнеры и
переключение к этому моменту умеет владелец (задачи 1-5), поэтому переключение —
атомарное, без периода «две реализации живы» (DoD 14).

**Что делаем:**

1. `Sidebar.tsx`: `.connection-status-bottom` (`:298`) отдаётся владельцу через
   `useImperativeIsland((host) => { manager.start(host, chatlistContainerRef.current, hooks); return () => manager.destroy() }, [], {mode: 'host'})`;
   `hooks.closeEverythingInsideNaturally` закрывает поиск/экран/архив/форум из
   состояния колонки и отвечает `true`, `hooks.isForumOpen` — для свайпа. Из JSX
   уходят: `has-filters` (`:292`), `useMeasuredHeight`/`overlayHeightVar` (`:139-144`),
   градиент (`:306-313`), `<FolderTabs>` (`:319-327`), `#folders-container` (`:328`);
   `<PendingSuggestion>` рисуется порталом в `manager.suggestionContainer`;
   `StoriesRow.getScrollable` → `manager.xd?.scrollable.container` (`:829`),
   `onExpand` — прокрутка того же узла; `listScrollRef` (`:101`) уходит.
2. `ChatList.tsx`: `TabSlide` снимается; компонент подписывается на
   `manager.subscribe/getRendered` (`useSyncExternalStore`) и на каждый
   `FolderList` рисует `createPortal(<ChatListFolder …/>, list.top)`; пропсы
   `folder`/`folderOrder` (`:40-49`) уходят — папку и порядок знает владелец.
3. `ChatListFolder`: `scrollableHost = list.scrollable.container` (вместо
   `ul.parentElement`, `:178-182`); `.chatlist-bottom` больше не рендерит (узел
   владельца, `:1271-1275`; клиренс под FAB `ChatList.module.scss::.bottom` и
   скроллбар `.scroll` — классы ставит владелец, `collapsed` — `manager.setCollapsed`);
   `useEffect(requestItemForIdx(0))` (`:195-197`) уходит — первую страницу просит
   `onTabChange` владельца; вместо него `useLayoutEffect(() => list.register({clear, reset, onChatsScroll}))`
   с `reset()` из `useDialogListSource` (новый метод: сброс `pageState` в
   `EMPTY_PAGE_STATE` + `cursorFetcher.reset()`; `clear` = `reset` + отрисовка
   пустого окна, как `deferredSortedVirtualList.tsx:157-168`).
4. `useSidebarFolders.tsx`: `tabOrder`, `folderUnread` (`:32`, `:46-52` — теперь из
   `folderUnreadCounts.ts`), `changeFolder` (`:60-63` — вертикальная колонка зовёт
   `manager.selectTab(index)`/`folders.solid.onClick()`), `onTabContextMenu`/`openTabMenu`
   (`:89-121` — уходят задачей 7, здесь помечаются) — хук худеет до
   `overlays`/`editingFolder`/удаления папки.
5. `stores/foldersStore.ts`: `deselectIfRemoved` (`:47-49`) снимается — сброс выбора
   при удалении активной папки делает владелец (`selectTab(0)`), писатель
   `selectedId` один; пин `foldersStore.test.ts:64-68` переезжает в
   `appDialogsManager.filters.test.ts`.
6. Удалить: `components/FolderTabs.tsx` (второй потребитель — задача 9),
   `shared/ui/Tabs/TabSlide.tsx` + `TabSlide.test.tsx` (если параллельная программа
   поиска уже сняла `SearchView.tsx`; иначе — задача 9), `shared/lib/useMeasuredHeight.ts`
   (единственный потребитель — `Sidebar.tsx`).
7. Пины переписать под оригинал (поправка 1): `Sidebar.chatlist.test.tsx:120-160`
   («папка помнит свой scrollTop» → «переключение начинает папку с начала;
   `--chatlist-overlay-height` ставит владелец на `host`»), `ChatList.test.tsx:514-660`
   («во время слайда в DOM оба списка» — остаётся, но `ul` уходящего пустеет по
   `transitionend`; «возврат восстанавливает scrollTop» → «возврат просит первую
   страницу заново, `scrollTop = 0`»; «страница просится по разу на папку» → «на
   каждый показ, без сети»; «наружу отдаётся скроллер активной папки» → через
   `manager.xd`; «показанная папка ушла из folderOrder» → предмет исчез: владелец
   снимает контейнер и переключает на «Все чаты»). Комментарии-ссылки на `TabSlide`
   в `useDialogListSource.test.tsx:649-653` и `foldersStore.test.ts:64-68` —
   актуализировать.

> **Осторожно: узлы React внутри узла владельца.** `destroy()` владельца снимает
> `.folders-scrollable` целиком; если React-портал ещё жив, его `ul` уедет из
> документа вместе с узлом, а React при размонтировании попытается снять детей у
> оторванного `.chatlist-top` — это безопасно, но ТОЛЬКО если порядок «сначала
> портал, потом владелец» не нарушен. `useImperativeIsland` гасит остров на
> размонтировании `Sidebar` в `useLayoutEffect(() => stop)` — после того, как
> React снял детей. Тест обязателен: размонтирование `Sidebar` не оставляет в
> документе ни `.folders-scrollable`, ни `ul.chatlist`, и не пишет ошибок в консоль.

**Файлы:**
- Изменить: `web-client/src/components/Sidebar.tsx`, `components/ChatList.tsx`,
  `components/ChatList.module.scss`, `core/hooks/useSidebarFolders.tsx`,
  `core/hooks/useDialogListSource.ts`, `stores/foldersStore.ts`,
  `components/sidebarLeft/pendingSuggestion.tsx`
- Удалить: `web-client/src/components/FolderTabs.tsx`, `shared/lib/useMeasuredHeight.ts`,
  (условно) `shared/ui/Tabs/TabSlide.tsx`, `TabSlide.test.tsx`
- Тесты: `components/Sidebar.chatlist.test.tsx`, `components/ChatList.test.tsx`,
  `core/hooks/useDialogListSource.test.tsx` (пин на `reset()`), `stores/foldersStore.test.ts`

- [ ] **Шаг 1: падающий тест на шов** (в `Sidebar.chatlist.test.tsx`): `ul.chatlist`
  лежит внутри `.folders-scrollable[data-filter-id] > .chatlist-top` — узла, которого
  React не создавал; клик по вкладке «Работа» переключает контейнер с тем же
  `data-filter-id` и после `transitionend` у «Всех чатов» `ul` пуст, а у «Работы»
  первая строка — `#1`, `scrollTop` = 0; `getDialogs` для «Работы» позван на каждый
  показ, `fetch` — ни разу.
- [ ] **Шаг 2: падающий тест на владение** (DoD 5): после `unmount()` колонки в
  документе нет `.chatlist-overlay`, `.folders-scrollable`, `ul.chatlist`; консоль пуста.
- [ ] **Шаг 3: падающий тест на первую загрузку**: первая папка просит страницу
  РОВНО один раз (late binding хэндла), вторая — при первом показе. Мутация:
  оставить `useEffect(requestItemForIdx(0))` в `ChatListFolder` — запросов станет два.
- [ ] **Шаг 4: убедиться, что тесты падают.**
- [ ] **Шаг 5: реализовать переключение и удалить React-версию.**
- [ ] **Шаг 6: живая проверка на стенде** (DoD 10) — пункты 1-7 и 11 чеклиста
  `docs/tweb/folders-tabs.md` § «Проверка после порта»; числа (переход
  выезжает: длительность по `--tabs-transition`, оба кадра в DOM; `scrollTop` после
  переключения) — в тело коммита.
- [ ] **Шаг 7: посчитать** число `.tsx` с импортом `react` до и после (DoD 14;
  на `6eab4970` их 228) и прогнать `node tools/tweb-parity/ownership-audit.mjs` —
  в `Sidebar.tsx`/`ChatList.tsx` не должно появиться ручных `classList` на узлах
  владельца. Цифры — в тело коммита.

**Готово когда:** `git grep -n "FolderTabs\b" web-client/src` пуст (кроме задачи 9);
`git grep -n "keepMounted" web-client/src` пуст; число React-файлов уменьшилось;
чеклист прощёлкан.

---

### Задача 7: контекстное меню папки — `createFolderContextMenu` на оба ряда

**Что делаем.** Порт `tweb/src/helpers/dom/createFolderContextMenu.ts` (75) поверх
нашего `helpers/dom/createContextMenu.ts`: пункты `FilterEdit` (`:35-41`),
`FilterEditAll` (`:42-50`), `Delete` (`:58-65`), папка — из `target.dataset.filterId`
(`:69-71`). `MarkAllAsRead` (`:51-57`) не объявляется — ручки `markFolderAsRead`
нет (задача 12), у строки комментарий. Открытие редактора/списка папок — колбэки
из хоста (`FolderEditor`, `SettingsView(initialSub='Chat Folders')` — сегодняшние
`setEditingFolder`/`onOpenFolderSettings` в `useSidebarFolders.tsx:96-104`).

Вешается дважды, как в оригинале: владелец — на `folders.menu`
(`appDialogsManager.ts:814-821`, `className: 'menu-horizontal-div-item'`) и
вертикальная колонка — на контейнер своих строк
(`foldersSidebarContent/index.tsx:84-92`): `FoldersSidebar.tsx` получает
`data-filter-id` на строках и `useImperativeIsland` с тем же `createFolderContextMenu`.
React-меню `openTabMenu`/`onTabContextMenu` (`useSidebarFolders.tsx:89-121`) и
`onContextMenu`-пропсы `FoldersSidebar` удаляются.

**Файлы:**
- Создать: `web-client/src/helpers/dom/createFolderContextMenu.ts`
- Изменить: `web-client/src/lib/appDialogsManager.ts`, `core/hooks/useSidebarFolders.tsx`,
  `components/folders/FoldersSidebar.tsx`
- Тесты: `web-client/src/helpers/dom/createFolderContextMenu.test.ts`

- [ ] **Шаг 1: прочитать** оригинал и наш `createContextMenu.ts:30-53`,
  `createParticipantContextMenu.ts` (образец порта поверх него).
- [ ] **Шаг 2: падающий тест**: правый клик по вкладке папки даёт меню с
  `FilterEdit` и `Delete` (без `FilterEditAll`), по «Все чаты» — только
  `FilterEditAll`; пункты, не прошедшие `verify`, **не созданы** (не скрыты);
  `Delete` зовёт колбэк с id папки из `data-filter-id`; то же — на строке
  вертикальной колонки.
- [ ] **Шаг 3: убедиться, что тест падает.**
- [ ] **Шаг 4: реализовать.**

**Готово когда:** `git grep -n "openTabMenu\|onTabContextMenu" web-client/src` пуст;
меню у ряда и у колонки — один модуль.

---

### Задача 8: body-классы режима папок и снятие статического класса

**Что делаем.** Порт эффекта `tweb/src/stores/foldersSidebar.ts:90-112`:
`has-horizontal-folders` = `hasFolders ∧ (не свёрнута ∨ узкий экран) ∧ вертикальная колонка не показана`,
`has-vertical-folders` — инверсия при `hasFolders`. `hasFolders` ставит владелец
(`onFiltersLengthChange` `:1315-1316` → `setHasFolders`, `foldersSidebar.ts:43-50`);
«колонка показана» и «свёрнута» у нас уже есть в `Sidebar.tsx:151-157` и `:167`
(`foldersSidebarShown`, `collapsed`). Статический `has-horizontal-folders` из
`web-client/index.html:33` снимается — теперь ряд ВСЕГДА в DOM и его видимость
решает только этот класс (`_leftSidebar.scss:308-312`), поэтому эффект перестаёт
быть косметикой.

**Файлы:**
- Создать: `web-client/src/stores/foldersSidebar.solid.ts` (сигналы `useHasFolders`,
  `useFoldersSidebarShown`, `useIsSidebarCollapsed` + эффект классов)
- Изменить: `web-client/src/components/Sidebar.tsx` (писать сигналы из своего
  состояния), `web-client/index.html`
- Тест: `web-client/src/stores/foldersSidebar.solid.test.ts`

- [ ] **Шаг 1: прочитать** `foldersSidebar.ts` целиком и `Sidebar.tsx:151-190`.
- [ ] **Шаг 2: падающий тест**: одна папка → ни того, ни другого класса; две папки
  → `has-horizontal-folders`; включили «папки слева» на широком экране →
  `has-vertical-folders`, горизонтальный снят; сузили экран → снова горизонтальный.
- [ ] **Шаг 3: убедиться, что тест падает.**
- [ ] **Шаг 4: реализовать**; из `index.html` класс убрать (комментарий там же
  обновить).

**Готово когда:** `grep -n has-horizontal-folders web-client/index.html` пуст; на
стенде переключение «Расположение папок» прячет/показывает ряд без перерендера
колонки.

---

### Задача 9: `ForwardPicker` без ряда папок, судьба `shared/ui/Tabs`

**Что делаем.** Второй потребитель `FolderTabs.tsx` — `components/messages/ChatDialogs.tsx:278`
(`ForwardPicker`). У оригинала селектор пиров ряда папок не имеет: `appSelectPeers.ts`
знает лишь скоуп по одной папке (`:69-70`, `:631-646`, `:1358-1366`), а попапы
пересылки/выбора пользователя (`popups/forward.ts`, `popups/pickUser.ts`) папок не
касаются вовсе. Ряд в `ForwardPicker` — наше, не портированное поведение
(`docs/tweb/folders-tabs.md` § 2.3 п. 3); снимается вместе с `folderId`-состоянием
(`ChatDialogs.tsx:181`, `:205`). Сам `ForwardPicker` остаётся React до волны 1.

После этого у `shared/ui/Tabs` остаётся один потребитель — `SearchView.tsx:36`
(`Tabs`, `TabSlide`), который сносит параллельная программа глобального поиска.
Правило: **`shared/ui/Tabs` удаляет та программа, что снимает последнего
потребителя** — проверить `git grep -n "shared/ui/Tabs" web-client/src` в момент
выполнения. `TabsBar.tsx` (45) потребителей не имеет уже сейчас — удаляется здесь
безусловно.

**Файлы:**
- Изменить: `web-client/src/components/messages/ChatDialogs.tsx`
- Удалить: `web-client/src/shared/ui/Tabs/TabsBar.tsx`, `TabsBar.module.scss`;
  условно — весь `shared/ui/Tabs/`
- Тесты: `components/messages/ForwardPicker.test.tsx` (пин: в попапе нет
  `.menu-horizontal-div`)

- [x] **Шаг 1:** ~~снять ряд и состояние папки из `ForwardPicker`~~ — см. поправку ниже: ряд
  портирован, а не снят; тест `components/messages/ForwardPicker.test.tsx`.
- [x] **Шаг 2:** `git grep -n "TabsBar"` пуст; решить по `shared/ui/Tabs` по правилу выше.

**Готово когда:** `git grep -n "components/FolderTabs\|from './FolderTabs'" web-client/src` пуст.

**Поправка при выполнении (проверено в tweb e52b5d931).** Посылка «у оригинала селектор пиров ряда
папок не имеет» неверна: ссылки `popups/forward.ts`/`popups/pickUser.ts` указывали на файлы,
которых в базе нет (они `.tsx`). `showForwardPopup` зовёт `showPickUserPopup({showTopPeers: true, …})`
(`popups/forward.tsx:360-376`), а тот при `showTopPeers` ставит за «недавними» Solid-`FoldersTabs`
(`createFolderTabs`, `popups/pickUser.tsx:325-424`, вызов `:509`): клик → `selectTarget` →
прокрутка списка к началу → `selector.setFolderId`; на запросе ряд `is-collapsed`, скоуп —
«Все чаты» (`appSelectPeers.ts:631-633`, `:644-647`). Поэтому ряд не снят, а ПОРТИРОВАН:
`components/popups/pickUserFolderTabs.ts` (6 расхождений в шапке) монтирует Solid-`FoldersTabs`
в узел-хост `ForwardPicker`; состояние `folderId` осталось — это `selectedFolderId` селектора.
Удалены `components/FolderTabs.tsx`, `shared/ui/Tabs/TabsBar.tsx` + `TabsBar.module.scss` и
экспорт `TabsBar`; у `Tabs.tsx` сняты пропы, которые держал только папочный ряд. У
`shared/ui/Tabs/{Tabs,TabSlide,index}` остаётся потребитель `SearchView.tsx` — не удалены,
отложенная задача 19. Регэксп DoD `FolderTabs\b` ловит теперь только имя порта
`createFolderTabs`/`pickUserFolderTabs` (имя функции tweb); `git grep -nw FolderTabs web-client/src` пуст.

---

## Отложено — с предметом, а не «потом посмотрим» (DoD 13)

| № | Что | Почему отложено | Что разблокирует |
|---|---|---|---|
| 10 | Лимит папок для не-Premium: `isFilterIdAvailable` + `showLimitPopup('folders')` (`appDialogsManager.ts:742-748`, `storages/filters.ts:544-554`, `popups/limit.ts:116`) | Нет ни лимитов (`getLimit`), ни `PopupLimit`; бэкенд лимитов не отдаёт | Отказ переключения на недоступную папку + попап с апселлом |
| 11 | Кастомные эмодзи в названии папки: `wrapFolderTitle` → `documentFragmentToNodes` (`foldersTabs.tsx:24-30`), перекраска `custom-emoji-renderer-element` в `onChange` (`:806-809`) | `Folder.title` на проводе — строка без сущностей (`foldersManager.ts:5-17`, бэкенд `folders_handler.go`); `custom-emoji-renderer` не портирован | Названия папок 1:1 с Telegram |
| 12 | Пункт `MarkAllAsRead` в меню папки (`createFolderContextMenu.ts:51-57`) | Нет `dialogs.markFolderAsRead` и папочного `getFolderUnreadCount` в воркере/бэкенде | Полное меню папки |
| 13 | Плашка «N новых чатов» shared-папки (`onTabChange` `:1103-1165`, `createTopNotification` `:1178-1247`) | Нет `getChatlistUpdates`/`chatlist_update_period`; у нас есть только инвайты папок (`FolderInvite`) | Вступление в обновлённую shared-папку одним кликом |
| 14 | Пустая папка: 📂 + «Edit Folder» (`generateEmptyPlaceholder` `:1324-1435`, ветка `folder` `:1399-1430`) | `wrapStickerEmoji` не портирован; сейчас пустая папка — просто пустой список | Плейсхолдер 1:1 |
| 15 | События стора `filter_joined` (переключение на вступившую папку) и `premium_toggle` (сброс на ALL, `stores/folders.ts:193-206`) | Событий на проводе нет | Поведение после вступления по ссылке/потери Premium |
| 16 | Счётчик папки от воркера (`dialogsStorage.getFolderUnreadCount`, `folders.ts:19-30`) | Воркер папочный unread не считает; сейчас — чистая функция с main из зеркала (`core/folders/folderUnreadCounts.ts`, задача 3): считает только диалоги, уже лежащие в зеркале, без `unread_mark` и суммы по топикам форума. `muted` с упоминаниями уже портирован целиком (`folders.ts:28`), `unread_mentions_count` в `Dialog` есть | Один владелец счётчика в воркере, счёт по всей папке, а не по загруженной части |
| 17 | Вертикальная колонка на Solid — порт `foldersSidebarContent/index.tsx` (242) с бургером-в-колонке и кнопкой «добавить чаты» | По карте спеки § 4 — оболочка сайдбара, волна 7; здесь колонка только переводится на общий `selectTab`, счётчики и меню | Снятие React с левой колонки |
| 18 | `Tabs.Content`/`Tabs.ContentTab`/`Tabs.Simple` (`tabs.tsx:97-170`) | Потребители у tweb — `boosts.tsx`, `popups/stars.tsx`, которых у нас нет | Вкладки бустов/звёзд |
| 19 | `shared/ui/Tabs/{Tabs,TabSlide}.tsx` (+ `Tabs.module.scss`, `index.ts`, `TabSlide.test.tsx`) — последний потребитель `SearchView.tsx:36` (проверено задачей 9: `git grep -n "shared/ui/Tabs" web-client/src` → только `SearchView.tsx`; `TabsBar` и папочные пропы `Tabs.tsx` удалены задачей 9) | Сносится программой глобального поиска (`AppSearchSuper` с `asChatList`, отложенная задача 20 плана shared media) — по правилу задачи 9 каталог удаляет та программа, что снимает последнего потребителя | Ноль React-переписок полосы вкладок |
| 20 | Архив как вкладка слайдера (`AppArchivedTab`, `left-sidebar.md` часть 1 § 6) и побочки `onCollapsedChange` (`left-sidebar.md` § 8.2 п. 5, 9) | Не предмет ряда папок; свои задачи в `left-sidebar.md` | — |
| 21 | `shared/ui/PeerSelector/PeerSelector.tsx:252-256` собирает `menu-horizontal-gradient*` руками (найдено задачей 1) | React-файл вне ряда папок; Solid-фабрику `Tabs.MenuGradient` из React напрямую не позвать — нужен остров или порт `PeerSelector` | Один строитель градиента на весь репозиторий (критерий задачи 2) |

## Оценка объёма

| Задача | Строк оригинала | Размер |
|---|---|---|
| 1 `tabs.solid` + `badge.solid` | ~100 из 172 + 26 | S |
| 2 градиент `AppSearchSuper` | 5 | S |
| 3 `folders.solid` + `folderUnreadCounts` | ~120 из 222 | M |
| 4 `foldersTabs.solid` | 61 | S |
| 5 владелец `appDialogsManager` (срез) | ~300 | **L** |
| 6 шов и снос React | — (правка 6 файлов, 3 теста) | **L** (риск, не объём) |
| 7 меню папки | 75 | M |
| 8 body-классы | ~25 | S |
| 9 `ForwardPicker`, `shared/ui/Tabs` | — | S |

## DoD программы (перед мержем задачи 6)

Спека § 9, пункты 9-14, плюс предметно:

- [ ] `vite build` живой; `vitest run`, `tsc --noEmit`, `oxlint --type-aware` зелёные из `web-client/`.
- [ ] Стенд: чеклист `docs/tweb/folders-tabs.md` § «Проверка после порта» прощёлкан,
  пункты 3-5 — с числами в теле коммита (переход папок **выезжает**, длительность
  `--tabs-transition`; после перехода `scrollTop` активной = 0, у неактивных `ul` пуст;
  сетевых запросов при переключении — 0).
- [ ] `node tools/tweb-parity/dom-parity.mjs 14-left-01-chatlist ours.txt` — расхождений
  по `.chatlist-overlay`/`#folders-container`/`.folders-scrollable` нет.
- [ ] `node tools/tweb-parity/ownership-audit.mjs` — новых находок в `Sidebar.tsx`/`ChatList.tsx` нет.
- [ ] `git grep -n "keepMounted\|FolderTabs\b\|useMeasuredHeight" web-client/src` пуст; число
  `.tsx` с импортом `react` меньше 228.
- [ ] Секция «у нас» в `docs/tweb/folders-tabs.md` (§ 2) и строка в `left-sidebar.md` § 8
  обновлены в том же изменении.
