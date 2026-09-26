# Папки чатов: ряд вкладок и слайдер папок — `foldersTabs`/`tabs` в tweb vs наши `FolderTabs`/`TabSlide`

Снято 2026-09-08. Источники:

- tweb `/Users/denisurevic/Documents/tweb`, коммит `e52b5d931` («Add dev server typecheck and lint overlay»);
- наш код `web-client/` на `main` (`6eab4970`).

> Локальный tweb — форк. Для папок это важно втройне: (1) ряд вкладок там уже
> Solid-компонент поверх Solid-обёртки `tabs.tsx`; (2) чатлист виртуализован, и
> `positionElementByIndex` остался только для КОНТЕЙНЕРОВ папок; (3) есть
> вертикальная колонка папок с общим стором `stores/folders.ts`. Ниже — состояние
> форка, а не апстрима.

Это разбор **одной подсистемы**: ряда вкладок папок над списком чатов, контейнеров
папок (`#folders-container`) и их переключения. Каркас колонки, слайдер вкладок
настроек, глобальный поиск, строка чатлиста, вертикальная колонка целиком —
[`left-sidebar.md`](left-sidebar.md) (часть 1 § 5, часть 5 § 8, часть 7, часть 8),
здесь не дублируются. Полоса вкладок как механизм (`horizontalMenu`, `TransitionSlider`)
и её потребитель в правой колонке — [`shared-media.md`](shared-media.md) § 1.4.

**Порт по этому доку** — план
[`../superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`](../superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md).

---

## 0. Три поправки к постановке — прежде чем читать дальше

Три вещи, которые «ожидаются по умолчанию» и которые в нашем коде уже записаны
как «так в tweb», в оригинале устроены иначе. Проверено в исходниках.

| Ожидание | Как на самом деле в tweb |
|---|---|
| «Папка помнит свой `scrollTop`: ушли и вернулись — позиция на месте» (так утверждает `core/hooks/useSidebarFolders.tsx:54-59` и пины `Sidebar.chatlist.test.tsx:131`, `ChatList.test.tsx:566`) | **Памяти позиции у папок нет.** Контейнер-скроллер папки создаётся один раз (`appDialogsManager.ts:1249-1290`) и живёт дальше — но его СОДЕРЖИМОЕ нет: `selectFolderByIndex` зовёт `this.xds[id].clear()` (`:786`) ПЕРЕД переключением, а `onTransitionEnd` полосы чистит все неактивные списки (`:798-804`). `clear()` (`autonomousDialogList/base.ts:353-362` → `sortedDialogList.ts:271-273` → `deferredSortedVirtualList.tsx:157-168`) обнуляет элементы, `totalCount` и `wasAtLeastOnceFetched` — `ul` схлопывается, `scrollTop` уходит в 0. Затем `onTabChange` (`:1092-1101`) делает `xd.reset()` и `xd.onChatsScroll()` → `requestItemForIdx(0)` (`base.ts:144-146`): папка каждый раз показывается с первой страницы, которую хранилище отдаёт из кэша без сети (`lib/storages/dialogs.ts:1700-1710`; у нас — `core/managers/dialogsManager.ts::getDialogs`, тот же порт). Повторный клик по активной папке — прокрутка к началу (`:779-782`), в ту же сторону. |
| «Заголовок «Все чаты» переключается между коротким и длинным ключом по ширине ряда (`changeFiltersAllChatsKey`)» | **В форке это мёртвый код.** `allChatsIntlElement` (`:539`, создаётся `:636-638`, обновляется `:1295`) нигде не вставляется в DOM — `grep -rn allChatsIntlElement src` даёт ровно эти три строки. Ряд рендерит Solid-`FoldersTabs`, и для `FOLDER_ID_ALL` там всегда `i18n('FilterAllChatsShort')` (`foldersTabs.tsx:20-22`). Слушатель `resize` (`:700-702`) тоже крутится впустую. Не портируется. |
| «Свайп между папками — это жест над кадрами слайдера с замком `lockTouchScroll`, как у shared media» | **Свайп — это клик.** `handleTabSwipe` на `folders.container` (`:617-634`, только при `IS_TOUCH_SUPPORTED`) считает соседний индекс от `selectedFolderIndex()` стора и зовёт `folders.onClick()(newIndex)` — ту же функцию `selectTab`, что и клик по вкладке (`:812`). `lockTouchScroll` папки не используют (он у `appSearchSuper.ts:498-542`). |

---

# Часть 1. Что делает оригинал

## 1.1 Карта файлов

| Путь | Строк | Роль |
|---|---|---|
| `index.html:98-101` | — | статический скелет: `#chatlist-container.transition-item > #folders-container.tabs-container` |
| `src/components/foldersTabs.tsx` | 61 | Solid-компонент ряда вкладок папок |
| `src/components/tabs.tsx` | 172 | Solid-обёртка `Tabs.*` вокруг классов `.menu-horizontal-*` и `horizontalMenu` |
| `src/components/badge.tsx` | 26 | Solid-бейдж `badge badge-{size} badge-{color}` |
| `src/components/scrollable2.tsx` | 355 | Solid-скроллер; `MenuScrollable` берёт его с `axis="x"` |
| `src/stores/folders.ts` | 222 | Solid-стор папок: `folderItems`, `selectedFolderId`, сигнал `onClick` |
| `src/stores/foldersSidebar.ts` | 112 | сигналы режима: `useHasFolders`, `useFoldersSidebarShown`, классы `body.has-horizontal-folders`/`has-vertical-folders` |
| `src/lib/appDialogsManager.ts` | 2695 | **владелец контейнеров папок** и переключения (срез ~300 строк, адреса в § 1.6) |
| `src/components/autonomousDialogList/{base,dialogs}.ts` | 381 / 420 | список одной папки (`xd`): скроллер, `clear`/`reset`/`onChatsScroll` |
| `src/components/horizontalMenu.ts` | 215 | полоса вкладок + `TransitionSlider` — **портирован**, `web-client/src/components/horizontalMenu.ts` |
| `src/components/transition.ts` | 383 | `TransitionSlider`, ветка `slideTabs` `:45-95` — **портирован**, `web-client/src/components/transition.ts` |
| `src/helpers/dom/handleTabSwipe.ts`, `positionElementByIndex.ts` | 19 / 23 | **портированы** 1:1 |
| `src/helpers/dom/createFolderContextMenu.ts` | 75 | контекстное меню папки (общее с вертикальной колонкой) |
| `src/scss/partials/_leftSidebar.scss`, `_slider.scss` | — | стили (§ 1.8) — **портированы** в `styles/tweb/` |

## 1.2 DOM подсистемы (живой дамп)

Эталон — `docs/tweb/dom/dumps/14-left-01-chatlist.json` (дамп — одна JSON-строка;
номера ниже по РАЗВЁРНУТОМУ тексту, `json.load(...).split('\n')`; то же дерево —
`02-chatlist.json:164-188`, там оверлей с плашкой-подсказкой высотой 296px):

```
:28  div.transition-item.has-filters.active#chatlist-container   [--stories-scrolled]
:29    div.connection-status-bottom                              [--chatlist-overlay-height: 0px]
:30      div.chatlist-overlay
:31-45     div … (suggestionContainer → плашка pending suggestion, Solid)
:46        div.menu-horizontal-gradient-container.folders-tabs-gradient-container
:47          div.menu-horizontal-gradient.menu-horizontal-gradient-color-surface.menu-horizontal-gradient-smaller.folders-tabs-gradient
:48        div.menu-horizontal-scrollable.folders-tabs-scrollable
:49          div.scrollable.scrollable-x
:50            div.menu-horizontal-div#folders-tabs
:51              div.menu-horizontal-div-item.active            [data-filter-id]
:52                i.menu-horizontal-div-item-background
:53                div.menu-horizontal-div-item-span
:54                  span.text-super  → span.i18n "All"
:56                  div.badge.badge-20.badge-primary[.is-badge-empty]
:57-71           … ещё вкладки той же формы
:73      div.tabs-container#folders-container
:74        div.scrollable.scrollable-y.tabs-tab.chatlist-parts.folders-scrollable.scrollable-y-bordered.active.scrolled-start[.scrolled-end]  [data-filter-id]
:75          div.chatlist-top
:76            ul.chatlist.virtual-chatlist                      [height: N*72px]
:…          div.chatlist-bottom
:142,146,150 div.scrollable.scrollable-y.tabs-tab.chatlist-parts.folders-scrollable…  (остальные папки, без active)
```

Три факта, которые важны для шва:

1. Градиент и карточка ряда — **прямые дети** `.chatlist-overlay`, без обёртки
   (`:46`, `:48`): `.folders-tabs-gradient-container { position:absolute; inset:0; z-index:-1 }`
   растягивается на весь оверлей (`_leftSidebar.scss:319-324`), плашка-подсказка
   выше него тоже накрывается фейдом.
2. Все контейнеры папок лежат в DOM **одновременно** (`:74`, `:142`, `:146`, `:150`),
   показан один — `.tabs-tab { display:none } .tabs-tab.active { display:flex }`
   (`_slider.scss:171-184`). Порядок детей `#folders-container` = порядок вкладок:
   `TransitionSlider` берёт кадр как `content.children[id]` (`horizontalMenu.ts:56`).
3. У неактивных папок `scrolled-end` стоит вместе со `scrolled-start` (`:142`) —
   список пуст, это следствие поправки 1 (§ 0).

## 1.3 `tabs.tsx` — Solid-обёртка над классами `.menu-horizontal-*`

| Часть | Стр. | Что рендерит |
|---|---|---|
| `Tabs` | `:7-20` | контекст-пустышка `TabsContext` + `props.children` |
| `Tabs.Menu` | `:22-39` | `div.menu-horizontal-div[.class]#id`, `onClick`, `ref` |
| `Tabs.MenuTab` | `:41-54` | `div.menu-horizontal-div-item[.class] > i.menu-horizontal-div-item-background + div.menu-horizontal-div-item-span > children` |
| `Tabs.MenuScrollable` | `:56-69` | `div.menu-horizontal-scrollable[.class] > <Scrollable axis="x" {...scrollableProps}>` — Solid-скроллер `scrollable2.tsx`; наружу отдаёт `ref` обёртки и через `scrollableProps.contextRef` — `ScrollableContextValue` (`scrollable2.tsx:26-36`, `:44`, `:291-293`) |
| `Tabs.MenuGradient` | `:71-95` | `div.menu-horizontal-gradient-container[.{className}-container] > div.menu-horizontal-gradient.menu-horizontal-gradient-color-{surface\|background}[.menu-horizontal-gradient-smaller][.{className}]` |
| `Tabs.Content` / `Tabs.ContentTab` | `:97-120` | контейнер содержимого / вкладка с `hide` |
| `Tabs.Simple` | `:122-170` | ряд + содержимое одним компонентом; внутри позиционная `horizontalMenu(tabs, content, …)` (`:156-166`) |

Потребители во всём tweb (`grep -rn 'Tabs\.'`): `foldersTabs.tsx` (Menu/MenuTab/MenuScrollable/MenuGradient),
`appSearchSuper.ts:597` и `selectorSearch.ts:78` (только `MenuGradient`, вызовом как
функции — `Tabs.MenuGradient({...}) as HTMLElement`), `sidebarRight/tabs/boosts.tsx:139-286`
(Menu/MenuTab/Content/ContentTab), `popups/stars.tsx:760` (`Simple`).
Собственных стилей у `menu-horizontal-gradient*` нет — правило даёт потребитель
(для папок `_leftSidebar.scss:315-325`).

## 1.4 `foldersTabs.tsx` — ряд вкладок

| Стр. | Что |
|---|---|
| `:11-15` | пропсы: `scrollableProps` (для `MenuScrollable`), `menuProps` (для `Menu`), `gradientProps` (для `MenuGradient`; без них градиент не рисуется, `:53`) |
| `:16` | `const {folderItems} = useFolders()` — единственный источник |
| `:18-49` | `Tab(item)`: заголовок — для `FOLDER_ID_ALL` всегда `i18n('FilterAllChatsShort')` (`:20-22`), иначе `wrapFolderTitle(item.filter.title, middleware, true, {textColor:'secondary-text-color'})` → `documentFragmentToNodes` (`:24-30`, кастомные эмодзи в названии) |
| `:34-36` | `Tabs.MenuTab` с `ref.dataset.filterId = item.filter.id` — по нему меню и `onChange` находят папку |
| `:37-39` | `span.text-super` вокруг заголовка |
| `:40-46` | `<Badge tag="div" size={20} color={muted ? 'gray' : 'primary'}>{count}</Badge>` — при `count` 0 у бейджа `is-badge-empty` (`badge.tsx:19`) |
| `:51-59` | `Tabs > [MenuGradient] > MenuScrollable > Menu > For each={folderItems}` |

Компонент **не читает `selectedFolderId`** и не ставит `active` сам: класс
переставляет `horizontalMenu` на DOM (`horizontalMenu.ts:97-103`, `:129-132`).

## 1.5 Стор `stores/folders.ts`

| Стр. | Что |
|---|---|
| `:9-17` | `StoredFolder {id, notifications?: {count, muted}, chatsCount, filter}` |
| `:19-30` | `getNotificationCountForFilter` — из воркера `dialogsStorage.getFolderUnreadCount`; для «Все чаты» `unreadUnmutedCount`, иначе `unreadCount`; `muted` = всё непрочитанное замьючено и без меншенов |
| `:32-51` | `getFolderItemsInOrder` — сортировка по `filter.localId` |
| `:54-56` | `selectedFolderId` (сигнал), `folderItems` (`createStore`), `selectedFolderIndex` (мемо) |
| `:58-63` | **`onClick`-сигнал**: сюда менеджер кладёт свой `selectTab` (`appDialogsManager.ts:812`); `setSelectedFolderId` внутри стора — это и есть `onClick()` |
| `:65-100` | `updateFolderItem`, `updateFolderNotifications`, `updateAllFolderNotifications`, `makeFolderItemPayload` |
| `:102-118` | `updateOrAddFolder`; `:120-134` `deleteFolder` (`:131` — `length >= selectedId \|\| selectedId === filterId` сравнивает ДЛИНУ списка с ID папки; при id из плотного пространства это сбрасывает выбор на «Все» почти всегда — дефект оригинала, см. часть 2); `:136-153` `updateItemsOrder` |
| `:155-167` | `hydrateFilters` — один раз, без архива, затем `initListeners` |
| `:169-207` | подписки: `dialog_flush`, `folder_unread`, `filter_update`, `filter_delete`, `filter_order`, `filter_joined` (переключение на вступившую папку), `premium_toggle` (сброс на ALL, если папка стала недоступна) |

## 1.6 Владелец контейнеров и переключения — `appDialogsManager.ts`

### Поля

| Поле | Стр. |
|---|---|
| `filterId`; `folders = {menu, menuScrollContainer, menuGradient, container: #folders-container}` | `:518-525` |
| `filtersRendered: {[id]: FilterRendered {id, container, scrollable, topNotification…}}` | `:526-528`, тип `:480-490` |
| `showFiltersPromise` | `:529` |
| `allChatsIntlElement` (мёртв, § 0) | `:539` |
| `filtersNavigationItem` | `:544` |
| `xd`, `xds: {[filterId]: AutonomousDialogList}` | `:558-559` |
| `bottomPart`, `suggestionContainer`, `authorizationContainer`, `foldersOverlay` | `:565`, `:569-571` |
| `ignoreFolderChange` — объявлено, нигде не используется | `:575` |

### Старт (`start()`, `:577-727`)

| Стр. | Что |
|---|---|
| `:587-589` | `bottomPart = div.connection-status-bottom`; `bottomPart.append(folders.container)` |
| `:595-597` | `foldersOverlay = div.chatlist-overlay`, `bottomPart.prepend(overlay)` |
| `:601-604` | `ResizeObserver(overlay)` → `bottomPart.style --chatlist-overlay-height` |
| `:617-634` | свайп (§ 0, поправка 3); `verifyTouchTarget: !this.forumTab` |
| `:640-652` | `state_cleared` → сброс флагов, `xd.clear()` + `onTabChange()` для реальных папок, `onStateLoaded` |
| `:654-686` | `createRoot(() => { const element = FoldersTabs({...}); this.foldersOverlay.append(...children(() => element).toArray()) })` — Solid-узлы кладутся в оверлей **напрямую, без хоста**. Пропсы: `scrollableProps.class = 'folders-tabs-scrollable hide'`, `ref → folders.menuScrollContainer`, `scrollableProps.contextRef → scrollableContext`; `menuProps.id = 'folders-tabs'`, `ref → folders.menu` и **здесь же `this.onRef(scrollableContext)`**; `gradientProps {className:'folders-tabs-gradient', color:'surface', smaller:true, ref → folders.menuGradient + класс hide}` |
| `:700-702` | `resize` → `changeFiltersAllChatsKey` (мёртв) |
| `:704` | `chatsContainer.append(bottomPart)` |
| `:723` | `xd = xds[filterId]` |

### `onRef` — сборка переключения (`:729-822`)

| Стр. | Что |
|---|---|
| `:730-735` | `setFilterId(FOLDER_ID_ALL)` + `addFilter({id: ALL, title пустой, localId: ALL})` — контейнер «Все чаты» есть всегда |
| `:737` | из стора берутся `setSelectedFolderId`, `onClick`, `setOnClick`, `folderItems` |
| `:738-791` | **`selectFolderByIndex(index)`** — `onClick` полосы: |
| `:739-740` | `id = folderItems[index]?.filter.id ?? ALL`, `wasFilterId` |
| `:742-748` | доступность: `wasFilterId === -1 \|\| REAL_FOLDERS.has(id) \|\| filtersStorage.isFilterIdAvailable(id)` (`storages/filters.ts:544-554`, лимит папок не-премиум); иначе `showLimitPopup('folders')` (`popups/limit.ts:116`) и `return false` — полоса переключение **отменяет** (`horizontalMenu.ts:55-62`) |
| `:756-758` | `appSidebarLeft.closeEverythingInsideNaturally()` (`sidebarLeft/index.ts:505-516`: закрыть вкладки «через назад», поиск, форум); отказ пользователя → `return false` |
| `:760-777` | не iOS Safari: при `index > 0` в навигационный стек вставляется `{type:'filters', onPop: () => onClick()(0)}` на позицию 1 (`spliceItems(1, 0, …)`), при `index === 0` снимается — Back возвращает на «Все чаты» |
| `:779-782` | **повторный клик по активной** → `fastSmoothScrollToStart(xds[id].scrollable.container, 'y')` (`helpers/fastSmoothScroll.ts:49-62`), `return` (undefined — полоса продолжит, но `selectTarget` сам выйдет на `target.classList.contains('active')`, `horizontalMenu.ts:91-93`) |
| `:784` | `setSelectedFolderId(id)` — факт выбора в стор |
| `:786-790` | `xds[id].clear()`; `setFilterIdAndChangeTab(id)` (`:855-858` → `setFilterId` + `onTabChange`); первый вызов (`wasFilterId === -1`) промис не возвращает |
| `:793` | `foldersOverlay.append(folders.menuScrollContainer)` |
| `:794-810` | **`horizontalMenuObjArgs({tabs: folders.menu, content: folders.container, onClick: selectFolderByIndex, onTransitionEnd, scrollableX: scrollableContext, onChange})`**: `onTransitionEnd` (`:798-804`) чистит `xds[folderId].clear()` у всех, кроме `filterId`; `onChange` (`:806-809`) перекрашивает `custom-emoji-renderer-element` заголовка по `getFolderTitleTextColor(active)` (`:170-172`: `primary-color`/`secondary-text-color`) |
| `:812` | `setOnClick(() => selectTab)` — **единственная точка переключения** для полосы, свайпа, вертикальной колонки и стора |
| `:814-821` | `createFolderContextMenu({…, className: 'menu-horizontal-div-item', listenTo: folders.menu})` |

Последовательность клика по вкладке (полоса → слайдер), для пинов:

1. `attachClickEvent(tabs)` → `selectTarget` (`horizontalMenu.ts:196-212`, `:42`).
2. `onClick(id, content.children[id], animate)` = `selectFolderByIndex` (`:55-62`); `false` → стоп.
3. Автоцентрирование активной вкладки в `ScrollableX` (`:64-85`).
4. Уже `active` или `id === prevId` → стоп (`:91-93`); иначе перенос `active` и полоски (`:97-132`).
5. `selectTab(id, animate)` → `TransitionSlider` (`transition.ts:300-352`): уходящий получает `from`, контейнер — `animating` (+`backwards`, если `id < prevId`), **`slideTabs`** (`:45-95`) ставит обоим `transform: translate3d(±width)`, добавляет приходящему `active`, делает reflow (`:68`) и снимает его `transform` (`:70`) — приходящий едет к 0 по `transition: transform var(--tabs-transition)` (`_slider.scss:214-216`); приходящий получает `to` (`:321-322`); по `transitionend` уходящий теряет `active from` и инлайновый сдвиг (`:340-347`), страховочный таймер `transitionTime + 100` (`:350`).
6. `onTransitionEnd` полосы → `clear()` неактивных (`:798-804`).

### `addFilter` / `l` / показ ряда

| Стр. | Что |
|---|---|
| `:1170-1176` | `l(filter)`: `xds[id] = new AutonomousDialogList({filterId})`, `generateScrollable(filter)` (`dialogs.ts:207-238`: `new Scrollable(null, 'CL', 500)` `:209`, `container.dataset.filterId` `:210`, `itemSize: 72` `:221`), `setListClickListener` |
| `:1249-1290` | **`addFilter(filter)`**: архив пропускается (`:1251-1253`); уже отрисованная папка — только `positionElementByIndex(container, folders.container, filter.localId)` (`:1255-1259`); иначе `l(filter)`, классы `tabs-tab chatlist-parts folders-scrollable` (`:1262`), `attachBorderListeners()` (`:1263`), `div.chatlist-top > ul` + `div.chatlist-bottom` (`:1268-1275`), `positionElementByIndex(...)` (`:1281`), запись в `filtersRendered` (`:1283-1287`), `onFiltersLengthChange()` (`:1289`) |
| `:1298-1322` | **`onFiltersLengthChange`**: один на тик (`pause(0)`, дедуп по `showFiltersPromise`); `show = filtersRendered.length > 1` (`:1305-1306`); при смене — `hide` на `menuScrollContainer` и `menuGradient`, `has-filters` на `#chatlist-container` (`:1310-1312`); `setHasFolders(show)` (`:1315-1316`, → `body.has-horizontal-folders`/`has-vertical-folders`, `stores/foldersSidebar.ts:90-112`) |
| `:1292-1296` | `changeFiltersAllChatsKey` — мёртв (§ 0) |

### `onTabChange` (`:1092-1168`)

`xd = xds[filterId]` (`:1094`), `xd.reset()` (`:1095` → `base.ts:364-367`, только промисы),
отмена фетча chatlist-апдейтов (`:1097-1099`), `promise = xd.onChatsScroll()` (`:1101` →
`requestItemForIdx(0)`, `base.ts:144-146`). Остальное (`:1103-1165`) — верхняя плашка
«N новых чатов» для shared-папок `dialogFilterChatlist` через `getChatlistUpdates`.

### События (`initListeners`, `:860-969`)

| Событие | Стр. | Что |
|---|---|---|
| `filter_update` | `:924-932` | не реальная папка и ещё не отрисована → `addFilter` |
| `filter_delete` | `:934-945` | `container.remove()`, `xds[id].destroy()`, удалить из карт, `onFiltersLengthChange()` |
| `filter_order` | `:947-968` | по каждому id: `xds[id].setIndexKey(...)` и `positionElementByIndex(container, folders.container, filter.localId)` (`:966`) |

Первичное наполнение — `onStateLoaded` (`:1014-1090`): `addFilter` на каждый фильтр
из `state.filtersArr` + `hydrateFilters` стора (`:1026-1035`), `onClick(0, false)`
для плейсхолдера (`:1055-1057`), затем `filterId = -1; onClick(0, false)` (`:1064-1065`) —
первый показ без анимации; `suggestionContainer`/`authorizationContainer` препендятся
в оверлей (`:1079-1088`).

## 1.7 Контекстное меню папки — `helpers/dom/createFolderContextMenu.ts`

Один модуль на оба ряда: горизонтальный (`appDialogsManager.ts:814-821`, `listenTo: folders.menu`)
и вертикальный (`foldersSidebarContent/index.tsx:84-92`, `listenTo: folderItemsContainer`).
Поверх `createContextMenu`; папка берётся из `target.dataset.filterId` (`:69-71`).

| Пункт | Стр. | verify |
|---|---|---|
| `FilterEdit` → `AppEditFolderTab` | `:35-41` | не «Все чаты» |
| `FilterEditAll` → `AppChatFoldersTab` | `:42-50` | «Все чаты» |
| `MarkAllAsRead` → `dialogsStorage.markFolderAsRead` | `:51-57` | `getFolderUnreadCount(id).unreadCount > 0` |
| `Delete` → `AppEditFolderTab.deleteFolder` | `:58-65` | не «Все чаты» |

## 1.8 Стили

| Что | Файл:строки |
|---|---|
| `.item-main .menu-horizontal-scrollable { z-index:2; position:relative; flex:0 0 auto }`, `-div { justify-content:flex-start }`, item `min-width:3rem` | `_leftSidebar.scss:278-293` |
| `.chatlist-overlay { position:absolute; top:0; inset-inline:0; z-index:2 }` | `:295-302` |
| `.folders-tabs-scrollable { margin:.5rem; box-shadow: var(--section-box-shadow-big); display:none }` → `display:block` только под `body.has-horizontal-folders` | `:304-313` |
| `.folders-tabs-gradient { --alpha:1; height:100% }`, `-container { position:absolute; inset:0; z-index:-1 }` | `:315-325` |
| `#folders-container { position:relative; flex:1 1 auto }`; `.folders-scrollable { position:absolute; transition: transform var(--tabs-transition); padding-top: var(--chatlist-overlay-height, 0) }` | `:407-418` |
| гашение ряда на время навигационного перехода колонки (`opacity: var(--disabled-opacity)`, `.animating`/`.backwards`) | `:1187-1190`, `:1202-1204`, `:1217-1219`, `:1231-1233` |
| `.menu-horizontal-scrollable`, `-div`, `-div-item[.active]` | `_slider.scss:3-80` |
| `.tabs-container` grid, `.tabs-tab { display:none } .active { display:flex }`, `[data-animation="tabs"] .tabs-tab { transition: transform var(--tabs-transition) }` | `_slider.scss:164-184`, `:214-216` |

## 1.9 Вертикальная колонка и body-классы

- Клик по папке в колонке (`foldersSidebarContent/index.tsx:64-73`): `onClick()(index)` из
  стора — тот же `selectTab`; при `false` выходит; затем `closeEverythingInside()`.
- Режим: `useHasFolders` (`foldersSidebar.ts:43-50`, ставит `onFiltersLengthChange`),
  `useFoldersSidebarShown` (`:25-41`, гейт по ширине ≤925px, `body.has-folders-sidebar`),
  итоговый эффект (`:90-112`): `has-horizontal-folders` = есть папки ∧ (не свёрнута ∨ узкий
  экран) ∧ колонка не показана; `has-vertical-folders` — инверсия. Ряд вкладок **всегда
  в DOM**, скрывается CSS (`_leftSidebar.scss:308-312`).
- Бургер-морф (`sidebarLeft/index.ts:408-418`, `left-sidebar.md` часть 7 § 3) папок не
  касается — только `useFoldersSidebarShown`/`useIsLeftSearchActive`.

## 1.10 Сводная таблица подсистем оригинала

| Подсистема | Где | Суть |
|---|---|---|
| Ряд вкладок | `foldersTabs.tsx` + `tabs.tsx` | Solid; `active` — на DOM полосой |
| Стор | `stores/folders.ts` | `folderItems` + `onClick`-сигнал = `selectTab` менеджера |
| Контейнеры папок | `appDialogsManager.addFilter` `:1249-1290` | скроллер один раз, порядок по `localId` |
| Переключение | `selectFolderByIndex` `:738-791` + `horizontalMenuObjArgs` `:794-810` | лимит, закрыть всё, навигация, повторный клик → к началу, `clear()` + `onTabChange` |
| Уборка | `onTransitionEnd` `:798-804` | неактивные списки пусты |
| Показ ряда | `onFiltersLengthChange` `:1298-1322` | >1 папки: `hide` с ряда/градиента, `has-filters`, body-классы |
| События | `:924-968` | add / remove / reorder контейнеров |
| Свайп | `:617-634` | = клик по соседней вкладке |
| Меню папки | `createFolderContextMenu.ts` | одно на оба ряда |

---

# Часть 2. Что есть у нас

## 2.1 Карта

| Наш файл | Роль | Аналог tweb |
|---|---|---|
| `components/FolderTabs.tsx` (50) | React-ряд поверх `shared/ui/Tabs` | `foldersTabs.tsx` |
| `shared/ui/Tabs/Tabs.tsx` (159) | React-переписка `.menu-horizontal-*` + полоски Jolly Cobra | `tabs.tsx` + кусок `horizontalMenu.ts` |
| `shared/ui/Tabs/TabSlide.tsx` (177) | React-переписка `slideTabs` + `selectTab`; `keepMounted` | `transition.ts:45-95`, `:300-352` |
| `shared/ui/Tabs/TabsBar.tsx` (45) | липкая плашка с градиентом — **потребителей нет** | — |
| `components/ChatList.tsx` (305) | `TabSlide keepMounted` = контейнеры папок; `ChatListFolder` = `xd` | `addFilter` + `AutonomousDialogList` |
| `components/Sidebar.tsx:292-341` | `has-filters`, `.connection-status-bottom` + `--chatlist-overlay-height` (`useMeasuredHeight`), `.chatlist-overlay` с плашкой, градиентом и `FolderTabs`, `#folders-container` | `start()` `:587-604`, `:654-686`, `onFiltersLengthChange` |
| `core/hooks/useSidebarFolders.tsx` (137) | `tabOrder`, счётчики с main (`:46-52`), `changeFolder` (`:60-63`), React-меню папки (`:89-121`) | стор + `selectFolderByIndex` + `createFolderContextMenu` |
| `stores/foldersStore.ts` (157) | Zustand: `selectedId`, `contactIds`; определения папок — в `appState.folders` | `stores/folders.ts` + `filtersStorage` |
| `core/hooks/useDialogListSource.ts` | курсор/страницы/размер набора одной папки | `AutonomousDialogListBase` |
| `components/folders/FoldersSidebar.tsx` (201) | вертикальная колонка, React, портал в `#main-columns` | `foldersSidebarContent/index.tsx` |
| `components/messages/ChatDialogs.tsx:167-278` | `ForwardPicker` со **своим** рядом `FolderTabs` (`:278`) | у `appSelectPeers.ts` ряда папок нет — только скоуп по одной папке (`:631-646`, `:1358-1366`) |
| `index.html:33` | `has-horizontal-folders` стоит на `<body>` **статически** | `stores/foldersSidebar.ts:90-112` |
| `components/horizontalMenu.ts` (299), `components/transition.ts` (470), `helpers/dom/{handleTabSwipe,positionElementByIndex,lockTouchScroll}.ts`, `components/scrollable.ts`, `components/scrollable2.solid.tsx`, `shared/solid/mountSolid.solid.tsx`, `core/hooks/useImperativeIsland.ts`, `helpers/solid/subscribeExternal.ts`, `core/navigation/appNavigationController.ts` (`'filters'` в типах `:82-86`, `spliceItems` `:467`, `removeItem` `:477`), `helpers/dom/createContextMenu.ts`, `helpers/fastSmoothScroll.ts:79-91` (`fastSmoothScrollToStart`), `environment/{touchSupport,userAgent}.ts`, `lib/langPack.ts:914` (`i18n`) | **портировано и переиспользуется** | одноимённые |

## 2.2 Статус по подсистемам

| Подсистема оригинала | Статус | Расхождение |
|---|---|---|
| Solid-обёртка `Tabs.*` | **нет** | `appSearchSuper.ts` собирает градиент сам (расхождение 1 в его шапке, `:31-39`, `createMenuGradient` `:895-900`) — у tweb это `Tabs.MenuGradient({...})` (`appSearchSuper.ts:596-600`) |
| Solid-`Badge` | **нет** | бейдж вкладки — инлайн в `Tabs.tsx:141-145`, всегда `badge-gray` и `99+` (у tweb цвет по `muted`, число без обрезки) |
| Ряд вкладок | React `FolderTabs.tsx` | рендерится условно (`Sidebar.tsx:319-327`: не при поиске, не при вертикальной колонке); в tweb — всегда в DOM, скрыт CSS; `data-filter-id` на вкладке нет; название папки — `f.title` строкой |
| Слайдер папок | React `TabSlide keepMounted` | **дефект**: переход папок то без выезда, то рывком (стенд, `shared-media.md` § 2.3, последний абзац — тот же `TabSlide`). Порядок операций другой: React коммитит `active` на кадр, потом layout-эффект ставит оба `transform` и делает reflow (`TabSlide.tsx:113-118`); у `slideTabs` — сперва `transform` обоим, потом `active`, reflow, снятие (`transition.ts:63-70`). Кадры в DOM по порядку ПЕРВОГО ПОКАЗА, не по `localId` (`TabSlide.tsx:134-140`, объявлено там) |
| Владелец контейнеров | **нет** — роль размазана по `Sidebar.tsx`, `ChatList.tsx`, `useSidebarFolders.tsx`, `foldersStore.ts` | контейнер — React-кадр `TabSlide`; скроллер папки — `ul.parentElement` (`ChatList.tsx:178-182`); нет `Scrollable` на папку (нет `attachBorderListeners` → нет `scrolled-start/end`, `scrollable-y-bordered`); нет `.chatlist-top` (`ChatList.tsx:294-299`) |
| `clear()` на переключение и по концу перехода | **нет, наоборот** | список каждой папки живёт и помнит `scrollTop` — § 0, поправка 1; так и запинено (`Sidebar.chatlist.test.tsx:131-160`, `ChatList.test.tsx:542-600`) |
| Повторный клик → прокрутка к началу | **нет** | `changeFolder` (`useSidebarFolders.tsx:60-63`) выходит на `id === folderId` |
| Лимит папок / `closeEverythingInsideNaturally` / навигационный `'filters'` | **нет** | тип `'filters'` в `appNavigationController.ts:84` объявлен, никем не ставится |
| Показ ряда при >1 папке, `has-filters` | частично | `has-filters` — `folders.length > 0` (`Sidebar.tsx:292`); `hide` на ряд/градиент не ставится (ряд условно не рендерится); `body.has-horizontal-folders` статичен (`index.html:33`) |
| Счётчики | с main из зеркала | `useSidebarFolders.tsx:46-52`; tweb считает воркер (`folders.ts:19-30`); `muted` не считается |
| Свайп | **нет** | `left-sidebar.md` § 8.2 п. 8 |
| Меню папки | React-меню (`useSidebarFolders.tsx:89-121`) | нет `MarkAllAsRead`; два разных меню-механизма у ряда и колонки (у tweb — одно) |
| Выбор папки (факт) | `foldersStore.selectedId` (Zustand) | писатели: `changeFolder`, `deselectIfRemoved` (`foldersStore.ts:47-49`) — эквивалент `deleteFolder` без дефекта `:131` |
| Пустая папка (📂 + «Edit Folder», `:1399-1430`) | **нет** | — |
| Плашка «N новых чатов» shared-папки (`:1103-1165`) | **нет** | ручки `getChatlistUpdates` нет |

## 2.3 Наши известные дефекты в этой зоне (подтверждены на 2026-09-08)

1. **Переход папок без выезда / рывком** — `TabSlide` (см. таблицу выше).
2. **«Память `scrollTop`» узаконена как «как в tweb»** — `useSidebarFolders.tsx:54-59`
   утверждает обратное оригиналу (§ 0).
3. **Ряд папок в `ForwardPicker`** (`ChatDialogs.tsx:278`) — у оригинала селектор пиров
   ряда папок не имеет.
4. **`TabsBar.tsx`** — мёртвый файл (потребителей нет).
5. **`body.has-horizontal-folders` никто не переключает** — при показанной
   вертикальной колонке класс остаётся; ряд скрыт только тем, что React его не рендерит.

---

# Часть 3. Что блокировано бэкендом или инфраструктурой

| Что | Чего нет | Вердикт |
|---|---|---|
| Лимит папок не-премиум (`isFilterIdAvailable` + `showLimitPopup('folders')`, `:742-748`) | ни лимитов (`apiManager.getLimit`), ни `PopupLimit` | **отложено** — в `selectFolderByIndex` папка всегда доступна, комментарий у строки |
| Кастомные эмодзи в названии папки (`wrapFolderTitle`, `onChange` `:806-809`) | `Folder.title` на проводе — строка без сущностей (`core/managers/foldersManager.ts:5-17`); `custom-emoji-renderer` не портирован | **отложено** — заголовок текстом в `span.text-super` |
| `MarkAllAsRead` в меню папки | нет `dialogs.markFolderAsRead` в менеджерах | **отложено** — пункт не объявляется |
| Счётчик `{count, muted}` от воркера (`getFolderUnreadCount`) | воркер папочный unread не считает | остаётся расчёт с main одной чистой функцией на оба ряда; `muted` считается по тому же правилу `folders.ts:28` из зеркала |
| Плашка chatlist-апдейтов shared-папки | `getChatlistUpdates` | **отложено** |
| `filter_joined`, `premium_toggle` в сторе | событий нет | **отложено** |

---

# Часть 4. Риски порта

| Риск | В чём | Смягчение |
|---|---|---|
| **Два владельца контейнера** | Кадр папки сейчас создаёт React (`TabSlide`), а слайдер tweb адресует кадры индексом в живом DOM (`content.children[id]`) | Контейнеры создаёт и снимает ТОЛЬКО TS-владелец; React рисует `ul` порталом внутрь `.chatlist-top` и владеет только своим поддеревом; пин: после `destroy()` владельца в документе нет ни `.folders-scrollable`, ни `.chatlist-overlay` |
| **Порядок детей ≠ порядок вкладок** | `selectTab(id)` берёт `content.children[id]`; если ряд и контейнеры отсортированы по-разному, откроется чужая папка | один источник порядка (`tabOrder` = позиция в `folderItems`); `positionElementByIndex` и на добавлении, и на переупорядочивании; пин: клик по i-й вкладке активирует контейнер с тем же `data-filter-id` |
| **Второй факт «выбранная папка»** | Solid-стор оригинала держит `selectedFolderId`; у нас факт уже в Zustand `foldersStore.selectedId` | Solid-стор папок держит только проекцию `folderItems` и `onClick`; `selectedId` пишет один `selectFolderByIndex` |
| **Пины на нашу недоделку дадут ложный зелёный** | `Sidebar.chatlist.test.tsx:131`, `ChatList.test.tsx:566,585` пинят память позиции и «одна загрузка на папку» | переписываются под оригинал (§ 0): переключение = список с нуля, страница просится у воркера, сети нет |
| **Первый запрос страницы до регистрации React-списка** | `onTabChange` зовёт `xd.onChatsScroll()` синхронно при старте, а `ChatListFolder` регистрируется эффектом после портала | «late binding»: `FolderList` держит отложенный `onChatsScroll` до регистрации хэндла; пин: первая папка грузится ровно один раз |
| **Ряд в DOM при вертикальной колонке** | у нас ряд не рендерился, теперь он всегда в DOM | эффект body-классов (`foldersSidebar.ts:90-112`) обязателен, статический класс из `index.html` уходит |

---

# Проверка после порта

Прощёлкать на стенде; числа сверять с `web.telegram.org/k`.

1. Ряд папок: карточка и градиент — прямые дети `.chatlist-overlay`; у вкладки `data-filter-id`, `span.text-super`, `div.badge.badge-20` (`badge-gray` у замьюченной, `is-badge-empty` при 0).
2. Одна папка (только «Все чаты») — ряда и градиента нет (`hide`), `has-filters` снят, `body.has-horizontal-folders` снят.
3. Клик по соседней папке: уходящий кадр получает `from`, приходящий — `active to`, контейнер — `animating` (+`backwards` при движении влево); переход **выезжает** (не рывком), оба кадра в DOM на время перехода.
4. По концу перехода: у неактивных папок `ul` пуст; открытая папка показана **с начала** (`scrollTop = 0`); сетевого запроса нет (страница из кэша воркера).
5. Повторный клик по активной папке после прокрутки — плавная прокрутка к началу.
6. Создать папку в настройках — контейнер и вкладка появились на своём месте (порядок по `pos`); удалить папку с другого устройства — её контейнер снят, выбор ушёл на «Все чаты».
7. Свайп на тач-устройстве переключает на соседнюю папку; в первой/последней — не выходит за края.
8. Правый клик по вкладке: Edit / Edit all / Delete (по `verify`); то же меню в вертикальной колонке.
9. «Папки слева» в настройках: ряд остаётся в DOM, но скрыт (`body.has-vertical-folders`), клик в колонке идёт через тот же `selectTab`.
10. Открыт поиск/экран настроек → клик по папке в колонке закрывает их (`closeEverythingInsideNaturally`), Back с не-первой папки возвращает на «Все чаты».
11. `dom-parity.mjs` по `14-left-01-chatlist.json` и `02-chatlist.json`: `--chatlist-overlay-height` на `.connection-status-bottom`, `.chatlist-top` вокруг `ul`, `scrollable-y-bordered`/`scrolled-start` на скроллере.
