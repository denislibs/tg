# Глобальный поиск левой колонки: `initSearch` + `AppSearchSuper` в tweb vs наш `SearchView`

Снято 2026-09-08. Источники:

- tweb `/Users/denisurevic/Documents/tweb`, коммит `e52b5d931` («Add dev server typecheck and lint overlay»);
- наш код `web-client/` и `backend/` на `main` (`6eab4970`).

> Локальный tweb — форк оригинала. Левая колонка там гибрид: `AppSidebarLeft` и
> `AppSearchSuper` — **классы на ванильном DOM**, а группы результатов
> (`SearchGroup`), меню типа чата (`ChatTypeMenu`) и пустая заглушка
> (`EmptySearchPlaceholder`) — Solid-компоненты, которые классы монтируют в свои
> контейнеры. Ниже отражено фактическое состояние репозитория.

Этот док — разбор **одной подсистемы**: второго потребителя `AppSearchSuper` —
глобального поиска левой колонки. Сам класс (конструктор, вкладки, память
скролла, `load`/`loadType`, рендереры медиа/документов/ссылок, живые апдейты)
разобран в [`shared-media.md`](shared-media.md) и здесь не дублируется; общий
обзор левой колонки (InputSearch, группы, табы, открытие/закрытие) — в
[`left-sidebar.md`](left-sidebar.md) часть 4, здесь он раскрыт до адресов,
нужных порту. Про бургер и морф ↔ «назад» — `left-sidebar.md` часть 7 п. 3.

**Порт по этому доку** — план
[`../superpowers/plans/2026-09-07-solid-wave-3-global-search.md`](../superpowers/plans/2026-09-07-solid-wave-3-global-search.md).

---

## 0. Поправки к постановке — прежде чем читать дальше

| Ожидание | Как на самом деле в tweb |
|---|---|
| «Поиск — отдельный экран со своими вкладками» | **Нет.** Вкладки, слайдер, память скролла и загрузка — тот же класс `AppSearchSuper`, что в правой колонке; левая колонка лишь создаёт его с другим списком вкладок и четырьмя опциями (`sidebarLeft/index.ts:1128-1170`): `searchGroups`, `asChatList: true`, `hideEmptyTabs: false`, `showSender: true`. Экран поиска — это `initSearch()` (`:1084-1554`), 470 строк обвязки вокруг класса |
| «Поле ввода принадлежит экрану поиска» | **Нет.** `InputSearch` живёт в шапке колонки всегда (`index.ts:151-154`), поиск лишь подписывается на его `onChange/onClear/onEnter` (`:1286`, `:1305`, `:1312`) и снимает подписки в `cleanup()` (`:1411-1412`) |
| «Поиск живёт, пока открыт сайдбар» | **Нет.** Поиск **пересоздаётся при каждом открытии**: `initSearch` ленив и идемпотентен (`:1085`, once-подписка на `focus` `:220`, `:1422`), а по окончании обратного перехода `cleanup()` (`:1401-1423`) сносит класс, группы, чипы и сам `searchInitResult` |
| «Недавние — на сервере» | **Нет.** `recentSearch` — поле клиентского `State` (`config/state.ts:209`), пишется `appUsersManager.pushRecentSearch` (`appUsersManager.ts:277-293`), лимит 20. Ручки бэкенда у него нет и не нужно |
| «Вкладка `chats` листает сообщения как остальные» | Да, **и это главное**: `loadType` для `inputMessagesFilterEmpty` без пира идёт в `messages.searchGlobal` (`appMessagesManager.ts:9987-10003`) с курсором `offset_rate`/`next_rate`, а группы контактов рисует ОДИН раз `loadChats()` (`appSearchSuper.ts:2229-2240`, `:1285-1523`). У курсора глобального поиска **нет `offset_id` по одному чату** — это опаковый `next_rate` слайса (`:9432`, `:2321`) |

---

# Часть 1. Что делает оригинал

## 1.1 Карта файлов

| Файл (tweb `src/`) | Строк | Роль |
|---|---|---|
| `components/sidebarLeft/index.ts` | 1675 | `AppSidebarLeft`; **`initSearch()` `:1084-1554`** — сборка поиска; `watchChannelsTabVisibility` `:1556-1581`; `closeSearch` `:1583-1585`; эффект бургера `:408-418`; сигнал `isSearchActive` `:127-132` |
| `components/appSearchSuper.ts` | 2843 | класс; для левой колонки существенны `processEmptyFilter` `:826-871`, `loadChats` `:1285-1523`, `renderPeerDialogs` `:1943-1969`, `loadChannels` `:1971-2022`, `loadApps` `:2024-2115`, `loadPosts` `:2117-2128`, глобальная ветка `loadType` `:2229-2240` и `:2278-2321` |
| `components/searchGroup.tsx` | 170 | `createSearchGroup` — Solid-секция с чатлистом внутри |
| `components/chatTypeMenu/index.tsx` | 74 | `ChatTypeMenu` — фильтр all/users/groups/channels в заголовке группы «Сообщения» |
| `components/emptySearchPlaceholder/index.tsx` | 52 | заглушка «ничего не найдено» с уткой и кнопкой «искать во всех чатах» |
| `components/topPeersList.ts` | 60 | `createTopPeersList` — горизонтальная лента «люди» без запроса |
| `components/sidebarLeft/globalPostsSearch.tsx` | 318 | вкладка `posts` (Solid) — публичные посты каналов |
| `helpers/date.ts` | — | `DateData` `:240-244`, `fillTipDates` `:245-…` — чипы дат по тексту запроса |
| `lib/appManagers/appUsersManager.ts` | — | `pushRecentSearch` `:277-293`, `clearRecentSearch` `:295-…`, `getContactsPeerIds` `:467-480` (локальный индекс контактов, `getContacts` `:417-430`), `searchContacts` `:1069-1095` (`contacts.search`), `getTopPeers` `:969` |
| `lib/appManagers/appMessagesManager.ts` | — | `getHistory` `:9339`; `requestHistory` — выбор метода `:9966` (`messages.search`, если есть пир И нет `nextRate` И `folderId === undefined`) / `:9987-10003` (`messages.searchGlobal`: `offset_rate`, `folder_id`, `users_only/groups_only/broadcasts_only`); `nextRate` из слайса `:9432` |
| `lib/storages/dialogs.ts` | — | `getDialogs({query})` — поиск по **локальному** индексу диалогов `:1660-1690` (`SearchIndex`, `:342`) |
| `lib/searchIndex.ts` | 124 | `SearchIndex` — локальный полнотекстовый индекс имён (контакты `appUsersManager.ts:509`, диалоги `dialogs.ts:342`) |
| `lib/appDialogsManager.ts` | — | `setListClickListener` `:1751-…` (клик по строке → `appImManager.setPeer`, `onFound`), `createChatList` `:1952`, `setLastMessageN` `:1983` → `setLastMessage` `:2020-…` (`highlightWord` → `wrapMessageForReply` `:2184-2192`, время `:2242`), `addDialogNew` `:2636` |
| `components/wrappers/messageForReply.ts` | — | опция `highlightWord` `:36`, `:45-46`, подсветка `:384` |
| `index.html` | — | статический каркас `:91-102`: `.item-main` > `.sidebar-header` (`.animated-menu-icon` `:94`, `.sidebar-back-button` `:95`) + `.sidebar-content.transition.zoom-fade` `:98` > `#chatlist-container.transition-item.active` `:99` + `#search-container.transition-item.sidebar-search` `:102` |
| `scss/partials/_leftSidebar.scss` | — | чип в поле `:332-359` (`.input-search .selector-user`, `is-picked`, `is-picked-twice`, `--paddingLeft`), `.search-helper` `:376-391`, `#search-container` `:663-…` (`--super-offset: 1rem`, вкладки `flex: 1 0 auto`) |
| `scss/partials/_searchGroup.scss` | 80 | `.search-group`, `is-short`/`is-short-5`, `.search-group-people` (горизонтальная лента) |
| `scss/partials/_transition.scss` | — | `zoom-fade` `:18-60` |
| `config/state.ts` | — | `recentSearch: PeerId[]` `:209`, дефолт `:568` |

## 1.2 `SearchGroup` — `searchGroup.tsx`

Фабрика `createSearchGroup(options)` (`:13-24`): `name` (`LangPackKey | false`),
`type`, `clearable = true`, `className`, `clickable = true`, `autonomous = true`,
`onFound`, `noIcons`, `middleware`, `scrollableX`.

| Что | Где | Суть |
|---|---|---|
| Разметка | `:82-112` | `Section` с `class="search-group search-group-<type> [className] [hide] [showMoreClassName] [search-group-with-scroll]"`, `innerClass="search-group-inner"`, контент `.search-group-content`; внутри — `list = appDialogsManager.createChatList()` (`:77`), при `scrollableX` обёрнут в горизонтальный `Scrollable` (`:101-108`) |
| Скрыт по умолчанию | `:52`, `:91` | `hide()` = `true` → класс `hide`; `setActive()` снимает |
| «Показать ещё/меньше» | `:53-76`, `:163-165` | `needShowMoreButton(toggleClassName = 'is-short-5')` ставит класс-обрезку и справа в заголовке кнопку `Separator.ShowMore/ShowLess` (`NameRight`, `:37-50`) |
| Правый слот заголовка | `:166` | `setNameRight({children, onClick})` — им левая колонка вешает `ChatTypeMenu` на «Сообщения» (`index.ts:1124-1126`) и «Clear» на «Недавние» (`:1504-1519`) |
| Клик по строке | `:114-121` | `appDialogsManager.setListClickListener({list, onFound, autonomous})` — открыть пира и позвать `onFound` (закрыть поиск) |
| API | `:123-169` | `container`, `list`, `nameEl`, `autonomous`, `noIcons`, `createPlaceholder`, `addPlaceholder/removePlaceholder` (`:133-141`), `clear()` (`:142-152`: `hide` + снос строк), `setActive()` (`:153-155`), `toggle()` (`:156-162`: показать, если есть дети, иначе очистить), `needShowMoreButton`, `setNameRight` |
| Корень Solid | `:82`, `:112` | `createRoot` с `dispose` на `middleware.onClean` — группа умирает вместе с `initSearch` |

## 1.3 Сборка в левой колонке — `initSearch()` (`sidebarLeft/index.ts:1084-1554`)

| Шаг | Где | Что |
|---|---|---|
| Идемпотентность | `:1085` | `if(this.searchInitResult) return this.searchInitResult` |
| Контейнер и скроллер | `:1087-1089` | `#search-container` из статического каркаса; `new Scrollable(searchContainer)` — **скроллер поиска создаёт хозяин**, класс получает его опцией `scrollable` |
| `close` | `:1091-1093` | `simulateClickEvent(this.backBtn)` — единственный способ закрыть; им пользуются `onFound` групп, Escape, Enter-с-URL |
| Пять групп | `:1095-1103` | `contacts` («SearchAllChatsShort»), `globalContacts` («GlobalSearch»), `messages` («SearchMessages»), `people` (`name: false`, `className: 'search-group-people'`, `autonomous: false`, `noIcons`, `scrollableX`), `recent` («Recent», `className: 'search-group-recent'`). У всех, кроме `messages`, `onFound: close` |
| Заглушка группы сообщений | `:1105-1116` | `messages.createPlaceholder = () => new EmptySearchPlaceholder` с `onAllChats` (сброс `ChatTypeMenu` в `all` + `updateSearchQuery`) — только если выбран не `all` и меню не скрыто |
| `ChatTypeMenu` | `:1118-1126` | `feedProps({onChange → updateSearchQuery({search, chatType}), selected: 'all'})`; вешается в правый слот заголовка «Сообщения» |
| Класс | `:1128-1170` | 9 вкладок (таблица в `left-sidebar.md` часть 4 § 4), `scrollable`, `searchGroups`, `asChatList: true`, `hideEmptyTabs: false`, `showSender: true`, `managers`, `scrollOffset: 16` |
| `onChangeTab` | `:1172-1183` | уход с `posts` — клик по `clearBtn` поля; `searchContext.chatType = 'all'`; вход в `posts` — `globalPostsSearch.setQuery(value)` |
| Видимость вкладки `channels` | `:1185`, `:1556-1581` | `watchChannelsTabVisibility`: `menuTab.hide`, если среди кэшированных диалогов нет ни одного broadcast; пересчёт по `channel_update` (через 200 мс) и `peer_deleted` |
| Вставка узла | `:1187` | `scrollable.append(searchSuper.container)` |
| `resetSearch` | `:1189-1197` | `setQuery({peerId: '', folderId: 0})` → `selectTab(0)` → `load(true)`; зовётся сразу |
| Чипы: состояние | `:1200-1224` | `pickedElements`, `selectedPeerId`, `selectedMinDate/MaxDate`; `updatePicked`: классы `is-picked`/`is-picked-twice` на контейнере поля, `is-first`/`is-last` на чипах, `--paddingLeft` = правый край последнего чипа − левый край инпута; при чипах `ChatTypeMenu` прячется (`pause(0)`) |
| Чипы: helper | `:1226-1255` | `div.search-helper.hide` вставляется в `searchSuper.nav.parentElement` (`:1255`); клик по `.selector-user` внутри: снять `selector-user-primary`, разобрать `data-key` (`date_<min>_<max>` или peerId), **перенести чип в контейнер поля** (`:1249`), очистить поле и перезапросить (`:1250`) |
| Чипы: рендер | `:1257-1266` | `AppSelectPeers.renderEntity({key, title, avatarSize: 30, fallbackIcon: 'calendarfilter', primary: true})` |
| Чипы: снятие | `:1268-1284` | `unselectEntity`: сброс дат/пира, `middlewareHelper.destroy()`, удаление узла, `setTimeout(0)` → `updatePicked` + `onChange(value)` |
| `onClear` поля | `:1286-1293` | снять все чипы, очистить helper |
| helper ↔ ряд вкладок | `:1295-1303` | `onHelperLength(hide)`: пока в helper есть чипы — helper показан, а `searchSuper.nav` скрыт (`hide`), и наоборот |
| `onChange` поля | `:1305-1310` | не на вкладке `chats` — `ChatTypeMenu` в `all`; `updateSearchQuery({search, chatType})` |
| `onEnter` поля | `:1312-1321` | если введён URL (`wrapUrl(trimmed).onclick`) — очистить поле, закрыть поиск, `appImManager.openUrl` |
| **`updateSearchQuery`** | `:1328-1381` | на `posts` — только `globalPostsSearch.setQuery`; иначе `cleanupHTML()` → `setQuery({peerId: selectedPeerId, folderId: selectedPeerId ? undefined : 0, query, chatType, minDate, maxDate})` → `load(true)`; параллельно helper: чипы дат `fillTipDates(value, dates)` (`:1351-1359`, только без выбранной даты) и чипы пиров `dialogsStorage.getDialogs({query})` + `getContactsPeerIds(query, true)` до 20 (`:1361-1374`, только без выбранного пира); `helperMiddlewareHelper.clean()` на каждый запрос |
| Recent: запись | `:1383-1396` | `mousedown` capture на `tabs.inputMessagesFilterEmpty`: найти `a` (`DIALOG_LIST_ELEMENT_TAG`), пропустить группы `recent`/`people`, `pushRecentSearch(peerId)` |
| **`cleanup`** | `:1401-1423` | снос чипов; поле: `value = ''`, снять `is-picked*`/`--paddingLeft`, `onChange = onClear = undefined`; `searchSuper.destroy()`; `helperMiddlewareHelper.destroy()`; `searchContainer.replaceChildren()`; `searchListenerSetter.removeAll()`; `searchInitResult = searchSuper = undefined`; **новая once-подписка на `focus`** (`:1422`) |
| **Переход** | `:1425-1449` | `TransitionSlider({content: searchContainer.parentElement /* .sidebar-content */, type: 'zoom-fade', transitionTime: 150, listenerSetter})`; `onTransitionStart(id)` — `is-search-active` на `.item-main` (`:1431`); `onTransitionEnd(0)` при не первом вызове — `cleanup()` + через 150 мс вернуть `newBtnMenu`/`updateBtn` (`:1433-1447`); `transition(0)` сразу (`:1449`) |
| **`onFocus`** | `:1451-1486` | `newBtnMenu`/`updateBtn` → `is-hidden`; `appNavigationController.pushItem({type: 'global-search', onPop: close})` (кроме iOS Safari и если такого итема ещё нет); `transition(1)`; `buttonsContainer.is-visible` (+`appear-animated`, если триггер поиска в свёрнутой колонке не был виден); `isSearchActive = true` → Solid-эффект морфит бургер (`:408-418`); `onSomethingOpenInsideChange()` |
| Подписка на фокус | `:1488-1489` | `searchListenerSetter.add(input)('focus', onFocus)`; `onFocus()` зовётся сразу |
| `backBtn` | `:1491-1502` | `removeByType('global-search')` → `transition(0)` → снять `is-visible` → `isSearchActive = false` → `onSomethingOpenInsideChange()` → `ChatTypeMenu` в `all` |
| Recent: «Clear» | `:1504-1519` | `recent.setNameRight({onClick: confirmationPopup('Search.Confirm.ClearHistory', 'ClearButton', danger) → clearRecentSearch() → recent.clear(), children: i18n('ClearRecentSearch')})` |
| Возврат | `:1525-1553` | `{open(focus), openWithPeerId(peerId), close}`; `openWithPeerId` (`:1530-1549`) — вход сразу с чипом пира (`forumTab/forumTab.ts:114`) |

**Escape** — `appNavigationController.onKeyDown` → `onPop` итема `'global-search'` →
`close()`. **Ctrl+F** — фокус поля тем же путём (`onFocus` по событию `focus`).

## 1.4 Вкладка `chats` — `loadType` + `loadChats` + `processEmptyFilter`

Вкладка `chats` — единственная с `inputFilter: 'inputMessagesFilterEmpty'`.
Порядок в `loadType` (`appSearchSuper.ts:2229-2240`):

```
history = historyStorage[inputMessagesFilterEmpty] ??= []
if (!history.length && type !== 'saved'):
    if (!loadedChats) { loadChats(); loadedChats = true }        # группы — один раз на запрос
    if (!query.trim() && !peerId && !minDate):                   # пустой запрос — только группы
        loaded[type] = true; return
… дальше обычная ветка: getHistory({...searchContext, inputFilter, offsetId,
   offsetPeerId, limit, nextRate: nextRates[type] ??= 0})         # :2278-2291
```

**`loadChats()` (`:1285-1523`)** — сперва все группы `clear()` и вставляются в
`tabs.inputMessagesFilterEmpty` (`:1289-1292`), затем одна из трёх веток:

| Ветка | Условие | Что рисует |
|---|---|---|
| С запросом | `query && !peerId` (`:1295`) | 4 параллельных запроса (`:1364-1449`): `getContactsPeerIds(query, true, undefined, 10)` → `contacts`; `getSponsoredPeers(query)` → `globalContacts` (реклама, `:1373-1421`); `searchContacts(query, 20)` → `my_results` → `contacts`, `results` → `globalContacts` (+`is-short`, «показать ещё» при >3, `:1427-1438`); `dialogsStorage.getDialogs({query, limit: 20, filterId: 0})` → `contacts` (`:1442-1448`). Дедуп по `renderedPeerIds` (`:1329-1352`); строка — `addDialogNew({avatarSize: 'abitbigger', autonomous: group.autonomous, withStories: true})`; подпись `addDialogSubtitle` (`:1297-1327`): «Presence.YourChat» для себя, иначе `@username` / `+телефон`, для чата — ещё `getChatMembersString`; `group.toggle()` после каждой порции |
| Без запроса | `!peerId && !minDate` (`:1450`) | `createTopPeersList({group: people, modifyPeers: топ-15 без себя})` (`:1503-1517`) + `renderRecentSearch()` (`:1452-1501`): Solid-`For` по `appState.recentSearch`, строки `addDialogNew({meAsSaved: true, avatarSize: 'abitbigger', autonomous: true})`, подпись — статус пользователя / число участников; группа показывается, пока список не пуст |
| Иначе | выбран пир или дата | ничего (`:1522`) — сообщения приедут обычной веткой |

**`processEmptyFilter` (`:826-871`)** — рендер ОДНОГО сообщения строкой чатлиста в
группе `messages`: `addDialogNew({peerId, container: searchGroup.list, avatarSize:
'bigger', wrapOptions: {middleware}, withStories, meAsSaved, fromName})` (`:838-851`)
+ `setLastMessageN({dialog: {peerId}, lastMessage: message, dialogElement,
highlightWord: searchContext.query})` (`:853-861`) — превью сообщения с
подсветкой совпадения и временем. Куда: `performSearchResult` для
`inputMessagesFilterEmpty` берёт `searchGroups.messages` (`:1110-1113`), для
`PhotoVideo` с непустым запросом — `searchGroupMedia` (`:1106-1110`, узел
вставляется в `sharedMediaDiv`); группа анимируется `is-hidden → is-visible`
250 мс с задержкой 100 мс (`:1115-1128`); после рендера `setActive()`, а если
пусто и есть `createPlaceholder` — заглушка (`:1189-1194`;
`showSearchGroupAnyway` — только для `chats`).

## 1.5 Курсор глобального поиска — `nextRate`

| Где | Что |
|---|---|
| `appSearchSuper.ts:121`, `:124` | `SearchSuperContext.nextRate`, `chatType` |
| `:378` | `nextRates: Partial<{[type]: number}>` — пер-типовой курсор |
| `:2288` | запрос: `nextRate: this.nextRates[type] ??= 0` |
| `:2310-2319` | «всё загружено»: `history.length < loadCount` ИЛИ (`folderId !== undefined && !value.nextRate`) ИЛИ `isEnd.top` |
| `:2321` | `this.nextRates[type] = value.nextRate` |
| `:2718` | сброс в `cleanup()` |
| `:2795-2801` | `copySearchContext(inputFilter, nextRate, skipSensitive)` — контекст для плеера/вьювера |
| `appMessagesManager.ts:9966` | пир задан, `nextRate` нет и `folderId === undefined` → `messages.search` (поиск в одном чате, `offset_id`) |
| `:9987-10003` | иначе → `messages.searchGlobal`: `q`, `filter`, `min_date/max_date`, **`offset_rate: nextRate`**, `offset_peer`, `folder_id`, `users_only/groups_only/broadcasts_only` по `chatType` |
| `:9432` | `nextRate: slice.next_rate` в результате `getHistory` |

Итог: у глобальной выдачи курсор — пара «`offset_rate` из ответа + `offset_id`/
`offset_peer` последнего сообщения»; клиент его не вычисляет, а возвращает
серверу как есть. `folderId: 0` в `setQuery` (`index.ts:1192`) и есть признак
«глобально».

## 1.6 `showSender` — подпись отправителя в документах и ссылках

| Где | Что |
|---|---|
| `:411`, `:447` | опция `showSender? = false`; левая колонка ставит `true` (`index.ts:1167`) |
| `:942` | `processDocumentFilter`: `showSender = this.showSender || type ∈ {voice, round}` |
| `:947`, `:950` | `wrapDocument({withTime: !showSender, showSender, …})` — время И отправитель не дублируются |
| `:1061-1063` | `processUrlFilter`: `subtitleFragment.append('\n', await wrapSenderToPeer(message))` |

## 1.7 Остальные вкладки

| Вкладка | Где | Источник данных |
|---|---|---|
| `channels` | `loadChannels` `:1971-2022` | с запросом: `searchContacts(query, 200).results` → только broadcast → группа «Channels» без заголовка (`:1973-1993`); без запроса: группа «Chat.Search.JoinedChannels» из кэшированных диалогов-каналов (`:1995-2007`, «показать ещё» при >5) + группа «SimilarChannels» из `getChannelRecommendations()` (`:2009-2018`, без аргумента — глобальные рекомендации) |
| `apps` | `loadApps` `:2024-2115` | `getTopPeers('bots_app')` + `getPopularAppBots` с пагинацией; клик открывает веб-апп бота |
| `posts` | `loadPosts` `:2117-2128` | `wrapGlobalPostsSearch` (`globalPostsSearch.tsx:299-318`) — `channels.searchPosts`, квота/оплата звёздами |
| `media/links/files/music/voice` | обычная ветка `loadType` (`shared-media.md` § 1.5) | `messages.searchGlobal` с `filter` — те же рендереры, что в правой колонке, плюс `showSender` |

`hideEmptyTabs: false` → `loadFirstTime` выходит сразу (`:2383-2385`): вкладки
не скрываются по счётчикам и счётчики не запрашиваются; `cleanupHTML` не
прячет контейнер (`:2770-2773`) и для `chats` не ставит прелоадер (`:2776-2778`).
`NO_SECTION_TYPES` содержит `chats/channels/apps/posts` (`:545-553`) — эти
вкладки рисуют свои секции сами (группами).

## 1.8 `ChatTypeMenu` и `EmptySearchPlaceholder`

`chatTypeMenu/index.tsx`: ключи `all/users/groups/channels` → `AllChats/UsersOnly/
GroupsOnly/ChannelsOnly` (`:21-26`); пункты `ButtonMenu` с галочкой у выбранного
(`:35-51`); триггер — `span.primary.checkable-button-menu` с текстом текущего
(`:54-59`), меню `ButtonMenuToggle({direction: 'bottom-left'})` (`:61-68`);
`hidden` — класс модуля (`:57`). Сам фильтр уходит серверу флагами
`users_only/groups_only/broadcasts_only` (§ 1.5).

`emptySearchPlaceholder/index.tsx`: `LottieAnimation` «UtyanSearch» 156px
(`:24-30`, ассет `public/assets/tgs/UtyanSearch.json`), `NoResultsTitle`/
`NoResultsSubtitle` (`:32-35`), кнопка `SearchInAllChats` при `onAllChats`
(`:38-46`).

## 1.9 Открытие ↔ закрытие: последовательность и DOM

Каркас статический (`index.html:91-102`): `.sidebar-content.transition.zoom-fade`
держит **оба** узла всегда — `#chatlist-container.transition-item.active` и
`#search-container.transition-item.sidebar-search`. Переход — `TransitionSlider`
типа `zoom-fade` (`transition.ts`, ветка без `animationFunction`): приходящий
узел получает `active` + `to`, уходящий — `from`, контейнер — `animating`
(+`backwards`); кейфреймы `_transition.scss:18-60` (вход: `fade-in-opacity .15s`
+ `zoom-fade-in-move .15s`, scale 1.1 → 1). Узел выдачи **существует до
перехода** — анимация стартует на уже лежащем в DOM узле, ничего не
вставляется в кадре с transform.

---

# Часть 2. Что есть у нас

## 2.1 Карта

| Наш файл | Роль | Аналог tweb | Судьба в порте |
|---|---|---|---|
| `components/SearchView.tsx` (515) + `SearchView.module.scss` | React-экран поиска: вкладки `Tabs`/`TabSlide` (`:39`), секции `SidebarSection`, свои строки (`ChatRow` `:456`) | `initSearch` + `AppSearchSuper` | **удаляется** |
| `core/hooks/useSidebarSearch.ts` (34) | `query`/`searching`/`inputRef`, `searchReal` (`channels.search`), `onJoin`, событие `tg-focus-search` | часть `initSearch` (`onFocus`, `close`) | **удаляется**, роль уходит во владельца поиска |
| `core/hooks/useGlobalSearch.ts` (+`.test.tsx`) | пагинация `messages.searchGlobal` по `offset` | `loadType` глобальной ветки | **удаляется** |
| `components/searchNotVirtualized.test.ts` | пин «SearchView не на ядре виртуализации» | — | **удаляется** вместе с `SearchView` |
| `shared/ui/Tabs/{Tabs,TabsBar,TabSlide}.tsx` | React-переписи `horizontalMenu`/`slideTabs` | `transition.ts:45-95` | потребители после порта — только `ChatList.tsx:129` (`TabSlide`) и `FolderTabs.tsx:1` (`Tabs`); см. § 2.3 п. 7 |
| `core/hooks/useTransitionSlider.ts` (60) | React-перепись ветки без `animationFunction` (`zoom-fade`/`fade`/`slide-fade`) | `transition.ts:291-352` | потребитель после порта — только `UserInfoPanel.tsx:594` |
| `components/Sidebar.tsx` | шапка (`:241-257`: бургер, `InputSearch` с `onFocus → setSearching(true)`), `.sidebar-content.transition.zoom-fade` (`:286`), `#chatlist-container` с `active` по `!searching` (`:292`), **`#search-container` рендерится условно** (`:377-386`), `is-search-active` на `.item-main` (`:240`) | `index.html:91-102` + `initSearch` | шов: узел `#search-container` становится постоянным, переходом владеет `TransitionSlider` |
| `components/SidebarMenuButton.tsx` | бургер + `state-back` по пропу `searching` | эффект `index.ts:408-418` | остаётся; проп `searching` — от владельца поиска |
| `shared/ui/InputSearch/InputSearch.tsx` | React-порт `InputSearch` (без `onEnter`, без debounce внутри) | `inputSearch.ts` | остаётся; `onEnter` добавить |
| `components/appSearchSuper.ts` (2393) | класс, портирован правой колонкой; расхождения 9 (`nextRate`, `:82-86`), 11 (`searchGroups`, `:98-100`), 24 (`showSender`, `:168-171`), 33 (колбэки хоста), 36 (Solid-вкладки через `mountSolid`); `SearchSuperManagers` `:456-462`; `NO_SECTION_TYPES` `:397-405` | `appSearchSuper.ts` | расширяется: `searchGroups`/`asChatList`/`hideEmptyTabs`/`showSender`, `processEmptyFilter`, `loadChats`, `loadChannels`, `nextRate` |
| `core/hooks/useSearchSuper.ts` | шов «панель профиля ↔ класс» (скроллер создаёт хозяин) | `sharedMediaTab.tsx` | образец формы для владельца поиска |
| `components/dialogRow.ts` (215) | узкий `DialogElement`/`addDialogNew`/`createChatList` без `setLastMessage` и без `setListClickListener` | `appDialogsManager.ts` | расширяется: превью сообщения с подсветкой и временем, клик по строке |
| `components/wrappers/messageForReply.ts` | порт `wrapMessageForReply` **без** `highlightWord` (шапка, строка 22) | `messageForReply.ts:36-49`, `:384` | дописать подсветку |
| `components/wrappers/senderToPeer.ts` | `wrapSenderToPeer` (синхронный) | `senderToPeer.ts` | используется как есть |
| `components/section.solid.tsx` | Solid-`Section` с `nameRight`/`nameRef`/`innerClass`/`contentProps`/`ref` | `section.tsx` | база для `createSearchGroup` |
| `components/lottieAnimation.solid.tsx`, `components/buttonMenu.ts`, `components/popups/popupPeer.ts` | Solid-lottie, `ButtonMenu`/`ButtonMenuToggle`, `PopupPeer` | — | база для `EmptySearchPlaceholder`, `ChatTypeMenu`, `confirmationPopup` |
| `shared/ui/PeerSelector/PeerSelector.tsx:100` | React-`renderEntity` (чип `.selector-user`) | `selectorSearch.ts:319-400` | чипу поиска нужен ванильный `renderEntity` |
| `core/navigation/appNavigationController.ts` | порт контроллера; тип `'global-search'` объявлен (`:84`) | `appNavigationController.ts` | используется как есть |
| `core/state/state.ts:22`, `core/state/migrateRecentSearch.ts` | `recentSearch: string[]` в `AppState` (ключ чата — строка, не число: разница модели) | `config/state.ts:209` | используется как есть; писатель — `pushRecentSearch` в менеджере |
| `stores/searchStore.ts` `pendingJump` | «результат ждёт открытия чата → прыжок к сообщению» (`SearchView.tsx:134`) | `appImManager.setInnerPeer({peerId, lastMsgId})` | остаётся: клик по строке группы `messages` ставит `pendingJump` |
| `core/peerCache.ts` (`isBroadcastPeer`, `cachedPeer`), `core/navigation/openPeer.ts` | зеркало карточек, открытие пира | `appPeersManager`, `appImManager.setPeer` | как есть |
| `styles/tweb/_searchGroup.scss`, `_leftSidebar.scss:332-391`, `:663`, `_transition.scss`, `_selector.scss` | стили групп, чипов, `#search-container`, `zoom-fade`, `.selector-user` — портированы 1:1 | те же партиалы | как есть |
| `core/hotkeys.ts:71` → `useAppHotkeys.ts:55` → событие `tg-focus-search` | Ctrl+F | `focus` поля | слушатель переезжает во владельца |

## 2.2 Менеджеры и ручки — что есть

| Наш менеджер | Ручка | Что отдаёт | tweb-аналог |
|---|---|---|---|
| `messages.searchGlobal(q, filter, offset, limit)` (`messagesManager.ts:776`) | `GET /search/messages?q&filter&offset&limit` → `chat_handler.go:1126-1138` → `usecase/chat/sync.go:437` → `messagesrepo.go:349-397` | `messages.messagesSlice{count, messages, users}`; `ORDER BY m.id DESC LIMIT OFFSET` (`:382`); `filter` ∈ `media/files/music/voice/links` (та же лексика, что `mediaFilterCond`); `q` — `ILIKE` по тексту и имени файла | `messages.searchGlobal` — **но без `offset_rate`/`next_rate`, без `chat_type`, без `min_date/max_date`** |
| `messages.searchMessages(peerId, q, {senderId, mediaType, reaction, offset, limit})` (`:732`) | `GET /chats/{peerID}/search` → `chat_handler.go:1052` → `messagesrepo.go:224-284` | `ORDER BY m.seq DESC LIMIT OFFSET` (`:269`); `media_type` — мелкая лексика `photo/video/voice/roundvideo/file/music/link` | `messages.search` — **без `offset_id`, без дат**; второй потребитель — поиск в чате `core/hooks/useChatSearch.ts:61` |
| `messages.mediaHistory(peerId, filter, offsetId, limit)` (`:710`) | `GET /chats/{peerID}/media?filter&offset_id&limit` (`messagesrepo.go:475-511`) | курсор `m.seq < offset_id` (`:494-496`) | `messages.search` с фильтром и пустым `q` |
| `messages.searchCounters(peerId, filters)` (`:700`) | `GET /chats/{peerID}/search_counters` | по одному чату | не нужен: `hideEmptyTabs: false` |
| `channels.search(q)` (`channelsManager.ts:210-219`) | `GET /search?q` → `channel_handler.go:510-517` → `searchrepo.go:26-67` | `contacts.found`; **`my_results` всегда пуст** (`domain/mtpeer.go:974-976`, конструктор `:985-1000`); лимит 20 жёстко; чаты — только `is_public`, префикс `ILIKE` по `username`/`title`; пользователи — **все** по `username`/`display_name` | `contacts.search(q, limit)` |
| `contacts.list()` (`contactsManager.ts:78`) | `GET /contacts` | список контактов | `fillContacts` — локальный индекс у нас не строится |
| `dialogs` (воркер, `dialogsManager.ts`) | зеркало диалогов | сортировка/пагинация; **поиска по названию нет** | `dialogsStorage.getDialogs({query})` — локальный `SearchIndex` |
| — | `GET /channels/{peerID}/similar` (`router.go:371`) | похожие на ОДИН канал | `getChannelRecommendations()` без аргумента — **нет** |
| — | нет | — | `getTopPeers('correspondents')`, `getTopPeers('bots_app')`, `getPopularAppBots`, `channels.searchPosts`, `getSponsoredPeers` — **нет** |
| `appState.recentSearch` (`core/state/state.ts:22`) | — | клиентский State через `persistManager.stateKey` | `recentSearch` в State — совпадает |

Форма слайса на проводе — `domain/mtmessage.go:1256-1270`: поля `next_rate`
**нет** (в комментарии схемы `:1239` есть, в структуре — нет).

## 2.3 Расхождения (подтверждены на 2026-09-08)

1. **Экран поиска — React, класс не участвует.** `SearchView.tsx` — своя реализация
   вкладок (`TABS` `:39`), своих строк (`ChatRow`/`ResultRow`/`Empty` `:456-515`), своих
   секций. Дефект, ради которого программа: `TabSlide` вставляет приходящий кадр
   в DOM **в том же кадре**, что и стартовый `transform` (`TabSlide.tsx:112-118`
   — `useLayoutEffect` после рендера нового кадра), переход не стартует; у класса
   (`horizontalMenu` + `slideTabs`) кадры лежат в DOM заранее — для профиля это
   уже починено задачей 13 плана shared media.
2. **`#search-container` создаётся условно** (`Sidebar.tsx:377`): узел появляется
   вместе с `active`, а `zoom-fade` играет на вставке; `backwards`-ветка
   (`_transition.scss:43-60`) не играет вовсе — узел просто исчезает. У оригинала
   узел постоянный, переход ведёт `TransitionSlider`, а `cleanup()` — по
   `onTransitionEnd(0)`.
3. **Вкладок 7 вместо 9**: нет `apps`, `posts`; у нас есть `channels` (`SearchView.tsx:39`).
4. **Групп нет**: результаты — плоские `SidebarSection`; нет `searchGroups`,
   `search-group-*`, «показать ещё», `people`-ленты; `recent` есть, но своим кодом
   (`pushRecent` `:52-55`, «Clear» через React `ConfirmDialog`).
5. **Чипов нет**: ни пира, ни даты; `fillTipDates` не портирован (`helpers/date.ts`
   — только форматирование); `ChatTypeMenu` нет; `EmptySearchPlaceholder` нет.
6. **Пагинация глобальной выдачи — числовой `OFFSET`** (`useGlobalSearch.ts:52`,
   `messagesrepo.go:382`): та же математическая ошибка, что была у медиа профиля
   (задача 1 плана shared media) — вставка сверху сдвигает окно. Курсор оригинала
   — `next_rate` (§ 1.5), у нас его нет ни на проводе, ни в слайсе.
7. **Две React-переписи `TransitionSlider`** (`components/transition.ts:384-394`,
   «ДОЛГ-3»): `TabSlide.tsx` (потребители `ChatList.tsx`, `SearchView.tsx`) и
   `useTransitionSlider.ts` (потребитель `UserInfoPanel.tsx`). После сноса
   `SearchView` у `TabSlide` остаётся один потребитель — `ChatList.tsx` (папки);
   он — предмет **соседней программы папок**, здесь не трогается.
8. **`showSender`/`nextRate`/`searchGroups` в классе объявлены расхождениями**
   9, 11, 24 (`components/appSearchSuper.ts:82-101`, `:168-172`) — снимаются
   этой программой.
9. **`dialogRow.ts` не умеет превью сообщения**: `setLastMessage` не портирован,
   `wrapMessageForReply` — без `highlightWord`; клик по строке (`setListClickListener`)
   тоже не портирован — правая колонка вешала клик сама (`SortedUserList`).
10. **Локальных индексов нет**: поиск по контактам и диалогам по имени в воркере
    отсутствует (`SearchView` фильтрует `chats` в главном потоке,
    `localMatches`/`myChannels`/`recentChats` `:165-169`).
11. **`contacts.found.my_results` пуст** — бэкенд не отделяет «свои» попадания
    от глобальных (`mtpeer.go:974-976`); группа `contacts` у оригинала собирается
    из трёх источников, из которых у нас есть ноль (п. 10 и этот).

---

# Часть 3. Что блокировано бэкендом

| Что нужно классу | Ручка | Вердикт |
|---|---|---|
| Курсор глобальной выдачи (`offset_rate` → `next_rate`) для `chats`/`media`/`links`/`files`/`music`/`voice` при `peerId: 0` | `GET /search/messages` — есть, но `offset` | **правится**: опаковый `next_rate` в слайсе (`domain/mtmessage.go`) и параметр `offset_rate`; `OFFSET` удаляется. У нас `messages.id` глобально монотонен (`ORDER BY m.id DESC`, `messagesrepo.go:382`), поэтому «rate» — это `id` последнего отданного сообщения, а `offset_id`/`offset_peer` оригинала серверу не нужны — клиент их всё равно шлёт, сервер игнорирует |
| `chat_type` (`users_only/groups_only/broadcasts_only`) | нет | **правится**: `chat_type=users\|groups\|channels` → условие по `chats.type` |
| `min_date`/`max_date` (чипы дат) | нет ни у `/search/messages`, ни у `/chats/{peerID}/search` | **правится**: `created_at` между границами |
| Поиск по одному чату с чипом пира: `q` + `offset_id` + даты + крупный `filter` | `GET /chats/{peerID}/search` — `OFFSET`, мелкая лексика `media_type` | **правится**: `offset_id` вместо `offset` (потребителя ДВА — `useChatSearch.ts:61`), `min_date/max_date`, `filter` в лексике `mediaFilterCond` рядом с `media_type` (лексики разные, обе живые: `media_type` — поиск в чате волны 5) |
| `contacts.search`: `my_results`, `limit` | `GET /search` — `my_results` пуст, лимит 20 | **правится**: `my_results` — попадания среди контактов вызывающего и его диалогов; `limit` параметром (20 для `chats`, 200 для `channels`, `appSearchSuper.ts:1977`) |
| Локальный поиск контактов и диалогов по имени | — (клиент) | не бэкенд: порт `SearchIndex` в воркер |
| `recentSearch` | — (клиент) | есть: `AppState` |
| `getTopPeers('correspondents')` — лента «люди» | нет | **отложено** (план, «Отложено»): группа `people` портируется и остаётся пустой/скрытой (`toggle()`), пока нет ручки |
| `getChannelRecommendations()` без аргумента | только `/channels/{peerID}/similar` | **отложено**: группа «SimilarChannels» вкладки `channels` |
| `getTopPeers('bots_app')`, `getPopularAppBots` — вкладка `apps` | нет | **отложено**: вкладка не объявляется |
| `channels.searchPosts` — вкладка `posts` | нет | **отложено**: вкладка не объявляется |
| `getSponsoredPeers` | нет | **не портируется**: реклама вне продукта (`roadmap.md`, «Что в план НЕ входит») |
| Фильтр `links` по сущностям | регексп по тексту | задача 15 плана shared media, здесь не дублируется |

---

# Часть 4. Риски порта

| Риск | В чём | Смягчение |
|---|---|---|
| **Вторая реализация** | Соблазн оставить `SearchView.tsx` «пока» рядом с классом | Шов и снос — один коммит; `git grep SearchView` пуст (DoD 14) |
| **Владение узлом `#search-container`** | Сейчас его создаёт React по `searching`; у оригинала он статический, а его ДЕТЕЙ создаёт `initSearch` и сносит `cleanup()` | Узел — постоянный React-элемент без детей; детей создаёт и снимает владелец поиска (правило шва § 7 спеки); пин: после закрытия детей нет, узел на месте |
| **Переход ведут двое** | React-`active` на `#chatlist-container` (`Sidebar.tsx:292`) И `TransitionSlider` | Классы `active/from/to/animating` — только у `TransitionSlider`; React к ним не прикасается; пин на `zoom-fade` в обе стороны |
| **`OFFSET` вместо курсора** | § 2.3 п. 6 | Бэкенд первым, клиент дословный (`nextRate`) |
| **Пин на форму, а не результат** | «`searchGlobal` позван с `offset_rate`» переживёт поломку рендера | Пины на DOM: строки в группах, `hide` у пустых, чип в поле, `--paddingLeft`, отсутствие сети из кэша |
| **`cleanup()` на смену пира** | Класс в правой колонке переживает смену пира (`useSearchSuper.ts`), в левой — умирает на каждое закрытие | Никаких «оптимизаций» переиспользования: как в оригинале, `destroy()` на `onTransitionEnd(0)` |
| **Соседняя программа папок** | `TabSlide`/`Tabs` в `ChatList.tsx`/`FolderTabs.tsx` | Не трогать; снос общих `shared/ui/Tabs` и `useTransitionSlider` — тому, кто снимает последнего потребителя |

---

# Проверка после порта

Прощёлкивается на стенде; поведение сверяется с `web.telegram.org/k`.

1. Фокус в поле: чатлист уходит `zoom-fade`, выдача въезжает (scale 1.1 → 1), бургер морфится в стрелку; ряд вкладок `Chats / Channels / Media / Links / Files / Music / Voice`, у пустого запроса — только группа «Recent» (и «люди», если есть ручка).
2. Ввести имя контакта: группы «Chats» (свои диалоги + контакты), «Global search» (публичные, обрезано до 3 с «Show more»), «Messages» (строки с превью и подсветкой совпадения, время справа); пустые группы скрыты, а не пустые секции.
3. Скролл группы «Messages» до низа: следующая страница пришла с `offset_rate`, дублей нет; отправить сообщение с тем же словом в открытый чат и докрутить ещё — дубля нет.
4. Переключить на «Media» с запросом: сетка плиток, у файлов/ссылок под строкой — отправитель (`showSender`), время не дублируется.
5. Ввести «today» — чип даты в helper вместо ряда вкладок; клик — чип переехал в поле (`is-picked`, `--paddingLeft`), выдача сузилась по дате; повторный клик — чип снят, ряд вкладок вернулся.
6. Ввести имя чата, кликнуть чип пира — поиск внутри пира (`/chats/{id}/search`); «Media» с чипом пира без запроса — `/chats/{id}/media`.
7. «Messages» → `ChatTypeMenu` → «Channels only»: выдача сузилась; при пустом результате — заглушка с уткой и кнопкой «Search in all chats», кнопка возвращает `all`.
8. Клик по строке из «Chats»: чат открыт, поиск закрыт, пир — первым в «Recent» при следующем открытии; «Clear» → подтверждение → группа пропала.
9. Стрелка «назад» / Escape: выдача уходит `zoom-fade.backwards`, чатлист вернулся, `#search-container` пуст, поле очищено; повторный фокус создаёт поиск заново (сетевые запросы групп ушли снова).
10. Вкладка «Channels» без запроса: «Joined channels» (>5 — «Show more»); вкладка скрыта, если каналов нет.
11. `dom-parity.mjs` по дампам `docs/tweb/dom/dumps/10-global-search.json`, `14-left-02-search-empty.json`, `14-left-03-search-chats.json`, `14-left-03b-search-chats-query.json`, `14-left-04-search-channels.json`, `14-left-07-search-media.json`, `14-left-08-search-links.json`, `14-left-09-search-files.json`.
