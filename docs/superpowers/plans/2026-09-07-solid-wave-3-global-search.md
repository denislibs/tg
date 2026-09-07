# Глобальный поиск левой колонки — план реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ: `superpowers:subagent-driven-development`.
> Шаги помечены чекбоксами (`- [ ]`).

**Цель:** выдачу глобального поиска левой колонки (вкладки чаты/каналы/медиа/
ссылки/файлы/музыка/голосовые, группы «Chats / Global search / Messages /
Recent», чипы пира и даты, `ChatTypeMenu`) рисует **тот же класс `AppSearchSuper`**,
что уже рисует shared media профиля (`web-client/src/components/appSearchSuper.ts`,
2393), — вторым потребителем, как в tweb (`sidebarLeft/index.ts:1128-1170`), — а
React-экран `web-client/src/components/SearchView.tsx` (515) с хуками
`useSidebarSearch`/`useGlobalSearch` удаляется.

**Место в программе:** волна 3 Solid-миграции
(`docs/superpowers/specs/2026-08-28-solid-migration-design.md` § 8), **этап 4**.
Этапы 1 (`AuthFlow`), 2 (профиль) и 3 (shared media, задачи 1-13 плана
`2026-09-07-solid-wave-3-shared-media.md`) слиты; это — задача 20 из его
таблицы «Отложено».

**Оригинал:** `/Users/denisurevic/Documents/tweb`, коммит `e52b5d931`.
**Разбор с адресами — [`docs/tweb/global-search.md`](../../tweb/global-search.md)**;
сам класс — [`docs/tweb/shared-media.md`](../../tweb/shared-media.md); каркас
колонки, бургер, морф ↔ «назад» — [`docs/tweb/left-sidebar.md`](../../tweb/left-sidebar.md)
части 4, 7, 8.

**Дефект, ради которого всё это:** React-`TabSlide` вставляет приходящий кадр в
DOM в том же кадре, что и стартовый `transform` (`shared/ui/Tabs/TabSlide.tsx:112-118`),
и переход между вкладками не стартует; у класса кадры лежат в DOM заранее
(`horizontalMenu` + `slideTabs`), и для профиля это уже починено задачей 13
плана shared media. Плюс сам экран не 1:1: нет групп, чипов, `ChatTypeMenu`,
`recent`-механики оригинала (`docs/tweb/global-search.md` § 2.3).

---

## Четыре поправки к постановке (проверены в исходниках)

Прежде чем брать задачи — четыре вещи, которых в оригинале НЕТ или которые
устроены не так, как ожидается. Обоснование и адреса — `docs/tweb/global-search.md` § 0.

1. **Отдельного «экрана поиска» нет.** Есть `initSearch()` (`sidebarLeft/index.ts:1084-1554`)
   — обвязка вокруг того же класса: пять групп, `ChatTypeMenu`, чипы, переход,
   `cleanup`. Портируется она, а не «SearchView на классе».
2. **Поиск умирает на каждое закрытие.** `cleanup()` (`:1401-1423`) сносит класс,
   группы и чипы по `onTransitionEnd(0)` и заново подписывается на `focus`
   (`:1422`). Никакого переиспользования инстанса между открытиями — в отличие от
   правой колонки, где класс переживает смену пира (`useSearchSuper.ts`).
3. **Курсор глобальной выдачи — не `offset_id`.** `messages.searchGlobal` листает
   парой `offset_rate` (из `next_rate` ответа) + `offset_id`/`offset_peer`
   (`appMessagesManager.ts:9987-10003`, `appSearchSuper.ts:2278-2321`). У нас его
   нет ни на проводе (`domain/mtmessage.go:1256-1270`), ни в ручке
   (`messagesrepo.go:382` — `OFFSET`). Правится бэкенд (задача 1), клиент остаётся
   дословным — расхождение 9 в шапке класса снимается, а не узаконивается.
4. **Недавние — не ручка.** `recentSearch` живёт в клиентском `State`
   (`config/state.ts:209`, `appUsersManager.ts:277-293`), у нас — уже там же
   (`core/state/state.ts:22`). Бэкенду тут делать нечего.

## Ключевой шов — половина готова, половину надо перевернуть

В оригинале узел выдачи `#search-container` — **статический** (`index.html:102`),
лежит в `.sidebar-content.transition.zoom-fade` рядом с `#chatlist-container`
всегда; `initSearch` создаёт в нём скроллер и класс, `cleanup()` вычищает детей
(`:1416`), а переходом между двумя узлами владеет `TransitionSlider` типа
`zoom-fade` (`:1425-1449`).

У нас `.sidebar-content.transition.zoom-fade` и `is-search-active` на `.item-main`
воспроизведены (`Sidebar.tsx:240`, `:286`), но `#search-container` **рендерится
условно** по `searching` (`:377-386`), а класс `active` на `#chatlist-container`
ставит React (`:292`): переход играет на вставке узла, обратный (`backwards`)
не играет вовсе.

**Порт сводится к двум вещам:** (а) `#search-container` становится постоянным
пустым React-узлом, детей которого создаёт и снимает **владелец поиска**
(чистый TS-порт `initSearch`, задача 12); (б) классы `active/from/to/animating`
на обоих узлах ставит **только** `TransitionSlider` (`components/transition.ts`,
тип `zoom-fade` уже в союзе типов, `:119`), React к ним не прикасается — правило
шва § 7 спеки: у узла один владелец.

## Что у нас уже есть и переиспользуется без изменений

Класс со всеми рендерерами и памятью скролла (`components/appSearchSuper.ts`,
`sharedMediaHistories.ts`), `horizontalMenu.ts`, `transition.ts` (`slideTabs` +
`zoom-fade`), `scrollable.ts` (`Scrollable`, `ScrollableX`), `dialogRow.ts`
(строка чатлиста без превью), `sortedUserList.ts`, `wrappers/{senderToPeer,
document,photo,video,webPageTitle,webPageDescription,sentTime}.ts`,
`section.solid.tsx`, `shared/solid/mountSolid.solid.tsx`, `lottieAnimation.solid.tsx`,
`buttonMenu.ts` (`ButtonMenuToggle`), `popups/{popupElement,popupPeer}.ts`,
`core/navigation/appNavigationController.ts` (тип `'global-search'` уже объявлен,
`:84`), `core/navigation/openPeer.ts`, `core/peerCache.ts` (`isBroadcastPeer`),
`core/state/state.ts` (`recentSearch`), `stores/searchStore.ts` (`pendingJump`),
`helpers/dom/{clickEvent (attachClickEvent, simulateClickEvent),findUpTag,findUpClassName}.ts`,
`lib/richtext/url.ts` (`wrapUrl`, `matchUrl`), стили `styles/tweb/{_searchGroup,
_leftSidebar (:332-391, :663), _transition, _selector, _selectorBase}.scss` — все
портированы 1:1, ассет `public/assets/tgs/` (сюда доезжает `UtyanSearch.json`).

## Чего нет вовсе и что заводится здесь

`components/searchGroup.solid.tsx` (порт `searchGroup.tsx`, 170),
`components/chatTypeMenu.solid.tsx` (74), `components/emptySearchPlaceholder.solid.tsx` (52),
`components/confirmationPopup.ts` (49), `components/sidebarLeft/globalSearch.ts`
(порт `initSearch`, ~470), `lib/searchIndex.ts` (124), `fillTipDates` в
`helpers/date.ts`, ванильный `renderEntity` (`selectorSearch.ts:321-…`),
`setLastMessage`/`setListClickListener` в `dialogRow.ts`, `highlightWord` в
`wrappers/messageForReply.ts`, в классе — `processEmptyFilter`, `loadChats`,
`loadChannels`, `renderPeerDialogs`, `searchGroups`/`asChatList`/`hideEmptyTabs`/
`showSender`, `nextRate`; на бэкенде — курсор `next_rate`, `chat_type`,
`min_date/max_date`, `offset_id` у поиска в чате, `my_results`/`limit` у `/search`.

## Global Constraints

- **Источник порта — компонент tweb, а не наш React** (спека § 6a). `SearchView.tsx`
  и `useSidebarSearch.ts` — НЕ образец поведения: их расхождения перечислены в
  `docs/tweb/global-search.md` § 2.3; переносить их в порт запрещено, в частности
  условный рендер `#search-container`, плоские секции вместо групп и `OFFSET`-пагинацию.
  «Сохрани текущее поведение» в постановках задач не пишется (память проекта:
  «Порт якорить на tweb, не на React»).
- **Definition of Done** — спека § 9, все 14 пунктов. Особо: п. 4 (мутацию
  ФАКТИЧЕСКИ прогнать, вывод падения — в тело коммита), п. 5 (владелец снимает
  то, что создал: после закрытия поиска детей `#search-container` нет), п. 14
  (React обязан убыть, а не удвоиться).
- **DoD 2a — расхождение правится в бэкенде, а не узаконивается в клиенте.**
  Отсюда задачи 1-4 идут первыми: без `next_rate` дословный порт `loadType`
  математически неверен (см. задачу 1), без `chat_type` `ChatTypeMenu` — фикция.
- **`ChatList.tsx`, `FolderTabs.tsx` и общие `shared/ui/Tabs/*`, `useTransitionSlider.ts`
  здесь НЕ трогаются** — это соседняя программа папок (ветка `docs/folders-tabs-plan`).
  Кто снимает последнего потребителя, тот и сносит общий файл (задача 21, «Отложено»).
- **Никакого `git add -A`.** Коммитить только явно перечисленные пути: индекс
  ворктри общий, рядом работают другие агенты.
- **Комментарии и сообщения коммитов — по-русски**, объяснять ПОЧЕМУ.
- Каждый порт несёт в шапке файла ссылку вида `порт tweb/src/components/sidebarLeft/index.ts:1084-1554`,
  со строками там, где взята нетривиальная деталь.
- **Пины — на результат, а не на форму вызова.** Проверять узлы в DOM (строки в
  группах, `hide` у пустых, чип в поле, `--paddingLeft`, `active/from/to` на
  узлах перехода), отсутствие сетевого вызова — не «менеджер позван с такими
  аргументами».

## Порядок и зависимости

```
1 next_rate ──┐
2 chat_type+даты ─┤
3 /chats/{id}/search: offset_id ─┼─→ 6 шов менеджеров searchHistory ─┐
4 /search: my_results+limit ──┘                                       │
5 SearchIndex + recent (воркер) ────────────────────────┐             │
                                                        ├─→ 9 loadChats/loadChannels ─┐
7 searchGroup + строка (превью, клик) ─→ 8 класс: опции, группы, showSender, nextRate ─┤
                                                                                       ├─→ 12 владелец поиска ─→ 13 ШОВ + снос React
10 ChatTypeMenu + EmptySearchPlaceholder ──────────────────────────────────────────────┤
11 чипы: fillTipDates + renderEntity + helper ─────────────────────────────────────────┘
```

Задачи 1-4 (бэкенд) независимы между собой и от 5, 7, 10. Задача 8 зависит от
6 и 7; 9 — от 5 и 8; 11 — от 3 (чип пира) и 2 (чип даты). Задача 13 — единственная
точка, где меняется видимое поведение; до неё приложение работает на старом React.

---

### Задача 1: бэкенд — курсор `next_rate` у глобального поиска сообщений

**Почему первой.** Класс листает глобальную выдачу курсором сервера:
`nextRate: this.nextRates[type] ??= 0` в запросе (`appSearchSuper.ts:2288`),
`this.nextRates[type] = value.nextRate` из ответа (`:2321`), а критерий «всё
загружено» для `folderId !== undefined` — `!value.nextRate` (`:2312`). При этом
кэш `historyStorage` вкладки растёт сверху от живых апдейтов
(`sharedMediaHistories.ts`, порт `sharedMedia.tsx:239`). С числовым SQL-`OFFSET`
(`messagesrepo.go:382`) любое новое сообщение, попавшее в выдачу, сдвигает
окно: вторая страница приедет с дублем или дырой. Это та же ошибка, что была у
медиа профиля (задача 1 плана shared media), и по DoD 2a правится бэкенд.

У нас `messages.id` глобально монотонен и выдача уже упорядочена по нему
(`ORDER BY m.id DESC`, `:382`), поэтому опаковый «rate» — это `id` последнего
отданного сообщения; `offset_id`/`offset_peer`, которые клиент шлёт дословно,
серверу не нужны и игнорируются (в MTProto `next_rate` тоже опаков).

**Файлы:**
- Изменить: `backend/internal/domain/mtmessage.go` (`MessagesMessagesSlice`, `:1256-1270`) —
  поле `NextRate *int json:"next_rate,omitempty"` (в комментарии схемы `:1239` оно
  есть, в структуре нет); `NewMessagesMessagesSlice` — параметр или сеттер
- Изменить: `backend/internal/adapter/delivery/http/chat_handler.go` (`GlobalSearchMessages`, `:1126-1138`)
- Изменить: `backend/internal/usecase/chat/sync.go` (`GlobalSearchMessages`, `:437`)
- Изменить: `backend/internal/adapter/repo/postgres/messagesrepo.go` (`GlobalSearchMessages`, `:349-397`)
- Изменить: `web-client/src/core/managers/messagesManager.ts` (`searchGlobal`, `:776`) и
  единственный потребитель `core/hooks/useGlobalSearch.ts:34,52` (живёт до задачи 13)
- Тесты: рядом с юзкейсом и репозиторием (`sharedmedia_test.go`, `mediahistory_test.go` — образец)

- [ ] **Шаг 1: прочитать** `messagesrepo.go:349-397`, `mtmessage.go:1236-1296`,
  `appMessagesManager.ts:9987-10003` и `appSearchSuper.ts:2278-2321`.
- [ ] **Шаг 2: падающий тест** на репозиторий: ответ несёт `next_rate` = `id`
  последнего отданного сообщения; запрос с `offset_rate` начинается строго ниже
  него; вставка нового подходящего сообщения между двумя запросами НЕ меняет
  содержимое второй страницы (с `offset` — меняет: предмет теста); последняя
  страница — без `next_rate`.
- [ ] **Шаг 3: убедиться, что тест падает.**
- [ ] **Шаг 4: реализовать.** `GET /search/messages` принимает `offset_rate`
  (0/нет — с начала) → `AND m.id < $offset_rate`; `OFFSET` **удалить**, не
  оставлять второй веткой. Курсор — в текст запроса, не `($N=0 OR m.id<$N)`
  (причина — комментарий у `MediaHistory`, `messagesrepo.go:486-488`).
- [ ] **Шаг 5: клиент.** `messagesManager.searchGlobal(q, filter, {offsetRate, limit})`
  → `{messages, count, nextRate}`; `useGlobalSearch.ts` переводится на курсор
  (он умрёт в задаче 13, но до неё стенд обязан работать без `offset`).

**Готово когда:** ручка листает по `offset_rate`; тест «вставка сверху не рвёт
вторую страницу» краснеет на возврате к `OFFSET`; `git grep -n "offset" -- backend/internal/adapter/delivery/http/chat_handler.go`
у `GlobalSearchMessages` пуст.

---

### Задача 2: бэкенд — `chat_type` и `min_date`/`max_date` у глобального поиска

**Что делаем.** `ChatTypeMenu` (`chatTypeMenu/index.tsx`) уходит серверу флагами
`users_only/groups_only/broadcasts_only` (`appMessagesManager.ts:9997-9999`), чипы
дат — `min_date/max_date` (`:9992-9993`). У `GET /search/messages` нет ни того, ни
другого (`messagesrepo.go:349-397`).

**Файлы:**
- Изменить: `chat_handler.go` (`GlobalSearchMessages`), `usecase/chat/sync.go`, `messagesrepo.go`
- Изменить: `web-client/src/core/managers/messagesManager.ts` (`searchGlobal` — опции `chatType`, `minDate`, `maxDate`)
- Тесты: рядом

- [ ] **Шаг 1: падающий тест** на репозиторий: `chat_type=users` отдаёт только
  приватные чаты, `groups` — группы, `channels` — только broadcast; `min_date`/
  `max_date` (unix-секунды, как `messages.search`) режут по `created_at`;
  неизвестный `chat_type` — ошибка 400, а не «всё».
- [ ] **Шаг 2: убедиться, что тест падает.**
- [ ] **Шаг 3: реализовать** одним `JOIN chats c` с условием по `c.type`
  (значения — как в `CallLog`: `c.type = 'private'`, `messagesrepo.go:407`);
  даты — `m.created_at >= to_timestamp($min)` / `< to_timestamp($max + 1)`.
- [ ] **Шаг 4: клиент** — опции менеджера; неверная лексика не пропускается типом.

**Готово когда:** тест краснеет, если `chat_type=channels` пропускает группу.

---

### Задача 3: бэкенд — поиск в одном чате по `offset_id`, датам и крупному фильтру

**Что делаем.** С чипом пира класс уходит в `messages.search` (`:9966`) с
`offset_id`, `min_date/max_date` и `filter` (`:9969-9982`). Наш `GET /chats/{peerID}/search`
листает `OFFSET` (`messagesrepo.go:269`), дат не знает, а `media_type` — мелкая
лексика поиска в чате (`photo/video/voice/roundvideo/file/music/link`, `:243-260`).

**У ручки ПОТРЕБИТЕЛЯ ДВА.** Кроме будущего шва (задача 6), ею листает поиск
внутри чата — `core/hooks/useChatSearch.ts:61` (`offset`). Менять сигнатуру
`messagesManager.searchMessages` (`:732`) можно только правя ОБА места разом;
серверный `offset` уходит вместе с последним потребителем.

**Файлы:**
- Изменить: `chat_handler.go` (`SearchMessages`, `:1052-…`), `usecase/chat/sync.go` (`SearchFilter`), `messagesrepo.go` (`SearchMessages`, `:224-284`)
- Изменить: `web-client/src/core/managers/messagesManager.ts` (`searchMessages`), `core/hooks/useChatSearch.ts:55-70`
- Тесты: рядом

- [ ] **Шаг 1: падающий тест** на репозиторий: `offset_id` = `seq` последнего
  отданного → следующая страница строго ниже; `min_date/max_date` режут;
  `filter=media|files|links|music|voice` (лексика `mediaFilterCond`, `:452-465`)
  работает вместе с `q`; `media_type` остаётся и не конфликтует (обе лексики
  живые: `media_type` — поиск в чате, `filter` — класс).
- [ ] **Шаг 2: убедиться, что тест падает.**
- [ ] **Шаг 3: реализовать**; `OFFSET` удалить.
- [ ] **Шаг 4: оба потребителя.** `searchMessages(peerId, q, {offsetId, filter, minDate, maxDate, senderId, mediaType, reaction, limit})`;
  `useChatSearch.ts` — курсор = `id` последнего сообщения в списке, а не его длина.
  Тест на поиск в чате: вставка сообщения между страницами не даёт дубля.

**Готово когда:** оба потребителя на `offset_id`; `offset` никем не посылается.

---

### Задача 4: бэкенд — `my_results` и `limit` у `contacts.search`

**Что делаем.** `loadChats` кладёт `my_results` в группу «Chats», `results` — в
«Global search» (`appSearchSuper.ts:1427-1428`); `loadChannels` просит 200
результатов (`:1977`). Наш `GET /search` отдаёт `my_results` пустым (`mtpeer.go:974-976`,
`:985-1000`) и режет 20 (`channel_handler.go:510-517`).

**Файлы:**
- Изменить: `channel_handler.go` (`Search`), `usecase/chat/channel.go` (`SearchChats` `:102`, `SearchUsers` `:118`), `searchrepo.go` (`:26-67`), `domain/mtpeer.go` (`NewContactsFound`)
- Изменить: `web-client/src/core/managers/channelsManager.ts` (`search(q, limit)`, `:210-219`)
- Тесты: рядом

- [ ] **Шаг 1: падающий тест** на юзкейс: пир, с которым у вызывающего есть
  диалог или который в его контактах, попадает в `my_results`, а не в `results`;
  `limit` уважается; без `q` — пусто.
- [ ] **Шаг 2: убедиться, что тест падает.**
- [ ] **Шаг 3: реализовать**: `my_results` — пересечение попаданий с
  `chat_members` вызывающего и его контактами (один запрос, не N); `limit`
  параметром (по умолчанию 20).
- [ ] **Шаг 4: клиент** — `channels.search(q, limit)`.

**Готово когда:** тест краснеет, если свой диалог уезжает в `results`.

---

### Задача 5: воркер — `SearchIndex`, локальный поиск контактов и диалогов, `recentSearch`

**Что делаем.** Группу «Chats» оригинал собирает из трёх источников, два из
которых локальные: `getContactsPeerIds(query, true, undefined, 10)`
(`appUsersManager.ts:467-480` → `getContacts` `:417-430`, индекс `:509`) и
`dialogsStorage.getDialogs({query, limit: 20, filterId: 0})` (`dialogs.ts:1660-1690`,
индекс `:342`). Оба — `SearchIndex` (`lib/searchIndex.ts`, 124). Чипы пиров —
те же два источника (`index.ts:1361-1374`). `recentSearch` пишет
`appUsersManager.pushRecentSearch` (`:277-293`: unshift, дедуп, обрезка до 20),
чистит `clearRecentSearch` (`:295-…`).

**Файлы:**
- Создать: `web-client/src/lib/searchIndex.ts` (порт), `searchIndex.test.ts`
- Изменить: `core/managers/contactsManager.ts` — `searchPeerIds(q, limit)`;
  `core/managers/dialogsManager.ts` — `search(q, limit)` по зеркалу диалогов;
  `core/managers/peersManager.ts` (или `contactsManager`) — `pushRecentSearch(peerId)`,
  `clearRecentSearch()` поверх `persistManager.stateKey('recentSearch', …)`
  (образец — `persistManager.state.test.ts:13`)
- Удалить: `pushRecent` из `SearchView.tsx:52-55` — вместе с файлом в задаче 13;
  до неё оба писателя не сосуществуют: `SearchView` переводится на менеджер
- Тесты: рядом

- [ ] **Шаг 1: прочитать** `tweb/src/lib/searchIndex.ts` целиком, `dialogs.ts:1655-1700`,
  `appUsersManager.ts:417-480`, `:277-300`.
- [ ] **Шаг 2: падающий тест** на индекс: поиск по началу слова, по нескольким
  словам, регистронезависимо, транслитерации — ровно те случаи, что покрывает
  оригинал (его опции `SEARCH_OPTIONS`); на менеджеры: контакт находится по
  имени, диалог — по названию, лимит уважается; `pushRecentSearch` ставит пира
  первым, повтор не дублирует, 21-й вытесняет последний; `clearRecentSearch`
  обнуляет.
- [ ] **Шаг 3: убедиться, что тесты падают.**
- [ ] **Шаг 4: реализовать.** Индекс строится в воркере и живёт с зеркалом
  (обновляется на `applyPeerOps`/апдейты диалогов), а не пересобирается на
  каждый запрос. `recentSearch` остаётся `string[]` (`core/state/state.ts:22`,
  докблок про разницу модели).

**Готово когда:** поиск по имени не ходит в сеть и не фильтрует в главном
потоке; тест краснеет, если `pushRecentSearch` перестанет дедуплицировать.

---

### Задача 6: воркер — шов менеджеров `messages.searchHistory(ctx)` (порт диспетчера `requestHistory`)

**Что делаем.** Класс зовёт ОДИН метод — `getHistory({...searchContext, inputFilter,
offsetId, offsetPeerId, limit, nextRate})` (`appSearchSuper.ts:2278-2291`), а метод
выбирает `messages.search` или `messages.searchGlobal` (`appMessagesManager.ts:9966-10003`).
У нас три ручки: `/chats/{id}/media` (пир + фильтр без запроса), `/chats/{id}/search`
(пир + запрос, задача 3), `/search/messages` (без пира, задачи 1-2). Развилка
портируется в воркер — туда, где она у оригинала.

**Файлы:**
- Изменить: `web-client/src/core/managers/messagesManager.ts` — `searchHistory(options)` →
  `{messages, count, nextRate}`; `SearchSuperManagers.messages` в `appSearchSuper.ts:456-462`
  расширяется этой ручкой
- Тест: `messagesManager.searchHistory.test.ts`

- [ ] **Шаг 1: падающий тест**: `peerId && inputFilter !== Empty && !query` →
  `/chats/{id}/media?filter&offset_id`; `peerId && (query || Empty)` →
  `/chats/{id}/search?q&filter&offset_id&min_date&max_date`; `!peerId` →
  `/search/messages?q&filter&offset_rate&chat_type&min_date&max_date`;
  `nextRate` возвращается только из глобальной ветки. Проверять — по
  фактическому URL и ответу, не по «вызван с аргументами».
- [ ] **Шаг 2: убедиться, что тест падает.**
- [ ] **Шаг 3: реализовать**; `mediaHistory`/`searchMessages`/`searchGlobal` остаются
  публичными (у них свои потребители: вьювер, поиск в чате).

**Готово когда:** класс в задаче 8 не знает, сколько у бэкенда ручек.

---

### Задача 7: `createSearchGroup` (Solid) и строка чатлиста с превью и кликом

**Что делаем.** Порт `searchGroup.tsx` (170) поверх `section.solid.tsx`:
`createSearchGroup(options)` (`:13-24`), сигналы `hide`/`showingMore`/`nameRight`
(`:52-76`), разметка `Section` с `search-group search-group-<type>` (`:82-112`),
`Scrollable axis="x"` при `scrollableX` (`:101-108`), API `:123-169`. Плюс два
куска `appDialogsManager`, которых нет в `dialogRow.ts`:

- `setListClickListener({list, onFound, autonomous})` (`:1751-…`): клик по `a`
  строки → `openPeer` + `onFound(target)`; у нас открытие — `core/navigation/openPeer.ts`,
  прыжок к сообщению из группы «Messages» — `searchStore.setPendingJump`
  (нынешний `SearchView.tsx:134`; у оригинала `setInnerPeer({lastMsgId})`);
- `setLastMessage` в объёме `processEmptyFilter` (`:2020-…`): `lastMessageSpan` ←
  `wrapMessageForReply({message, highlightWord})` (`:2184-2192`), `lastTimeSpan` ←
  `formatDateAccordingToTodayNew` (`:2242`). `highlightWord` у нашего
  `wrappers/messageForReply.ts` не портирован (шапка, строка 22) — дописать
  (`messageForReply.ts:36`, `:45-46`, `:384`).

**Файлы:**
- Создать: `web-client/src/components/searchGroup.solid.tsx`, `searchGroup.test.tsx`
- Изменить: `components/dialogRow.ts` (`setListClickListener`, `setLastMessage`), `dialogRow.test.ts`
- Изменить: `components/wrappers/messageForReply.ts` (`highlightWord`), тест рядом
- Тесты: рядом

- [ ] **Шаг 1: прочитать** `searchGroup.tsx` целиком, `appDialogsManager.ts:1751-1800`,
  `:2020-2060`, `:2180-2250`, `messageForReply.ts:30-60`, `:380-390`.
- [ ] **Шаг 2: падающий тест на группу**: разметка 1:1 с дампом
  `docs/tweb/dom/dumps/14-left-03b-search-chats-query.json` (`.search-group.search-group-contacts`
  > `.sidebar-left-section` > `.search-group-inner` > `.search-group-content` > `ul.chatlist`);
  создана скрытой (`hide`); `toggle()` показывает при детях и чистит без;
  `needShowMoreButton('is-short')` ставит класс и кнопку «Show more», клик
  снимает класс и меняет текст на «Show less»; `setNameRight` кладёт узел в
  заголовок; `clear()` сносит строки через их `dialogElement.remove()`;
  `scrollableX` даёт `.search-group-with-scroll` и горизонтальный скроллер.
- [ ] **Шаг 3: падающий тест на строку**: клик по строке открывает пира и зовёт
  `onFound`; `setLastMessage` с `highlightWord` даёт `.text-highlight` вокруг
  совпадения и время справа.
- [ ] **Шаг 4: убедиться, что тесты падают.**
- [ ] **Шаг 5: реализовать.** Корень Solid — `createRoot` с `dispose` на
  `middleware.onClean` (`:82`, `:112`), не `mountSolid`: у группы нет
  контейнера-хоста, она сама отдаёт `container`.

**Готово когда:** тест краснеет, если `toggle()` перестанет чистить пустую группу.

---

### Задача 8: класс — `searchGroups`, `asChatList`, `hideEmptyTabs`, `showSender`, `nextRate`, `processEmptyFilter`

**Что делаем.** Снимаются расхождения 9, 11, 24 из шапки `appSearchSuper.ts`:

- опции `searchGroups`/`asChatList`/`hideEmptyTabs`/`showSender` (`tweb:407-411`,
  `:443-447`) — `hideEmptyTabs`/`showSender` уже есть (`:502-505`, `:583-584`);
- `searchGroupMedia = createSearchGroup({type: 'messages'})` (`:607`), `clear()` в
  `cleanupHTML` (`:2791`);
- `performSearchResult`: выбор группы (`:1106-1113`), анимация `is-hidden → is-visible`
  (`:1115-1128`), `setActive`/заглушка (`:1189-1194`);
- `processEmptyFilter` (`:826-871`) поверх `dialogRow.addDialogNew` + `setLastMessage`
  задачи 7; `getPeerMigratedTo` (`:833`) — у нас миграции чатов нет, строка
  объявляется расхождением;
- `showSender` в `processUrlFilter` (`:1061-1063`, `wrapSenderToPeer` синхронный —
  шапка `wrappers/senderToPeer.ts`); в `processDocumentFilter` уже есть (`:1391-1411`);
- `nextRate`: поле контекста (`:121`), запрос (`:2288`), критерий (`:2312`),
  запись (`:2321`), сброс (`:2718`), `copySearchContext` (`:2795-2801`) — через
  `messages.searchHistory` задачи 6;
- `hideEmptyTabs: false`: ранний выход `loadFirstTime` (`:2383-2385`), ветки
  `cleanupHTML` (`:2770-2778`).

**Файлы:**
- Изменить: `web-client/src/components/appSearchSuper.ts` (шапка: расхождения 9, 11, 24 — снять, не оставлять «частично»)
- Тесты: `appSearchSuper.chats.test.ts`, дополнить `appSearchSuper.links.test.ts`, `appSearchSuper.load.test.ts`

- [ ] **Шаг 1: прочитать** адреса выше и `docs/tweb/global-search.md` § 1.4-1.6.
- [ ] **Шаг 2: падающий тест на группы**: с `searchGroups` и `inputMessagesFilterEmpty`
  сообщения рисуются строками в `searchGroups.messages.list`, группа получает
  `setActive`; пустая выдача с `createPlaceholder` даёт заглушку; без
  `searchGroups` (правая колонка) поведение прежнее — существующие тесты зелены.
- [ ] **Шаг 3: падающий тест на `nextRate`**: вторая страница глобальной вкладки
  уходит с `offsetRate` из первого ответа; отсутствие `nextRate` при
  `folderId !== undefined` ставит `loaded`; `cleanup()` обнуляет курсор; в
  режиме правой колонки (`folderId === undefined`) критерий прежний.
- [ ] **Шаг 4: падающий тест на `showSender`**: ссылка получает вторую строку
  подписи с отправителем; документ с `showSender` — без времени в подписи
  (`withTime: !showSender`).
- [ ] **Шаг 5: падающий тест на `hideEmptyTabs: false`**: счётчики не
  запрашиваются, вкладки не прячутся, `cleanupHTML` не ставит `search-empty`.
- [ ] **Шаг 6: убедиться, что тесты падают.**
- [ ] **Шаг 7: реализовать**; шапку класса привести к факту.

**Готово когда:** `grep -n "не портирован" appSearchSuper.ts` не упоминает
`nextRate`, `searchGroups`, `showSender`.

---

### Задача 9: класс — `loadChats`, `loadChannels`, `renderPeerDialogs`

**Что делаем.** `loadChats` (`:1285-1523`) целиком, кроме рекламы
(`getSponsoredPeers`, `:1373-1421` — вне продукта, `roadmap.md` «Что в план НЕ
входит») и ленты «люди» (`createTopPeersList`, `:1503-1517` — ручки нет, задача 14);
`renderPeerDialogs` (`:1943-1969`); `loadChannels` (`:1971-2022`) без группы
«SimilarChannels» (`:2009-2018` — ручки нет, задача 15); триггер в `loadType`
(`:2229-2240`); `renderRecentSearch` (`:1452-1501`) — реактивно из `recentSearch`
(у нас — подписка на `AppState`, а не `useAppState()`); подпись строки
`addDialogSubtitle` (`:1297-1327`: «Presence.YourChat» / `@username` / телефон /
участники через `wrappers/getChatMembersString.ts`).

**Файлы:**
- Изменить: `web-client/src/components/appSearchSuper.ts`
- Изменить: `web-client/src/lang.ts` — ключи `SearchAllChatsShort`, `ClearRecentSearch`,
  `ChannelsTab`, `Presence.YourChat`, `Chat.Search.JoinedChannels`
  (на момент плана их нет; `GlobalSearch`, `SearchMessages`, `Recent`,
  `Separator.ShowMore`, `Search.Confirm.ClearHistory`, `SimilarChannels`, `Channels`
  уже есть — перед добавлением любого ключа `grep`)
- Тесты: `appSearchSuper.loadChats.test.ts`, `appSearchSuper.channels.test.ts`

- [ ] **Шаг 1: прочитать** адреса выше.
- [ ] **Шаг 2: падающий тест с запросом**: три источника (`contacts.searchPeerIds`,
  `channels.search` → `my_results`/`results`, `dialogs.search`) дают строки в
  `contacts`/`globalContacts` **без дублей** (`renderedPeerIds`); у `globalContacts`
  `is-short` и «Show more» при >3; подпись строки — `@username`, у чата ещё число
  участников; пустая группа скрыта.
- [ ] **Шаг 3: падающий тест без запроса**: группа `recent` рисует строки из
  `recentSearch` в его порядке, пустой список прячет группу; смена `recentSearch`
  перерисовывает без перезапроса; `loaded[chats] = true` без сети.
- [ ] **Шаг 4: падающий тест на `channels`**: с запросом — только broadcast из
  `results`, заголовок группы скрыт (`:1975`); без запроса — «Joined channels»
  из зеркала диалогов, «Show more» при >5.
- [ ] **Шаг 5: убедиться, что тесты падают.**
- [ ] **Шаг 6: реализовать.**

**Готово когда:** тест краснеет, если дедуп `renderedPeerIds` убрать (пир из
`my_results` и из диалогов нарисуется дважды).

---

### Задача 10: `ChatTypeMenu` и `EmptySearchPlaceholder` (Solid)

**Что делаем.** Порт `chatTypeMenu/index.tsx` (74): триггер
`span.primary.checkable-button-menu` (`:54-59`), `ButtonMenuToggle({direction: 'bottom-left'})`
(`:61-68`), галочка у выбранного (`:44-51`), `hidden` (`:57`); `styles.module.scss`
(15) — рядом. Порт `emptySearchPlaceholder/index.tsx` (52): утка `UtyanSearch`
156px через `lottieAnimation.solid.tsx` (`:24-30`), тексты (`:32-35`), кнопка
`SearchInAllChats` при `onAllChats` (`:38-46`); `styles.module.scss` (41). Оба
у оригинала — `defineSolidElement` (custom element); у нас — Solid-компонент,
монтируемый мостом `mountSolid` в узел, который отдаётся `setNameRight`/
`addPlaceholder` (форма шва — как у вкладок задачи 12 плана shared media).

**Файлы:**
- Создать: `web-client/src/components/chatTypeMenu.solid.tsx` (+`.module.scss`),
  `components/emptySearchPlaceholder.solid.tsx` (+`.module.scss`), тесты рядом
- Добавить: `web-client/public/assets/tgs/UtyanSearch.json` (из `tweb/public/assets/tgs/`)
- Изменить: `web-client/src/lang.ts` — `AllChats`, `UsersOnly`, `GroupsOnly`, `ChannelsOnly`,
  `NoResultsTitle`, `NoResultsSubtitle`, `SearchInAllChats` (проверить `grep`)

- [ ] **Шаг 1: прочитать** оба компонента и их scss целиком.
- [ ] **Шаг 2: падающий тест на меню**: клик по триггеру открывает меню с четырьмя
  пунктами и галочкой у текущего; выбор зовёт `onChange(type)` и меняет текст
  триггера; `hidden` прячет.
- [ ] **Шаг 3: падающий тест на заглушку**: без `onAllChats` кнопки нет; с ним —
  есть, клик зовёт колбэк.
- [ ] **Шаг 4: убедиться, что тесты падают.**
- [ ] **Шаг 5: реализовать.**

---

### Задача 11: чипы пира и даты — `fillTipDates`, `renderEntity`, `search-helper`

**Что делаем.** `fillTipDates` (`helpers/date.ts:245-…`, `DateData` `:240-244`;
тест оригинала — `src/tests/fillTipDates.test.ts`); ванильный `renderEntity`
(`selectorSearch.ts:321-…`: чип `.selector-user` с аватаром 30, `fallbackIcon:
'calendarfilter'`, `primary`) — наш `PeerSelector.tsx:100-…` держит React-копию,
она остаётся своему экрану; helper `div.search-helper` и вся механика чипов
из `initSearch` (`:1200-1303`, `:1349-1381`) — часть владельца поиска (задача 12),
здесь заводятся только строительные блоки.

**Файлы:**
- Изменить: `web-client/src/helpers/date.ts` (`fillTipDates`, `DateData`), `date.test.ts`
- Создать: `web-client/src/components/selectorEntity.ts` (`renderEntity`), тест рядом
- Изменить: `web-client/src/lang.ts` — ключи дат, которых нет (`Date.Today` и `Yesterday` есть; дни недели, месяцы, `Peer.Status.Today/Yesterday` — по `grep`)

- [ ] **Шаг 1: прочитать** `helpers/date.ts:225-…` до конца `fillTipDates`,
  `src/tests/fillTipDates.test.ts`, `selectorSearch.ts:321-404`.
- [ ] **Шаг 2: падающий тест**: порт теста оригинала целиком (`today`, `yesterday`,
  день недели, месяц, `12.05`, `12.05.2024` …) плюс наши локали (`сегодня`);
  `renderEntity` даёт `.selector-user.selector-user-primary[data-key]` с аватаром
  для пира и с иконкой `calendarfilter` для даты, `middleware` гасит аватар.
- [ ] **Шаг 3: убедиться, что тесты падают.**
- [ ] **Шаг 4: реализовать.**

---

### Задача 12: владелец поиска — чистый TS-порт `initSearch` (`components/sidebarLeft/globalSearch.ts`)

**Что делаем.** Порт `sidebarLeft/index.ts:1084-1554` **файлом**, с точками входа
вместо полей `AppSidebarLeft`: `{searchContainer, sidebarContent /* .sidebar-content */,
itemMain, inputSearch: {input, container, clearBtn, setOnChange/onClear/onEnter},
backBtn, managers, onSearchActive(boolean), openPeer, onFound}`. Внутри — всё,
что в оригинале:

| Кусок | tweb | Заметка |
|---|---|---|
| Идемпотентность, `Scrollable(searchContainer)`, `close` | `:1085-1093` | скроллер создаёт владелец (как `useSearchSuper.ts`) |
| Пять групп | `:1095-1103` | `createSearchGroup` задачи 7 |
| `messages.createPlaceholder`, `ChatTypeMenu` | `:1105-1126` | задача 10 |
| Класс с 7 вкладками (без `apps`/`posts` — задачи 16-17) | `:1128-1170` | `scrollOffset: 16` |
| `onChangeTab` | `:1172-1183` | ветка `posts` отсутствует вместе с вкладкой; `chatType = 'all'` остаётся |
| `watchChannelsTabVisibility` | `:1556-1581` | по зеркалу диалогов + `isBroadcastPeer`; событие — `RT` апдейт диалогов |
| `resetSearch` | `:1189-1197` | |
| Чипы: `pickedElements`, `updatePicked`, helper, `renderEntity`, `unselectEntity`, `onClear`, `onHelperLength` | `:1200-1303` | задача 11 |
| `onChange`, `onEnter` (URL → `openUrl`) | `:1305-1321` | `wrapUrl` у нас — `lib/richtext/url.ts:151` |
| `updateSearchQuery` | `:1328-1381` | `cleanupHTML → setQuery → load(true)` + чипы |
| Recent: `mousedown` capture | `:1383-1396` | → `pushRecentSearch` задачи 5 |
| `cleanup` | `:1401-1423` | **`searchSuper.destroy()`, `searchContainer.replaceChildren()`, once-подписка на `focus`** |
| `TransitionSlider zoom-fade` на `.sidebar-content` | `:1425-1449` | `onTransitionStart` → `is-search-active` на `.item-main`; `onTransitionEnd(0)` → `cleanup()` |
| `onFocus` | `:1451-1489` | `appNavigationController.pushItem({type: 'global-search', onPop: close})`; `transition(1)`; `onSearchActive(true)` вместо сигнала `isSearchActive` (морф бургера у нас — проп `SidebarMenuButton.searching`) |
| `backBtn` | `:1491-1502` | `removeByType('global-search')`, `transition(0)`, `onSearchActive(false)` |
| Recent: «Clear» | `:1504-1519` | `confirmationPopup` (порт `confirmationPopup.ts`, 49, поверх `popups/popupPeer.ts`) |
| Возврат `{open, openWithPeerId, close}` | `:1525-1553` | `openWithPeerId` — потребитель форум-панели, задача 20 |

Не портируется: `newBtnMenu`/`updateBtn` `is-hidden` (`:1455-1456`, `:1440-1443`) —
у нас FAB прячет React-проп `ComposeFab.searching` (`Sidebar.tsx:392`), останется
им; `IS_MOBILE_SAFARI` (`:1459`) — окружения нет, ветка объявляется;
`appear-animated` (`:1471-1480`) — свёрнутой колонки с триггером поиска у нас нет.

**Файлы:**
- Создать: `web-client/src/components/sidebarLeft/globalSearch.ts`, `globalSearch.test.ts`
- Создать: `web-client/src/components/confirmationPopup.ts`, тест рядом
- Изменить: `web-client/src/shared/ui/InputSearch/InputSearch.tsx` — `onEnter` (tweb `inputSearch.ts:26`)
- Тесты: рядом

- [ ] **Шаг 1: прочитать** `sidebarLeft/index.ts:1084-1585` целиком ещё раз и
  `core/hooks/useSearchSuper.ts` (образец шва).
- [ ] **Шаг 2: падающий тест на жизненный цикл** (главный пин): `init` строит
  скроллер, класс и группы в `searchContainer`; `transition(1)` ставит `active to`
  на `#search-container` и `active from` на `#chatlist-container`, `animating` на
  `.sidebar-content`, `is-search-active` на `.item-main`; `backBtn` → `backwards`;
  по окончании обратного перехода `searchContainer` **пуст**, `searchInitResult`
  снят, следующий `focus` создаёт всё заново (DoD 5). Мутация: убрать
  `replaceChildren()` из `cleanup` — тест обязан покраснеть.
- [ ] **Шаг 3: падающий тест на чипы**: клик по чипу даты в helper переносит его в
  контейнер поля (`is-picked`, `--paddingLeft` выставлен), ряд вкладок вернулся
  (`nav` без `hide`), `setQuery` ушёл с `minDate/maxDate`; второй чип — `is-picked-twice`,
  `is-first`/`is-last`; повторный клик снимает; `onClear` снимает все.
- [ ] **Шаг 4: падающий тест на recent**: `mousedown` по строке в группе `contacts`
  пишет пира в `recentSearch`, по строке в `recent`/`people` — нет; «Clear» →
  попап → группа очищена.
- [ ] **Шаг 5: падающий тест на Escape/Enter**: `pushItem` с типом `'global-search'`,
  `onPop` закрывает; Enter с URL — поле очищено, поиск закрыт, `openUrl` позван;
  Enter с текстом — ничего.
- [ ] **Шаг 6: убедиться, что тесты падают.**
- [ ] **Шаг 7: реализовать.**

**Готово когда:** владелец работает на фейковых узлах без React; тест
жизненного цикла краснеет на названной мутации.

---

### Задача 13: шов — владелец въезжает в `Sidebar.tsx`, React-`SearchView` удаляется

**Единственная задача, меняющая видимое поведение.** Всё, что умеет `SearchView`,
к этому моменту умеет класс с владельцем (задачи 8-12), поэтому переключение —
атомарное, без периода «две реализации живы» (DoD 14).

**Что делаем:**

1. `Sidebar.tsx`: `#search-container.transition-item.sidebar-search` рендерится
   **всегда и пустым** (`:377-386` → постоянный узел с `ref`); класс `active` с
   `#chatlist-container` (`:292`) и `is-search-active` с `.item-main` (`:240`)
   React **не ставит** — ими владеет `TransitionSlider` владельца; `searching`
   остаётся React-состоянием ТОЛЬКО для пропов `SidebarMenuButton.searching`,
   `ComposeFab.searching`, скрытия `FolderTabs`/замка — и пишется из
   `onSearchActive` владельца.
2. Владелец создаётся лениво по `focus` поля (`index.ts:220`) хуком-швом по
   образцу `useSearchSuper.ts`: `useGlobalSearch(refs…)` заводит once-подписку на
   `focus`, отдаёт `{open, close}` для `tg-focus-search` (Ctrl+F, `core/hotkeys.ts:71`)
   и deep-open (`initialQuery`), гасит владельца на размонтировании колонки.
3. `InputSearch`: `onChange` без React-состояния `query` — значение читает
   владелец (`inputSearch.value`), как в оригинале; `useSidebarSearch`
   **удаляется** вместе с `searchReal`/`onJoin` (вступление по `@username` —
   клик по строке `globalContacts` открывает пира; join делает открытие чата).
4. Удалить: `components/SearchView.tsx`, `SearchView.module.scss`,
   `core/hooks/useSidebarSearch.ts`, `core/hooks/useGlobalSearch.ts` +
   `useGlobalSearch.test.tsx`, `components/searchNotVirtualized.test.ts` (пинил
   форму `SearchView`; контракт «результаты идут группами, не виртуальным
   списком» держит теперь сам класс), классы `.searchOverlay`/`.searchInner` из
   `Sidebar.module.scss:159`, `:216`, импорты `Tabs`/`TabSlide` из `SearchView`.
5. Обновить пины: `Sidebar.*.test.tsx`, которые монтируют `SearchView` или
   читают `searching` (найти `grep -rln "SearchView\|searching" web-client/src --include='*.test.tsx'`).
6. `docs/tweb/global-search.md` § 2 и `docs/tweb/left-sidebar.md` часть 8 п. 3
   привести к факту (правило поддержки `docs/tweb/README.md`).

> **Осторожно: два владельца перехода.** Если оставить `searching ? '' : 'active'`
> на `#chatlist-container` (`Sidebar.tsx:292`), React снимет `active` с уходящего
> узла в том же коммите, в котором `TransitionSlider` поставил ему `from`, — и
> `_transition.scss:12` спрячет его `display: none` до начала анимации: обратный
> переход снова не сыграет, ошибки не будет. Пин обязателен: после `transition(1)`
> у `#chatlist-container` есть И `active`, И `from` до `transitionend`.

**Файлы:**
- Изменить: `web-client/src/components/Sidebar.tsx`, `Sidebar.module.scss`
- Создать: `web-client/src/core/hooks/useGlobalSearch.ts` (хук-шов; имя
  освобождается удалением старого файла в том же коммите), `useGlobalSearch.test.tsx`
- Удалить: перечисленное в п. 4
- Тесты: пины на шов

- [ ] **Шаг 1: падающий тест на шов**: `#search-container` есть в DOM до фокуса
  и пуст; после фокуса — дети владельца; после закрытия — пуст, узел на месте
  (DoD 5); размонтирование колонки не оставляет узлов класса.
- [ ] **Шаг 2: падающий тест на переход в обе стороны** (пин дефекта, ради
  которого программа): открытие — `#search-container.active.to`, `#chatlist-container.active.from`,
  `.sidebar-content.animating`; закрытие — `.animating.backwards`; классы сняты по
  `transitionend`; React-рендер во время перехода их не трогает. Мутация: вернуть
  условный рендер `#search-container` — тест обязан покраснеть.
- [ ] **Шаг 3: падающий тест на бургер**: `SidebarMenuButton` получает `searching`
  от владельца (`state-back` появляется на `onSearchActive(true)`, снимается на
  `false`), а не от фокуса поля напрямую.
- [ ] **Шаг 4: убедиться, что тесты падают.**
- [ ] **Шаг 5: реализовать переключение и удалить React-версию.**
- [ ] **Шаг 6: живая проверка на стенде** (DoD 10) — прощёлкать пункты 1-11
  чеклиста `docs/tweb/global-search.md` § «Проверка после порта» (п. 5-7 — если
  задачи 2-3, 10-11 в объёме), числа положить в тело коммита; `dom-parity.mjs`
  по дампам из п. 11.
- [ ] **Шаг 7: посчитать** число `.tsx` с импортом `react` до и после (DoD 14;
  на момент плана — 228), цифры — в тело коммита.

**Готово когда:** `git grep -n "SearchView\|useSidebarSearch"` пуст; число
React-файлов уменьшилось; у `shared/ui/Tabs/TabSlide.tsx` остался один
потребитель — `ChatList.tsx` (задача 21); чеклист прощёлкан.

---

## Отложено — с предметом, а не «потом посмотрим» (DoD 13)

| № | Что | Почему отложено | Что разблокирует |
|---|---|---|---|
| 14 | Лента «люди» (`createTopPeersList`, `topPeersList.ts:7-60`, группа `people`) | **Ручки нет**: аналога `contacts.getTopPeers('correspondents')` (`appUsersManager.ts:969`) — рейтинга собеседников — в бэкенде нет. Группа `people` создаётся владельцем (задача 12) и остаётся скрытой (`toggle()` без детей), как у оригинала при пустом ответе | Горизонтальная лента топ-15 над «Recent» |
| 15 | Группа «SimilarChannels» вкладки `channels` без запроса (`appSearchSuper.ts:2009-2018`) | `getChannelRecommendations()` без аргумента (`appChatsManager.ts:1049-1056`) — глобальные рекомендации; у нас только `GET /channels/{peerID}/similar` (`router.go:371`) для одного канала | Вторая группа вкладки «Channels» |
| 16 | Вкладка `apps` (`loadApps` `:2024-2115`) | Ручек `getTopPeers('bots_app')`, `getPopularAppBots` и открытия веб-аппа бота из выдачи нет; вкладка не объявляется — иначе `loadType` нечем её наполнить (расхождение 1 в `useSearchSuper.ts`) | Вкладка «Apps» |
| 17 | Вкладка `posts` (`loadPosts` `:2117-2128` → `globalPostsSearch.tsx`, 318) | `channels.searchPosts`, квота `checkSearchPostsFlood`, оплата звёздами — ни одной ручки | Вкладка «Posts» и ветка `posts` в `onChangeTab` (`index.ts:1174-1181`) |
| 18 | Реклама в «Global search» (`getSponsoredPeers`, `:1373-1421`, `sponsored-peer-chip`) | Вне продукта (`roadmap.md`, «Что в план НЕ входит») — **не портируется**, не «отложено» | — |
| 19 | `SearchUsers` бэкенда ищет **всех** пользователей по `display_name` (`searchrepo.go:49-67`) | У `contacts.search` глобальная часть — только по публичному `username`; поиск чужих по имени — утечка. Правка бэкенда со сменой семантики выдачи, не блокирует порт: класс кладёт `results` в «Global search» как есть | «Global search» 1:1 по составу |
| 20 | `openWithPeerId` (`index.ts:1530-1549`) — вход в поиск с готовым чипом пира | Единственный потребитель у оригинала — форум-таб (`forumTab/forumTab.ts:114`); наша форум-панель — React (`useForumPanel`), точки входа нет. Метод возвращается владельцем (задача 12), потребитель — программа форума | Поиск по темам форума из панели |
| 21 | Снос `shared/ui/Tabs/{Tabs,TabsBar,TabSlide}.tsx` и `core/hooks/useTransitionSlider.ts` («ДОЛГ-3», `components/transition.ts:384-394`) | После задачи 13 у `TabSlide`/`Tabs` остаются потребители `ChatList.tsx:129`, `FolderTabs.tsx:1` — предмет **программы папок** (ветка `docs/folders-tabs-plan`); у `useTransitionSlider` — `UserInfoPanel.tsx:594` (шапка профиля, React до волны 8). Сносит тот, кто снимает последнего потребителя; здесь — только запись в «ДОЛГ-3», что `SearchView` из списка ушёл | Один `TransitionSlider` на репозиторий |
| 22 | `getPeerMigratedTo` в `processEmptyFilter` (`:833`) | Миграции legacy-чата в супергруппу у бэкенда нет (`core/peers/peerId.ts::getOutputPeer`, решение № 2 разбора shared media) — строка объявляется, не портируется | — |
| 23 | Фильтр `links` по сущностям вместо регекспа | Задача 15 плана shared media — та же ручка `mediaFilterCond`, здесь не дублируется | Ссылки за текстом-якорем в глобальной выдаче |

## Оценка объёма

| Задача | Строк оригинала | Размер |
|---|---|---|
| 1 `next_rate` (бэкенд + клиент) | — | S |
| 2 `chat_type` + даты | — | S |
| 3 поиск в чате: `offset_id`, даты, `filter` (два потребителя) | — | M |
| 4 `my_results` + `limit` | — | S |
| 5 `SearchIndex` + локальный поиск + recent | 124 + ~80 | M |
| 6 `searchHistory` (диспетчер) | ~40 | S |
| 7 `createSearchGroup` + строка (превью, клик) | 170 + ~120 | M |
| 8 класс: опции, группы, `showSender`, `nextRate`, `processEmptyFilter` | ~150 | M |
| 9 `loadChats` + `loadChannels` + `renderPeerDialogs` | ~300 | **L** |
| 10 `ChatTypeMenu` + `EmptySearchPlaceholder` | 126 + scss 56 | S |
| 11 `fillTipDates` + `renderEntity` | ~150 + ~80 | M |
| 12 владелец поиска (порт `initSearch`) | ~470 + `confirmationPopup` 49 | **L** |
| 13 шов и снос React | — | **L** (риск, не объём) |

Итого **13 задач**: 4 бэкендных (S/S/M/S), 9 клиентских; критический путь —
1 → 6 → 8 → 9 → 12 → 13.

## Definition of Done волны (перед мержем)

Спека § 9, пункты 9-14, плюс пины, которые обязаны существовать к мержу
(результат, не форма):

- анимация вкладок класса в обе стороны внутри поиска — уже пинится
  `horizontalMenu.test.ts`/`transition.test.ts`; здесь — что в `#search-container`
  лежит именно `.search-super` класса, а не React-`.tabs-container` (задача 13, шаг 1);
- `zoom-fade` при открытии И закрытии (задача 13, шаг 2) — тот самый дефект;
- группы: рисуются при результатах, скрыты при пустых, «Show more» обрезает
  (задачи 7, 9);
- чипы: переезд в поле, `--paddingLeft`, снятие (задача 12, шаг 3);
- recent: запись по клику, дедуп и лимит, «Clear» (задачи 5, 12);
- владение: после закрытия `#search-container` пуст, после размонтирования
  колонки узлов класса нет (задачи 12-13);
- стенд: чеклист `docs/tweb/global-search.md` § «Проверка после порта» прощёлкан,
  числа в коммите задачи 13.
