# Shared media профиля: `AppSearchSuper` в tweb vs наш `SharedMedia`

Снято 2026-09-07. Источники:

- tweb `/Users/denisurevic/Documents/tweb`, коммит `e52b5d931` («Add dev server typecheck and lint overlay»);
- наш код `web-client/` и `backend/` на `origin/main` (`5e0ebce0`).

> Локальный tweb — форк оригинала. Правая колонка там уже гибрид: обёртка таба и
> `AppSearchSuper` — **классы на ванильном DOM**, а профиль и часть вкладок
> (истории, подарки, сохранённые диалоги) — Solid-компоненты, которые класс
> монтирует в свои контейнеры. Ниже отражено фактическое состояние репозитория.

Этот док — разбор **одной подсистемы**: контент-вкладок правой колонки
(`appSearchSuper.ts`, 2843 строки) и того, что вокруг них. Про слайдер табов,
шапку профиля, карусель аватаров, `PeerProfile` и различия user/group/channel —
[`right-sidebar.md`](right-sidebar.md), здесь они не дублируются.

**Порт по этому доку** — план
[`../superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`](../superpowers/plans/2026-09-07-solid-wave-3-shared-media.md).

---

## 0. Три поправки к постановке — прежде чем читать дальше

Три вещи, которые «по умолчанию ожидаются» от shared media, в оригинале
устроены не так. Это факты, проверенные в исходниках, и план построен на них.

| Ожидание | Как на самом деле в tweb |
|---|---|
| «Группировка по датам, липкие заголовки месяцев» | **Её нет.** В `appSearchSuper.ts` нет ни `search-super-month`, ни `dateContainer`/`monthContainer` — `grep -rn "search-super-month\|monthContainer\|dateContainer" src/` по всему tweb даёт ноль совпадений в этой подсистеме (единственные `dateContainer` — в `chat/bubbleGroups.ts:70,310,316` — это ЛЕНТА ЧАТА, другая подсистема). Списки shared media плоские, newest-first; единственная структура — `SearchGroup` (`searchGroup.tsx:13`) и она используется ТОЛЬКО левой колонкой. |
| «Вкладка GIF» | **Её нет.** Полный список вкладок задаётся одним литералом `sharedMedia.tsx:604-648`: `savedDialogs, stories, members, media, gifts, saved, files, links, music, voice, groups, similar`. GIF-документы попадают в `media` (`inputMessagesFilterPhotoVideo`) как видео. |
| «Поиск внутри чата — это тоже `appSearchSuper`» | **Нет.** Поиск по чату в tweb — отдельный Solid-компонент `chat/topbarSearch.tsx` (1318 строк), он не импортирует `AppSearchSuper` вовсе (`grep -rn appSearchSuper src` → потребители: `sidebarLeft/index.ts`, `sidebarRight/tabs/sharedMedia*.tsx`, `chat/selection.ts`, `mediaViewer/appMediaViewerNew.ts`, `appMediaPlaybackController.ts`, `helpers/searchListLoader.ts`). Строки поиска у `AppSearchSuper` нет в принципе: `setQuery` (`:2803`) принимает `query` снаружи, а ввод живёт у потребителя (`inputSearch.ts:33,77,219`, дебаунс 300 мс) — и в правой колонке его не передают. По плану волн (`../superpowers/specs/2026-08-28-solid-migration-design.md` § 8) `TopbarSearch` — **волна 5**, не этот этап. |

---

# Часть 1. Что делает оригинал

## 1.1 Два потребителя одного класса

`AppSearchSuper` универсален и живёт в двух местах:

| Потребитель | Вызов | Режим |
|---|---|---|
| Глобальный поиск левой колонки | `sidebarLeft/index.ts:1128` | `asChatList: true`, `hideEmptyTabs: false`, `showSender: true`, переданы `searchGroups`, есть строка ввода |
| Shared media профиля | `sidebarRight/tabs/sharedMedia.tsx:604-680` | `hideEmptyTabs` по умолчанию `true`, `searchGroups` НЕ переданы, строки ввода нет |

Нам сейчас нужен второй режим, но класс портируется целиком — иначе левую
колонку придётся портировать вторым экземпляром той же логики.

## 1.2 Карта файлов

| Путь | Строк | Роль |
|---|---|---|
| `src/components/appSearchSuper.ts` | 2843 | сам класс + внутренний `SearchContextMenu` |
| `src/components/sidebarRight/tabs/sharedMedia.tsx` | 711 | Solid-обвязка: создаёт экземпляр, задаёт список вкладок, шапку, живые апдейты |
| `src/components/sidebarRight/tabs/sharedMediaTab.tsx` | 135 | тонкий `SliderSuperTab`-фасад (`setPeer`/`fillProfileElements`/`loadSidebarMedia`/`setSearchTab`/`setLoadMutex`) |
| `src/components/horizontalMenu.ts` | 215 | ряд вкладок + автоцентрирование активной в `ScrollableX` |
| `src/components/transition.ts` | 383 | `TransitionSlider`; вкладкам нужна функция `slideTabs` (`:45-95`). **Портирован** — `web-client/src/components/transition.ts` |
| `src/components/chat/selection.ts` | 1189 | `AppSelection` (база) + `SearchSelection` (`:583-763`) |
| `src/components/sortedUserList.ts` | 134 | список участников/общих групп |
| `src/components/searchGroup.tsx` | 170 | группы результатов — только для левой колонки |
| `src/components/stargifts/profileList.tsx` | 472 | Solid-вкладка «Подарки» |
| `src/components/stories/profileList.tsx` | 938 | Solid-вкладка «Истории» |
| `src/scss/partials/_searchSuper.scss` | 428 | стили подсистемы |

## 1.3 Подсистема: конструктор, опции, состояние

**Типы** — `appSearchSuper.ts:111-154`:

- `SearchSuperType` (`:111`) — алиас `MyInputMessagesFilter` (`inputMessagesFilterPhotoVideo` и т.п.);
- `SearchSuperContext` (`:112-124`) — `peerId`, `inputFilter`, `query`, `maxId`, `folderId`, `threadId`, `date`, `nextRate`, `minDate`/`maxDate`, `chatType`;
- `SearchSuperMediaType` (`:126-128`) — 16 логических вкладок;
- `SearchSuperMediaTab` (`:129-139`) — описание вкладки: `inputFilter?`, `name` (langpack-ключ), `type`, `contentTab`/`itemsTab` (узлы), `menuTab`/`menuTabName` (узлы ряда), **`scroll` (запомненная позиция `{scrollTop, scrollHeight}`)**, `hideOn` (узел, скрытый до первого рендера);
- `SearchSuperLoadTypeOptions` (`:141-147`), `PerformSearchResultArgs` (`:149-154`), `ProcessSearchSuperResult` (`:346-353`).

**Поля класса** — `:356-437`. Существенное:

| Поле | Стр. | Что |
|---|---|---|
| `tabs: {[filter]: HTMLDivElement}` | 357 | карта «фильтр → узел списка», по ней ищут элементы при клике |
| `mediaTab` | 359 | текущая вкладка |
| `container` / `nav` / `navScrollableContainer` / `tabsContainer` / `navScrollable: ScrollableX` | 361-366 | DOM подсистемы |
| `historyStorage` / `usedFromHistory` | 373-374 | **кэш сообщений по фильтру, живёт СНАРУЖИ класса** (владеет `sharedMedia.tsx:33-36`) и переживает `cleanup()` |
| `loadMutex` | 377 | внешний мьютекс: рендер ждёт его перед вставкой в DOM |
| `nextRates`/`loadPromises`/`loaded`/`loadedChats`/`firstLoad` | 379-383 | состояние загрузки по типу |
| `selectTab` | 387 | функция из `horizontalMenu` |
| `mediaTabsMap` | 391 | `type → SearchSuperMediaTab` |
| `counters` / `onLengthChange` | 436-437 | счётчики вкладок наружу (подзаголовок залитой шапки) |
| `middleware = getMiddleware()` | 370 | отмена асинхронщины; `lazyLoadQueue` — `:369` |

**Конструктор** — `:439-795`. Порядок:

1. `safeAssign(this, options)` (`:451`) — `mediaTabs`, `scrollable`, `searchGroups?`, `asChatList?`, `hideEmptyTabs? = true`, `onChangeTab?`, `showSender?`, `managers`, `scrollOffset`, `slider?`, `onLengthChange?`, `openSavedDialogsInner?`.
2. `container.classList.add('search-super')` (`:454-455`); `listenerSetter`, `SearchContextMenu`, `SearchSelection` (`:457-459`).
3. Ряд вкладок (`:461-472`): `.search-super-tabs-scrollable.menu-horizontal-scrollable.sticky` → `ScrollableX` → `nav.search-super-tabs.menu-horizontal-div`.
4. Цикл по `mediaTabs` (`:474-495`): на каждую — `div.menu-horizontal-div-item` + `span.menu-horizontal-div-item-span` + **`i.menu-horizontal-div-item-background`** (подчёркивание активного), `ripple()`, запись в `mediaTabsMap`.
5. `tabsContainer.search-super-tabs-container.tabs-container` (`:497-499`) — контейнер контента для `TransitionSlider`.
6. Контент вкладок (`:543-589`): `noSectionTypes` (`stories, media, gifts, chats, channels, apps, posts`) рисуются без `Section`; остальным создаётся `Section({noDelimiter: true, class: 'hide'})` — этот узел и есть `mediaTab.hideOn`. Для `type === 'media'` дополнительно `.search-super-content-media-grid` (`:576-579`). Классы: `.search-super-tab-container.search-super-container-<type>.tabs-tab` на контейнере, `.search-super-content-container.search-super-content-<type>` на контенте.
7. Сборка (`:591-597`): `menuGradient` (`search-super-tabs-gradient`), ряд, `tabsContainer`.
8. `scrollable.onScrolledBottom` (`:610-615`) — догрузка текущей вкладки.
9. `this.selectTab = horizontalMenu(...)` (`:624-708`) — см. 1.4.
10. Клики: перехват при выделении (`:710-714`, `capture: true`), открытие медиавьювера (`:716-774`).
11. `this.mediaTab = this.mediaTabs[0]` (`:791`), `useHeavyAnimationCheck` для `lazyLoadQueue` (`:793-795`).

## 1.4 Подсистема: вкладки, их слайдер и **память скролла**

Самая нетривиальная часть файла — коллбэки `horizontalMenu`.

**`onClick(id, tabContent, animate)`** — `:624-691`:

| Стр. | Что делает |
|---|---|
| 625-628 | клик по уже активной вкладке (и не `skipScroll`) → только `scrollToStart()` и выход |
| 630-633 | `onChangeTab?.(newMediaTab)` — наружу (потребитель переключает подзаголовок/кнопки) |
| 637-639 | не первое переключение + `animate` → `onTransitionStart()` (класс `sliding` на контейнере) |
| 641-646 | `offsetTop = container.offsetTop - scrollOffset`; если скролл выше него — сперва `scrollToStart()` |
| 647-660 | **запоминает уходящую**: `fromMediaTab.scroll = {scrollTop, scrollHeight: scrollable.scrollSize}` |
| 661-672 | у новой вкладки ещё нет `scroll` → позиция считается от разницы `getBoundingClientRect` контейнеров (чтобы не улететь вниз при первом заходе) |
| 673 | **есть `scroll`** → `newMediaTab.contentTab.style.transform = translateY(diff)`, где `diff = from.scroll.scrollTop - new.scroll.scrollTop` — визуальный трюк: контент «стоит на месте», пока идёт анимация |
| 686-689 | новая вкладка пуста и это не первый показ → `this.load(true)` |
| 691 | `prevTabId = id` |

**`onTransitionEnd`** — `:693-707`: `scrollable.onScroll()`; **сброс `transform` и физическая установка `scrollable.scrollPosition = mediaTab.scroll.scrollTop`**; `unlockScroll()`; `onTransitionEnd()` (снятие `sliding`).

`onTransitionStart`/`onTransitionEnd` — `:809-815` (только toggle класса `sliding`).
`scrollToStart` — `:800-807`: `scrollable.scrollIntoViewNew({element: container, position: 'start', startCallback: this.scrollStartCallback})`.
`cleanScrollPositions()` — `:2756-2760`: обнуляет `mediaTab.scroll` у всех вкладок; вызывается **снаружи** при выходе из полноэкранного режима (`sharedMedia.tsx:515`).

**Свайп** — `:498-542`: `handleTabSwipe` на `tabsContainer`; у вкладок `gifts`/`stories` есть своя горизонтальная навигация (альбомы/коллекции), она перехватывает свайп первой (`:508-515`); иначе ищется соседняя невидимая-`hide` вкладка и вызывается `selectTab(idx)` с `lockTouchScroll`.

**Автоцентрирование ряда** — `horizontalMenu.ts:64-79`: `fastSmoothScroll` по оси X у `ScrollableX`, с оптимизацией (`scrollWidth <= clientWidth` → пропуск; `scrollLeft === 0` и выбран первый — тоже).

## 1.5 Подсистема: загрузка по типам

**Точка входа `load(single, justLoad, side)`** — `:2531-2577`:

- `:2534-2542` — при `firstLoad` дождаться `loadFirstTimePromise ??= loadFirstTime()`;
- `:2543-2545` — `toLoad`: либо только текущая вкладка (`single`), либо все прочие (фоновая предзагрузка), отфильтрованные `canLoadMediaTab` (`:2362-2369`);
- `:2547-2551` — на юзере выбрасывается `members`, на чате — `groups`;
- `:2556` — `loadCount = justLoad ? 50 : round((windowSize.height / 130 | 0) * 3 * 1.25)` — примерно три экрана;
- `:2558-2565` — `Promise.all` по `loadType`.

**Диспетчер `loadType(options)`** — `:2181-2360`:

| Стр. | Что |
|---|---|
| 2189-2190 | дедупликация: уже есть `loadPromises[type]` → вернуть его |
| 2193-2210 | нестандартные типы → `loadMembers` (`:1525`), `loadStories` (`:1762`), `loadSimilarChannels` (`:1804`), `loadSavedDialogs` (`:1890`), `loadChannels` (`:1971`), `loadApps` (`:2024`), `loadPosts` (`:2118`), `loadGifts` (`:2130`) |
| 2213-2224 | `.finally()` → сброс `loadPromises[type]` и `scrollable.checkForTriggers()` (докрутить, если контента не хватило на экран) |
| 2226 | `history = historyStorage[inputFilter] ??= []` |
| 2228-2237 | особый случай `inputMessagesFilterEmpty` → `loadChats()` (`:1285`) |
| **2239-2276** | **рендер ИЗ КЭША**: в `history` больше записей, чем `usedFromHistory[inputFilter]` → сообщения достаются `apiManagerProxy.getMessageByPeer` по `{mid, peerId}` и рендерятся **без сетевого запроса** |
| 2278-2291 | иначе `offsetId`/`offsetPeerId` из последнего элемента истории; опции `getHistory`: `...searchContext, inputFilter, offsetId, offsetPeerId, limit: loadCount, nextRate` |
| 2286-2287 | для `type === 'saved'` подмена: `inputFilter: undefined, peerId: myId, threadId: searchContext.peerId` |
| 2293-2299 | `appMessagesManager.getHistory(options)`; накопление `history.push(...)` |
| 2301-2303 | `setCounter(type, value.count)` — один раз |
| 2308-2317 | «всё загружено»: `history.length < loadCount` ИЛИ (`folderId !== undefined && !nextRate`) ИЛИ `isEnd.top` |
| 2319 | `nextRates[type] = value.nextRate` — **курсор пагинации** |
| 2321-2325 | `justLoad` → выход без рендера; иначе `usedFromHistory[inputFilter] = history.length` |
| 2327-2347 | отложенная предзагрузка следующей партии `load(true, true)`, только если пользователь не ушёл с вкладки |
| 2350-2351 | `performSearchResult({messages: filterMessagesByType(...), mediaTab, canAnimateIn: !offsetId})` |

Ключевой вывод для порта: **пагинация — по `offsetId` (id последнего показанного сообщения) + `nextRate`, а не по числовому смещению.** Это прямо определяет форму нашей ручки (см. часть 3).

Разбор веток по типам:

| Тип вкладки | Метод / стр. | Источник данных |
|---|---|---|
| `media` (photo+video) | общий путь `getHistory`, рендер `processPhotoVideoFilter` `:874-938` | `inputMessagesFilterPhotoVideo` |
| `files` | тот же путь, рендер `processDocumentFilter` `:940-962` | `inputMessagesFilterDocument` |
| `music` / `voice` | тот же `processDocumentFilter` (класс `audio-48` для audio/voice/round, `:958-960`) | `inputMessagesFilterMusic` / `inputMessagesFilterRoundVoice` |
| `links` | `processUrlFilter` `:964-1094` | `inputMessagesFilterUrl` |
| `saved` | общий путь с подменой peer/thread (`:2286-2287`), рендер `processEmptyFilter` `:826-871` в режиме чатлиста (`:1226-1244`) | сообщения в Saved Messages с `saved_peer_id` |
| `members` / `groups` | `loadMembers` `:1525-1758` | `getChannelParticipants` (`:1680-1699`, LOAD_COUNT 50 → 200), `getChatFull` (`:1700-1714`), `getCommonChats` (`:1660-1679`) |
| `stories` | `loadStories` `:1762-1802` | Solid `StoriesProfileList`, `pinned`/`archive` |
| `gifts` | `loadGifts` `:2130-2179` | Solid `StarGiftsProfileTab` + `stargiftsStore`; топ-3 подарка рисуются стикерами в `menuTabName` (`setPinnedGifts` `:2579-2610`) |
| `savedDialogs` | `loadSavedDialogs` `:1890-1941` | `AutonomousSavedDialogList` + `SortedDialogList` |
| `similar` | `loadSimilarChannels` `:1804-1881` | `getChannelRecommendations` + paywall при не-Premium |
| `chats`/`channels`/`apps`/`posts` | `loadChats` `:1285-1523`, `loadChannels` `:1971`, `loadApps` `:2024`, `loadPosts` `:2118` | только левая колонка |

## 1.6 Подсистема: рендер элементов

**`performSearchResult({messages, mediaTab, canAnimateIn, append})`** — `:1096-1257`:

- `:1104` `await getHeavyAnimationPromise()` — не рендерить во время тяжёлой анимации;
- `:1139-1163` — выбор `processCallback` по `inputFilter`;
- `:1169-1180` — `messages.map(async ...)`, ошибка на одном сообщении не роняет партию;
- `:1194-1200` — ожидание побочных промисов, **включая `loadMutex`**;
- `:1206-1224` — вставка: `container[append ? 'append' : 'prepend'](element)`, на элемент вешаются `search-super-item`, `data-mid`, `data-peer-id`; если включён режим выделения — сразу `selection.toggleElementCheckbox(element, true)`;
- `:1226-1244` — для `saved` создаётся `.chatlist` через `appDialogsManager.createChatList`;
- `:1249` — `afterPerforming(...)`.

**`afterPerforming(length, mediaTab)`** — `:1259-1283`: снимает `hide` с `mediaTab.hideOn` (`:1265-1267`); чистит остатки прелоадеров/пустых состояний (`:1269-1272`); если ничего нет — вставляет `.content-empty.position-center.text-center.no-select` с ключом `Chat.Search.NothingFound` (`:1276-1281`).

Рендереры:

| Метод | Стр. | Как рисует |
|---|---|---|
| `processPhotoVideoFilter` | 874-938 | `div.grid-item` в `.search-super-content-media-grid`; `choosePhotoSize(media, 200, 200)`; фото — `wrapPhoto`, видео — `wrapVideo({onlyPreview: true, withoutPreloader: true, noPlayButton: true})`; спойлер — `wrapMediaSpoiler` при `pFlags.spoiler` или `isMessageSensitive` (`:917-930`) |
| `processDocumentFilter` | 940-962 | `wrapDocument({withTime: !showSender, voiceAsMusic: true, showSender, searchContext: copySearchContext(...)})`; для audio/voice/round добавляется `audio-48` |
| `processUrlFilter` | 964-1094 | если у сообщения нет `webpage` — URL парсится из `entities`/`matchUrl` и собирается синтетический `webPage` (`:1010-1017`); рендер через `Row` (`wrapWebPageTitle` / `wrapWebPageDescription` + `<a href>`), превью — `wrapPhoto` в `div.preview` либо `wrapAbbreviation` |
| `processEmptyFilter` | 826-871 | `appDialogsManager.addDialogNew` + `setLastMessageN` с `highlightWord: searchContext.query` |

**Открытие медиавьювера** — `:716-774`: собирает все `.search-super-item` текущей вкладки как `prevTargets`/`nextTargets` и открывает `new AppMediaViewer().setSearchContext(copySearchContext(...)).openMedia({...})` — то есть вьювер листается **по результатам вкладки**, а не по ленте чата. Привязано к `grid-item` (`:765-769`) и к `document-with-thumb`/`media-container` (`:770-774`).

## 1.7 Подсистема: первый показ вкладок и счётчики

**`loadFirstTime()`** — `:2380-2513`:

- `:2384-2386` — при `!hideEmptyTabs` (левая колонка) сразу выход: там показывают все вкладки всегда;
- `:2388-2389` — **один batch-запрос `getSearchCounters(filters)`** (`:2375-2377`) на все медиа-фильтры сразу;
- `:2392-2412` — параллельно все `canView*` + `getGiftsCount` + `getPinnedGifts`;
- `:2422-2427` — ожидание `loadMutex` перед манипуляциями с DOM;
- `:2429-2445` — по каждой медиа-вкладке `menuTab.classList.toggle('hide', !counter.count)`, обновление счётчика; первая ненулевая запоминается;
- `:2447-2472` — по нестандартным вкладкам toggle `hide` от `canView*`;
- **`:2478-2495` — приоритет первой открытой вкладки: `stories` → `members` (перебивает stories) → `savedDialogs` → `gifts`**; у группы по умолчанию открыт список участников;
- `:2503-2511` — `toggleContainerHidden(false)`, `skipScroll = true`, `selectTab(idx, false)` без анимации; класс `is-single` на ряде + скрытие градиента, если видимая вкладка одна.

**Предикаты видимости**:

| Метод | Стр. | Условие |
|---|---|---|
| `canViewSavedDialogs` | 2611-2626 | `peerId === myId`, нет `threadId`, вкладка объявлена, реально есть диалоги |
| `canViewSaved` | 2627-2643 | `peerId !== myId`, нет `threadId`, в треде Saved Messages есть сообщения |
| `canViewMembers` | 2644-2657 | чат, не broadcast, право `view_participants`, (не форум ИЛИ нет `threadId`) |
| `canViewGroups` | 2658-2664 | только user, `userFull.common_chats_count` не ноль |
| `canViewStories` | 2665-2685 | не Saved Messages, нет `threadId`; user → есть pinned/archive; чат → `channelFull.pFlags.stories_pinned_available` |
| `canViewSimilar` | 2686-2699 | не-user, `getChannelRecommendations().chats.length` |
| `canViewGifts` | 2700-2703 | `!threadId && mediaTabsMap.has('gifts')` (сам счётчик — отдельно) |

`toggleContainerHidden` / `updateContainerHidden` — `:2515-2529`: класс `hide` на контейнере и `search-empty` на родителе; второй умеет переключиться на первую видимую вкладку, если текущая пропала (например, обнулился счётчик подарков — `:2151-2154`).

## 1.8 Подсистема: выделение и контекстное меню

**`SearchContextMenu`** (внутренний класс) — `:156-345`:

- `:171-215` — `attachContextMenuListener` на весь `container`; игнор внутри `.search-super-content-stories`; поиск ближайшего `.search-super-item`; асинхронная проверка `verify()` каждой кнопки; если видимых кнопок нет — меню не открывается;
- `:243-289` — кнопки через `ButtonMenuSync`: **Forward** (одиночный/групповой, `withSelection`), **Download** (`ChatContextMenu.onDownloadClick`/`canDownload`), **`Message.Context.Goto`**, **Select / `Selection.Clear`**, **Delete / `Selection.Delete`** (danger, через `PopupDeleteMessages`); класс меню `search-contextmenu contextmenu`, монтируется в `getOverlayRoot()`;
- `:291-343` — обработчики: `onGotoClick` → `appImManager.setInnerPeer({peerId, lastMsgId: mid, threadId})`; `onForwardClick`; `onSelectClick`/`onClearSelectionClick` → делегируют в `searchSuper.selection`; `onDeleteClick`.

**`SearchSelection`** — `chat/selection.ts:583-763`:

- `:596-611` — конфигурация базового `AppSelection`: `getElementFromTarget` → `.search-super-item`, `lookupBetweenParentClassName: 'tabs-tab'`, `lookupBetweenElementsQuery: '.search-super-item'` (диапазон shift-кликом внутри вкладки); слушатели — только не-touch;
- `:637-651` — `toggleByElement`/`toggleByMid`;
- `:653-660` — `onUpdateContainer`: счётчик «N messages», видимость goto/forward/delete по правам;
- `:662-761` — `onToggleSelection`: строит плашку `.search-super-selection-container` и монтирует её **в `searchSuper.navScrollableContainer`** — то есть плашка выделения занимает место ряда вкладок; классы `is-selecting` на `navScrollableContainer` и на `container` (`_searchSuper.scss:351-361`).

## 1.9 Подсистема: смена пира, очистка, живые апдейты

**`setQuery({peerId, query, threadId, historyStorage, folderId, minDate, maxDate, chatType})`** — `:2803-2826`: пересобирает `searchContext` (`:2812-2820`), **подменяет `historyStorage` на переданный снаружи** (`:2822`), зовёт `cleanup()` (`:2824`). Загрузку НЕ запускает — это ответственность вызывающего (ср. `sidebarLeft/index.ts:1335-1344`).

**`cleanup()`** — `:2714-2755`: сбрасывает `loadPromises`, `loaded`, `loadedChats`, `nextRates`, `firstLoad = true`, `prevTabId = -1`, `counters`; чистит `lazyLoadQueue`; ставит `usedFromHistory[inputFilter] = -1` (`:2726-2732`) — **сам кэш сообщений не трётся**; отменяет выделение; `middleware.clean()`; `cleanScrollPositions()`; сбрасывает состояние участников.

**`cleanupHTML()`** — `:2762-2793`: `itemsTab.replaceChildren()` по всем вкладкам; `hideOn` снова прячется; при `hideEmptyTabs` весь контейнер прячется и родитель получает `search-empty`; ставится `putPreloader`, если для фильтра ещё нет кэша; `scrollable.scrollPosition = 0`.

**`destroy()`** — `:2828-2843`: `cleanup()`, `listenerSetter.removeAll()`, `scrollable.destroy()`, отписка `swipeHandler`, `selection.cleanup()`, обнуление ссылок.

**Кэш переживает смену пира.** Он лежит НЕ в классе, а в модульном сторе обвязки:

```
sharedMedia.tsx:28-36   type SharedMediaHistoryStorage = {[filter]: {mid, peerId}[]}
                        const historiesStorage: {[peerId]: {[threadId]: SharedMediaHistoryStorage}} = {}
sharedMedia.tsx:43-45   getHistoryStorage(peerId, threadId) — ленивое создание
sharedMedia.tsx:47-57   setQuery() — достаёт стор пира и отдаёт классу
```

То есть: вернулся в профиль того же пира — вкладки нарисуются из кэша без сети
(`loadType:2239-2276`).

**Живые апдейты — точечные, а не сброс кэша** (`sharedMedia.tsx:209-345`, подписки `:596-602`):

- `_renderNewMessage` (`:209-251`) — по каждой вкладке прогоняет сообщение через `filterMessagesByType`, вставляет `{mid, peerId}` в начало `history` (`history.unshift`), увеличивает `usedFromHistory[inputFilter]` и зовёт `performSearchResult({messages: filtered, mediaTab, append: false})` — **prepend одного узла**, после чего `setCounter(type, counters[type] + length)`;
- `renderNewMessage` (`:254-263`) — то же ещё раз для треда форума;
- `_deleteDeletedMessages` / `deleteDeletedMessages` (`:265-345`) — симметрично на удаление.

## 1.10 Подсистема: скролл

- Своего скроллера у подсистемы нет — `scrollable` приходит снаружи (весь профиль скроллится одним контейнером).
- `scrollable.onScrolledBottom` (`:610-615`) → `load(true, undefined, 'bottom')`.
- `scrollStartCallback` — публичное поле, назначается потребителем (`sharedMedia.tsx:682-684` → `setIsSharedMedia(true)`).
- `onAdditionalScroll` тоже принадлежит потребителю (`sharedMedia.tsx:484-493`): меряет `getBoundingClientRect()` у `searchSuper.container` (если `is-single`) или у `searchSuper.nav` и сравнивает `top - 1 <= OFFSET + BODY_PADDING` (56 + 16 + 16).
- `setIsSharedMedia(isSharedMedia)` (`sharedMedia.tsx:505-517`): `animated-close-icon.state-back`, `searchSuper.container.classList.toggle('is-full-viewport')`, `header.hide-border`, `transition(...)` заголовка, и при выходе — `searchSuper.cleanScrollPositions()`.

## 1.11 Сводная таблица подсистем оригинала

| Подсистема | Строки `appSearchSuper.ts` | Механика в двух фразах |
|---|---|---|
| Типы и опции | 111-154, 346-353, 356-437 | Описание вкладки несёт свои DOM-узлы и свою запомненную позицию скролла. Состояние загрузки — карты по типу вкладки. |
| Конструктор и DOM | 439-599 | Ряд вкладок в `ScrollableX` + контейнер контента; `Section`-обёртка каждой вкладки скрыта до первого рендера. |
| Слайдер вкладок и память скролла | 624-708, 800-815, 2756-2760 | При уходе позиция запоминается, при входе разница компенсируется `translateY`, а по концу анимации ставится настоящий `scrollPosition`. |
| Свайп | 500-539 | Соседняя невидимая вкладка пропускается; у gifts/stories свой перехват. |
| Загрузка: вход | 2531-2577 | `loadCount` считается от высоты окна (≈3 экрана); неприменимые вкладки выбрасываются по типу пира. |
| Загрузка: диспетчер и кэш | 2181-2360 | Кэш `historyStorage` рендерится без сети; сеть — `getHistory` с `offsetId` + `nextRate`; следующая партия предзагружается заранее. |
| Загрузка: нестандартные вкладки | 1285-2179 | Участники/истории/подарки/сохранённые/похожие — свои источники и свои контейнеры внутри той же вкладки. |
| Рендер | 826-1094, 1096-1283 | Один `processXFilter` на фильтр; вставка ждёт `loadMutex`; пустая вкладка получает `.content-empty`. |
| Медиавьювер | 716-774 | Листается по элементам вкладки, а не по ленте чата. |
| Первый показ и счётчики | 2362-2529, 2611-2703 | Один batch `getSearchCounters` + `canView*`; приоритет stories → members → savedDialogs → gifts. |
| Выделение и контекст-меню | 156-345 + `chat/selection.ts:583-763` | Плашка выделения занимает место ряда вкладок; меню — Forward/Download/Goto/Select/Delete. |
| Очистка и смена пира | 2714-2843 + `sharedMedia.tsx:28-57` | Кэш живёт снаружи класса и переживает смену пира; `cleanup` только помечает его неиспользованным. |
| Живые апдейты | `sharedMedia.tsx:209-345` | Новое/удалённое сообщение вставляется/снимается точечно, кэш не сбрасывается. |

---

# Часть 2. Что есть у нас

Наш аналог — **один React-компонент** `web-client/src/components/userInfo/SharedMedia.tsx`
(815 строк), рисуемый порталом в узел, которым владеет Solid-карточка профиля
(`components/UserInfoPanel.tsx:351-355` создаёт узел, `:691-710` — портал;
`components/peerProfile.solid.tsx` вставляет его последним ребёнком
`.profile-content`). Отдельного класса-движка вкладок у нас нет вовсе.

## 2.1 Статус по подсистемам

| Подсистема оригинала | Статус | Наш код | Расхождение |
|---|---|---|---|
| Вкладки Media/Files/Links/Music/Voice | **есть; Media — в ядре класса** | Media: `components/appSearchSuper.ts` — `processPhotoVideoFilter` (порт `:874-938`) + `onMediaClick` (порт `:716-767`), пины — `appSearchSuper.media.test.ts`. Files/Links/Music/Voice пока в React: `SharedMedia.tsx:489-534`, `:536-558`, `:560-594`, `:596-625` | Media портирован дословно: `div.grid-item` в `.search-super-content-media-grid`, `choosePhotoSize(media, 200, 200)`, `wrapPhoto`/`wrapVideo({onlyPreview, withoutPreloader, noPlayButton, photoSize})`, крышка `wrapMediaSpoiler` по `pFlags.spoiler`; первый клик по крышке снимает её, иначе открывается вьювер, и цели листания — `.grid-item` ЭТОЙ вкладки в её порядке (`newest-first`, `reverse: false`), за их пределами — `loadMoreMedia` той же ручкой (роль `setSearchContext`). Расхождения 13-17 в шапке файла: нет «чувствительного контента», `getMessageByPeer` заменён кэшем вкладки, `multiply` у крышки не передаётся. Документы/ссылки — задачи 8-9 (пока React-JSX, вьювер — наш `openMediaViewer` из `msgs` вкладки) |
| Рендер файлов / музыки / голосовых и кружков | **есть в ядре** | `components/appSearchSuper.ts::processDocumentFilter` (порт `:940-962`, развилка `:1143-1170`); `wrappers/document.ts` — опции `withTime`/`showSender`/`voiceAsMusic`/`managers` (порт `document.ts:52-56`, `:225-239`, `:263-265`); `wrappers/senderToPeer.ts`, `wrappers/sentTime.ts` (порт 1:1); `audio.ts` — `withTime`/`showSender`/`voiceAsMusic` (порт `audio.ts:343-402`, `:548-549`) и ветка `search-super-item` в `findMediaTargets` (`:461-476`); пины — `appSearchSuper.documents.test.ts` (волна 3, задача 8) | ОДИН рендерер на три вкладки, как в оригинале: файл — `.document` с размером и временем через « · », музыка/голосовое/кружок — `audio-element.audio-48`; голосовое рисуется как трек с отправителем в заголовке. Воспроизведение — общий плеер ленты (`core/audio/mediaPlaybackController`), очередь — элементы вкладки в порядке узлов. Не передаются `searchContext` (очередь у нас не догружается с сервера) и `lazyLoadQueue` (обложки трека нет) — расхождения 13-14 в шапке класса; шов менеджеров расширен `peers.fillMirror` ради `PeerTitle` (15). В `wrapSenderToPeer` нет опции `dialog` (в «Избранном» отправитель подписан своим именем, а не «Saved Messages») |
| Вкладка GIF | **нет — и в оригинале нет** | — | не расхождение (см. § 0) |
| Рендер ссылок (`processUrlFilter`) | **есть в ядре класса** | `components/appSearchSuper.ts` (порт `tweb:964-1094`), обвязка — `wrappers/{webPageTitle,webPageDescription,sentTime}.ts`, `lib/richtext/url.ts::matchUrl`; пины — `appSearchSuper.links.test.ts` | портировано дословно: карточка `webPage` → `Row` с заголовком, описанием, якорем и превью `wrapPhoto` в `div.preview`; без карточки url берётся из сущностей/`matchUrl` и собирается синтетическая карточка с абвиатурой (`:1010-1017`), хост занимает место заголовка. Расхождения 13-17 в шапке файла (`entities` вместо `totalEntities`, модель без `webPageEmpty`/`pFlags`, `data-anchor-action` вместо inline `onclick`, без `showSender`). `filterMessagesByType` для ссылок тоже дословный (сущности ЛИБО `matchUrl`) — шире, чем регексп бэкенда (§ 3, задача 15 плана) |
| Вкладка «Участники» | **есть в ядре класса** (задача 11) | `components/appSearchSuper.ts::loadMembers` (порт `:1525-1758`), пины — `appSearchSuper.members.test.ts` | список грузится САМ, пагинация 50 → 200 (`groups.channelParticipants`), клик → `openPeer`, меню участника; React-панель (`SharedMedia.tsx:369-413`, проп `members` из `useGroupInfo`) живёт до задачи 13. Расхождения 31-35 в шапке класса: портирована только ветка канала; живые обновления — по `rt:chat_update` перечитыванием окна (кадра `updateChannelParticipant` нет, § 3); `slider` → колбэки `openPeer`/`openUserPermissions` |
| Вкладка «Подарки» | **есть** | `SharedMedia.tsx:426-466`, стили — SCSS-модули самого tweb (`components/stargifts/*.module.scss`) | данные пропом (`useProfileGifts`), без пагинации, без `setPinnedGifts` (топ-3 стикерами в ряду вкладок) |
| Вкладка «Чаты» (savedDialogs) | **есть** | `SharedMedia.tsx:357-366`, список `:686-748` (`DeferredSortedVirtualList`, itemSize 72) | один RPC без пагинации; покрыта тестом `SharedMedia.saved.test.tsx` |
| Вкладка «Истории» | **есть частично, НЕ как вкладка** | `components/PinnedStoriesSection.tsx`, монтируется в `UserInfoPanel.tsx:772` | в оригинале это вкладка `stories` внутри того же ряда и с приоритетом первой открытой (`:2478-2484`); у нас — отдельная секция выше по странице |
| Вкладка «Общие группы» | **нет вовсе** | — | ручки бэкенда тоже нет (§ 3) |
| Вкладка «Похожие каналы» | **нет вовсе** | — | ручка бэкенда **есть** |
| Вкладка `saved` (Saved Messages внутри пира) | **нет вовсе** | — | |
| Ряд вкладок (разметка) | **есть дважды**: React-копия и ядро класса | `SharedMedia.tsx:73-97` (`SharedMediaTab`), ряд `:320-349`; ядро — `components/appSearchSuper.ts` (волна 3, задача 5) | классы совпадают у обоих, включая `i.menu-horizontal-div-item-background`. Ядро строит ряд как оригинал (`appSearchSuper.ts:462-493`) и сверено с дампом `dom/dumps/07-right-sidebar.json:121-131`; React-копия по `ALL_TABS` уходит с задачей 13 |
| Стили подсистемы | **есть, 1:1** | `web-client/src/styles/tweb/_searchSuper.scss` — **428 строк, ровно как оригинал** | портированы целиком, включая `is-selecting`/`is-full-viewport`, под которые у нас пока нет кода |
| Анимация перехода между вкладками | **есть, потребитель — ядро класса** | `components/transition.ts` — `TransitionSlider` с `slideTabs`; старый React-путь `shared/ui/Tabs/TabSlide.tsx` (177) + `core/hooks/useTransitionSlider.ts` (60) пока жив | `slideTabs` (`transition.ts:45-95`) портирован 1:1 (волна 3, задача 3): вкладки не размонтируются, а сдвигаются на ±width, поэтому поддерево и `scrollTop` переживают переключение. Потребителем стал `AppSearchSuper` (задача 5) — через `horizontalMenu`. React-путь с `keepMounted`-дефектом (`SharedMedia.tsx:352`) уйдёт вместе с `SharedMedia.tsx` (задача 13) |
| Горизонтальный скролл ряда + автоцентрирование активной | **есть, подключён к ядру** | `components/horizontalMenu.ts` (задачи 4-5 плана этапа 3) | порт `horizontalMenu.ts` целиком, включая автоцентрирование (`:64-79`) и переезд подчёркивания (`:104-127`); ряд ядра `AppSearchSuper` им и управляется. Время перехода вынесено в `TABS_TRANSITION_TIME` и запинено на CSS-токен `--tabs-transition` (`horizontalMenu.test.ts`) |
| Свайп между вкладками | **есть в ядре** | `appSearchSuper.ts` (порт `tweb:498-542`) + `helpers/dom/handleTabSwipe.ts`, `helpers/dom/lockTouchScroll.ts` | соседняя вкладка со `hide` пропускается, замок скролла снимается по концу перехода. Перехват свайпа вкладками `gifts`/`stories` (`tweb:508-515`) приедет с задачами 11-12 |
| Пагинация | **есть частично** | `SharedMedia.tsx:139,147,185-224` (`byFilter`, `PAGE_SIZE = 30`), sentinel `:226-242` | **по числовому `offset`, а не по `offsetId`** — прямое следствие формы ручки (§ 3); infinite scroll через `IntersectionObserver` с `rootMargin: 300px` вместо `scrollable.onScrolledBottom` |
| Кэш вкладок | **есть частично** | `byFilter` — `SharedMedia.tsx:139` | живёт в стейте компонента: смена пира сносит компонент (`components/chat/ChatsContainer.tsx:151`, `key={desc.id}`) вместе с кэшем. У оригинала кэш модульный и переживает смену пира (`sharedMedia.tsx:33-36`) |
| Живые апдейты | **есть, но грубее** | `SharedMedia.tsx:177-183` | **любое** изменение длины окна сообщений сбрасывает ВЕСЬ `byFilter` — включая подгрузку старых сообщений при скролле ленты. Все накопленные страницы теряются, активная вкладка грузится с нуля. У оригинала — точечный prepend/remove (`sharedMedia.tsx:209-345`) |
| Счётчики вкладок / скрытие пустых | **есть в ядре класса** | `components/appSearchSuper.ts::loadFirstTime` (порт `tweb:2380-2513`), `toggleContainerHidden`/`updateContainerHidden` (`:2515-2529`); пины — `appSearchSuper.firstTime.test.ts` (волна 3, задача 10) | портировано дословно: ОДИН batch `messages.searchCounters` на все медиа-фильтры (ручка задачи 2), нулевая вкладка получает `hide` на строке ряда и ОСТАЁТСЯ в DOM (свайп и `updateContainerHidden` её видят), при единственной видимой — `is-single` на ряду и `hide` на градиенте, при пустом наборе — `hide` на подсистеме и `search-empty` на родителе. `updateContainerHidden` — `public`: его единственный вызывающий (`onCountChange` подарков, `:2151-2154`) приезжает задачей 12. React-`SharedMedia.tsx:149-163` (пять `mediaHistory(..., 0, 1)`) уходит с задачей 13 |
| Приоритет первой открытой вкладки | **есть в ядре класса** | `components/appSearchSuper.ts::loadFirstTime` (`tweb:2478-2495`) + предикаты `canView*`/`getGiftsCount` (`:2611-2712`); `firstLoad`/`loadFirstTimePromise` в `load()` (`:2536-2544`) и их сброс в `cleanup()`; пины — `appSearchSuper.firstTime.test.ts` | приоритет дословный: stories → members (перебивает stories) → savedDialogs → gifts (только когда больше нечего показать), иначе первая непустая медиа; выбор без анимации и без прокрутки (`skipScroll`). `canViewMembers` — из зеркала карточек после `peers.fillMirror` (не три RPC), действие `view_participants` добавлено в `ChatRights` (порт `hasRights.ts:140-142`); `canViewSaved`/`canViewGroups`/`canViewSimilar` — `false` без сети (задачи 17/16/18 плана); `canViewStories` — ветка пользователя через `stories.pinnedStories`, ветка чата `false` (у `ChannelFull` нет `stories_pinned_available`), `storiesArchive` не портирован; `getGiftsCount` — длина `stars.profileGifts` вместо `stargifts_count` и только при объявленной вкладке `gifts`; `maybePinnedGifts`/`setPinnedGifts` — задача 12. Расхождения 26-30 в шапке файла. React `UserInfoPanel.tsx:84`/`SharedMedia.tsx:309-313` уходят с задачей 13 |
| Память скролла между вкладками | **есть в ядре класса** | `components/appSearchSuper.ts` (порт `tweb:624-708`, `:2756-2760`), пины — `appSearchSuper.scroll.test.ts` | портировано дословно: позиция уходящей запоминается, приходящая на время анимации сдвигается инлайновым `translateY(diff)`, по концу перехода сдвиг снимается и ставится настоящий `scrollPosition`. React-`SharedMedia` этого по-прежнему не умеет (вкладка размонтируется) — уйдёт с задачей 13 |
| Выделение элементов | **нет вовсе** | база есть: `components/chat/selection.ts` (844, `AppSelection` + `ChatSelection`) | `SearchSelection` (`chat/selection.ts:583-763`) не портирован; стили под него уже лежат |
| Контекстное меню элемента | **нет вовсе** | инфраструктура есть: `helpers/contextMenuController.ts`, `helpers/dom/attachContextMenuListener.ts`, `helpers/positionMenu.ts`, `components/buttonMenu.ts` | `SearchContextMenu` (`:156-345`) не портирован: из shared media нельзя ни переслать, ни скачать, ни перейти к сообщению |
| Строка поиска внутри вкладки | **нет — и в оригинале нет** | — | не расхождение (§ 0) |
| Поиск сообщений внутри чата | **есть, и это другая подсистема** | `components/conversation/TopbarSearch.tsx` (599), `core/hooks/useChatHeaderSearch.ts`, `useChatSearch.ts`, `stores/searchStore.ts`; ручка `core/managers/messagesManager.ts:708-719` → `GET /chats/:id/search` | оригинал — `chat/topbarSearch.tsx` (1318, Solid). **Волна 5**, не этот этап |
| Тесты | **есть частично** | `SharedMedia.invalidate.test.tsx` (126), `SharedMedia.saved.test.tsx` (337), `userInfo/helpers.test.ts` (25) | покрыты сигнал инвалидации и виртуальный список «Избранного». Не покрыты: пагинация медиа-вкладок, переключение вкладок, смена пира, подарки, участники |
| Контракт «контекст до первого `load`» | **есть в ядре класса** | `setQuery` перед `load` — так зовёт владелец (`sharedMedia.tsx`), так делают все харнессы `appSearchSuper.*.test.ts` | `load()` теперь `async` и первым делом ждёт `loadFirstTime`, который читает `searchContext` (`tweb:2382`, до проверки `hideEmptyTabs`); харнессы свайпа и памяти скролла (`appSearchSuper.swipe/scroll.test.ts`) зовут `setQuery` и работают с `hideEmptyTabs: false` — первый показ не их предмет, а в этом режиме он выключен, как у левой колонки (`:2384-2386`) |
| `SortedUserList` + строка чатлиста | **есть** (задача 11) | `components/sortedUserList.ts` (порт `sortedUserList.ts` 1:1), `components/dialogRow.ts` (узкий порт `DialogElement`/`addDialogNew`/`createChatList` из `appDialogsManager.ts`), `helpers/sortedList.ts` (порт `SortedList`, `sortedList.ts:128-303`) | строка сверена с дампами `15-right-11`/`15-right-14`; из `DialogElement` не портированы параметры списка чатов (темы, монофорум, истории на аватаре, бейджи) — шапка `dialogRow.ts` |
| Контекстное меню участника | **есть** (задача 11) | `helpers/dom/createParticipantContextMenu.ts` (порт 1:1) поверх `helpers/dom/createContextMenu.ts` (порт tweb `createContextMenu.ts`) | пункты скрыты по `verify`, а не задизейблены; `change_permissions` → `ban_users` (у оригинала одна ветка `hasRights`); `promoted_by` на проводе нет — `canEditAdmin` отвечает «да» только создателю (шапка `core/peers/participant.ts`); `handleMissingInvitees` не портирован |

## 2.2 Что уже портировано и переиспользуется без изменений

Это существенно снижает объём работ — половина зависимостей класса у нас уже есть:

| Наш файл | Соответствие в tweb | Готовность |
|---|---|---|
| `components/scrollable.ts` (530) | `components/scrollable.ts` (483) | полный порт, включая `ScrollableX`, `onAdditionalScroll`, `checkForTriggers`, `onScrolledBottom`, `scrollIntoViewNew`, `attachBorderListeners` |
| `components/slider.ts`, `components/sliderTab.ts` | одноимённые | волна 2 |
| `components/row.ts`, `settingSection.ts`, `button.ts`, `buttonIcon.ts`, `buttonMenu.ts`, `icon.ts`, `ripple.ts`, `preloader.ts`, `checkboxField.ts` | одноимённые | волны 1-2 |
| `components/wrappers/{photo,video,document,mediaSpoiler,album,sticker}.ts` | `components/wrappers/*` | есть |
| `components/chat/selection.ts` (844) | `chat/selection.ts` (1189) — база `AppSelection` | база есть, `SearchSelection` нет |
| `helpers/{listenerSetter,middleware,middlewarePromise,positionMenu,contextMenuController}.ts`, `helpers/dom/attachContextMenuListener.ts` | одноимённые | есть |
| `core/lazyLoadQueue.ts`, `core/dom/setTransition.ts`, `core/dom/swipeHandler.ts`, `helpers/dom/handleHorizontalSwipe.ts` | одноимённые | есть |
| `components/transition.ts` (~460) | `transition.ts` (383) | **портирован целиком** (волна 3, задача 3): `TransitionSlider` с обеими функциями анимации — `slideNavigation` (`:23-43`) и `slideTabs` (`:45-95`) |
| `components/horizontalMenu.ts` (273) | `components/horizontalMenu.ts` (215) | **портирован целиком** (волна 3, задача 4): автоцентрирование (`:64-79`) и переезд подчёркивания (`:104-127`); слайдер содержимого по умолчанию — `TransitionSlider` выше |
| `styles/tweb/_searchSuper.scss` (428), `_profile.scss`, `_rightSidebar.scss`, `_searchGroup.scss`, `_transition.scss` | одноимённые партиалы | стили готовы |
| `components/stargifts/{stargiftsGrid,profileList}.module.scss` | одноимённые | стили готовы, кода нет |
| `components/putPreloader.ts`, `helpers/dom/{handleTabSwipe,lockTouchScroll}.ts` | одноимённые | заведены задачей 5 — их требует ядро класса; `putPreloader` собирает узлы `createElement`'ом вместо `innerHTML` оригинала (правило безопасности репозитория), дерево то же |

**`appSearchSuper.ts` — портировано ядро** (волна 3, задача 5):
`components/appSearchSuper.ts` строит разметку подсистемы (`tweb:439-603`),
держит слайдер вкладок и память скролла (`:624-708`, `:800-815`), свайп
(`:498-542`), очистку и смену пира (`:2714-2793`, `:2803-2843`). Загрузка,
рендер элементов, первый показ вкладок, участники, выделение и контекстное меню
в файле ОТСУТСТВУЮТ (не заглушки — пропуски с комментарием и ссылкой на строку
оригинала); приезжают задачами 6-14. Потребителя у класса ещё нет: панель
профиля до задачи 13 работает на React-`SharedMedia`.

**Чего у нас нет вовсе** (нужно портировать): остальные 2/3
`appSearchSuper.ts`, `SearchSelection`, `SearchContextMenu`. `sortedUserList.ts`
и строитель строки чатлиста портированы задачей 11 (см. § 2.1).

## 2.3 Наши известные дефекты в этой зоне (подтверждены на 2026-09-07)

1. **`stickyTop = TAB_GAP` = 8px перебивает портированный CSS.**
   `UserInfoPanel.tsx:706` передаёт `stickyTop={TAB_GAP}` (`userInfo/helpers.ts:45`),
   `SharedMedia.tsx:334` ставит его инлайном на `.search-super-tabs-scrollable`,
   у которого CSS уже даёт `top: var(--super-offset)` (72px). Инлайн выигрывает →
   липкий ряд прилипает под absolute-шапку. Числится P1 с
   `docs/research/2026-08-08-tweb-deep-structural-audit.md` и не закрыт.
2. **Инвалидация кэша слишком широкая** — `SharedMedia.tsx:177-183`, см. таблицу выше.
3. **Пять запросов вместо одного** на счётчики вкладок — `SharedMedia.tsx:149-163`.
4. **Неактивная вкладка размонтируется** (`SharedMedia.tsx:352`, `TabSlide` без `keepMounted`) — отсюда и отсутствие памяти скролла, и повторный рендер всего списка при возврате.
5. **Инлайн-стиль пустого состояния** — `SharedMedia.tsx:291-295` вместо портированного `.content-empty` (у оригинала — `afterPerforming:1276-1281`).

---

# Часть 3. Что блокировано бэкендом

Форма нашей ручки медиа отличается от той, под которую написан класс.

| Вкладка | Ручка | Что отдаёт | Вердикт для порта |
|---|---|---|---|
| `media` (photo+video) | `GET /chats/{peerID}/media?filter=media` — `backend/internal/adapter/delivery/http/router.go:261` → `chat_handler.go:985-1003` → `usecase/chat/sync.go:290-309` → `adapter/repo/postgres/messagesrepo.go:449-487` | `messages.messagesSlice{count, messages, users}` | **портируется**, но пагинация по `offset` |
| `files` | тот же, `filter=files` (`type='document'`) | то же | **портируется** |
| `music` | тот же, `filter=music` (`type='audio'`) | то же | **портируется** |
| `voice` | тот же, `filter=voice` (`type IN ('voice','roundVideo')`) | то же | **портируется**; совпадает с `inputMessagesFilterRoundVoice` оригинала |
| `links` | тот же, `filter=links` | то же | **портируется с оговоркой**: фильтр — регексп по тексту `type='text' AND text ~* 'https?://'` (`messagesrepo.go:449-487`), а не по сущностям `messageEntityUrl`/`TextUrl`. Ссылка за текстом-якорем не найдётся; сообщение с медиа + ссылкой в подписи тоже |
| `members` | `GET /chats/{peerID}/members` — `router.go:317` → `group_handler.go:639`, репо `grouprepo.go:451` | участники + карточки users | **портируется**; пагинация `offset`/`limit` (дефолт 200). **Блокер по живым обновлениям:** кадра по участнику (`updateChannelParticipant`, у tweb `chat_participant`) нет — на изменение состава бэкенд шлёт общий `updateChannelFullSnapshot` (`usecase/chat/group.go:153`, `:203`) без списка; класс перечитывает отрисованное окно ручкой (расхождение 32 в шапке `appSearchSuper.ts`). Лечится кадром по участнику на бэкенде |
| `gifts` | `GET /users/{userID}/gifts` — `router.go:247` → `stars_handler.go:180-201` | `payments.savedStarGifts` | **портируется**; пагинации нет — отдаёт всё разом |
| `savedDialogs` | `GET /saved/dialogs` — `router.go:174` → `chat_handler.go:230-253` | `messages.savedDialogs` | **портируется**; пагинации нет |
| `stories` | `GET /stories/pinned?peer=` — `router.go:405`; `GET /stories/archive` — `router.go:404` (там `offset_id`+`limit`) | `stories.stories` | **портируется**; pinned без пагинации |
| `similar` | `GET /channels/{peerID}/similar` — `router.go:370` → `channel_handler.go:494-508` | `messages.chatsSlice{count, chats}`, жёстко топ-30 | **портируется** (оригинал тоже грузит один раз) |
| `groups` (общие группы) | **ручки нет** | — | **заблокировано.** Аналога `users.getCommonChats` в usecase/http/repo нет; в TL-схеме конструктор объявлен (`internal/domain/mtpeer.go`, `internal/pkg/tl/schema_gen.go`), реализации — нет |
| `saved` (Saved Messages внутри пира) | частично: `GET /saved/dialogs`, `GET /saved/tags` (`router.go:174-175`) | — | **заблокировано**: истории треда `saved_peer_id` по пиру ручкой не отдаётся |
| Счётчики всех типов разом | **ручки нет** | — | **заблокировано.** Аналога `messages.getSearchCounters` нет; `count` приходит только по одному переданному фильтру. Отсюда наши 5 запросов вместо одного |

**Две вещи, которые надо править в бэкенде, а не обходить в клиенте**
(норма `docs/superpowers/specs/2026-08-28-solid-migration-design.md` § 9, DoD 2a):

1. **Пагинация по `offset_id`.** Класс листает по id последнего показанного
   сообщения (`loadType:2278-2291`), а `historyStorage` при этом ещё и растёт
   сверху от живых апдейтов (`sharedMedia.tsx:239`). С числовым SQL-`OFFSET`
   (`messagesrepo.go:449-487`) любое пополнение сверху сдвигает окно — вторая
   страница приедет с дублями или дырой. Дословный порт `historyStorage`
   поверх `offset` **некорректен**, а не просто «немного другой».
2. **Batch-счётчики.** Без них `loadFirstTime` (`:2380-2513`) — либо пять
   запросов на открытие профиля, либо расхождение с оригиналом.

**Индексы** (`backend/internal/store/postgres/migrations`): есть `UNIQUE(chat_id, seq)`
(`0002_chats_messages.sql:31`), на нём и держится `ORDER BY seq DESC`. Составного
индекса `(chat_id, type, seq)` нет — точный `count(*)` по фильтру требует прохода
по всем сообщениям чата. Для батч-счётчиков это надо учесть.

---

# Часть 4. Риски порта

| Риск | В чём | Смягчение |
|---|---|---|
| **Владение узлом между React и ванилью** | Узел `search-super` сейчас создаёт React (`UserInfoPanel.tsx:351-355`) и рисует в него портал; после порта узлом обязан владеть класс — у оригинала `searchSuperContainer` это **и есть** `tab.searchSuper.container` (`sharedMedia.tsx:166`) | Не изобретать мост: React отдаёт Solid-карточке `instance.container` вместо самодельного `div`, а снимает узел тот, кто создал (§ 7 спеки). Пин на шов: после смерти владельца его узлов в DOM нет |
| **Двойная реализация** | Соблазн оставить React-`SharedMedia.tsx` «пока» рядом с классом. Ровно этим программа проваливается (DoD п. 14) | Все вкладки, которые сейчас РАБОТАЮТ (media/files/links/music/voice/members/gifts/savedDialogs), должны быть у класса ДО переключения шва; переключение и удаление React — одна задача |
| **Пересборка вместо переиспользования** | Наш React рисует список заново при каждом заходе на вкладку (нет `keepMounted`), у класса вкладка — живой DOM, который просто перестаёт быть `active` | Пин: повторный вход на вкладку не делает сетевого запроса и сохраняет `scrollTop` |
| **Пин на форму вызова вместо результата** | Тесты вида «вызван `mediaHistory` с такими аргументами» переживут поломку рендера | Пины — на DOM (`.search-super-item` появился/снялся), на счётчик, на `scrollTop`, на отсутствие сетевого вызова из кэша |
| **`offset` vs `offsetId`** | См. часть 3 | Бэкенд правится ПЕРВЫМ, клиент остаётся дословным |
| **Ванильного чатлиста нет** | `SortedUserList` (`sortedUserList.ts:134`) опирается на `appDialogsManager.addDialogNew`, которого у нас нет | Наша React-разметка участников (`SharedMedia.tsx:369-413`) уже даёт `.chatlist-chat` 1:1 — порт сводится к узкому строителю строки, а не к переносу `appDialogsManager` |
| **Слишком широкая инвалидация уедет в порт** | Если перенести `winLen`-сброс как есть, недоделка станет «портированным поведением» | Живые апдейты портируются в форме оригинала (`sharedMedia.tsx:209-345`), `winLen`-сброс удаляется, а не переносится |
| **Тесты на текущий React дадут ложный зелёный** | `SharedMedia.invalidate.test.tsx` пинит именно ту инвалидацию, которую надо снести | Тест переписывается под контракт оригинала (точечный prepend), а не сохраняется |

---

# Проверка после порта

Прощёлкивается на стенде; числа сверяются с оригиналом на `web.telegram.org/k`.

1. Открыть профиль пира с медиа: ряд вкладок липнет на `--super-offset` (72px), **не** на 8px, и не уезжает под шапку.
2. Пустые вкладки в ряду отсутствуют; при единственной видимой у ряда класс `is-single` и градиент скрыт.
3. У группы по умолчанию открыта вкладка «Участники» (`appSearchSuper.ts:2478-2495`), у пользователя — первая непустая медиа.
4. Прокрутить вкладку «Медиа» на 3-4 страницы, уйти на «Файлы», вернуться: **позиция скролла восстановлена, сетевого запроса нет**.
5. Скролл профиля вниз: заголовок сменился слайд-фейдом, у контейнера появился `is-full-viewport`, крестик стал стрелкой; скролл вверх — всё вернулось и позиции вкладок сброшены (`cleanScrollPositions`).
6. Отправить в открытый чат фото: во вкладке «Медиа» **добавилась одна плитка сверху**, счётчик вырос на 1, ранее загруженные страницы на месте.
7. Удалить это сообщение: плитка снялась, счётчик уменьшился.
8. Правый клик по плитке: меню `search-contextmenu` с Forward/Download/Goto/Select/Delete; пункты, недоступные по правам, скрыты, а не задизейблены.
9. Выделить два элемента: ряд вкладок сменился плашкой `.search-super-selection-container` со счётчиком.
10. Клик по плитке открывает вьювер, стрелки листают **по элементам вкладки**, а не по ленте чата.
11. Открыть другой профиль и вернуться: вкладки нарисовались из кэша, без сети (`historiesStorage`).
12. `dom-parity.mjs` по дампам правой колонки — `docs/tweb/dom/dumps/07-right-sidebar.json` и `15-right-*.json`.
