# Shared media правой колонки — план реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ: `superpowers:subagent-driven-development`.
> Шаги помечены чекбоксами (`- [ ]`).

**Цель:** контент-вкладки правой колонки (медиа/файлы/ссылки/музыка/голосовые/
участники/подарки/сохранённые) рисует **класс `AppSearchSuper`** — дословный порт
tweb `src/components/appSearchSuper.ts` (2843 строки), — а React-компонент
`web-client/src/components/userInfo/SharedMedia.tsx` (815) удаляется.

**Место в программе:** волна 3 Solid-миграции
(`docs/superpowers/specs/2026-08-28-solid-migration-design.md` § 8), **этап 3**.
Этап 1 (`AuthFlow`) и этап 2 (профиль: карусель классом + карточка на Solid) слиты.

**Оригинал:** `/Users/denisurevic/Documents/tweb`, коммит `e52b5d931`.
**Разбор с адресами — [`docs/tweb/shared-media.md`](../../tweb/shared-media.md)**;
слайдер/шапка/различия user-group-channel — [`docs/tweb/right-sidebar.md`](../../tweb/right-sidebar.md).

---

## Три поправки к постановке (проверены в исходниках)

Прежде чем брать задачи — три вещи, которых в оригинале НЕТ, и их не надо искать
и не надо делать. Обоснование и адреса — `docs/tweb/shared-media.md` § 0.

1. **Группировки по датам в shared media нет.** Ни `search-super-month`, ни
   месячных/дневных заголовков; списки плоские, newest-first. Датовые контейнеры
   в tweb есть только у ленты чата (`chat/bubbleGroups.ts:70`) — другая подсистема.
2. **Вкладки GIF нет.** Полный список вкладок — литерал `sharedMedia.tsx:604-648`.
   GIF-документы попадают в `media` как видео.
3. **Поиск внутри чата — это НЕ `appSearchSuper`.** В tweb это отдельный Solid
   `chat/topbarSearch.tsx` (1318), не импортирующий `AppSearchSuper`. По § 8
   спеки — **волна 5**. Строки поиска у `AppSearchSuper` нет вовсе; `setQuery`
   (`appSearchSuper.ts:2803`) принимает запрос снаружи, и правая колонка его не
   передаёт. В этот план поиск по чату не входит.

## Ключевой шов — он уже готов

В оригинале узел, в который рисуется shared media, **и есть контейнер класса**:
`searchSuperContainer: tab.searchSuper.container` (`sharedMedia.tsx:166`), а Solid
вставляет его последним ребёнком `.profile-content` (`peerProfile.tsx:121,211`).

У нас этап 2 воспроизвёл ровно это, но с самодельным узлом:
`UserInfoPanel.tsx:351-355` создаёт `div.search-super`, отдаёт его Solid-карточке
пропом `searchSuperContainer`, а React-`SharedMedia` рисуется в него порталом
(`UserInfoPanel.tsx:691-710`).

**Порт сводится к подмене начинки шва:** вместо самодельного `div` в Solid уезжает
`instance.container` живого `AppSearchSuper`. Обратный мост не нужен, разметка
`.profile-content` не меняется.

## Что у нас уже есть и переиспользуется без изменений

Половина зависимостей класса портирована прежними волнами — это и делает этап
подъёмным:

`components/scrollable.ts` (полный порт, включая `ScrollableX`,
`onAdditionalScroll`, `checkForTriggers`, `onScrolledBottom`, `scrollIntoViewNew`),
`components/{slider,sliderTab,row,settingSection,button,buttonIcon,buttonMenu,icon,ripple,preloader,checkboxField}.ts`,
`components/wrappers/{photo,video,document,mediaSpoiler}.ts`,
`components/chat/selection.ts` (база `AppSelection`),
`helpers/{listenerSetter,middleware,middlewarePromise,positionMenu,contextMenuController}.ts`,
`helpers/dom/{attachContextMenuListener,handleHorizontalSwipe}.ts`,
`core/lazyLoadQueue.ts`, `core/dom/{setTransition,swipeHandler}.ts`,
`core/dom/navigationTransition.ts` (ветка `slideNavigation`),
`styles/tweb/_searchSuper.scss` — **428 строк, ровно как оригинал**,
`components/stargifts/{stargiftsGrid,profileList}.module.scss`.

## Чего нет вовсе и что заводится здесь

`components/horizontalMenu.ts` (215), `slideTabs` из `transition.ts:45-95`,
`components/sortedUserList.ts` (134) вместе с ванильным строителем строки
чатлиста (аналога `appDialogsManager.addDialogNew` у нас нет),
`components/appSearchSuper.ts` (2843), `SearchSelection`
(`chat/selection.ts:583-763`), `SearchContextMenu` (`appSearchSuper.ts:156-345`).

## Global Constraints

- **Источник порта — компонент tweb, а не наш React** (спека § 6a). Наш
  `userInfo/SharedMedia.tsx` — НЕ образец поведения. Его расхождения перечислены
  в `docs/tweb/shared-media.md` § 2.3; переносить их в порт запрещено, в
  частности сброс всего кэша по длине окна (`SharedMedia.tsx:177-183`) и
  инлайновый `stickyTop` (`UserInfoPanel.tsx:706`).
- **Definition of Done** — спека § 9, все 14 пунктов. Особо: п. 4 (мутацию
  ФАКТИЧЕСКИ прогнать, вывод падения — в тело коммита), п. 5 (владелец снимает
  то, что создал), п. 14 (React обязан убыть, а не удвоиться).
- **DoD 2a — расхождение правится в бэкенде, а не узаконивается в клиенте.**
  Отсюда задачи 1-2 идут первыми: без `offset_id` дословный порт `historyStorage`
  математически неверен (см. задачу 1).
- **Никакого `git add -A`.** Коммитить только явно перечисленные пути: индекс
  ворктри общий, рядом работают другие агенты.
- **Комментарии и сообщения коммитов — по-русски**, объяснять ПОЧЕМУ.
- Каждый порт несёт в шапке файла ссылку вида `порт tweb/src/components/appSearchSuper.ts`,
  со строками там, где взята нетривиальная деталь.
- **Пины — на результат, а не на форму вызова.** Проверять узлы в DOM, счётчик,
  `scrollTop`, отсутствие сетевого вызова — не «менеджер позван с такими
  аргументами».

## Порядок и зависимости

```
1 offset_id ─┐
2 counters ──┤
             ├─→ 5 ядро ─→ 6 загрузка ─→ 7 медиа-грид ─┐
3 slideTabs ─┤                        ├─→ 8 документы ─┤
4 horizMenu ─┘                        └─→ 9 ссылки ────┼─→ 10 первый показ ─┐
                                                        │                   │
                            11 участники ────────────────┤                   │
                            12 подарки + сохранённые ────┘                   │
                                                                             ▼
                                                            13 ШОВ + снос React
                                                                             │
                                                    14 выделение и меню ─────┘
```

Задачи 1-2 (бэкенд) и 3-4 (инфраструктура) независимы и могут идти параллельно.
Задачи 7, 8, 9 независимы между собой. 11 и 12 независимы. Задача 13 — единственная
точка, где меняется видимое поведение; до неё приложение работает на старом React.

---

### Задача 1: бэкенд — пагинация медиа по `offset_id`

**Почему первой.** Класс листает по id последнего показанного сообщения
(`appSearchSuper.ts:2278-2291`), а его кэш `historyStorage` одновременно растёт
СВЕРХУ от живых апдейтов (`sharedMedia.tsx:239` — `history.unshift`). С числовым
SQL-`OFFSET` (`backend/internal/adapter/repo/postgres/messagesrepo.go:449-487`)
любое пополнение сверху сдвигает окно: вторая страница приедет с дублями или с
дырой. Это не «немного другая пагинация» — это неверный результат, поэтому по
DoD 2a правится бэкенд, а не клиент.

**Файлы:**
- Изменить: `backend/internal/adapter/delivery/http/chat_handler.go` (`MediaHistory`, `:985-1003`)
- Изменить: `backend/internal/usecase/chat/sync.go` (`MediaHistory`, `:290-309`)
- Изменить: `backend/internal/adapter/repo/postgres/messagesrepo.go` (`MediaHistory`, `:449-487`)
- Миграция: составной индекс под `(chat_id, type, seq)` в `backend/internal/store/postgres/migrations/`
- Тесты: рядом с юзкейсом и репозиторием

- [x] **Шаг 1: прочитать** `messagesrepo.go:449-487` целиком и `router.go:261`.
- [x] **Шаг 2: падающий тест** на репозиторий: `offset_id = seq` последнего
  отданного сообщения → следующая страница начинается строго ниже него; вставка
  нового сообщения между двумя запросами НЕ меняет содержимое второй страницы
  (с `offset` — меняет; это и есть предмет теста).
- [x] **Шаг 3: убедиться, что тест падает.**
- [x] **Шаг 4: реализовать.** `GET /chats/{peerID}/media` принимает `offset_id`
  (0/отсутствует = с начала); `WHERE m.seq < $offset_id` вместо `OFFSET`.
  Старый `offset` **удалить**, а не оставить второй веткой (мёртвый код).
- [x] **Шаг 5: индекс.** Миграция с составным индексом под фильтрацию по типу;
  в теле коммита — `EXPLAIN` до и после на чате с ≥50k сообщений.
- [x] **Шаг 6: клиент.** `core/managers/messagesManager.ts:697-700` —
  `mediaHistory(peerId, filter, offsetId, limit)`. Потребителя **ДВА**:
  медиа-вкладки профиля (`SharedMedia.tsx:157,193`) и догрузка соседей в
  просмотрщике медиа (`Chat.tsx:768-793`, `loadMoreMedia`) — переводить надо
  оба, иначе вьювер молча перестанет листать. Перевод разнесён по задаче 6
  (см. её «потребителя два»), поэтому серверный `offset` в задаче 1 **остаётся
  временно** и уходит вместе с последним из двух вызовов.

**Готово когда:** ручка листает по `offset_id`; тест на «вставка сверху не рвёт
вторую страницу» краснеет на возврате к `OFFSET`.

---

### Задача 2: бэкенд — batch-счётчики по типам (аналог `messages.getSearchCounters`)

**Что делаем.** `loadFirstTime` (`appSearchSuper.ts:2380-2513`) одним вызовом
`getSearchCounters(filters)` (`:2375-2377`) узнаёт число сообщений по КАЖДОМУ
фильтру и по нему решает, какие вкладки показывать и какую открыть первой. У нас
такой ручки нет — отсюда пять запросов на открытие профиля
(`SharedMedia.tsx:149-163`).

**Файлы:**
- Изменить: `backend/internal/adapter/delivery/http/router.go`, `chat_handler.go`
- Изменить: `backend/internal/usecase/chat/sync.go`
- Изменить: `backend/internal/adapter/repo/postgres/messagesrepo.go`
- Изменить: `web-client/src/core/managers/messagesManager.ts`
- Тесты: рядом

- [x] **Шаг 1: падающий тест** на юзкейс: запрос по списку фильтров возвращает
  число по каждому одним ответом; неизвестный фильтр — ноль, а не ошибка.
- [x] **Шаг 2: убедиться, что тест падает.**
- [x] **Шаг 3: реализовать** `GET /chats/{peerID}/search_counters?filters=media,files,links,music,voice`
  → `{counters: [{filter, count}, …]}`. В репозитории — **один** запрос с
  агрегацией по типу (`GROUP BY`), а не N подзапросов; опереться на индекс из задачи 1.
- [x] **Шаг 4: клиент** — `managers.messages.searchCounters(peerId, filters)`.

**Готово когда:** открытие профиля стоит одного запроса счётчиков вместо пяти;
тест краснеет, если ручка теряет фильтр из списка.

---

### Задача 3: `slideTabs` — вторая функция анимации `TransitionSlider`

**Что делаем.** У нас портирована только навигационная ветка
(`core/dom/navigationTransition.ts:236` ← `tweb/transition.ts:23-43`). Вкладкам
нужна `slideTabs` (`tweb/transition.ts:45-95`) — симметричный сдвиг на ±width, и
бухгалтерия классов `active`/`to`/`from` + `animating`/`backwards`/`disable-hover`
(`tweb/transition.ts:271-335`).

**Файлы:**
- Создать: `web-client/src/components/transition.ts` — `TransitionSlider` с обеими
  функциями анимации. `core/dom/navigationTransition.ts` **переезжает сюда**, а не
  остаётся вторым слайдером.
- Тест: `web-client/src/components/transition.test.ts`

- [x] **Шаг 1: прочитать** `tweb/src/components/transition.ts` целиком (383) и
  наш `core/dom/navigationTransition.ts` целиком.
- [x] **Шаг 2: падающий тест**: при переходе 0→1 уходящий получает `from`,
  приходящий — `active to`, контейнер — `animating`; при 1→0 добавляется
  `backwards`; по `transitionend` все временные классы сняты — и с вкладок, и с
  контейнера. Страховочный таймер (`tweb:350`, `transitionTime + 100`)
  срабатывает и без события, но убирает ТОЛЬКО уходящую вкладку (`active`/`from`
  + её инлайновый сдвиг, `tweb:340-347`); `animating`/`backwards`/`disable-hover`
  с контейнера снимает исключительно обработчик события (`tweb:225`). Так в
  оригинале — так и портировать: таймер обработчик не дублирует.
- [x] **Шаг 3: убедиться, что тест падает.**
- [x] **Шаг 4: реализовать**, дословно. Сохранить `selectTab.prevId()/.getFrom()/.setFrom()`
  (`tweb:376-378`) — они нужны правой колонке.
- [x] **Шаг 5: снести** `core/dom/navigationTransition.ts`, потребителей перевести
  на новый файл. Двух слайдеров в репозитории быть не должно.

**Готово когда:** один `TransitionSlider` на репозиторий; тест краснеет, если
убрать `backwards` или страховочный таймер.

---

### Задача 4: `horizontalMenu.ts`

**Что делаем.** Порт `tweb/src/components/horizontalMenu.ts` (215): ряд вкладок,
переключение через `TransitionSlider` из задачи 3, автоцентрирование активной
вкладки в `ScrollableX` (`:64-79`, `fastSmoothScroll` по X с оптимизациями
«ряд не скроллится» и «выбран первый при `scrollLeft === 0`»).

**Файлы:**
- Создать: `web-client/src/components/horizontalMenu.ts`
- Тест: `web-client/src/components/horizontalMenu.test.ts`

- [x] **Шаг 1: прочитать оригинал целиком.**
- [x] **Шаг 2: падающий тест**: клик по вкладке зовёт `onClick(id, content, animate)`;
  `onTransitionEnd` зовётся после перехода; активная вкладка, не влезающая в ряд,
  доезжает в вид (`scrollLeft` изменился); при `scrollWidth <= clientWidth` скролла
  не происходит вовсе.
- [x] **Шаг 3: убедиться, что тест падает.**
- [x] **Шаг 4: реализовать** дословно.

**Готово когда:** тест краснеет на удалении оптимизации `scrollWidth <= clientWidth`
и на потере `onTransitionEnd`.

---

### Задача 5: ядро `AppSearchSuper` — DOM, вкладки, память скролла, очистка

**Что делаем.** Каркас класса без загрузки данных: конструктор
(`appSearchSuper.ts:439-599`), коллбэки `selectTab` с **сохранением и
восстановлением позиции скролла** (`:624-708` — самая нетривиальная часть файла),
`scrollToStart` (`:800-807`), `onTransitionStart/End` (`:809-815`),
`cleanup`/`cleanScrollPositions`/`cleanupHTML`/`destroy` (`:2714-2793`, `:2828-2843`),
`setQuery` (`:2803-2826`), свайп (`:500-539`).

**Файлы:**
- Создать: `web-client/src/components/appSearchSuper.ts`
- Тесты: `web-client/src/components/appSearchSuper.dom.test.ts`,
  `appSearchSuper.scroll.test.ts`

- [x] **Шаг 1: прочитать** `appSearchSuper.ts:1-820` и `:2700-2843` целиком.
- [x] **Шаг 2: падающий тест на DOM**: конструктор строит
  `.search-super` → градиент + `.search-super-tabs-scrollable.menu-horizontal-scrollable.sticky`
  (внутри `ScrollableX` и `nav.search-super-tabs.menu-horizontal-div`) +
  `.search-super-tabs-container.tabs-container`; на каждую вкладку —
  `.menu-horizontal-div-item` с `i.menu-horizontal-div-item-background` и
  `span.menu-horizontal-div-item-span`; вкладка типа `media` получает
  `.search-super-content-media-grid`; типы вне `noSectionTypes` получают
  скрытый `Section` (`hideOn` с классом `hide`).
- [x] **Шаг 3: падающий тест на память скролла** (главный пин задачи):
  прокрутить вкладку A, переключиться на B, вернуться на A → `scrollPosition`
  восстановлен; во время перехода у `contentTab` новой вкладки стоит
  `transform: translateY(diff)`, а по `onTransitionEnd` он снят и выставлен
  реальный `scrollPosition` (`:641-676`, `:693-707`). Мутация для проверки:
  убрать строку `:673` — тест обязан покраснеть.
- [x] **Шаг 4: убедиться, что оба теста падают.**
- [x] **Шаг 5: реализовать** конструктор, `selectTab`-коллбэки, `scrollToStart`,
  `sliding`, свайп.
- [x] **Шаг 6: тест на очистку**: `cleanupHTML()` вычищает `itemsTab`, возвращает
  `hide` на `hideOn`, ставит прелоадер и обнуляет `scrollPosition`; `cleanup()`
  ставит `usedFromHistory[filter] = -1`, но **не трогает сам кэш**;
  `cleanScrollPositions()` обнуляет `mediaTab.scroll`; `destroy()` снимает
  слушатели и не оставляет узлов в DOM (DoD 5).
- [x] **Шаг 7: реализовать** очистку и `setQuery` (пересборка `searchContext`,
  подмена `historyStorage`, вызов `cleanup`; загрузку НЕ запускать — как в оригинале).

**Готово когда:** класс строит DOM 1:1 с дампом `docs/tweb/dom/dumps/07-right-sidebar.json`;
память скролла краснеет на названной мутации; `destroy()` не оставляет следов.

---

### Задача 6: загрузка — `historyStorage`, `load`/`loadType`, `performSearchResult`, живые апдейты

**Что делаем.** Механика загрузки для вкладок, идущих через историю
(media/files/links/music/voice): `load` (`:2531-2577`), `loadType` (`:2181-2360`)
с дедупликацией (`:2189`), **рендером из кэша без сети** (`:2239-2276`),
пагинацией по `offsetId` (`:2278-2291`, ручка из задачи 1), критерием «всё
загружено» (`:2308-2317`), отложенной предзагрузкой (`:2327-2347`);
`performSearchResult` (`:1096-1257`) с ожиданием `loadMutex` и `afterPerforming`
(`:1259-1283`); плюс **живые апдейты в форме оригинала** — модульный
`historiesStorage` и точечные `renderNewMessage`/`deleteDeletedMessages`
(`sharedMedia.tsx:28-36`, `:209-345`).

Рендерер конкретного фильтра в этой задаче — заглушка (`div.search-super-item`
с `data-mid`); настоящие приезжают в задачах 7-9.

**У ручки `mediaHistory` ПОТРЕБИТЕЛЯ ДВА, а не один.** Кроме медиа-вкладок
профиля (`SharedMedia.tsx:157,193`), той же ручкой листает **догрузка соседей в
просмотрщике медиа** — `Chat.tsx:768-793` (`loadMoreMedia`, наш заменитель
tweb-`SearchListLoader`): она докручивает страницы `mediaHistory(chatId,
'media', cache.msgs.length, 50)`, пока не найдёт якорь, и к порту
`AppSearchSuper` отношения не имеет. Поэтому:

- менять сигнатуру `messagesManager.mediaHistory` (`messagesManager.ts:697-700`)
  можно только правя ОБА места разом — иначе вьювер молча перестанет листать
  (ошибка сети там проглатывается и читается как «край списка», `Chat.tsx:790`);
- бэкендный параметр `offset` (шаг 6 задачи 1) удаляется только после того, как
  на `offset_id` переведены оба потребителя, — сейчас он оставлен временно
  именно ради `Chat.tsx` (см. `usecasechat.MediaPage.Offset`).

**Файлы:**
- Изменить: `web-client/src/components/appSearchSuper.ts`
- Изменить: `web-client/src/components/Chat.tsx` (`loadMoreMedia`, `:768-793`) —
  перевод второго потребителя на `offset_id` (курсор = `id` последнего
  сообщения в кэше, а не его длина)
- Создать: `web-client/src/components/sharedMediaHistories.ts` — модульный
  `historiesStorage` (порт `sharedMedia.tsx:28-45`)
- Тесты: `appSearchSuper.load.test.ts`, `appSearchSuper.live.test.ts`

- [x] **Шаг 1: прочитать** `appSearchSuper.ts:1096-1283`, `:2181-2360`, `:2531-2577`
  и `sharedMedia.tsx:28-345` целиком.
- [x] **Шаг 2: падающий тест на кэш**: первая загрузка вкладки идёт в сеть;
  уход на другую вкладку и возврат рисуют список **без единого сетевого вызова**
  (`usedFromHistory` меньше длины кэша → путь `:2239-2276`).
- [x] **Шаг 3: падающий тест на пагинацию**: вторая страница запрашивается с
  `offset_id` последнего элемента; `loaded[type]` ставится, когда пришло меньше
  `loadCount`; параллельные вызовы `loadType` для одного типа дают ОДИН запрос
  (дедупликация `:2189`).
- [x] **Шаг 4: падающий тест на живые апдейты** (пин против нашей нынешней
  недоделки): новое сообщение подходящего типа **prepend-ится одним узлом**,
  счётчик растёт на 1, а ранее загруженные страницы **остаются на месте**;
  удаление снимает узел и уменьшает счётчик; сообщение чужого типа не трогает
  вкладку вовсе.
- [x] **Шаг 5: убедиться, что тесты падают.**
- [x] **Шаг 6: реализовать.**
- [x] **Шаг 6а: дописать сброс новых полей в `cleanup()`.** Ядро (задача 5)
  оставило `cleanup()` без строк `:2715-2721` и `:2746` ОСОЗНАННО — сбрасывать
  было нечего, полей ещё не существовало (см. докблок `cleanup()` в
  `appSearchSuper.ts`). Заводя `loadPromises`/`loaded`/`loadedChats`/`nextRates`/
  `firstLoad`/`counters` (и `loadFirstTimePromise`, если приедет раньше задачи
  10), **тем же коммитом** вернуть их обнуление в `cleanup()` — иначе после
  `setQuery()` со сменой пира `loaded[type]` останется `true`, `load()` посчитает
  вкладку уже загруженной и молча ничего не запросит: **вкладка останется
  навсегда пустой**, без ошибки и без записи в консоль.
  **Тест обязателен: «после смены пира вкладка грузится заново»** — `setQuery()`
  с другим `peerId` и последующий показ вкладки дают НОВЫЙ сетевой вызов с новым
  `peerId`; мутация «убрать сброс полей из `cleanup()`» обязана его покраснить.
- [x] **Шаг 7:** `historiesStorage` — модульный, ключ `peerId → threadId → filter`,
  **переживает смену пира** (`sharedMedia.tsx:33-36`). Тест: вернулись к тому же
  пиру — сети нет.
- [x] **Шаг 8: второй потребитель.** Перевести `Chat.tsx::loadMoreMedia`
  (`:768-793`) на `offset_id`; тест на вьювер: вставка нового медиа между
  догрузками страниц НЕ даёт ни дубля, ни пропуска в списке листания.

**Готово когда:** тест на живые апдейты краснеет, если заменить точечный prepend
сбросом кэша (то есть на нашем нынешнем поведении); тест на кэш краснеет, если
`cleanup()` начнёт чистить `historyStorage`; **тест «после смены пира вкладка
грузится заново» краснеет, если убрать сброс полей из `cleanup()`** (шаг 6а);
**листание в просмотрщике медиа работает** — оба потребителя `mediaHistory`
переведены, `offset` больше никем не посылается.

---

### Задача 7: рендер медиа-грида + медиавьювер

**Что делаем.** `processPhotoVideoFilter` (`:874-938`): `div.grid-item`,
`choosePhotoSize(media, 200, 200)`, фото — `wrapPhoto`, видео —
`wrapVideo({onlyPreview: true, withoutPreloader: true, noPlayButton: true})`,
спойлер — `wrapMediaSpoiler` при `pFlags.spoiler`/чувствительном (`:917-930`).
Плюс открытие вьювера (`:716-774`) — со списком целей из **элементов вкладки**.

**Файлы:**
- Изменить: `web-client/src/components/appSearchSuper.ts`
- Тест: `web-client/src/components/appSearchSuper.media.test.ts`

- [x] **Шаг 1: прочитать** `:874-938` и `:716-774`.
- [x] **Шаг 2: падающий тест**: фото и видео дают `.grid-item.search-super-item`
  с `data-mid`/`data-peer-id` в `.search-super-content-media-grid`; сообщение со
  спойлером получает `.media-spoiler-container`, и первый клик по нему **снимает
  спойлер, а не открывает вьювер**; клик по обычной плитке открывает вьювер, а
  список для листания собран из элементов ЭТОЙ вкладки, а не из ленты чата.
- [x] **Шаг 3: убедиться, что тест падает.**
- [x] **Шаг 4: реализовать** поверх наших `wrappers/{photo,video,mediaSpoiler}.ts`
  и `components/mediaViewer/openMediaViewer.ts`.

**Готово когда:** пустая вкладка получает `.content-empty` с
`Chat.Search.NothingFound` (`afterPerforming:1276-1281`), а не наш инлайновый
текст (`SharedMedia.tsx:291-295`).

---

### Задача 8: рендер документов — файлы, музыка, голосовые

**Что делаем.** `processDocumentFilter` (`:940-962`): `wrapDocument({withTime: !showSender,
voiceAsMusic: true, showSender, searchContext})`, класс `audio-48` для
audio/voice/round (`:958-960`). Вкладка `voice` в оригинале — фильтр
`inputMessagesFilterRoundVoice`, то есть голосовые И кружки вместе; наша ручка
(`filter=voice` → `type IN ('voice','roundVideo')`) уже совпадает.

**Файлы:**
- Изменить: `web-client/src/components/appSearchSuper.ts`
- Тест: `web-client/src/components/appSearchSuper.documents.test.ts`

- [x] **Шаг 1: прочитать** `:940-962` и наш `components/wrappers/document.ts` целиком.
- [x] **Шаг 2: падающий тест**: файл даёт строку документа с именем/размером/датой;
  аудио и голосовое получают `audio-48`; воспроизведение идёт через тот же
  общий плеер, что и в ленте (очередь — из элементов вкладки).
- [x] **Шаг 3: убедиться, что тест падает.**
- [x] **Шаг 4: реализовать.**

**Готово когда:** три вкладки (files/music/voice) обслуживает ОДИН рендерер, как
в оригинале, а не три ветки JSX.

---

### Задача 9: рендер ссылок

**Что делаем.** `processUrlFilter` (`:964-1094`): при отсутствии `webpage` URL
парсится из `entities`/`matchUrl` и собирается синтетический `webPage`
(`:1010-1017`); рендер через наш `components/row.ts` — заголовок
(`wrapWebPageTitle`), описание + `<a href>`, превью `wrapPhoto` в `div.preview`
либо `wrapAbbreviation`.

**Известное ограничение бэкенда** (`docs/tweb/shared-media.md` § 3): фильтр
`links` — регексп по тексту (`messagesrepo.go:449-487`), а не по сущностям
`messageEntityUrl`/`messageEntityTextUrl`. Ссылка за текстом-якорем и ссылка в
подписи к медиа не найдутся. **Клиент остаётся дословным**; расхождение
объявляется комментарием у строки со ссылкой на задачу 15 (отложенное).

**Файлы:**
- Изменить: `web-client/src/components/appSearchSuper.ts`
- Тест: `web-client/src/components/appSearchSuper.links.test.ts`

- [x] **Шаг 1: прочитать** `:964-1094`.
- [x] **Шаг 2: падающий тест**: сообщение с `webpage` даёт строку с заголовком,
  описанием и превью; сообщение БЕЗ `webpage`, но с URL в тексте — строку с
  синтетическим превью-абвиатурой; хост показан отдельной строкой.
- [x] **Шаг 3: убедиться, что тест падает.**
- [x] **Шаг 4: реализовать.**

---

### Задача 10: первый показ вкладок, предикаты видимости, счётчики

**Что делаем.** `loadFirstTime` (`:2380-2513`), `canView*` (`:2611-2703`),
`canLoadMediaTab` (`:2362-2369`), `toggleContainerHidden`/`updateContainerHidden`
(`:2515-2529`), `setCounter`/`onLengthChange` (`:817-821`, `:436-437`).

**Ключевое, чего у нас нет:** приоритет первой открытой вкладки —
**stories → members (перебивает stories) → savedDialogs → gifts**, иначе первая
непустая медиа (`:2478-2495`). У группы по умолчанию открыт список участников.

**Файлы:**
- Изменить: `web-client/src/components/appSearchSuper.ts`
- Тест: `web-client/src/components/appSearchSuper.firstTime.test.ts`

- [ ] **Шаг 1: прочитать** `:2362-2529` и `:2611-2703`.
- [ ] **Шаг 2: падающий тест**: счётчики берутся ОДНИМ запросом (задача 2);
  вкладка с нулевым счётчиком получает `hide`, но **остаётся в DOM**; при
  единственной видимой у ряда `is-single` и градиент скрыт; у группы первой
  открывается `members`, у пользователя — первая непустая медиа; `canViewMembers`
  ложен для канала и для пользователя.
- [ ] **Шаг 3: убедиться, что тест падает.**
- [ ] **Шаг 4: реализовать.** `canViewGroups`/`canViewSaved` возвращают `false`
  с комментарием у строки и ссылкой на отложенные задачи 16-17 — ручек нет.

---

### Задача 11: вкладка «Участники» — `SortedUserList` и контекстное меню участника

**Что делаем.** `loadMembers` (`:1525-1758`): `SortedUserList` создаётся лениво
один раз и вставляется в `mediaTab.itemsTab` (`:1546-1572`); пагинация
`getChannelParticipants` LOAD_COUNT 50 → 200 (`:1680-1699`); live-обновления по
`chat_full_update`/`chat_participant` (`:1601-1640`); клик по участнику
(`:1552-1571`); контекстное меню `createParticipantContextMenu` (`:1577-1583`,
`helpers/dom/createParticipantContextMenu.ts:40-138`).

**Отдельная сложность:** `SortedUserList` опирается на
`appDialogsManager.addDialogNew`, которого у нас нет. Порт сводится к **узкому
строителю строки** — наша React-разметка (`SharedMedia.tsx:369-413`) уже даёт
`.row.chatlist-chat.chatlist-chat-abitbigger` 1:1, то есть целевая разметка
известна и переносить `appDialogsManager` не нужно.

**Файлы:**
- Создать: `web-client/src/components/sortedUserList.ts`
- Создать: `web-client/src/components/dialogRow.ts` — строитель строки чатлиста
- Создать: `web-client/src/helpers/dom/createParticipantContextMenu.ts`
- Изменить: `web-client/src/components/appSearchSuper.ts`
- Тесты: рядом с каждым

- [ ] **Шаг 1: прочитать** `tweb/src/components/sortedUserList.ts` (134),
  `appSearchSuper.ts:1525-1758`, `tweb/src/helpers/dom/createParticipantContextMenu.ts`.
- [ ] **Шаг 2: падающий тест на строку**: разметка совпадает с
  `docs/tweb/dom/dumps/15-right-*.json` (заголовок, роль правым слотом, статус,
  аватар `row-media-abitbigger`).
- [ ] **Шаг 3: падающий тест на вкладку**: список пагинируется (первая партия 50,
  дальше 200); участник, покинувший чат, снимается по событию; клик открывает
  профиль; правый клик даёт меню, где пункты скрыты по правам, а не задизейблены.
- [ ] **Шаг 4: убедиться, что тесты падают.**
- [ ] **Шаг 5: реализовать.**

**Готово когда:** список грузится САМ (сейчас приходит готовым пропом из
`useGroupInfo`), и `useGroupInfo` перестаёт тянуть участников для этой панели.

---

### Задача 12: вкладки «Подарки» и «Чаты» (savedDialogs)

**Что делаем.** Две вкладки, у которых контент — не поток сообщений:

- `loadGifts` (`:2130-2179`) + `setPinnedGifts` (`:2579-2610`, топ-3 подарка
  рисуются стикерами прямо в `menuTabName` вкладки — этого у нас нет);
  оригинал вкладки — Solid `stargifts/profileList.tsx` (472), стили-модули у нас
  уже лежат (`components/stargifts/*.module.scss`).
- `loadSavedDialogs` (`:1890-1941`) — список сохранённых диалогов.

Обе вкладки в оригинале — Solid-компоненты, монтируемые классом в
`mediaTab.contentTab`. Значит здесь они и пишутся как `*.solid.tsx` и монтируются
мостом `shared/solid/mountSolid.solid.tsx`.

**Файлы:**
- Создать: `web-client/src/components/stargifts/profileList.solid.tsx`
- Создать: `web-client/src/components/sidebarRight/savedDialogsTab.solid.tsx`
- Изменить: `web-client/src/components/appSearchSuper.ts`
- Тесты: рядом

- [ ] **Шаг 1: прочитать** `tweb/src/components/stargifts/profileList.tsx` (472),
  `appSearchSuper.ts:1890-1941`, `:2130-2179`, `:2579-2610`.
- [ ] **Шаг 2: падающий тест**: витрина подарков рисует сетку и пустое состояние
  с приглашением подарить; скрытые подарки помечены; топ-3 закреплённых
  появляются в узле вкладки (`setPinnedGifts`); список сохранённых диалогов
  рисует строки и открывает пира по клику.
- [ ] **Шаг 3: убедиться, что тест падает.**
- [ ] **Шаг 4: реализовать.** Существующий виртуальный список «Избранного»
  (`SharedMedia.tsx:686-748`) и его тест `SharedMedia.saved.test.tsx` —
  **источник сценариев, но не образец**: сверить, что ни один проверяемый там
  сценарий не потерян, и переписать тест под новый носитель.

---

### Задача 13: шов — класс въезжает в панель, React-`SharedMedia` удаляется

**Единственная задача, меняющая видимое поведение.** Всё, что работает сейчас,
к этому моменту умеет класс (задачи 7-12), поэтому переключение — атомарное, без
периода «две реализации живы» (DoD 14).

**Что делаем:**

1. `UserInfoPanel.tsx:351-355` — вместо самодельного `div.search-super` создаётся
   `AppSearchSuper` со списком вкладок из `sharedMedia.tsx:604-648`, и Solid-карточке
   отдаётся `instance.container` (`sharedMedia.tsx:166`).
2. Портал `SharedMedia` (`UserInfoPanel.tsx:691-710`) снимается, файл
   `userInfo/SharedMedia.tsx` (815) **удаляется**.
3. Шапка переводится на контракт класса: `onAdditionalScroll` меряет
   `searchSuper.nav` (или `container` при `is-single`) — `sharedMedia.tsx:484-493`;
   `setIsSharedMedia` toggl-ит `is-full-viewport` на контейнере класса и зовёт
   `cleanScrollPositions()` при выходе (`sharedMedia.tsx:505-517`); подзаголовок
   берёт число из `onLengthChange`, а не из нашего `onCount`.
4. **Инлайновый `stickyTop` удаляется** (`UserInfoPanel.tsx:706`, `TAB_GAP` в
   `userInfo/helpers.ts:45`) — липкий ряд встаёт на портированный
   `top: var(--super-offset)` (`styles/tweb/_searchSuper.scss:24`). Это закрывает
   P1 из `docs/research/2026-08-08-tweb-deep-structural-audit.md`.
5. Владение узлом: узел создаёт и уничтожает класс; React к его атрибутам не
   прикасается (правило шва, спека § 7).

> **Осторожно: `destroy()` роняет ЧУЖОЙ скроллер.** `AppSearchSuper.destroy()`
> зовёт `this.scrollable.destroy()` дословно как оригинал (`tweb:2831`) — см.
> расхождение 7 в шапке `web-client/src/components/appSearchSuper.ts`. В tweb
> скроллер создаёт владелец класса (вкладка сайдбара) и умирает вместе с ним; в
> этой задаче скроллер становится **общим с шапкой профиля** и переживает
> подсистему. Правило у нас: **скроллер уничтожается только если создан и
> принадлежит классу**. Значит здесь надо выбрать одно из двух и сделать это
> ЯВНО: либо класс заводит собственный скроллер (и тогда `destroy()` его роняет
> по праву), либо строка `this.scrollable.destroy()` уходит из `destroy()`.
> Отказ, если не сделать ничего, **тихий**: `Scrollable.destroy()` лишь снимает
> слушателей и обнуляет колбэки (`components/scrollable.ts:227-232`) — панель
> перестанет реагировать на прокрутку, а в консоли будет пусто.
> Тест обязателен: после `destroy()` подсистемы прокрутка профиля **всё ещё
> обрабатывается** (`onAdditionalScroll`/`onScrolledBottom` шапки живы); мутация
> «вернуть безусловный `this.scrollable.destroy()`» обязана его покраснить.

**Файлы:**
- Изменить: `web-client/src/components/UserInfoPanel.tsx`
- Удалить: `web-client/src/components/userInfo/SharedMedia.tsx`,
  `SharedMedia.invalidate.test.tsx` (пинит недоделку, снесённую задачей 6),
  `TAB_GAP` из `userInfo/helpers.ts`
- Изменить: `web-client/src/components/UserInfoPanel.shell.test.ts`,
  `UserInfoPanel.profileSections.test.ts` (пины на портал → пины на шов с классом)
- Изменить: `web-client/src/components/PinnedStoriesSection.tsx` — см. ниже

- [ ] **Шаг 1: падающий тест на шов**: `searchSuperContainer`, полученный
  Solid-карточкой, — это `instance.container`, а не свежесозданный `div`; при
  смене `peerId` Solid-корень пересоздаётся, а узел класса **переезжает целиком**,
  сохраняя активную вкладку и её DOM.
- [ ] **Шаг 2: падающий тест на владение** (DoD 5): после `destroy()` панели
  узлов класса в документе нет.
- [ ] **Шаг 3: падающий тест на липкость**: у `.search-super-tabs-scrollable` нет
  инлайнового `top`. Мутация: вернуть `stickyTop={TAB_GAP}` — тест обязан покраснеть.
- [ ] **Шаг 4: убедиться, что тесты падают.**
- [ ] **Шаг 5: реализовать переключение и удалить React-версию.**
- [ ] **Шаг 6: живая проверка на стенде** (DoD 10) — прощёлкать пункты 1-7 и 10-11
  чеклиста `docs/tweb/shared-media.md` § «Проверка после порта», числа положить в
  тело коммита.
- [ ] **Шаг 7: посчитать** число `.tsx` с импортом `react` до и после (DoD 14),
  цифры — в тело коммита.

**Готово когда:** `git grep -n "userInfo/SharedMedia"` пуст; число React-файлов
уменьшилось; чеклист прощёлкан.

---

### Задача 14: выделение и контекстное меню элемента

**Что делаем.** `SearchSelection` (`chat/selection.ts:583-763`) поверх нашей уже
портированной базы `AppSelection` (`components/chat/selection.ts`, 844) и
`SearchContextMenu` (`appSearchSuper.ts:156-345`).

Стили под обе подсистемы уже лежат (`styles/tweb/_searchSuper.scss:351-361`,
классы `is-selecting`) — кода нет.

**Файлы:**
- Изменить: `web-client/src/components/chat/selection.ts` (добавить `SearchSelection`)
- Изменить: `web-client/src/components/appSearchSuper.ts` (`SearchContextMenu`)
- Тесты: `appSearchSuper.contextMenu.test.ts`, `selection.search.test.ts`

- [ ] **Шаг 1: прочитать** `chat/selection.ts:583-763` и `appSearchSuper.ts:156-345`.
- [ ] **Шаг 2: падающий тест на меню**: правый клик по `.search-super-item` даёт
  `.search-contextmenu` с Forward/Download/Goto/Select/Delete; пункт, чей
  `verify()` ложен, **скрыт**; если скрыты все — меню не открывается вовсе.
- [ ] **Шаг 3: падающий тест на выделение**: выбор двух элементов ставит
  `is-selecting` на `navScrollableContainer` и на контейнер, плашка
  `.search-super-selection-container` встаёт **на место ряда вкладок**, счётчик
  показывает 2; shift-клик выделяет диапазон внутри одной вкладки и не выходит
  за `tabs-tab`.
- [ ] **Шаг 4: убедиться, что тесты падают.**
- [ ] **Шаг 5: реализовать.**

---

## Отложено — с предметом, а не «потом посмотрим» (DoD 13)

| № | Что | Почему отложено | Что разблокирует |
|---|---|---|---|
| 15 | Фильтр `links` по сущностям `messageEntityUrl`/`TextUrl` вместо регекспа по тексту | Правка бэкенда (`messagesrepo.go:449-487`) с миграцией данных; не блокирует вкладку, лишь сужает выдачу | Ссылки за текстом-якорем и в подписях к медиа |
| 16 | Вкладка «Общие группы» (`groups`) | **Ручки нет вовсе**: аналога `users.getCommonChats` в usecase/http/repo нет, есть только конструктор в TL-схеме | Вкладка `groups` в профиле пользователя |
| 17 | Вкладка `saved` (Saved Messages внутри пира) | Истории треда по `saved_peer_id` бэкенд не отдаёт | Вкладка `SharedMedia.Saved` |
| 18 | Вкладка «Похожие каналы» (`similar`) | Ручка ЕСТЬ (`GET /channels/{peerID}/similar`, `router.go:370`) — отложено только по объёму, включая paywall для не-Premium (`appSearchSuper.ts:1804-1881`) | Вкладка `similar` у каналов |
| 19 | «Истории» вкладкой ряда вместо отдельной секции | Сейчас `PinnedStoriesSection` рисуется выше по странице (`UserInfoPanel.tsx:772`); у оригинала это вкладка с приоритетом первой открытой (`:2478-2484`). Оригинал вкладки — Solid `stories/profileList.tsx` (938) | Приоритет вкладок 1:1 с оригиналом |
| 20 | Второй потребитель класса — глобальный поиск левой колонки (`sidebarLeft/index.ts:1128`): `searchGroups`, `asChatList`, `showSender`, `loadChats` (`:1285-1523`) | Отдельный экран (`SearchView.tsx`), свой этап | Снятие React с глобального поиска |
| 21 | Поиск внутри чата — `chat/topbarSearch.tsx` (1318, Solid) | По § 8 спеки это **волна 5**, а не этот этап; к `AppSearchSuper` отношения не имеет | — |

## Оценка объёма

| Задача | Строк оригинала | Размер |
|---|---|---|
| 1-2 (бэкенд) | — | S каждая |
| 3 `slideTabs` | ~90 + переезд 236 наших | S |
| 4 `horizontalMenu` | 215 | S |
| 5 ядро класса | ~600 | **L** |
| 6 загрузка и живые апдейты | ~600 | **L** |
| 7 медиа-грид | ~120 | M |
| 8 документы | ~25 | S |
| 9 ссылки | ~130 | M |
| 10 первый показ | ~250 | M |
| 11 участники | ~370 | **L** |
| 12 подарки + сохранённые | ~520 | **L** |
| 13 шов и снос React | — | **L** (риск, не объём) |
| 14 выделение и меню | ~370 | M |
