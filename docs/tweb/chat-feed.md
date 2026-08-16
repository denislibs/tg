# Лента чата (ChatBubbles): поведенческий референс tweb

Снято 2026-08-16. Источники:

- исходники tweb `/Users/denisurevic/Documents/tweb` (все `файл:строка` ниже — по нему);
- наш код `web-client/` на `main`.

> Важно: локальный tweb — форк оригинала (см. дисклеймер в
> [right-sidebar.md](right-sidebar.md)).
> Номера строк — по форку; часть комментариев в коде — форк-специфика (PiP-окно,
> reflow-якорь, botforum/monoforum), она помечена по ходу.

Смежные доки (здесь не дублируются):

- [2026-08-10-architecture-divergence-tweb.md](../research/2026-08-10-architecture-divergence-tweb.md) —
  общий разбор расхождений (Ф5 = «неограниченный рост DOM vs прюнинг», варианты стратегии порта);
- `web-client/CLAUDE.md`, раздел «Скролл» — что из скролл-механики уже портировано 1:1
  (Scrollable / ScrollSaver / stickyIntersector / fastSmoothScroll) и инвариант
  «единственный владелец записи scrollTop».

Структура: 8 частей по tweb + часть 9 «у нас» (главные структурные расхождения).

---

# Часть 1. Каркас: Chat → ChatBubbles → Scrollable

## 1.0 Карта файлов

| Путь | Роль |
|---|---|
| `src/lib/appImManager.ts` | владелец **стека** `Chat`-инстансов (`chats[]`), `setInnerPeer`/`setPeer`, сохранение позиций (`chatPositions`) |
| `src/components/chat/chat.ts` | `Chat` — контейнер одного чата: topbar + bubbles + input + selection + contextMenu; `setPeer`/`finishPeerChange`; распорки-паддинги; фоны |
| `src/components/chat/bubbles.ts` | `ChatBubbles` (11.8k строк) — вся лента: история, рендер, скролл,観察еры, апдейты |
| `src/components/scrollable.ts` | `Scrollable` — тонкая обёртка скролл-контейнера: throttled `onScroll`, триггеры краёв, `loadedAll` |
| `src/helpers/scrollSaver.ts` | `ScrollSaver` — сохранение позиции по DOMRect якорного бабла |
| `src/helpers/dom/getViewportSlice.ts` | разбиение баблов на invisibleTop / visible / invisibleBottom |
| `src/components/chat/bubbleGroups.ts` | `BubbleGroups`/`BubbleGroup` — сортированная модель ленты, серии сообщений, монтирование в date-группы, аватары |
| `src/components/chat/messageRender.ts` | время/статус в бабле (`MessageRender.setTime`) |
| `src/components/stickyIntersector.ts` | sticky-даты через 2 IntersectionObserver (sentinel + сам контейнер) |
| `src/helpers/dom/superIntersectionObserver.ts` | один IO на много колбэков (`observe(el, callback)`) |
| `src/components/lazyLoadQueue.ts` | очередь загрузки медиа с VisibilityIntersector |
| `src/components/animationIntersector.ts` | глобальный реестр анимаций (стикеры/видео): play/pause по видимости и группам |
| `src/components/chat/selection.ts` | `ChatSelection` — режим выделения (чекбоксы на баблах) |
| `src/components/chat/input.ts` | кнопка go-down + badge (`goDownBtn`, `setUnreadCount`) |

## 1.1 Стек чатов (appImManager)

- `chats: Chat[]` — стек; `createNewChat()` (`appImManager.ts:2658`) создаёт инстанс и
  пушит; активный — верхний.
- `setInnerPeer(options)` (`:2831`): если чат с таким `peerId+threadId+type` уже в стеке —
  `spliceChats(existingIndex + 1)` (срез всего, что выше) и `setPeer` в него; иначе — если
  текущий чат `inited`, создаётся **новый** `Chat` поверх (открытие треда/комментов кладёт
  чат на стек, а не заменяет). Диспатчится `chat_changing {from, to}`.
- На `peer_changing` `appImManager` сохраняет позицию покидаемого чата —
  `saveChatPosition(chat)` (`:378-383`, `:2111`), см. §4.8.
- `Chat`-инстансы **переиспользуются** между пирами (см. divergence-док, Ф-«tweb
  переиспользует инстансы»): смена чата в том же столбце = `chat.setPeer` с другим peerId.

## 1.2 DOM-каркас

`Chat.init()` (`chat.ts:608-829`) один раз строит подсистемы:

```
div.chat.tabs-tab                        (chat.container)
  ├ topbar.container
  ├ div.bubbles                          (bubbles.container, class 'scrolled-down' изначально)
  │   ├ div.bubbles-remover-container > div.bubbles-remover.bubbles-inner   ← «морг» анимируемо удаляемых баблов
  │   ├ div.scrollable.scrollable-y.bubbles-scrollable   (scrollable.container)
  │   │   ├ div.bubbles-padding.bubbles-padding-top      ← верхняя распорка (высота = chatPaddingTop)
  │   │   ├ div.bubbles-inner            (chatInner) ← section.bubbles-date-group* ← div.bubbles-group* ← div.bubble*
  │   │   └ div.bubbles-padding.bubbles-padding-bottom
  │   └ div.bubbles-floating-separators-container
  ├ div.bubbles-viewport.disable-hover   (chat.bubblesViewport — «видимая зона» для расчётов скролла)
  └ chat-input
```

- `constructBubbles()` — `bubbles.ts:1439-1458`; `setScroll()` — `bubbles.ts:4169-4232`:
  `new Scrollable(null, 'IM', 300)`, `onAdditionalScroll = this.onScroll`,
  `onScrolledTop/Bottom = () => loadMoreHistory(true/false)`.
- Распорки-паддинги: `chat.recomputePaddings()` (`chat.ts:345-365`) — 4.5rem сверху /
  4rem снизу (float-topbar и инпут лежат ПОВЕРХ ленты), плюс высота пин-плашки
  (`updatePinnedFloatingHeight`, `:286-304` — рост верхней распорки в середине истории отдан
  **нативному scroll anchoring**, ре-пин руками только когда были у низа) и «излишек» инпута
  (`updateChatInputHeight` + `preservePaddingScroll` `:306-335` — 250мс цикл прижатия к низу,
  пока инпут анимируется; отменяется `cancelPreservePaddingScroll` перед reveal нового
  сообщения, `bubbles.ts:4591-4599`).

## 1.3 Scrollable (`scrollable.ts`)

| Член | Стр. | Поведение |
|---|---|---|
| `onScroll` | 210-244 | throttle: rAF (или 24мс setTimeout при overlay-scroll); считает `lastScrollDirection` (−1/0/1), `lastScrollPosition`; зовёт `onAdditionalScroll`, затем `checkForTriggers` |
| `checkForTriggers` | 433-457 | `scrollPosition <= onScrollOffset (300)` и направление ≤0 → `onScrolledTop()`; симметрично низ → `onScrolledBottom()`. **`loadedAll` внутри не читается** — гейтит колбэк (`loadMoreHistory`) |
| `loadedAll: {top, bottom}` | 374 | флаги «край истории загружен», пишет только `bubbles.setLoaded` |
| `setScrollPositionSilently(v)` | 347-352 | запись scrollTop без собственного scroll-события (`ignoreNextScrollEvent` — one-shot capture-cancel, 354-362) |
| `getDistanceToEnd` / `isScrolledToEnd` | 315-321 | расстояние до низа; «у низа» = ≤1px |
| `replaceChildren` | 364-367 | атомарная замена содержимого (используется при mount нового чата) |
| heavy-animation | 146-160, 217-221 | во время тяжёлой анимации измерение отменяется, `needCheckAfterAnimation` — доизмерить после |

## 1.4 `setPeer` — полная последовательность открытия чата

Вход: `appImManager.setPeer` → `chat.setPeer(options)` (`chat.ts:1018-1133`):

1. Ленивый `init()` при первом использовании инстанса; `samePeer = isSamePeer(...)`.
2. Не samePeer: `dispatchEvent('peer_changing')` (→ appImManager сохраняет позицию старого),
   **синхронный** флип `peerId/threadId`, `middlewareHelper.clean()` (все висящие
   асинхронщины старого пира протухают), пересоздание Solid-руты (`usePeer` и т.п.).
3. Пересчёт `messagesStorageKey`/`historyStorageKey` (`changeHistoryStorageKey`, `:1135`).
4. `bubbles.setPeer({...options, samePeer, sameSearch})` — вся остальная работа; его
   промис становится `chat.setPeerPromise`.

`ChatBubbles.setPeer` (`bubbles.ts:5036-5568`), нумерация — фактический порядок:

1. `tempId = ++setPeerTempId`; `middleware = () => setPeerTempId === tempId` — единственный
   механизм отмены гонки открытий. `!peerId` → `cleanup(true)` и выход.
2. `!samePeer` → `await chat.onChangePeer(options, m)` (`chat.ts:881-995`): пачка флагов
   (isBroadcast/isMegagroup/isBot/…), создание shared-media-таба.
3. Вычисление целей (`:5068-5153`):
   - `lastMsgFullMid` — из `options.lastMsgId` (прыжок к сообщению), иначе `EMPTY`;
   - `topMessageFullMid` — `historyStorage.maxId`;
   - `savedPosition = appImManager.getChatSavedPosition(chat)` (только не samePeer и не target);
   - если нет target и нет savedPosition: `readMaxId = getReadMaxIdIfUnread(...)`; при
     непрочитанных (`unread_count !== 1`) → `followingUnread = true`,
     `lastMsgFullMid = readMaxId`, а `overrideAdditionMsgId = slice[offset − 25]` — чтобы под
     разделителем было ~25 сообщений снизу;
   - `isJump = lastMsgFullMid !== topMessageFullMid`.
4. **samePeer && sameSearch** и целевой бабл уже смонтирован (`:5155-5200`): без перезагрузки —
   `scrollToBubble(bubble, 'center')` + `highlightBubble`, либо `scrollToEnd()`;
   `followStack.push(stack)` если пришли «из ответа». Выход (`return null`).
5. Иначе: новый `lazyLoadQueue.queueId` (сброс приоритетов загрузки медиа), `followStack = []`.
6. `additionalMid` (`:5219`) — при заходе «в самый низ» topMessage добавляется отдельным
   немедленным рендером (см. §2.3 isAdditionRender).
7. `cleanup()` (`:4913-5012` — обнуляет ВСЁ: bubbles-map, bubbleGroups, dateMessages,
   observer'ы, unreaded-сеты, batchProcessor, loadedAll=false) и **новый** `chatInner`
   (старый ещё в DOM — старый чат виден, пока грузится новый). `lazyLoadQueue.lock()`.
8. Расчёт «куда скроллить»: `scrollFromDown` (samePeer, снизу), `scrollFromUp`,
   `haveToScrollToBubble`.
9. Загрузка админ-рангов для мегагрупп (`:5282-5335`).
10. **`getHistory1(lastMsgFullMid, true, isJump, additionalFullMid)`** (`:5337-5344`), либо при
    `savedPosition.mids` — `performHistoryResult({history: savedPosition.mids}, true)` как
    `cached` (`:5345-5353`).
11. Ветка «не кэш» (`:5371-5380`): `await chat.finishPeerChange(...)` →
    `chat.revealPreparedBackground()` (флип обоев синхронно с очисткой) →
    `scrollable.replaceChildren(paddingTop, paddingBottom)` (**старые баблы исчезают**) →
    `preloader.attach(container)` — **прелоадер (спиннер) показывается только на
    некэшированном заходе**; скелетонов у tweb нет вообще.
12. `animationIntersector.lockGroup(animationGroup)`; `promise.then(...)` (`:5383-5556`):
    - `mountedByLastMsgId = getMountedBubble(lastMsgFullMid)`;
    - кэш-ветка: `await chat.finishPeerChange(...)` только теперь (`:5387-5391`);
    - `preloader.detach()`; `resolveLadderAnimation?.()`;
    - `revealPreparedBackground()`; **`scrollable.replaceChildren(paddingTop, chatInner,
      paddingBottom)`** — вся отрендеренная лента монтируется одним DOM-swap'ом;
    - позиционирование (`:5437-5490`):
      * `savedPosition.mids` → `setScrollPositionSilently(savedPosition.top)`;
      * `scrollFromDown` → silently 99999; `scrollFromUp` → `setTopPadding()` + silently 0;
      * целевой бабл: `followingUnread` → `scrollToBubble(firstUnreadBubble, 'start')`;
        target → `'center'` + `highlightBubble`; последний → `scrollToEnd()`;
        не samePeer — `FocusDirection.Static` (мгновенно, без анимации);
      * target не найден → toast `MessageNotFound`;
      * иначе silently 99999 (низ);
    - `onRenderScrollSet()` (класс `has-sticky-dates`, §6.3), `onScroll()`;
    - `afterSetPromise` (setPeer + heavy animation) → `scrollable.onScroll()` (перепроверка
      триггеров), `tryToForceStartParam`;
    - `setFetchReactionsInterval` (каналы: опрос реакций видимых сообщений каждые 10с,
      `:5624-5665`) и `setFetchHistoryInterval` (подписка на канальные апдейты, `:5667`);
      затем если `loadedAll.bottom && !unreaded.size` → `onScrolledAllDown()` (`:5746-5760`) —
      `readHistory({force: true})` (чат без непрочитанных на экране читается сразу);
    - снятие `unread_mark` диалога (`:5545-5555`).

`chat.finishPeerChange` (`chat.ts:1179-1235`): параллельно собирает **колбэки** от
`topbar.finishPeerChange` / `bubbles.finishPeerChange` / `input.finishPeerChange` /
`sharedMediaTab.fillProfileElements` / `handleBackgrounds`, проверяет middleware и применяет
их **синхронно пачкой** — вся шапка/инпут/фон переключаются одним кадром.
`bubbles.finishPeerChange` (`bubbles.ts:5762-5799`) в колбэке ставит классы
`has-rights` / `is-chat` (аватары) / `no-messages` / `is-broadcast` и создаёт ResizeObserver.

---

# Часть 2. Подгрузка истории

## 2.1 Триггеры

- `scrollable.onScrolledTop/Bottom` → `loadMoreHistory(top, justLoad=false)`
  (`bubbles.ts:4004-4045`). Гейты: `setPeerPromise`, `isHeavyAnimationInProgress`,
  уже висящий `getHistoryTop/BottomPromise`, `loadedAll[side]`.
- offset триггера — 300px (`new Scrollable(null, 'IM', 300)`, `:4174`).
- Крайний mid берётся из **отрендеренного** (`getRenderedHistory('asc')`, `:3981-4002` —
  плоский обход `bubbleGroups.groups`), не из стораджа.
- **Преднагрузка**: после каждого успешного `getHistory1` — `setTimeout(() =>
  loadMoreHistory(reverse, justLoad=true), 0)` (`:11342-11357`) — следующая порция качается
  заранее в сторадж, без рендера (`justLoad` — только `scrollable.onScroll()` после).

## 2.2 Сколько грузить (`getHistory`, `:11380-11566`)

```
pageCount     = min(40, windowHeight / 40 | 0)          // ~экран баблов
realLoadCount = broadcast ? 20
              : (естьОтрендеренное ? max(35, pageCount) : pageCount)
backLimit     = isBackLimit ? loadCount : 0             // прыжок: грузим в ОБЕ стороны
                (при !reverse loadCount = 0)
```

`requestHistory(offsetId, limit, backLimit)` (`:10226-10311`) →
`managers.acknowledged.appMessagesManager.getHistory(...)` — **AckedResult**: `cached`
(есть синхронный слайс в воркерном сторадже) + `result`-промис. История в сторадже —
`SlicedArray` (слайсы mid'ов с флагами `SliceEnd.Top/Bottom`).

## 2.3 Мгновенный рендер из кэша (isAdditionRender)

При открытии «в низ» (`additionalFullMid`, `:11425-11453`): если нижний слайс стораджа
`isEnd(Bottom)` — из него берётся `additionalFullMids` (top-message + до `loadCount` кэшированных
mid'ов, последний неполный альбом отфильтровывается), и:

- `result` подменяется на `cached: true` с этими mid'ами → **лента рисуется мгновенно из кэша**;
- настоящий сетевой ответ становится `waitPromise` и дорендеривается вторым проходом;
- «лесенка» (`messagesQueueOnRenderAdditional`, `:11541-11559`) ждёт **оба** прохода
  (`times = 2`) и запускает `animateAsLadder`.

## 2.4 `performHistoryResult(historyResult, reverse)` (`:10037-10165`)

1. `setLoaded('top'/'bottom', true)` из `historyResult.isEnd` (или вычисляется по слайсам
   стораджа: край слайса + его mid в этой порции, `:10071-10098`);
   `setPeerOptions`-хак: если открываемся в низ — `isEnd.bottom = true` сразу.
2. Вставка спонсорских сообщений по счётчику (`:10104-10139`, только каналы).
3. Каждый элемент → `safeRenderMessage({message, reverse, canAnimateLadder: true})`
   (локальные `pFlags.local` → `processLocalMessageRender`).
4. `await Promise.all(promises)`; `await messagesQueuePromise` (батч, §5.2);
   `checkIfEmptyPlaceholderNeeded()`; на `loadedAll.top` — триггер лесенки.

`reverse` — семантика «грузим вверх» (prepend): передаётся в `safeRenderMessage` →
`bubbleGroups`-item, и в `prepareToSaveScroll` — от него зависит якорь ScrollSaver'а
(reverse=true — якорь по верхнему видимому баблу).

## 2.5 prepend/append в DOM

Прямых prepend/append баблов нет: рендер кладёт бабл в **модель** (`bubbleGroups`),
а `processBatch` монтирует группы по индексам (`positionElementByIndex`,
`bubbleGroups.ts:288-320`) внутри своих date-групп. Порядок в DOM — производная от
сортировки items по mid (desc), направление рендера влияет только на сохранение скролла.

---

# Часть 3. Прюнинг / виртуализация DOM

tweb **ограничивает** количество баблов — «slice viewport», два пути.

## 3.1 По скроллу

- `onScroll` → `sliceViewportDebounced()` — debounce **3000мс**, после остановки
  (`bubbles.ts:1411-1413`, `:4059`). Отключено на Safari
  (`DO_NOT_SLICE_VIEWPORT_ON_SCROLL = IS_SAFARI`, `:312` — Safari не умеет тихо переставить scrollTop).
- `sliceViewport` (`:11041-11053`) → `getViewportSlice(useExtra=true)` (`:10988-10996`):
  селектор `.bubbles-date-group .bubble:not(.is-date)`,
  **extraSize = max(700, windowHeight) × 2** (запас по 2 экрана с каждой стороны),
  **extraMinLength = 5** (минимум 5 «невидимых» с каждой стороны переводятся в visible);
- `deleteViewportSlice(slice)` (`:10998-11039`): для срезанной стороны —
  `setLoaded(side, false)` + сброс `getHistoryTop/BottomPromise` (край снова «не загружен»,
  триггеры скролла дозагрузят обратно из воркерного кэша), `ScrollSaver` вокруг удаления,
  `deleteMessagesByIds(fullMids, permanent=false, ignoreOnScroll=true)` — без анимации.

## 3.2 На рендере (внутри батча)

`processBatch` → `prepareToSaveScroll(reverse, sliceTop, sliceBottom)` (`:10004-10035`,
вызов `:5896-5900`): срезается сторона, **противоположная** направлению добавления
(`sliceTop = firstMid === newFirstMid` — верх не менялся → его и режем), тем же
`getViewportSlice(true)`. Т.е. подгрузка вниз попутно выбрасывает далёкий верх и наоборот —
DOM держится в пределах ~5 экранов.

Константы отключения: `DO_NOT_SLICE_VIEWPORT`, `..._ON_RENDER`, `..._ON_SCROLL` (`:310-312`).

## 3.3 lazyLoadQueue

`components/lazyLoadQueue.ts`: очередь загрузки медиа с `VisibilityIntersector`; элемент
получает `wasSeen` при первом попадании во вьюпорт, `getItem()` берёт только seen (видимое —
приоритетно); `lock()/unlockAndRefresh()` на время тяжёлых анимаций (в т.ч. вручную на
`setPeer`: lock в `:5252`, unlock после mount `:5428`); `queueId` инкрементируется на смене
пира (`:5202-5204`) — воркер приоритизирует загрузки текущего чата; после батча
`lazyLoadQueue.setAllSeen()` (`:5952-5956`).

## 3.4 IntersectionObserver'ы

Один `SuperIntersectionObserver` (`root: scrollable.container`, `:2127`), колбэки-каналы:

| Колбэк | Стр. attach | Назначение |
|---|---|---|
| `unreadedObserverCallback` | 6433-6443 (через `setUnreadObserver('history')`, ставится в renderMessage `:7291-7306`, для broadcast — на `timeSpan` `:7639`) | входящее непрочитанное показалось → `readUnreaded('history')` → `readHistory(maxId)` (§5.4) |
| `unreadedContentObserverCallback` | `setUnreadObserver('content')` `:7300,7310`, реакции `:1316` | непрочитанные упоминание/реакция → `readMessages(mids)` |
| `viewsObserverCallback` | 7685 (посты с `views`), 2305-2328 | инкремент просмотров (`incrementMessageViews`, debounce 1с `:2129-2147`) + `viewSponsoredMessage` |
| `readMetricsObserverCallback` | 7689, 2432-2483 | форк: engagement-метрики видимых баблов батчами по rAF |
| `stickerEffectObserverCallback` / `messageEffectObserverCallback` | 6160, 9736, 2485-2504 | автозапуск эффекта премиум-стикера/сообщения при появлении (симуляция клика) |
| `guestChatHintObserverCallback` | 9678, 2336-2391 | форк: тултип guest-чата |

Всё снимается адресно в `destroyBubble` (`:4314-4330`) и оптом в `cleanup` (`:4971-4983`).

## 3.5 animationIntersector

`components/animationIntersector.ts` — реестр всех анимируемых элементов (lottie, video,
custom emoji) с группами `AnimationItemGroup` (`chat-XXXX` у каждого Chat):
`checkAnimations(blurred, group)` — pause/play по видимости (`:283`), `lockGroup/unlockGroup`
на время `setPeer` (`bubbles.ts:5382/5424`), `toggleIntersectionGroup` — freeze невидимого
чата стека (`chat.ts:707-733`, события `chat_changing`/`tab_changing`, размораживание с
задержкой 400мс). `onScroll` дополнительно рулит одним «ближайшим к центру» видео
(`checkIntersectingVideos`, `:4100-4154`).

---

# Часть 4. Скролл-механика

## 4.1 `bubbles.onScroll` (`:4047-4098`)

Вешается как `scrollable.onAdditionalScroll`. Последовательность:

1. heavy animation → только очистка debounce среза; иначе: `pinnedMessage.setCorrectIndexThrottled(direction)`,
   `sliceViewportDebounced()`, `setStickyDateManually()` (ныне no-op, `:2865-2908` — sticky
   отдан stickyIntersector'у).
2. Класс `is-scrolling` на `chatInner` + таймер снятия **1350мс** (+длительность программной
   анимации) — на время скролла CSS отключает hover и т.п.
3. `scrolledDown`: `distanceToEnd < SCROLLED_DOWN_THRESHOLD (300)` **и**
   (`loadedAll.bottom || setPeerPromise || !peerId`) → класс `scrolled-down` на `.bubbles`
   (`:4084-4090`). Это же поле — гейт автоскролла новых сообщений.
4. `updateGoDownVisibility()` (`:4907-4911`): класс `is-go-down-visible` на `chat.container`
   при `!scrolledDown` — видимость кнопки go-down чисто CSS-ная.
5. `checkIntersectingVideos()`, `scheduleReadMetricsBatch()`.

## 4.2 Сохранение позиции при prepend/append: ScrollSaver

`createScrollSaver(reverse)` (`:2243-2250`) — селектор
`.bubble:not(.is-date):not(.is-sponsored):not(...)`. `helpers/scrollSaver.ts`:

- `save()` — находит **видимые** баблы, запоминает их DOMRect'ы (+scrollTop/scrollHeight);
- `restore()` (`:149-219`) — якорь = первый (reverse) / последний (!reverse) сохранённый
  элемент; сдвигает scrollTop на дельту позиции якоря; прилипание к видимому краю при
  overflow; фолбэк `_restore()` — по `scrollHeight − scrollTop`;
- `replaceSaved(from, to)` — подмена якоря при перерендере бабла (используется батчем,
  `bubbles.ts:5910-5912`).

Точки применения: батч рендера (`prepareToSaveScroll` → `restoreScroll()` после mount),
удаление баблов (`destroyBubble` `:4310-4381`), реакции/просмотры/edit
(`messages_reactions` `:1270`, `messages_views` `:2112`, `modifyBubble` `:6461-6470`),
срез вьюпорта (`deleteViewportSlice`).

Дополнительно (форк): «reflow-якорь» для resize окна/PiP (`:713-735`, `:2254-2287`) и
ResizeObserver высоты контейнера (клавиатура/инпут) с покадровой компенсацией scrollTop
(`createResizeObserver`, `:2506-2614`).

## 4.3 `scrollToBubble` (`:4635-4724`)

- позиции: `'center'` (прыжок к сообщению), `'start'` (unread-разделитель), `'end'` (низ);
- если бабл — первый в первой группе date-группы, при центрировании фолбэк к началу
  date-группы (`fallbackToElementStartWhenCentering`, `:4648-4659`) — чтобы дата не
  отрезалась;
- геометрия считается против `chat.bubblesViewport`, а не scroll-контейнера (тот заезжает
  под topbar/инпут) (`:4666-4704`);
- скролл — `scrollable.scrollIntoViewNew` → `fastSmoothScroll` (JS-анимация,
  `dispatchHeavyAnimationEvent` на время полёта); `startCallback` зовёт `onScroll(true,
  dimensions)` и двигает градиент обоев (`:4706-4715`);
- `FocusDirection.Static` — мгновенно (используется при открытии чата).

`scrollToEnd()` = `scrollToBubbleEnd(chatInner)` (`:4726-4742`), на время полёта ставится
`scrollingToBubble` (гейт для `renderNewMessage`).

## 4.4 Прыжок к сообщению

Вход — `chat.setMessageId({lastMsgId})` (обёртка `setPeer` c тем же peerId, `chat.ts:1164`).
Дальше в `bubbles.setPeer`:

- бабл смонтирован → `scrollToBubble('center')` + `highlightBubble` без перезагрузки (§1.4 п.4);
- нет → полная перезагрузка ленты: `getHistory1(lastMsgFullMid, true, isBackLimit=true)` —
  `backLimit` грузит по половине в обе стороны от цели; после mount —
  `scrollToBubble(center, Static)` + `highlightBubble`.

`highlightBubble` (`:4765-4778`): класс `is-highlighted` на 2000мс, с рестартом через reflow.

## 4.5 Кнопка go-down (+badge)

- DOM/клик — в ChatInput: `goDownBtn = ButtonCorner('arrow_down', 'bubbles-go-down')`
  (`input.ts:614-622`), внутри badge `goDownUnreadBadge = createBadge('span', 24, 'primary')`
  (`:1032-1035`).
- Badge: `input.setUnreadCount()` (`:2026-2077`) — `dialog.unread_count` (+ серый при mute);
  там же mention/reaction/pollVote-кнопки. Вызывается из `dialog_unread` /
  `dialogs_multiupdate` / `dialog_notify_settings` (`bubbles.ts:1925-1956`) и на
  `finishPeerChange` инпута (`input.ts:2396-2402`).
- Видимость — CSS от `is-go-down-visible` (§4.1 п.4).
- `onGoDownClick` (`bubbles.ts:3852-3896`):
  - `followStack` пуст → `chat.setMessageId()` **без** lastMsgId — т.е. штатное «в низ» это
    повторный setPeer (перезагрузка к top_message), а не scrollTo (лента может быть срезана);
  - иначе — возврат по стеку прыжков: выкинуть из стека цели, которые уже выше середины
    экрана, отсортировать, `pop()` → `setMessageId({lastMsgId})`. `followStack` пополняется
    при samePeer-прыжке со `stack` (клик по реплаю, `:5156-5158`).

## 4.6 Новые сообщения: когда автоскроллим

События (`constructPeerHelpers`):

- `history_append` (`:1860-1895`) — **своё** отправленное: если `!loadedAll.bottom` →
  `chat.setMessageId()` (перезагрузка в низ), иначе `renderNewMessage(message, scrolledDown=true)`
  — своё сообщение скроллит всегда;
- `history_multiappend` (`:1897-1901`) — входящие: `renderNewMessage(message)` без форса.

`_renderNewMessage` (`:4537-4627`):

1. `!loadedAll.bottom` → не рендерим (лента срезана/поиск); если идёт `setPeerPromise` —
   отложить и повторить после.
2. фильтры threadId / monoforum / savedReaction; дубль-гейт по `getBubble(fullMid)`.
3. `scrolledDown ||= this.scrolledDown && (!scrollingToBubble || scrollingToBubble ===
   lastBubble || chatInner)` (`:4580-4586`) — автоскролл только если юзер у низа (или уже
   летим к низу).
4. `setTopPadding()` (`:4486-4526`) — если лента короче экрана, временный paddingTop
   прижимает её к низу, чтобы новый бабл «вырос снизу»;
5. `performHistoryResult({history: [message]}, false)`; при `scrolledDown` после рендера —
   `scrollToEnd()` (анимированный reveal) и снятие паддинга.

Т.е.: **юзер выше низа → ничего не двигается** (бабл просто монтируется ниже вьюпорта,
badge растёт от `dialog_unread`); **у низа → плавный подскролл**.

## 4.7 `scrolled-down`-инварианты

`scrolledDown` требует `loadedAll.bottom` — окно, срезанное прюнингом или прыжком, никогда
не считается «у низа», и все «прижимные» механики (renderNewMessage, resize-компенсация)
через него автоматически отключаются.

## 4.8 Сохранение/восстановление позиции чата

`appImManager.saveChatPosition(chat)` (`appImManager.ts:2111-2149`), на `peer_changing`:

- сохраняет только если реально не у низа (`getDistanceToEnd() > 16 || !loadedAll.bottom`) и
  под вьюпортом есть невидимые баблы;
- перед сохранением — `sliceViewport(true)` (обрезать DOM), потом
  `mids = getRenderedHistory('desc', true)` + `top = scrollPosition`;
- восстановление: `bubbles.setPeer` рендерит **ровно эти mids** (`performHistoryResult({history:
  savedPosition.mids})`) и ставит `scrollTop = savedPosition.top` (`:5346-5352`, `:5437-5438`).
  Ключ — `peerId_threadId`; хранится в памяти (`chatPositions`), не персистится.

---

# Часть 5. Применение апдейтов (rootScope → DOM)

## 5.1 Каталог обработчиков

Конструктор (`bubbles.ts:762-1326`) — всегда активные; `constructPeerHelpers`
(`:1858-2183`) — чат-специфичные. Все через `listenerSetter.add(rootScope)`.

| Событие | Стр. | Действие |
|---|---|---|
| `history_update` | 765-873 | сообщение сменило позицию (например, доехал точный mid): пересадка item'а между группами `bubbleGroups`, при sequential — «на месте» без ремоунта |
| `message_sent` | 882-1070 | temp→real: перекладка `bubbles[fullTempMid]→[fullMid]`, `dataset.mid`, `changedMids.set(tempId, mid)`, снятие `is-outgoing`, статус `sent`/`read` (fastRaf), обновление документов/аудио/альбомных mid'ов, `reactionsElement.changeContext` |
| `message_edit` | 1104-1107 | `onMessageEdit` (`:1072-1102`) → **полный перерендер бабла**: `safeRenderMessage({message, bubble})` (гео — исключение) |
| `message_error` | 1109-1135 | `is-outgoing`→`is-error`, статус-иконка `sendingerror` |
| `replies_short_update` | 1137-1142 | счётчик ответов в time (`setBubbleRepliesCount`, `:6410`) |
| `message_transcribed` | 1144-1207 | текст расшифровки войса in-place |
| `grouped_edit` | 1209-1229 | перерендер альбома по новому главному mid |
| `messages_reactions` | 1247-1322 | батч: `getMountedBubble` по каждому, один общий ScrollSaver, `ReactionsElement.update(message, changedResults)` in-place (не перерендер бабла); пустые реакции — удаление элемента; непрочитанные реакции → `setUnreadObserver('content')` |
| `messages_views` | 2094-2125 | fastRaf + ScrollSaver, `textContent` счётчиков `.post-views` |
| `history_append` / `history_multiappend` | 1860-1901 | новые сообщения (§4.6) |
| `history_delete` / `history_delete_key` | 1903-1923 | `deleteMessagesByIds(fullMids)` + обновление реплаев на удалённое (`updateMessageReply`) |
| `dialog_flush` | 875-879 | очистка истории → удалить все баблы |
| `dialog_unread` | 1925-1933 | `input.setUnreadCount()` (badge) + `updateUnreadByDialog()` (тики) |
| `user_full_update` / `chat_update` | 1967-2049 | права/блок → `refreshInput` (пере-`finishPeerChange` bubbles+input), placeholder'ы |
| `history_reload` / `state_cleared` | 2051-2061 | `onHistoryReload` (`:2194-2241`): `reloadMessages` всех отрендеренных, перерендер/удаление, `setLoaded(false)` обеих сторон + `checkForTriggers` |
| `settings_updated` (emoji.big) | 2063-2092 | перерендер баблов `can-have-big-emoji` |
| `scheduled_new` / `scheduled_delete` | 2170-2182 | scheduled-лента |

Ключевой паттерн: **любой in-place мутатор оборачивается ScrollSaver'ом**, а «изменилось
содержимое» = перерендер бабла целиком через `safeRenderMessage` с передачей старого `bubble`.

## 5.2 Батчинг рендера

`safeRenderMessage` (`:6271-6380`):

- дубль-гейты `renderingMessages` / существующий бабл;
- **всегда создаётся новый** `div` c `middlewareHelper`, `dataset.mid/peerId/timestamp`;
  при перерендере старый бабл уходит в `bubblesToEject`, пара — в `bubblesToReplace`,
  `bubbleGroups.changeBubbleByBubble`;
- `renderMessage` (`:6568-9779`, ~3200 строк — сам рендер содержимого) возвращает
  `{bubble, promises(loadPromises медиа), message, reverse}`;
- результат-промис уходит в `renderMessagesQueue` → `batchProcessor.addToQueue`
  (`BatchProcessor` из `helpers/sortedList.ts`; `messagesQueuePromise` — текущий батч).

`processBatch` (`:5808-5959`) — сердце монтирования:

1. фильтрация протухших (бабл заменён / mid уже сменился);
2. `groupBubbles(...)` (`:5974-6028`): `bubbleGroups.prepareForGrouping` + `groupUngrouped()`
   → множество изменённых групп + промисы аватаров;
3. ожидание: все `loadPromises` медиа + `setUnreadDelimiter()` + `getHeavyAnimationPromise()`
   + `fastRafPromise` (`:5887-5891`) — DOM трогается только когда всё готово и кадр свободен;
4. `prepareToSaveScroll(reverse, ...)`: ScrollSaver.save + срез противоположной стороны (§3.2);
5. `messagesQueueOnRenderAdditional?.()` — лесенка;
6. `ejectBubbles()`; для заменённых — `scrollSaver.replaceSaved(old, new)`;
7. selection-режим — `toggleElementCheckbox(bubble, true)` на новых (`:5932-5936`);
8. локальные сообщения — prepend/append в `chatInner` напрямую (`:5938-5943`);
9. **`bubbleGroups.mountUnmountGroups(groups)`** — единственная точка вставки в DOM;
10. `updatePlaceholderPosition?.()`; `restoreScroll?.()`; после паузы —
    `lazyLoadQueue.setAllSeen()`.

## 5.3 «Лесенка» открытия (`animateAsLadder`, `:10313-10463`)

Только на первом сетевом рендере (`isFirstMessageRender`, `:11467`) и при
`liteMode.isAvailable('animations')`. Анимируются `bubble.lastElementChild`
(`.bubble-content-wrapper`) + аватар группы у последнего в серии: классы
`zoom-fade can-zoom-fade` + `transition-delay = idx * 40ms` (10ms при addition-рендере),
снятие класса на fastRaf → CSS-переход; `chatInner.zoom-fading`;
`dispatchHeavyAnimationEvent` на maxDelay+300ms; по завершении — преднагрузка истории.

## 5.4 Прочитанность

**Входящие (read inbox).** В `renderMessage`: `context.isInUnread = !out && unread`
(`:6667-6678`, для чатов дополнительно `readMaxId < mid`) → `setUnreadObserver('history')`
(`:6433-6443`; broadcast — на `timeSpan`, обычный чат — на бабл). Пересечение →
`onUnreadedInViewport` (`:2914-2926`): mid в `unreadedSeen`, unobserve →
`readUnreaded('history')` (`:2940-3011`):

- ждёт `idleController.getFocusPromise()` — **фон/блюр вкладки читает только после фокуса**;
- `maxId = max(unreadedSeen)`; если `loadedAll.bottom` и maxId ≥ верхнего отрендеренного —
  поднимается до `historyMaxId`;
- разом закрываются все observed с mid ≤ maxId; → `appMessagesManager.readHistory({peerId,
  maxId, threadId})`; retry при ошибке; хвост `unreadedSeen` — рекурсивно.
- `unreadedChat`-снапшот (`:2931-2938`) защищает от чтения чужого пира в окне смены чата.

**Контент (mention/reaction).** `setUnreadObserver('content')` → `readMessages(mids)`
(тот же pipeline, `:2979-2992`). `reobserveUnreadContent` (`:6454-6459`) — ре-арм после
программного прыжка к уже видимому баблу.

**Исходящие (read outbox, «тики»).** При рендере своего: `unreadOut.add(mid)`, статус
`sending|sent|read|error` → `setBubbleSendingStatus` (`:9714-9724`, `:6382-6408` — классы
`is-sending/is-sent/is-read/is-error` + иконка `check/checks` в каждом `.time`).
`dialog_unread` → `updateUnreadByDialog` (`:4234-4255`): mid ≤ `readOutboxMaxId` →
`unreadOut.delete` + статус `read`.

## 5.5 Удаление (`deleteMessagesByIds`, `:4431-4468`)

Сортировка по видимому порядку → `destroyBubble(bubble, animate)` (`:4257-4419`): снятие
всех observers, `bubbleGroups.removeAndUnmountBubble` (может **слить** соседние группы
обратно, `bubbleGroups.ts:379-424`); при `animate` — удаляемое поддерево уезжает в
`.bubbles-remover` (absolute), на его месте placeholder, анимация высоты→0 + opacity под
ScrollSaver. После: `selection.deleteSelectedMids`, `animationIntersector.checkAnimations`,
`deleteEmptyDateGroups()`, `scrollable.onScroll()`.

---

# Часть 6. Sticky-дата, unread-разделитель, date-группы

## 6.1 Date-группы

`dateMessages[dateTimestamp] = {div, container, firstTimestamp, groupsLength}` (`:534-540`).
`getDateContainerByTimestamp` (`:4823-4874`) создаёт по требованию:

```
section.bubbles-date-group
  ├ div.bubble.service.is-date          (sticky-пилюля; formatDate/Today, :4780-4813)
  ├ div.bubble.service.is-date.is-fake  (нескользящий дубликат — держит место)
  ├ div.sticky_sentinel--top            (добавляет stickyIntersector)
  └ div.bubbles-group*                  (индексы с STICKY_OFFSET = 3)
```

и вставляет по сортировке timestamp'ов среди существующих секций. Группы серий монтируются
внутрь по `positionElementByIndex(container, dateContainer.container, STICKY_OFFSET + …)`
(`bubbleGroups.ts:316`), счётчик `groupsLength`; пустые секции сносит `deleteEmptyDateGroups`
(`bubbles.ts:11616-11646`).

## 6.2 Серии (BubbleGroups)

- item сортируются по mid desc (scheduled — по времени); правило склейки
  `canItemsBeGrouped` (`bubbleGroups.ts:573-590`): один `fromId`, один календарный день,
  **Δt ≤ 121с** (`newGroupDiff`), оба не service/`single`;
- классы: `is-group-first`/`is-group-last` на баблах, `bubbles-group-first/last` на группах;
- аватар — один на группу, у последнего (нижнего) сообщения, sticky (создаёт
  `group.createAvatar`, нужен ли — `bubbles.isAvatarNeeded` `:11689`);
- вставка/удаление баблов из середины пересобирает соседние группы
  (`groupUngrouped`/`splitSiblingsOnGrouping`, `:750-780`).

## 6.3 Sticky-дата при скролле

- `StickyIntersector(scrollable.container, handler)` (`bubbles.ts:1382-1409`): два IO —
  по sentinel'у и по самой секции (`stickyIntersector.ts:20-44`), rootMargin = распорки
  (`updateStickyIntersectorRootMargin`, `bubbles.ts:4900-4905`);
- handler держит `WeakSet` stuck-контейнеров и вешает `is-sticky` **только на самую нижнюю**
  (максимальный timestamp) прилипшую дату (`:1386-1408`);
- секции подписываются в `getDateContainerByTimestamp` (`:4867`);
- показ/прозрачность пилюль гейтится классом контейнера `has-sticky-dates` —
  `onRenderScrollSet` (`:10167-10203`): ставится сразу, если будет скролл при открытии,
  иначе через 600мс (чтобы дата не мигала на пустом/коротком чате); `has-groups` — есть ли
  вообще секции (`:4869-4871`, `:5420`).

## 6.4 Unread-разделитель

`setUnreadDelimiter` (`:11568-11614`), вызывается **внутри каждого батча** (`:5890`), один
раз за открытие (`attachedUnreadBubble`):

- `readMaxId = getReadMaxIdIfUnread(...)`; среди отрендеренных не-out ищется первый mid >
  readMaxId; его бабл получает класс `is-first-unread` (плашка — CSS `::before` на всю
  ширину), сам бабл запоминается в `firstUnreadBubble`;
- при открытии чата с непрочитанными `setPeer` скроллит к `firstUnreadBubble` позицией
  `'start'` (`followingUnread`, §1.4 п.12);
- разделитель НЕ снимается при прочтении — живёт до пересоздания ленты; `destroyBubble`
  зачищает ссылку (`:4306-4308`).

---

# Часть 7. Пустой чат / placeholder'ы (скелетонов нет)

- Во время загрузки — только `ProgressivePreloader` (спиннер) поверх `.bubbles`, и только
  на некэшированном заходе (§1.4 п.11). Скелетонов баблов в tweb не существует.
- `setLoaded(side, value)` (`:11055-11097`) — единственный писатель `scrollable.loadedAll`;
  после установки края проверяет placeholder'ы:
  - `top` у бота → `renderBotPlaceholder` (`:11201`) — описание бота локальным сообщением
    сверху;
  - `top` + peerSettings → `renderUnknownUserPlaceholder` (`:11260`);
  - `bottom` у botforum → `renderBotforumPlaceholder`;
  - иначе `checkIfEmptyPlaceholderNeeded()`.
- `checkIfEmptyPlaceholderNeeded` (`:11302-11324`): оба края загружены + нет сообщений
  (`!historyStorage.count` / всё отфильтровано) → `generateLocalFirstMessage(true)`
  (service-сообщение с локальным mid, `:10944-10986`) → `processLocalMessageRender`
  (`:10745`) → `renderEmptyPlaceholder(type, ...)` (`:10466-…`): типы `greeting` (стикер
  приветствия + business intro), `group`, `saved`, `noMessages`, `noScheduledMessages`,
  `restricted`, `premiumRequired`, `paidMessages`, `topic`, … (`:378-390`).
- Позиционирование плейсхолдера при дорендере — `updatePlaceholderPosition` /
  `attachPlaceholderOnRender` (вызовы `:5414`, `:5948`); зачистка — `cleanupPlaceholders`
  (`:5014-5018`), пересоздание при смене прав (`user_full_update`, `:2002-2006`).

---

# Часть 8. Selection и свайп-ответ (кратко)

## 8.1 Selection (`selection.ts`)

- `ChatSelection extends AppSelection` (`:764`); слушатели вешает
  `bubbles.attachContainerListeners` → `selection.attachListeners(container, ...)`
  (`bubbles.ts:1479`).
- Вход в режим: десктоп — `mousedown` + drag-select по баблам (`onMouseDown`, `:162+`,
  выделение протаскиванием, `seen`-map); тач — long-press (`attachContextMenuListener`,
  `:123-155`) → `toggleByElement`; плюс пункт контекст-меню «Select».
- Режим: `toggleSelection` (`:862`) ставит класс `is-selecting` на контейнеры (CSS сдвигает
  баблы и показывает чекбоксы), `SetTransition` 200мс; чекбокс — `CheckboxField`,
  `appendCheckbox` кладёт его в `.bubble-content-wrapper` (`:823-831`);
  `toggleElementCheckbox` каскадит на `.grouped-item` альбома (`:886-897`).
- Новорендеренные баблы получают чекбоксы в `processBatch` (`bubbles.ts:5932-5936`);
  удаление — `selection.deleteSelectedMids` из `deleteMessagesByIds` (`:4453-4460`).
- `canSelectBubble` (`:999`) — фильтр (сервисные/спонсорские/outgoing нельзя).

## 8.2 Свайп-ответ

- Тач: `handleHorizontalSwipe` на контейнере (`bubbles.ts:1544-1573`), verify: можно писать,
  не service/is-sending, не selection; визуал — `createReplySwipeController` (`:1586-1711`):
  translate бабла (и аватара) за пальцем, иконка reply с порогом, на отпускании —
  `input.initMessageReply`.
- Трекпад (форк): `attachReplyWheelSwipe` (`:1713-1855`) — двухпальцевый wheel-свайп с
  захватом оси и инерцией, тот же контроллер.
- Десктоп-альтернатива: dblclick по баблу = reply (`:1497-1541`).

---

# Часть 9. У нас (web-client): главные структурные расхождения

Наш стек ленты: `components/Chat.tsx` (оркестратор, ~1650 строк) →
`components/messages/ChatFeed.tsx` (чистый рендер окна) + `MessageRow.tsx`;
данные — `stores/messagesStore` (окно на чат, наполняет воркер операциями) через
`core/hooks/useMessageWindow.ts`; скролл — `core/hooks/useChatScroll.ts`;
reveal/лесенка — `core/hooks/useFeedReveal.ts` + `core/dom/ladder.ts`;
sticky-даты — `components/chatStickyDates.ts`. Общая парадигма-развилка (императивная
DOM-лента vs React-окно) разобрана в
[divergence-доке](../research/2026-08-10-architecture-divergence-tweb.md) (§Ф1, Ф5, «Вариант 3»); здесь —
конкретика по механикам этого дока.

## 9.1 Что уже портировано 1:1 (не трогать при порте остального)

| tweb | у нас | Примечание |
|---|---|---|
| `Scrollable` (onScroll/триггеры/silent-запись) | `components/scrollable.ts`, инстанс — только `useChatScroll.ts:279-335` | onScrollOffset тот же (300) |
| `ScrollSaver` | `helpers/scrollSaver.ts`; в `useChatScroll` — **только** для loadOlder-prepend (`onScrolledTop` → save, layout-effect + ResizeObserver → restore) | якорь `[data-seq]` вместо `.bubble:not(...)` |
| `StickyIntersector` + is-sticky | `components/stickyIntersector.ts` + `chatStickyDates.ts` (ключ считает Chat, ChatFeed вешает класс декларативно) | tweb §6.3 |
| `fastSmoothScroll` | `helpers/fastSmoothScroll.ts` (пока только внутри Scrollable.scrollIntoViewNew) | jump у нас ещё на `smoothScrollToElement` |
| Лесенка | `useFeedReveal` (armed на первый СЕТЕВОЙ батч; `loadedFromCache` = аналог `setPeerCached`) + `core/dom/ladder.ts` (анимирует `.bubble-content-wrapper` + аватар, снизу вверх) | tweb §5.3 |
| Прелоадер | `ProgressivePreloader` vanilla (`Chat.tsx:640-643`), политика grace 250мс / min 1000мс — **наша** надстройка (у tweb показ мгновенный на !cached) | |
| unread-разделитель | модификатор `is-first-unread` на бабле (`ChatFeed.tsx:210-215`), позиционирование к верху — `useChatScroll:504-544` (rAF-ретраи + reassert — эрзац tweb-овского «скролл после полного mount батча») | |
| Позиции чатов | `core/chat/chatPositions.ts` — но храним **только `top`** | tweb хранит `mids` среза + top и восстанавливает ровно эти сообщения (§4.8) — у нас окно восстанавливается «какое загрузится», top может не совпасть с контентом |
| go-down | `onScrollDownClick`: `reachedBottom ? smooth scrollToBottom : reloadNewest()+pinBottomNext` — семантически = tweb `setMessageId()`; badge — **производный** `newestSeq − lastReadSeq` (tweb: `dialog.unread_count`) | |
| Дата-пилюли/серии | `ChatFeed.tsx`: секции `bubbles-date-group` по дню, серии `bubbles-group` с sticky-аватаром, `groupBreak` = автор + день + **Δt ≤ 121с** (`:133-148`) — правило tweb | у tweb серия — модель (`BubbleGroups`) с пересборкой при вставках; у нас — пере-derive на каждом рендере |

## 9.2 Главные расхождения (кандидаты порта)

1. **Нет прюнинга DOM (tweb §3).** Окно `messagesStore` только растёт при скролле
   (loadOlder/loadNewer prepend/append), `getViewportSlice`/`deleteViewportSlice`/
   `sliceViewport` аналогов нет → FPS деградирует на длинном скролле (память
   [feed-virtualization-backlog], divergence-док Ф5, Волна 4). У tweb срез двунаправленный:
   и по debounce-скроллу (3с), и внутри каждого батча рендера, с сбросом `loadedAll` срезанной
   стороны — наши `reachedTop/Bottom` в сторе пришлось бы «разгружать» так же.
2. **Нет батч-конвейера рендера (tweb §5.2).** У нас DOM-коммит делает React по изменению
   стора; у tweb монтирование ждёт медиа-`loadPromises` + heavy-animation + rAF и садится
   одним `mountUnmountGroups` под ScrollSaver. Следствия у нас: подгруженные сверху картинки
   доезжают ПОСЛЕ restore → нужен ResizeObserver-цикл повторных `restore()`
   (`useChatScroll:489-502`) — это компенсация отсутствия «ждать перед mount».
3. **Read-модель грубее (tweb §5.4).** У нас markRead = «прижат к низу + фокус + активный
   инстанс» (`useChatScroll:618-666`), maxSeq всего окна; у tweb — per-bubble
   IntersectionObserver «прочитано то, что реально показалось» + `idleController.getFocusPromise`
   (фон копит, читает по фокусу) + отдельный канал read-content (mention/reaction).
   Исходящих тиков через `unreadOut`/`readOutboxMaxId` у нас нет в этом слое (статусы
   sending/sent несёт ConvMsg).
4. **Открытие чата с непрочитанными.** tweb: до рендера вычисляет `readMaxId`, грузит окно
   вокруг него (`overrideAdditionMsgId = −25`), скроллит к `firstUnreadBubble` 'start' одним
   проходом. У нас окно грузится «как обычно» + rAF-поиск `[data-seq]` с двумя reassert-таймерами.
5. **Прыжок к сообщению.** tweb: смонтирован → `fastSmoothScroll` center + highlight; нет →
   перезагрузка ленты с `backLimit` (в обе стороны от цели) и мгновенный `FocusDirection.Static`.
   У нас `win.jumpTo(seq)` + `smoothScrollToElement` (не fastSmoothScroll) + пост-фактум
   коррекция `afterScrollSettles`. `followStack` (возврат вниз по цепочке прыжков через
   go-down) не реализован.
6. **`renderNewMessage`-нюансы**: у tweb своё сообщение при срезанном низе вызывает
   `setMessageId()` (перезагрузка в низ), чужие при срезанном низе не рендерятся вовсе;
   `setTopPadding` для «роста снизу» в коротком чате; `cancelPreservePaddingScroll` перед
   reveal. У нас — `applyIncoming` в стор + ResizeObserver-пин, короткий чат прижат CSS'ом.
7. **In-place-апдейты**: у tweb reactions/views/edit оборачиваются ScrollSaver'ом; у нас
   React-коммит без сохранения позиции — при изменении высоты бабла выше вьюпорта позиция
   уезжает (кроме случая atBottom).
8. **Свайп-ответ на мобиле** (tweb §8.2) — отсутствует (есть только контекст-меню reply);
   `core/dom/swipeHandler.ts` уже портирован для медиавьювера — контроллер из
   `createReplySwipeController` можно сажать на него.
9. **Selection** — декларативный (`selecting`/`selected` пропсы в `MessageRow`), вход только
   через меню; drag-select и long-press-механика tweb не портированы.
10. **Виртуальный «низ» истории**: tweb полагается на `scrolledDown ⇐ loadedAll.bottom`
    везде; у нас эквивалент — `atRealBottom = dist < 240 && win.reachedBottom` +
    `userScrolledUpRef` (свои костыли поверх, см. комменты в `useChatScroll:79-127`) —
    при порте прюнинга эти инварианты придётся свести к tweb-овским.

## 9.3 Куда смотреть при порте

Порядок, согласованный с divergence-доком («Вариант 3», Волна 4): сначала §3 (прюнинг:
`getViewportSlice` — самодостаточный хелпер; `deleteViewportSlice` требует «разгружаемых»
`reachedTop/Bottom` в `messagesStore`), затем §5.2 (батч + ScrollSaver вокруг ЛЮБОЙ мутации
высоты), затем §5.4 (per-bubble read через один SuperIntersectionObserver — хелпер
`helpers/dom/superIntersectionObserver.ts` портируется без изменений).

---

## Проверка после порта

Прощёлкать на стенде, прежде чем говорить «готово».

- [ ] Открытие чата: мгновенный рендер из кэша, затем «лесенка» появления баблов.
- [ ] Скролл вверх на пять и более страниц: позиция не прыгает при подгрузке, FPS ровный, DOM не растёт бесконечно.
- [ ] Прыжок к сообщению по reply и возврат кнопкой вниз; badge на go-down считает непрочитанные.
- [ ] Новое сообщение при скролле вверх не автоскроллит ленту; при прижатии к низу — скроллит.
- [ ] Выход из чата и возврат: позиция восстановлена.
- [ ] Прочитанность: бабл читается по видимости, при потере фокуса вкладки копится и уходит по возвращении.
- [ ] Удаление, редактирование и приход реакции не сдвигают ленту.
- [ ] Sticky-дата и pinned-плашка не перекрывают первый бабл.

Машинная сверка разметки: снять DOM через `tools/tweb-parity/snapshot-dom.js` и
сравнить с эталоном — `node tools/tweb-parity/dom-parity.mjs <дамп> ours.txt`.
Подходящие дампы: 03-chat-overview, 03-chat-topbar, 03-pinned-plate.
