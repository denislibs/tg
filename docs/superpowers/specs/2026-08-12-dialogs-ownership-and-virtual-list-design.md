# Виртуальный список диалогов: порт tweb 1:1

**Дата:** 2026-08-12
**Статус:** дизайн согласован, реализация не начата
**Референс:** `~/Documents/tweb` (локальная копия) + живые замеры `web.telegram.org/k` от 2026-08-12

## Задача

Портировать список чатов сайдбара из tweb 1:1: структуру DOM, виртуализацию,
анимации и слой данных под ними. Сейчас у нас список не виртуализирован — все
строки лежат в потоке в одном `ul.chatlist` (`components/ChatList.tsx:97`), а
стили `.virtual-chatlist` портированы, но ни к чему не применяются
(`styles/tweb/_chatlist.scss:471`, `_leftSidebar.scss:96` — мёртвый код).

Решение принято: портируем целиком, включая правки бэкенда, где они нужны.

## Как это устроено в tweb (референс)

### Слои

| Слой | Файл tweb |
|---|---|
| windowing (что рендерить) | `components/verticalVirtualList.tsx` |
| сортировка, скелетоны, reveal, shrink | `components/deferredSortedVirtualList.tsx` |
| скелетон-плейсхолдер | `components/loadingDialogSkeleton.tsx` + `.module.scss` |
| адаптер к диалогам | `components/sortedDialogList.ts` |
| пагинация/курсор | `components/autonomousDialogList/base.ts` + `helpers/sequentialCursorFetcher.ts` |
| DOM строки | `lib/appDialogsManager.ts` (`DialogElement`) + `components/row.ts` |
| владелец данных | `lib/storages/dialogs.ts` (`dialogsStorage`, в воркере) |

### DOM и геометрия (замеры живого tweb, viewport 1342×955, тёмная тема)

```
div.scrollable.scrollable-y.tabs-tab.chatlist-parts.folders-scrollable   x=16 w=357 padding-top=131px
└─ ul.chatlist.virtual-chatlist   style="height: 1304px"                 x=24 w=341 margin=0 8px padding=0
   ├─ a.row.no-wrap.row-with-padding.row-clickable.hover-effect.rp
   │    .chatlist-chat.chatlist-chat-bigger.row-big[.is-muted][.active]
   │    ._Item_   style="top: 0px"                                       x=24 w=341 h=72 position:absolute
   │  ├─ div.c-ripple
   │  ├─ div.row-row.row-subtitle-row.dialog-subtitle.has-multiple-badges
   │  ├─ div.row-row.row-title-row.dialog-title
   │  └─ div.avatar…dialog-avatar.row-media.row-media-bigger              x=33 (inset-inline-start: 9px) 54×54
   ├─ a…  style="top: 72px"
   └─ a…  style="top: 144px"
```

Цепочка отступов слева: `16` (margin сайдбара) + `8` (margin `ul`) = `24` —
левый край строки; `+9` — аватар; `+72` (`.row-with-padding`) — текст (x=96).
Высота `ul` = `totalCount * itemHeight + extraPaddingBottom` = `18*72 + 8 = 1304`.

**Почему `padding` на `ul` убит `!important`.** У абсолютно спозиционированного
ребёнка containing block — padding-box контейнера, и `width: 100%` считается от
него же: строка начинается от внешнего края паддинга и на всю его ширину, то
есть боковой `padding` визуально не работает. Поэтому tweb гасит
`ul.chatlist { padding: 0 .5rem }` (`_chatlist.scss:73`) правилом
`.virtual-chatlist { margin: 0 .5rem !important; padding: 0 !important; width: auto !important }`
(`_chatlist.scss:471`).

### Виртуализация

`VerticalVirtualList` — фиксированная высота строки, ничего не измеряет:

- `itemHeight` = 72 (чаты, монофорум) или 64 (топики форума, ботфорум);
- видимость — арифметика по индексу (`verticalVirtualList.tsx:62-72`):
  `idx*h >= scrollTop - pad && (idx+1)*h <= scrollTop + hostHeight + pad`,
  `thresholdPadding = 72*4` (overscan 4 строки);
- высота `ul` = `count*itemHeight + extraPaddingBottom` (8 = .5rem); пока список
  ни разу не загружен — `forceHostHeight` (высота хоста + `overflow: hidden`);
- скролл слушается на хосте (`.scrollable`), размер хоста — `useElementSize`.

`deferredSortedVirtualList` добавляет:

- `fullItems` длиной `totalCount + pinned`, дырки = `null` → на месте `null`
  рендерится `LoadingDialogSkeleton` с тем же `._Item_` и тем же `top`;
- `requestItemForIdx(idx)` → `cursorFetcher.fetchUntil(idx+1)` — догрузка страницы
  под пустой индекс;
- reveal-очередь: `revealIdx` пускает строки по одной каждые `1000/60/2` ≈ 8.3 мс
  (`:208-223`) — раскрытие идёт волной, а не одним кадром;
- shrink: если элементов больше `maxVisible + 50` (`EXTRA_ITEMS_TO_KEEP`), список
  режется и курсор откатывается (`:226-239`, `base.ts:67-77`);
- размонтированная строка помечается в `WeakMap` и при возврате во вьюпорт
  переинициализируется с задержкой 200 мс (`sortedDialogList.ts:78-90`).

### Пагинация

- размер страницы — `guessLoadCount()` = `max(windowHeight/64*1.25, DIALOG_LOAD_COUNT=20)`
  (`base.ts:216-219`);
- курсор — не offset, а `index` диалога: следующий `offsetIndex` = минимальный
  `getDialogIndex` из полученной пачки (`base.ts:274-277`);
- ответ несёт `{dialogs, count, isEnd}`; `count` → `setTotalCount` → высота списка
  и число скелетонов;
- первый ответ может прийти с `count: null`, поэтому через 500 мс идёт повторный
  запрос ради настоящего total (`base.ts:247-272`);
- `SequentialCursorFetcher` сериализует конкурентные запросы и крутит цикл
  `while (fetched < needed)`.

### Анимации

1. **Перестановка строк** — `top` анимируется JS'ом, не CSS:
   `createAnimatedValue(idx*itemHeight, 120, simpleEasing, canAnimate)`
   (`verticalVirtualList.tsx:78`), rAF-цикл `helpers/animation`.
2. **`useShouldAnimate`** (`verticalVirtualList.tsx:120-180`): если ВСЕ видимые
   элементы сдвинулись на одинаковое число позиций, анимация отменяется, вместо
   неё компенсируется `scrollTop -= diff*itemHeight`. Список визуально стоит на
   месте, двигаются только реально переехавшие строки.
3. **`--background` на время движения** (`:189-194`): пока `animating`, строке
   ставится `--background: var(--surface-color)` — иначе наезжающие друг на друга
   абсолютные строки просвечивали бы (`.chatlist-chat { background: var(--background) !important }`,
   `_chatlist.scss:88-90`).
4. **`blockAnimation()`** — счётчик-глушилка на первую загрузку
   (`autonomousDialogList/dialogs.ts:251`).
5. **Скелетон**: shimmer включается через 1500 мс после монтирования
   (`loadingDialogSkeleton.tsx:24-26`); ширины плашек псевдослучайны от `seed = idx`.
6. **CSS-слой** (`body.animation-level-2`): `.row { transition: opacity var(--transition-standard-in) }`
   (`_row.scss:23-25`); mute-иконка `fade-in-opacity .2s` / `fade-in-backwards-opacity .2s`
   (`_chatlist.scss:110-123`); бейджи непрочитанного — миксины
   `dialog-badge-transition` (`_chatlist.scss:3-67`), `transform: scale(0→1)` + opacity.

### Владение данными

`dialogsStorage` живёт в воркере вместе с `generateDialogIndex`, черновиками и
порядком закреплённых. Витрина получает значения событиями `rootScope`
(`dialogs_multiupdate: Map<PeerId, {dialog}>`, `dialog_notify_settings`,
`dialog_unread`, `dialog_draft`, `dialog_flush` — `rootScope.ts:66-74`).

**Оптимистики нет.** Действия применяются ПОСЛЕ ответа сервера:
- `toggleDialogPin` → `invokeApi(...).then(() => saveUpdate(updateDialogPinned))`
  (`appMessagesManager.ts:5687-5699`);
- `updateNotifySettings` → `.then(() => generateLocalNotifySettingsUpdate(...))`
  (`appNotificationsManager.ts:121-126`);
- `editPeerFolders` → `.then((updates) => processUpdateMessage(updates))`
  (`appMessagesManager.ts:5609-5625`).

## Наше состояние

| Что | Где | Статус |
|---|---|---|
| DOM строки | `components/ChatListItem.tsx:148-152` | совпадает с tweb (классы, порядок детей, `c-ripple` через `useRipple`) |
| Геометрия строки | `styles/tweb/_row.scss`, `_chatlist.scss` | портирована |
| `.virtual-chatlist` | `styles/tweb/_chatlist.scss:471` | мёртвый код (никто не применяет) |
| Список | `components/ChatList.tsx:97` | один `ul` на все папки, строки в потоке, без виртуализации |
| Архив | `components/ArchiveRow` | отдельный узел над `ul` (в tweb — pinned-элемент внутри списка) |
| Папки | `Sidebar` + `TabSlide` | один общий скроллер (в tweb — свой Scrollable+ul на папку) |
| Владелец диалогов | `stores/chatsStore.ts` (main) | порядок рождается в `applyDialogs`, читает `AppState.pinnedOrders` и черновики |
| Персист | `stores/dialogsPersist.ts` (main собирает) + `persistManager` (воркер пишет) | смешанное владение |
| Загрузка | `GET /chats` без пагинации (`chatsManager.ts:17-19`) | весь список одним куском |
| Оптимистика mute/pin/archive | `ChatListItem`, `Chat`, `useMuteToggle`, `useAppHotkeys` | применяется мгновенно, откат в `catch` |
| `helpers/animation` | `src/helpers/animation.ts` | уже портирован |
| `simpleEasing`, `SequentialCursorFetcher` | — | нет, довозим |
| Монофорум/ботфорум | — | функциональности нет, портировать нечего |

## Дорожная карта

Четыре этапа, порядок обязателен: этап 3 без 2 даст скелетоны, которым нечего
показывать; этап 2 без 1 разведёт курсор и порядок по разным потокам.

1. **Владение диалогами переезжает в воркер** — эта спека.
2. **Пагинация: бэкенд + `getDialogs`** — отдельная спека.
3. **Виртуальный список, DOM и анимации** — отдельная спека.
4. **Остальные списки на то же ядро** (`SearchView` 72, `TopicsPanel` 64) — отдельная спека.

---

# Этап 1: владение диалогами в воркере

## Цель

`chatsStore.dialogs` перестаёт быть источником истины и становится зеркалом.
Владелец — новый `core/managers/dialogsManager.ts` в воркере: держит кэш,
считает порядок, применяет realtime-кадры и действия, публикует операции.

Это тот же паттерн, что уже применён к пирам (Stage 1C.2): владелец публикует
`rt:peer_op`, `peersStore` — зеркало, единственный писатель — проектор, пробел
объявляет витрина (`fillMirror`), всё пинится `stores/noDuplicatePeers.test.ts`.

## Архитектура

```
воркер                                          main
──────────────────────────────────────────────  ──────────────────────────────
dialogsManager                                  chatsStore.dialogs (зеркало)
 ├─ кэш Dialog[] + index у каждого               └─ единственный писатель:
 ├─ dialogIndex (переезжает с main)                 storeProjection.applyDialogOps
 ├─ зеркало pinnedOrders/drafts из AppState
 ├─ применение realtime-кадров
 ├─ действия (mute/pin/archive/theme/remove)
 ├─ reconcile сети с кэшем
 ├─ персист (saveDialogs, дебаунс)
 └─ публикация rt:dialog_op ──── веер по вкладкам ────┘
```

`dialogIndex` переезжает в воркер вместе с зеркалом `pinnedOrders` и `drafts`:
воркер и так пишет эти ключи (`persistManager.stateKey` → `saveStateKey`),
достаточно читать их на старте и обновлять при записи.

Расшифровка превью секретных чатов (`decryptSecretPreviews`, сейчас в
`loadChats` на main) переезжает туда же — `secretManager` уже живёт в воркере
(`workerCore.ts:123`).

## Модель операций

Канал — `rt:dialog_op`, по образцу `rt:peer_op`. Индекс едет внутри значения,
как `{id, index, value}` у tweb:

```ts
export type DialogItem = { dialog: Dialog; index: number }

export type DialogOp =
  | { op: 'reset';   items: DialogItem[] }                                  // первичная загрузка / resync
  | { op: 'upsert';  items: DialogItem[] }                                  // новый или заменённый диалог
  | { op: 'patch';   chatId: number; fields: Partial<Dialog>; index?: number }
  | { op: 'reindex'; items: { chatId: number; index: number }[] }           // сменился pinnedOrders/черновик
  | { op: 'remove';  chatId: number }
```

Зеркало сортирует по готовому `index` (`b.index - a.index`, как `sortWith` в
`sortedDialogList.ts:102`). Пересчёта индекса на main не остаётся вовсе.

**Правила публикации** (те же, что у пиров):
- публикуем изменившееся значение — то, на чём зеркало может разъехаться;
- публикуем в ответ на объявленный пробел (`dialogs.fillMirror()`) ВСЕГДА,
  включая попадание в кэш: `SuperMessagePort` события не буферизует, поздняя
  вкладка стартовый бродкаст не получает;
- «уже публиковали» не считается доставкой.

**`fillMirror` — RPC, а не только веер.** Вызов возвращает `DialogOp` (`reset`)
ответом RPC вызвавшей вкладке И публикует его веером остальным. Ответ ответом
нужен для холодного старта: `boot.ts` ждёт именно его до первого рендера, а
подписка на `rt:dialog_op` к тому моменту ещё не поднята (тот же порядок, что у
`mediaManager.downloadMediaURL`: пробел закрывается ответом RPC, а не следующим
бродкастом).

## Действия: apply-after-success

Порт 1:1 с tweb — оптимистики нет:

```
UI → managers.dialogs.setMute(chatId, muted)
        → RPC в воркер → сеть
        → успех: владелец применяет к кэшу и публикует rt:dialog_op
        → ошибка: ничего не менялось, откатывать нечего
```

Ветки `catch(() => setDialogMuted(chatId, !muted))` в `ChatListItem`,
`useMuteToggle`, `useAppHotkeys` удаляются вместе с оптимистикой.

Цена: на медленной сети мьют/пин/архив отрабатывают по ответу сервера, а не
мгновенно — как в Telegram Web K.

Побочный выигрыш: действие применяется во ВСЕХ вкладках сразу (сейчас — только
в той, где кликнули, остальные ждут серверный кадр).

## Поток данных

**Холодный старт.** Сейчас `boot.ts:52-53` префетчит `chats.listDialogs()` и
параллельно читает IDB на main (`hydrateDialogsFromPersist`), сеть реконсайлит
поверх. Станет: воркер поднимает кэш из IDB сам, считает индексы и отвечает на
`dialogs.fillMirror()` операцией `reset`; сеть догоняет и публикует поверх.
`boot.ts` ждёт один RPC вместо чтения диска — инвариант «одно батч-чтение до
первого рендера, никаких ad-hoc чтений персиста из сторов» сохраняется.

Под passcode-локом — как сейчас: ни префетча, ни гидрации, ни plaintext at rest.

**Персист.** `stores/dialogsPersist.ts` удаляется целиком. Дебаунс-запись
переезжает к тому, кто и так физически пишет (`persistManager.dialogs` →
`saveDialogs`). Побочно уходит регулярная сериализация всего списка через
границу воркера на каждое изменение.

**Реконсиляция.** `core/store/reconcile` переезжает в воркер: неизменившиеся
записи сохраняют ссылки, совпавший с памятью ответ не даёт ни перерисовки, ни
записи в IDB (порт tweb `saveDialogFilter`).

**Что остаётся на main:** `typing`, `presence`, `activeChatId` — эфемерика, в
порядок списка не входит, живёт в `chatsStore` как сейчас.

## Миграция писателей

| Сейчас (main) | Кто зовёт | Станет |
|---|---|---|
| `setDialogMuted/Pinned/Archived` | `ChatListItem`, `Chat`, `useMuteToggle`, `useAppHotkeys` | `managers.dialogs.setMute/setPinned/setArchived` |
| `setDialogTheme` | `ChatThemesPicker`, `storeProjection` | `managers.dialogs.setTheme` |
| `removeDialog` | `useGroupEdit`, `storeProjection` | `managers.dialogs.remove` |
| `applyChatMeta` | `storeProjection`, `refetchSubscriber` | владелец по кадру → операция |
| `applyNewMessage`, `applyRead`, `bumpUnreadReactions` | `storeProjection` | владелец по кадру → операция |
| `setDialogs` | `useAuthGate`, `loadChats` | `reset` от владельца |

`loadChats` сегодня делает два дела — тянет `me` и диалоги. Диалоговая половина
уходит владельцу (`fillMirror` + сетевой догон), `setMe` остаётся как есть:
владение `me` уже разобрано отдельно (`stores/noDuplicateMe.test.ts`) и этой
работой не трогается. Логаут/смена сессии: владелец публикует `reset` с пустым
списком по тому же поводу, по которому сейчас `useAuthGate` зовёт `setDialogs([])`
(`rt:logging_out`), и чистит свой кэш.

## Порядок работ (тонкие срезы)

1. `dialogsManager` + канал `rt:dialog_op` + зеркало на `reset`/`fillMirror`
   (старый путь ещё жив, новый пока дублирует).
2. Перенос применения realtime-кадров, снятие соответствующих мутаторов с main.
3. Перенос действий на apply-after-success, удаление оптимистики и `catch`-откатов.
4. Перенос персиста, удаление `stores/dialogsPersist.ts`.
5. Снос `applyDialogs`/`dialogIndex` с main, переориентация `noManualOrder.test.ts`.

## Отступления от tweb (осознанные, с причинами)

1. **Зеркало-массив на main.** У tweb представление — сам DOM, которым владеет
   `SortedDialogList` (элементы + индексы), массива диалогов на main нет. У нас
   представление — React, читающий из стора; альтернатива (держать данные строки
   в локальном состоянии каждой строки) — тот же стор, только размазанный.
   Записывается комментарием у `chatsStore.dialogs`.
2. **Один канал `dialog_op` вместо пяти типизированных событий** (`dialogs_multiupdate`,
   `dialog_notify_settings`, `dialog_unread`, `dialog_draft`, `dialog_flush`).
   Причина: у нас канал событий уже устроен как операции (`rt:peer_op`,
   `rt:message_op`), и второй стиль в том же проекторе усложнил бы применение.
   Семантика та же — событие несёт значение, а не «пойди перечитай».

## Тесты

Норма: строка проводки без теста, чья мутация краснеет, — нарушение.

**Новые:**
- `stores/noDuplicateDialogs.test.ts` — единственный писатель `chatsStore.dialogs`
  — проектор; скан исходников на прямые записи, allow-list пуст.
- `client/realtime/storeProjection.dialogs.test.ts` — сравнивает ОТВЕТ ВЛАДЕЛЬЦА
  с состоянием зеркала напрямую (`dialogsManager.getSnapshot()` против
  `useChatsStore.getState().dialogs`), а не зеркало с самим собой.
- `core/managers/dialogsManager.test.ts` — порядок и индекс (сюда переезжает
  `core/dialogs/dialogIndex.test.ts`), применение realtime-кадров, и отдельно
  apply-after-success: RPC упал → ни одной операции не опубликовано, кэш не изменился.
- `core/workerCore.dialogs.test.ts` — проводка `onDialogOps` в `workerCore`
  (краснеет на `void` вместо подключения).
- Веер: операция, порождённая действием в одной вкладке, доезжает второй.

**Переориентируются:** `stores/noManualOrder.test.ts` (место рождения порядка —
воркер), `core/state/noAdHocReads.test.ts` (чтение диалогов с main исчезает),
`stores/chatsStore.test.ts`, тесты `ChatListItem`/`useMuteToggle` (проверяют, что
до ответа сервера состояние не менялось).

**Удаляются:** тесты `stores/dialogsPersist.ts` вместе с модулем.

## Критерии приёмки

Этап 1 не меняет внешний вид списка вообще: ни разметки, ни стилей, ни
виртуализации он не трогает. Единственное видимое изменение — исчезнувшая
оптимистика действий (пункт 3).

1. `npm test`, `npm run typecheck`, `npm run lint` зелёные — с приведённым выводом,
   не пересказом.
2. Поведение списка не изменилось: порядок, пины, превью, счётчики непрочитанного,
   архив, темы — проверено на стенде `:38080`.
3. Мьют/пин/архив применяются во всех открытых вкладках и НЕ применяются до
   ответа сервера.
4. `grep` не находит `applyDialogs`/`dialogIndex` на main-стороне;
   `stores/dialogsPersist.ts` отсутствует.
5. Холодный старт по-прежнему рисует кэш до сети, без рваной гидрации.

---

# Этап 2: пагинация (эскиз)

**Бэкенд.** `GET /chats` учится принимать `limit`, `offset_date`,
`offset_chat_id` и отдавать `{chats, count, is_end}`. Keyset по
`(pinned_at DESC NULLS LAST, lm.created_at DESC NULLS LAST, c.id)` — тот же
порядок, что уже стоит в `chatsrepo.go:186-228`. Отдельный `COUNT(*)` по тем же
фильтрам для `count`. Без параметров поведение прежнее (весь список), чтобы
переходный период ничего не ломал. Redis-кэш (`dialogscache.go`) сейчас держит
полный список — становится источником для нарезки страниц.

**Воркер.** `dialogsStorage.getDialogs({offsetIndex, limit, filterId})` с
контрактом tweb `{dialogs, count, isEnd}`: отдаёт срез из кэша, при нехватке
идёт в сеть за следующей страницей. `helpers/sequentialCursorFetcher.ts` —
вендор tweb 1:1. Папки фильтруются локально (`matchesFolder`), как в tweb, где
`getDialogs(filterId)` фильтрует по локальному индексу папки.

# Этап 3: виртуальный список, DOM и анимации (эскиз)

**Новые файлы:**
```
src/components/virtual/verticalVirtualList.tsx       ← windowing, itemHeight/thresholdPadding/useShouldAnimate
src/components/virtual/deferredSortedVirtualList.tsx ← totalCount, reveal-очередь, shrink, blockAnimation
src/components/virtual/loadingDialogSkeleton.tsx + .module.scss
src/core/hooks/useAnimatedValue.ts                   ← порт createAnimatedValue (120 мс, simpleEasing)
src/helpers/animateValue.ts                          ← довоз simpleEasing (вендор tweb)
```

Форма порта: React, логика 1:1 (те же формулы, константы, пороги, тот же DOM и
классы); сигналы solid перекладываются на React-состояние, строки остаются
`ChatListItem`. Ссылки на строки оригинала — комментариями, как в порте
`components/connectionStatus.ts`.

**Меняется в DOM:** `ul.chatlist` получает `virtual-chatlist` и
`style="height: N*72+8px"`; боковой отступ переезжает с `padding` на `margin` +
`width: auto`; строка получает класс-аналог `_Item_` (`position: absolute;
width: 100%`), `style="top: Npx"` и `--background` на время движения;
`ArchiveRow` становится pinned-элементом внутри списка (аналог
`CustomPinnedDialog`); появляется `LoadingDialogSkeleton`; на каждую папку —
свой скроллер и свой `ul` (причина прежнего отступления — «N копий по M строк не
потянем», `ChatList.tsx:76-79` — снимается виртуализацией).

# Этап 4: остальные списки (эскиз)

`SearchView` (itemSize 72) и `TopicsPanel` (itemSize 64) переезжают на то же
ядро. Монофорума и ботфорума у нас нет — портировать нечего.
