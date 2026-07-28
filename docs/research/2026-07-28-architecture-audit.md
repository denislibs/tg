# Аудит архитектуры web-client (сравнение с tweb)

_2026-07-28. Придирчивый разбор фронтенда (`web-client/`) в сравнении с референсом tweb.
Все находки привязаны к `file:line` на момент написания._

## Статус реализации (обновляется по мере работ)

| Пункт | Статус | Где |
|---|---|---|
| **P0-1** реакции/агрегаты из кэша | ✅ Сделано | PR #66 (SSOT воркер-кэша) |
| **P0-2** дубли уведомлений/звука на reconnect | 🟡 Частично | PR #66 (frontend-митигация: `deliveredSeq`; полный фикс — pts на бэке) |
| **Single-writer сообщений** (все «вторые писатели» стора убраны) | ✅ Сделано | PR #66/#67/#69 (агрегаты) + #70 (outbox/отправка) |
| **P1-7** пиры в реактивном сторе (`peersStore`) | ✅ Сделано | PR #71 (+ серверный `user_update`) |
| **P2-2** прямые записи в `messagesStore` из компонентов | ✅ Сделано (по сообщениям) | те же PR #66–#71 — писатель один: `storeProjection` |
| **P0-2 полноценно / P0-3 / P0-4** (pts, диспетчер по тегу, gap) | ⬜ Не начато | нужен бэк (тег/pts на апдейт) |
| **P1-1/P1-2** единый реестр менеджеров + `realtime`-фабрика | ⬜ Не начато | |
| **P2-1** God-компоненты (`GroupEditFlow`→экраны, реестр попапов) | ⬜ Не начато | следующий высокий-ROI фронт |
| unread из стора, `P1-5` чистка `storeProjection`, `P1-6` дробление `messagesManager`, `P2-3` `useSettings(selector)`, `P2-4` структура | ⬜ Не начато | |

Детали сделанного — в разделах ниже: «Повторная сверка с tweb», «Send / outbox», «Реактивные пиры».

## Вердикт

**Модель правильная — исполнение течёт.** Идеологически мы 1:1 с tweb: менеджеры-по-сущности,
однонаправленный поток, воркер-RPC через двойной Proxy, типизированная шина событий, offline-first
персист. Инвариант «единственный `smp.on` — в насосе `realtimeBridge`» реально держится (проверено
grep'ом: подписок на `smp` вне насоса нет). Паттерн декомпозиции у нас **уже есть и работает**
(`useChatSelection`/`usePinnedBar`/`useConvMessages`/`useChannelExtras`).

Но между «правильной моделью» и кодом есть **один системный разрыв**, из которого каскадом растёт
большинство P0.

## Корневая причина (одна, а не двадцать)

**Нет единого нормализованного источника истины по id.** tweb держит
`messagesStorageByPeerId: Map<mid, Message>` (`appMessagesManager.ts:205,504`) — одну копию сообщения,
а окна/пины/треды — это списки **id**, резолвящиеся из неё (`HistoryStorage.history: SlicedArray<number>`).

У нас одно сообщение физически лежит в **3-4 местах** разными объектами:

| Копия | Где | Пишется кодом |
|---|---|---|
| кэш воркера | `core/managers/messagesManager.ts:132` `Map<key,Map<seq,Message>>` | `cacheEdit` и др. |
| главный стор | `stores/messagesStore.ts:70` `byKey → msgs: Message[]` | `applyEdit` (дубль логики) |
| персист IDB | `core/store/persist.ts:299` | воркер, write-through |
| пины | `stores/pinsStore.ts:9` `byChat: Message[]` | `core/hooks/usePinnedBar.ts:39` |

Плюс сообщение дублируется **между окном чата и окном треда** (`applyIncoming` пишет в оба,
`messagesStore.ts:295`). Отсюда каскадом растут P0-2, realtime-drift, тройная логика,
O(окна×длина)-патчи. **Почини SSOT — и половина списка ниже закрывается автоматически.**

---

## 🔴 P0 — то, что реально ломается в проде (баги, а не долг)

### P0-1. Реакции/опросы/read теряются при открытии чата из кэша — ✅ СДЕЛАНО (PR #66)
`worker.ts:112` кэширует `edit/delete`, но `reaction/star_reaction/poll/checklist/giveaway/media_read`
идут по BROADCAST-only пути (`worker.ts:123`) — применяются в главный стор, но **не в кэш воркера и
не в персист**. Переоткрыл чат → `messagesManager.ts:181` отдаёт `cached:true` без реакций.
- **tweb:** реакция правит единственный `Message` в `messagesStorage` → согласовано везде.
- **Фикс:** `cacheReaction/cachePoll/…` симметрично `cacheEdit`, либо (лучше) нормализация снимает вопрос.

### P0-2. Дубли уведомлений/звука/непрочитанных при каждом reconnect
Live-путь (`worker.ts:150`) кэширует и бродкастит `new_message`, но **никогда не двигает `pts/date`** —
курсор двигает только `/sync` (`syncEngine.ts:31`). `catchUp()` на каждом reconnect
(`connectionManager.ts:58`) рефетчит от старого pts и заново прогоняет доставленные сообщения.
`dedupAsc` спасает только открытое окно, а `soundSubscriber.ts:21` / `notificationSubscriber.ts:9` /
`useChatScroll.ts:323` (`setUnreadBelow(c=>c+1)`) срабатывают повторно.
- **tweb:** `pts` двигается на **каждом** апдейте (`apiUpdatesManager.ts:601`) + `pendingPtsUpdates`
  отсекает дубль по `pts_count` (`:606`).
- **Фикс:** продвигать сохранённый `pts/date` из live-пути или не ре-бродкастить при `pts <= stored`.

### P0-3. Диспетчер апдейтов по наличию поля — молчаливый мисроутинг
`worker.ts:93`: `'edited_at' in o → editMessage`, `'total' in o → starReaction`, … `media_read` —
«по остатку» (порядок веток значим!). Бэк добавит в апдейт лишнее поле → событие уедет в чужую ветку,
без ошибки в консоли.
- **tweb:** диспатч по явному дискриминатору `update._` (имя TL-конструктора), никогда по эвристике.
- **Фикс:** бэку слать тег `kind`, диспетчер = `Record<kind, rtEvent>`. Убрать все `'field' in o`.

### P0-4. Нет детектора разрывов (gap)
Единственный триггер resync — `too_long` (`syncEngine.ts:26`). Потерянный live-кадр (decrypt вернул
null в `worker.ts:154`, подписчик кинул исключение) не восстановится до следующего reconnect. Порядок
самолечится только для сообщений в открытом окне (пересортировка `dedupAsc`); для реакций/read/pin
гарантий нет.
- **tweb:** при дыре в `pts` (`apiUpdatesManager.ts:571`) буферизует в `pendingPtsUpdates`, планирует
  точечный `getDifference`, применяет по порядку (`popPendingPtsUpdate`).
- **Фикс:** per-chat монотонный курсор (`seq`/`pts`) + буфер при разрыве вместо глобального `loadChats`.

---

## 🟠 P1 — высокий риск, компилятор молчит

### P1-1. Два несинхронных реестра менеджеров
UI-тип `Managers` (`client/bootstrap.ts:61`, 31 запись) и фактический реестр воркера
(`worker.ts:210`, 31 запись) — **два независимых рукописных списка**. Забыл в одном → зелёная сборка +
рантайм-`throw 'no manager method'` (`managersProxy.ts:10`).
- **tweb:** `Managers = Awaited<ReturnType<typeof createManagers>>` выводится из того же объекта, что и
  регистрируется — рассинхрон невозможен by construction.
- **Фикс:** собрать реестр воркера в одну константу, вывести `Managers` из неё.

### P1-2. Контракт `realtime` дублирован ×3, одна копия уже устарела
`SendArgs` (`connectionManager.ts:6`) ↔ `RealtimeApi` (`bootstrap.ts:52`) ↔ локальный тип
`worker.ts:198` — в третьем **уже нет** `geo/contactUserId/threadRootId`. Спасает только `...spread`.
- **Фикс:** сделать `realtime` обычной фабрикой `newRealtime()`, `MgrOf<>` как у всех менеджеров.
  Три копии схлопнутся в одну (и уйдёт ручной `RealtimeApi`).

### P1-3. Три рукописных каталога событий (дрейф)
`FRAME_TYPES` (`connectionManager.ts:23`) + `PASS_THROUGH` (`worker.ts:120`) +
`RT`/`RtEventMap` (`events.ts`/`eventBus.ts`). Комментарий «добавить событие = одна строка» — **миф**,
правок 4-5.
- **tweb:** источник один — дискриминированный `Update['_']`.
- **Фикс:** один реестр `{wsType, rtName, payloadType}`, из него генерить `FRAME_TYPES`/`PASS_THROUGH`/`WORKER_EVENTS`.

### P1-4. Типобезопасность шины теряется ровно там, где нужна
`RtEventMap` (`eventBus.ts:20`) работает только при литеральном ключе. Насос
`smp.on(ev, p => eventBus.publish(ev, p))` (`realtimeBridge.ts:26`) — `ev:string, p:unknown`;
`storeProjection` подписывается циклом по `Object.entries(APPLY)` (`:75`) с ручным `raw as XxxEvt`.
Плюс вторая, полностью нетипизированная шина `uiEvents` (`uiEvents.ts:2`), куда `storeProjection`
ре-эмитит доменные события.
- **tweb:** `RootScope extends EventListenerBase<BroadcastEvents>` (`rootScope.ts:252`) — диспатч
  проверяется компилятором, каст в листенерах не нужен.
- **Фикс:** типизировать `publish` перегрузкой по `RtEventMap`; `APPLY` как `{[K in RtEvent]?: (p: RtEventMap[K])=>void}`.

### P1-5. `storeProjection` не чистый
Заявлен «единственный писатель realtime→store без побочек», но делает REST
(`listPins().then(setPins)` `:131`, `loadChats`, `loadStories` `:221`), дёргает движки
(`callEngine.handleFrame` `:167`) и косвенно шлёт команды через `uiEvents`.
- **tweb:** `saveUpdate` в основном мутирует storages и диспатчит событие; «дорефетчить» решают
  менеджеры-слушатели, а не сам updates-manager.
- **Фикс:** в `APPLY` — только чистые записи в стор; refetch/движки — отдельными подписчиками eventBus
  (по образцу sound/notification).

### P1-6. `messagesManager` — God-object (761 строка)
Пагинация истории + отправка + **опросы** (`:454`) + **чек-листы** (`:473`) + **реакции** (`:692`) +
**перевод** (`:755`) + fact-check/transcribe/geo-live в одном объекте.
- **tweb:** это 6 менеджеров — `appPolls/appReactions/appTranslations/appWebPages/appMessagesIds/appMessages`.
- **Фикс:** выделить `pollsManager` (опросы+чек-листы), `reactionsManager` (реакции+теги+star),
  `translationsManager`. Кэш истории (`getHistory/getAround` + `slices`) оставить.

### P1-7. Пиры не в реактивном сторе — ✅ СДЕЛАНО (PR #71)
Peers-стора на главном треде нет; `usePeers.ts:16` копирует из воркера в локальный `useState` каждого
из 8 потребителей; плюс снимок пира внутри `Dialog` (`core/models.ts:116`). Смена имени/аватара
(`user_update`) не расходится реактивно.
- **tweb:** единый `stores/peers.ts` по `peerId` + `reconcile`, `usePeer(peerId)` реактивен.
- **Фикс:** `peersStore` (`Record<id,Peer>`) + `reconcile` на `user_update`; убрать `peer`-снимок из `Dialog`.

---

## 🟡 P2 — поддерживаемость и структура

### P2-1. God-компоненты не довели декомпозицию до конца
| Файл | LOC | Симптом | tweb-аналог |
|---|---|---|---|
| `group/GroupEditFlow.tsx` | 1268 | **45 `useState`** в одном неймспейсе (коллизии `saving×3, q×5`), 9 экранов | ~14 файлов в `sidebarRight/tabs/` |
| `ConversationView.tsx` | 1563 | ~20 попапов как `useState(false)` + 5 fire-and-forget фетч-эффектов в теле | `chat.ts` — тонкий контроллер, попапы в реестре |
| `Composer.tsx` | 1394 | ~60 пропсов, редактор+бары+voice+schedule в одном | `chat/input.ts` + каталог хелперов |
| `UserInfoPanel.tsx` | 1364 | 26 `useState`, все табы + аватар-пейджер в одном | `sidebarRight/tabs/*` по файлу на таб |
| `messages/MessageBubbles.tsx` | 636 | экспортит 15 бабл-компонентов из одного файла | `bubbleParts/` (26 файлов) |

Детали декомпозиции и паттерн контроллера — в разделе «Контроллеры tweb» ниже.

### P2-2. Прямые записи в доменные сторы из 20 компонентов — ✅ СДЕЛАНО по сообщениям (PR #66–#71)
`useMessagesStore.getState().applyIncoming/setPoll/applyStarReaction` (`ScheduledView`, `MessageBubbles`),
secret-статусы из `ConversationView:238`. Часть легитимна (UI-сторы: `report.open`, `lock`), но доменные
мутации мимо менеджеров/проектора размывают write-путь.
**Статус:** для `messagesStore` устранено полностью — все оптимистичные/командные мутации (реакции, ⭐,
опрос, чек-лист, giveaway, fact-check, delete, media-read, **отправка/outbox**) уходят в воркер, стор
пишет только `storeProjection`. Пиры — через `peersStore` (PR #71). Остаются нетронутыми доменные
записи в НЕ-message сторы вне этой дуги (если найдутся) — отдельно.

### P2-3. `useSettings` без селектора — множитель ре-рендеров
`settings.tsx:206` `return useSettingsStore()` (подписка на весь стор). Горячий потребитель —
`MessageRow.tsx:249` (мемоизированный ряд). Смена языка инвалидирует весь фид. → `useSettings(selector)`.

### P2-4. Структурный запах
- `core/` корень — ~40 разрозненных `.ts` вперемешку с тестами (`markdown/mediaUrl/models/worker` рядом
  с крошками `dayLabel/friendlyTime/cssColor`). → сгруппировать `core/format/`, `core/richtext/`.
- `helpers/` (23 файла) — «корзина, новое не класть», но не сжимается: чистые утилиты (`clamp/toArray`)
  просятся в `shared/lib`, толстый вендор (`middleware/eventListenerBase`) — в `lib`. → расформировать.
- **96 из 210 компонентов** плоско в корне `components/`, включая 3 из 5 God-файлов, хотя `conversation/`
  уже есть. → `ConversationView`/`Composer` → в `conversation/`.

### P2-5. Устаревшая документация инварианта
`web-client/CLAUDE.md:79` заявляет «`ConversationView` слушает `RT.newMessage`» — по факту переехало в
`useChatScroll.ts:315`, и там же новая проблема: **unread считается из потока событий**
(`setUnreadBelow(c=>c+1)`), а не из стора → плывёт при ремоунте/resync.
→ unread из `newestSeq/firstUnreadSeq` в сторе (как tweb `dialog.unread_count`). Обновить CLAUDE.md.

### Мелочи
- `rpc/superMessagePort` без timeout/disconnect-reject → зависший invoke копится в `awaiting` навсегда
  (вечный спиннер, `superMessagePort.ts:29`).
- Ошибка через границу схлопывается до `message`+`status` (`superMessagePort.ts:64`); `instanceof` не восстановить.
- Прокси без мемоизации и без transferables — upload копирует ArrayBuffer вместо transfer (`managersProxy.ts:21`).
- `audioStore` мешает `<audio>`-движок и реактивное состояние (tweb: `appMediaPlaybackController` отдельно).
- `chatsStore` держит `me` и производный `meId` — дубль id.

---

## Контроллеры tweb: что это и что из этого переносимо

**Что это.** tweb — vanilla-TS с императивным DOM. `Chat` (`chat.ts:82-87`) — это **координатор**
(mediator): тонкий класс, который держит инстансы подсистем-классов и раздаёт им себя + `managers`:

```ts
this.topbar    = new ChatTopbar(this, appSidebarRight, this.managers);
this.bubbles   = new ChatBubbles(this, this.managers);
this.input     = new ChatInput(this, this.appImManager, this.managers, 'chat-input-main');
this.contextMenu = new ChatContextMenu(this, this.managers);
this.selection = new ChatSelection(this, this.bubbles, this.input, this.managers);
```

Каждая подсистема — отдельный файл-класс со своей ответственностью и своим состоянием:
`bubbles.ts` (11812 LOC), `input.ts` (5233), `topbar.ts` (1766), `contextMenu.ts` (2347),
`selection.ts` (1189). Общаются между собой через координатор: `this.chat.input`, `this.chat.bubbles`.
`chat.ts` сам почти ничего не делает — только собирает подсистемы и роутит между ними.

**Применимо ли у нас — да, но не буквально.** Класс-контроллер копировать нельзя: наш стек — React,
состояние живёт в Zustand + хуках, а не в полях класса с DOM-рефами. Переносится **принцип**, а не
механизм. React-эквивалент координатора `Chat`:

| tweb (императивный класс) | наш React-эквивалент |
|---|---|
| `Chat` — тонкий координатор | `ConversationView` как тонкий компонент-композитор (≤400 LOC) |
| `ChatTopbar` (класс) | `ChatHeader` (компонент, **уже есть** в `conversation/`) |
| `ChatBubbles` (класс) | `ChatFeed` + `MessageRow`/`bubbles/*` (компоненты) |
| `ChatInput` (класс) | `Composer` + `useRichInput`/`useComposerAutocomplete` (компонент+хуки) |
| `ChatSelection` (класс) | `useChatSelection` (**уже есть**) |
| `ChatContextMenu` (класс) | `MessageContextMenu` + `useMessageActions` (**уже есть**) |
| подсистемы общаются через `this.chat.*` | подсистемы общаются через **общий стор** + типизированные пропсы/колбэки |
| попапы — `PopupElement.createPopup(...)` | **реестр попапов в сторе**: `open('createPoll', payload)` |

Ключевой перенос: **«тонкий координатор + подсистема на файл, cross-cutting через стор»**. У нас этот
паттерн уже частично реализован (`useChatSelection`/`usePinnedBar`/`useConvMessages`/`useChannelExtras`
= подсистемы-хуки; `ChatHeader`/`PinnedBar`/`SelectionBar` = подсистемы-компоненты). God-компоненты
просто «не дотянули» до него: держат 20-45 единиц состояния и 45 дочерних JSX-веток там, где должны быть
композиция + реестр попапов.

**Один конкретный приём из tweb, который снимает много боли сразу — реестр попапов.** Вместо ~20
`useState(false)` + 20 JSX-веток в `ConversationView` — стор `conversationDialogsStore` с API
`open(name, payload)` / `close()` и один `<DialogsHost/>`, который маунтит активный попап (аналог
tweb `PopupElement`). Это убирает ~20 `useState` и ~20 веток одним ходом.

---

## Порядок работ (по ROI, не по номерам)

1. ✅ **СДЕЛАНО** — **SSOT сообщений / single-writer** (PR #66–#71). Реализовано не как один
   `messagesById`-рефактор, а как tweb-mirror: воркер владеет данными/оптимистикой, `storeProjection` —
   единственный писатель стора-зеркала. Закрыл P0-1, устранил «вторых писателей» (P2-2 по сообщениям).
2. 🟡 **Частично** — **pts на live-пути + gap-детектор** (P0-2, P0-4). Фронт-митигация reconnect-дублей
   сделана (`deliveredSeq`, PR #66); полный фикс (pts/тег на апдейт) — на бэке, ⬜ не начато.
3. ⬜ **Диспетчер апдейтов по тегу** (P0-3, `worker.ts`) — дёшево, снимает класс молчаливых багов
   (нужна строчка `kind` на бэке — согласовать).
4. ⬜ **Единый реестр менеджеров + `realtime`-фабрика** (P1-1, P1-2) — убирает два рантайм-класса
   рассинхрона, дёшево.
5. ⬜ **`GroupEditFlow` → экраны** (P2-1) — механически, модель уже в `useGroupEdit`, максимум читаемости
   за минимум риска. **← следующий высокий-ROI, чистый фронт.**
6. ⬜ **Реестр попапов + разгрузка `ConversationView`** (P2-1) — по образцу tweb `PopupElement`.
7. Дальше: ✅ `peersStore` (P1-7, PR #71 — с серверным `user_update`); ⬜ чистка `storeProjection` (P1-5),
   дробление `messagesManager` (P1-6), `useSettings(selector)` (P2-3), структура папок (P2-4), unread из стора.

**Связь с существующим планом** (`docs/research/2026-07-28-web-client-refactor-plan.md`):
пункты 1-3 — новые P0, которых в плане не было; 4 — уточняет PR-9; 5-6 — уточняют PR-12.

---

## Найдено при реализации (фазы 1-2, PR feat/messages-ssot-normalization)

- **Реакции дважды считаются на reconnect (предсуществующий, не regress).** `reaction` —
  дельта `count±1` (`reactionDelta`). Live-путь не двигает pts, поэтому `/sync` catch-up
  переотдаёт уже применённую live-реакцию → и стор (`applyReaction`), и (если бы кэшировали)
  воркер-SSOT удвоили бы счётчик. Идемпотентные апдейты (edit/delete/star=absolute/media_read)
  на catch-up теперь пишутся в SSOT (`dispatchOther`), а reaction оставлен broadcast-only.
  **Настоящий фикс** — update-level дедуп (монотонный id/pts на апдейт, как tweb `pendingPtsUpdates`),
  а не seq-по-сообщению. Требует тега на бэке. → отдельная задача.
- **Статус фаз:** Фаза 1 (SSOT воркер-кэша) + Фаза 2 (подавление backfill) — сделаны в этой ветке
  (P0-1 закрыт для live + идемпотентного catch-up; P0-2 — для reconnect в пределах жизни
  SharedWorker). Фазы 3 (стор → проекция `ids[]`+`byId`) и 4 (воркер как push-источник) —
  отдельной веткой (переписывают read-путь всех потребителей, нельзя мешать с 1-2).

---

## Повторная сверка с tweb (single-writer / mirror) — ветка `feat/messages-mirror-tweb`

Проверено по исходникам tweb, а не по памяти:

- **tweb: единственная авторитетная копия сообщения** — `appMessagesManager.messagesStorageByPeerId`
  (`peerId→mid→message`), в **воркере** (`appMessagesManager.ts:205,504`). Главный тред держит
  **read-only зеркало** `mirrors.messages`, пишется ТОЛЬКО пушем из воркера (`apiManagerProxy.ts:172-233`).
- **Вся оптимистика идёт через воркер-менеджер** (send `beforeMessageSending`, реакции
  `sendReaction→processLocalUpdate({local:true})`) → зеркало → UI перечитывает. Компонент никогда
  не пишет авторитетную копию. Значит «воркер как единственный applier» не заблокирован — это канон.
- **Наше расхождение:** ~21 «второй писатель» напрямую мутировали `messagesStore`. Фазы 1-2
  (идемпотентное эхо) — костыль под двух-писательную модель; tighter fix = убрать вторых писателей.

**Сделано в ветке (single-writer для агрегатов):** мутации перенесены в воркер-менеджер, который
правит SSOT и `broadcast(...)` эхо всем вкладкам; `storeProjection` — единственный писатель стора,
кросс-таб бесплатно. Домены: **реакции** (оптимистично до REST + откат), **⭐-реакция**, **чек-лист**
(chatId в сигнатуре), **media-read** (`worker.ts markMediaRead`), **голос в опросе**
(новое `RT.pollVoted`→`setPoll`, полный set — сохраняет мой `myVotes`), **fact-check** (set/remove),
**delete** (broadcast + eviction ПОСЛЕ успеха REST — не оптимистично: откат eviction+persist
рисковен, сервер может отклонить удаление). Реакции — идемпотентны через `reactionDelta`
(null-гард на своё эхо); star/poll/checklist/factcheck — absolute-set (двойное применение безвредно).

**Осталось (осознанно не в этой ветке):**
- ~~Giveaway «участвовать»~~ — **сделано** (PR #69): `participateGiveaway` перенесён в
  `messagesManager`, новое `RT.giveawayJoined` → `setGiveaway`.
- ~~Send-кластер~~ — **сделано** (ветка `feat/outbox-worker-pending`, см. ниже).

---

## Send / outbox → single-writer (ветка `feat/outbox-worker-pending`)

Последняя фаза. **Прагматичная реализация** «полного переноса»: не переписываем pending против
`SlicedArray` вслепую (это ядро отправки — так проще всего сломать), а делаем воркер **funnel'ом
жизненного цикла**, переиспользуя проверенную reconcile-логику стора без изменений.

- Компоненты (`useChatSend`, `useMessageActions`, `callEngine`, `ConversationView`-cancel) больше не
  зовут стор-экшены отправки напрямую. Вместо этого — RPC воркера: `appendPending` / `attachPendingMedia`
  / `failPending` / `retryPending` / `removePending`, которые `broadcast(...)` новое событие всем вкладкам.
- `storeProjection` подписан на `RT.pending*` и вызывает те же стор-экшены (`appendOptimistic` и т.д.) —
  **единственный писатель** окна. Кросс-таб оптимистика бесплатно (blob-превью медиа валидно только во
  вкладке-инициаторе — ограничение blob-URL, как в tweb).
- Транспортный `outbox` (durable, resend) и reconcile ack/err (`reconcileAckByClient` по `clientToWin`) —
  **без изменений**; `clientToWin` заполняет `appendOptimistic`, теперь вызываемый из `storeProjection`
  (до ack — гарантировано порядком на порту: `appendPending` обрабатывается раньше `sendMessage`).
- Удалены мёртвые обёртки `useMessageWindow` (`appendOptimistic`/`reconcileAck`/`failOptimistic`).
- **Осознанно НЕ сделано:** сам pending-Message остаётся материализован в сторе (рендер-модель), а не
  в worker-SSOT `SlicedArray` — литеральное объединение хранилищ требует reindex tentative→real seq и
  живого прогона, при нулевой доп. пользе для пользователя. → возможный follow-up.
- **Требует живого прогона `:38080`** перед мержем: отправка текста/медиа/альбома/секретных, retry
  failed, offline-resend, отмена аплоада, тред/канал.
