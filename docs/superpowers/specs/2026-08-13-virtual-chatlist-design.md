# Этап 3: виртуальный список, DOM и анимации

**Дата:** 2026-08-13
**Статус:** дизайн согласован
**Родительская спека:** [`2026-08-12-dialogs-ownership-and-virtual-list-design.md`](2026-08-12-dialogs-ownership-and-virtual-list-design.md)
**Предыдущий этап:** [`2026-08-13-dialogs-pagination-design.md`](2026-08-13-dialogs-pagination-design.md)
**Референс:** `~/Documents/tweb` + живые замеры `web.telegram.org/k` (2026-08-12)

## Задача

Список чатов сайдбара становится виртуальным — ровно как в tweb: абсолютно
спозиционированные строки внутри `ul` фиксированной высоты, окно видимости по
арифметике индекса, JS-анимация `top`, скелетоны под ещё не загруженными
индексами, свой скроллер на каждую папку, архив — закреплённым элементом внутри
списка.

Это тот самый видимый результат, ради которого делались этапы 1 и 2.

## Референс tweb: что именно портируем

### `VerticalVirtualList` (`components/verticalVirtualList.tsx`, 191 строка)

- `totalCount = list.length`; высота `ul` =
  `totalCount * itemHeight + (totalCount ? extraPaddingBottom : 0)`,
  `extraPaddingBottom = 8` (`:90`);
- пока список ни разу не загружен — `forceHostHeight`: высота = высоте хоста,
  `overflow: hidden` (`:92, :100`);
- видимость (`:65-74`):
  ```
  idx * itemHeight >= scrollAmount - padding &&
  (idx + 1) * itemHeight <= scrollAmount + hostHeight + padding
  ```
  `thresholdPadding = 72 * 4` (`deferredSortedVirtualList.tsx:328`) — overscan 4 строки;
- `scrollAmount` — `scrollTop` хоста, слушается на самом хосте (`:39-41`);
  размер хоста — `useElementSize`;
- `top` каждой строки — `createAnimatedValue(idx * itemHeight, 120, simpleEasing, canAnimate)` (`:78`);
- `canAnimate = shouldAnimate() && props.animate` (`:63`).

### `useShouldAnimate` (`verticalVirtualList.tsx:129-189`)

Если ВСЕ элементы, видимые до и после изменения, сдвинулись на одинаковое число
позиций — анимация отменяется, вместо неё компенсируется скролл:
`scrollableHost.scrollTop -= prevDiff * itemHeight` (`:49-53, :181-183`).
Визуально список стоит на месте; двигаются только реально переехавшие строки.

Видимость здесь — своя, БЕЗ overscan (`:132-141`):
```
(idx + 1) * itemHeight >= scrollAmount && idx * itemHeight <= scrollAmount + hostHeight
```

Пустое пересечение (`!visiblePrevAndNow.length`) → `allChangedTheSameAmount = false`,
то есть анимируем (`:174-177`).

### `deferredSortedVirtualList` (`components/deferredSortedVirtualList.tsx`, 356 строк)

- `fullItems` (`:73-81`) — массив длиной
  `max(totalCount + pinnedItems.length, realItems.length)`, дырки = `null`;
  `realItems = [...pinnedItems, ...sortedItems]`;
- на месте `null` рендерится `LoadingDialogSkeleton` с тем же классом `.Item`
  и тем же `top` (`:308-316`);
- `requestItemForIdx(idx - pinnedItems.length, items.length)` вызывается для
  каждого индекса, который нельзя показать (`:287-291`);
- **reveal-очередь** (`:199-223`): индекс, готовый к показу, но ещё не
  раскрытый, кладётся в `queuedToBeRevealed`; таймер `1000/60/2` ≈ 8.3 мс
  двигает `revealIdx` на один — строки раскрываются волной, а не одним кадром;
- **`blockAnimation()`** (`:241-253`) — счётчик-глушилка; `animate` у списка =
  `blockedAnimationCount === 0`. Первая загрузка оборачивается им
  (`autonomousDialogList/dialogs.ts:251`);
- **shrink** (`:226-239`) — обрезка списка до `maxVisible + 50` с откатом курсора;
- `.Item` (`deferredSortedVirtualList.module.scss`) — `position: absolute; width: 100%`;
- на время движения строке ставится `--background: var(--surface-color)`
  (`:189-194`) — иначе наезжающие друг на друга абсолютные строки просвечивают
  (`.chatlist-chat { background: var(--background) !important }`).

### `LoadingDialogSkeleton` (`components/loadingDialogSkeleton.tsx` + `.module.scss`)

- размеры `72 | 64`; аватар `54×54` / `48×48`, `padding: 16px 16px 16px 9px`,
  `margin-right: 14px`, `gap: 18px`, плашки `height: 10px; border-radius: 1000px`;
- ширины плашек псевдослучайны от `seed = idx`:
  ```ts
  const x = Math.sin(seed * 10000 + 999999) * 10000
  const rand = x - Math.floor(x)
  min + rand * (max - min)
  ```
  title-left `100..120`, title-right `20..60`, subtitle `60..200` (все `| 0`);
- shimmer включается ЧЕРЕЗ 1500 мс после монтирования (`:25-27`) — «чтобы не
  тратиться при быстром скролле»; сама анимация — `mask-image` линейным
  градиентом, `mask-size: 200% 100%`, `animation: shimmer 2.25s infinite linear`,
  `mask-position 50% → -150%`.

### `createAnimatedValue` (`helpers/solid/createAnimatedValue.ts`, 47 строк)

`animate()` из `helpers/animation` (у нас уже портирован), прогресс
`easing(min(1, (now - startTime) / time))`, значение
`(target - startValue) * progress + startValue`, флаг `animating`.
`simpleEasing = BezierEasing(0.25, 0.1, 0.25, 1)` (`helpers/easings.ts:6`) — это
кривая CSS `ease`.

### Геометрия и DOM (замеры живого tweb)

```
div.scrollable.scrollable-y.tabs-tab.chatlist-parts.folders-scrollable  x=16 w=357 padding-top=131
└─ ul.chatlist.virtual-chatlist  style="height: 1304px"                 x=24 w=341 margin=0 8px padding=0
   └─ a.row…chatlist-chat.chatlist-chat-bigger.row-big._Item_
        style="top: 0px"                                                x=24 w=341 h=72 position:absolute
```
`1304 = 18*72 + 8`. Отступ слева: `16` (сайдбар) + `8` (`ul`) = `24`; аватар `+9`;
текст `+72`.

**Почему `padding` на `ul` заменяется на `margin`.** У абсолютно
спозиционированного ребёнка containing block — padding-box контейнера, и
`width: 100%` считается от него же: строка начинается от ВНЕШНЕГО края паддинга
и на всю его ширину, то есть боковой `padding` визуально не работает. tweb
гасит `ul.chatlist { padding: 0 .5rem }` правилом
`.virtual-chatlist { margin: 0 .5rem !important; padding: 0 !important; width: auto !important }`
(`_chatlist.scss:471`). У нас это правило УЖЕ портировано и лежит мёртвым — его
надо просто начать применять.

## Наше состояние (после этапов 1-2)

| Что | Где | Статус |
|---|---|---|
| Список | `components/ChatList.tsx:97` | один `ul.chatlist`, строки в потоке, без виртуализации |
| Скроллер | `ChatList.tsx:83` | ОДИН на все папки, `TabSlide` внутри него |
| Сброс скролла при смене папки | `useSidebarFolders.tsx:59` | ручной `el.scrollTop = 0` — зарегистрированное исключение в `core/scrollWriters.test.ts` |
| Архив | `ChatList.tsx:91-93` | отдельный узел НАД `ul` |
| Строка | `ChatListItem.tsx:146-160` | классы совпадают с tweb, но нет `_Item_`, `position:absolute`, `top` |
| Высота строки 72px | выводится из CSS (`.row-big` min-height 4.5rem + `.chatlist-chat .row-row` 1.375rem) | как константа в JS не зафиксирована |
| `.virtual-chatlist` | `styles/tweb/_chatlist.scss:471` | мёртвый код |
| Скелетон списка | `components/chatlist/dialogsPlaceholder.ts` | canvas-плейсхолдер на весь список (порт tweb `dialogsPlaceholder`), `TOTAL_HEIGHT = 72` уже зашит |
| `helpers/animation.ts` | есть | вендор tweb 1:1, тот же rAF-цикл |
| `BezierEasing` | `lib/spoiler/bezierEasing.ts` | есть, `simpleEasing` — нет |
| `useElementSize` | — | нет; есть `shared/lib/useMeasuredHeight.ts` (только высота) |
| `SequentialCursorFetcher` | `helpers/sequentialCursorFetcher.ts` | привезён этапом 2 |
| `dialogs.getDialogs()` | `core/managers/dialogsManager.ts` | привезён этапом 2 |

## Решение

### Форма порта: React, логика 1:1

Те же формулы, константы, пороги, тот же DOM и те же классы. Сигналы solid
перекладываются на состояние React; строки остаются `ChatListItem`. Ссылки на
строки оригинала — комментариями (тот же приём, что в порте
`components/connectionStatus.ts`).

**Критическое отличие механики.** В solid `<For>` + `<Show when={isVisible(idx)}>`
— мелкозернистая реактивность: перерисовывается одна строка. Наивный React-порт
перерисовывал бы ВЕСЬ список на каждый кадр скролла и на каждый кадр анимации
`top`. Поэтому:

1. **Окно видимости — состояние родителя**, но родитель рендерит только строки
   из окна, а окно пересчитывается из `scrollTop` не чаще одного раза за кадр
   (rAF-троттлинг, как в нашем `components/scrollable.ts`). Один ре-рендер на
   кадр скролла, N видимых строк — норма для React-виртуализации.
2. **Анимация `top` НЕ идёт через состояние React.** `useAnimatedTop` пишет
   `element.style.top` и `--background` напрямую по ref — ровно как tweb
   (`createRenderEffect`/`createEffect` в `InnerItem` тоже пишут в `style`
   императивно, `:185-194`). React в кадрах анимации не участвует вовсе.

### Новые файлы

```
src/components/virtual/VerticalVirtualList.tsx        ← окно, высота ul, canAnimate
src/components/virtual/useShouldAnimate.ts            ← отмена анимации + компенсация скролла
src/components/virtual/DeferredSortedVirtualList.tsx  ← fullItems, скелетоны, reveal, blockAnimation
src/components/virtual/LoadingDialogSkeleton.tsx      ← + .module.scss (порт 1:1)
src/components/virtual/useAnimatedTop.ts              ← порт createAnimatedValue, пишет в style
src/helpers/easings.ts                                ← simpleEasing поверх lib/spoiler/bezierEasing
src/shared/lib/useElementSize.ts                      ← ResizeObserver → {width, height}
src/core/hooks/useDialogListSource.ts                 ← items/totalCount/requestItemForIdx для папки
```

### Что меняется в существующем DOM

- `ul.chatlist` получает класс `virtual-chatlist` и `style="height: N*72+8px"`;
  боковой отступ переезжает с `padding` на `margin` + `width: auto` — правило
  уже есть в `_chatlist.scss:471`, надо начать его применять;
- строка получает класс-аналог `_Item_` (`position: absolute; width: 100%`),
  `style="top: Npx"` и `--background` на время движения. Класс навешивается
  СНАРУЖИ (`ChatListItem` принимает `className` и `ref`) — как в tweb, где
  `element.classList.add(styles.Item)` делает список, а не строка;
- `ArchiveRow` становится закреплённым элементом ВНУТРИ списка (аналог
  `CustomPinnedDialog`, `sortedDialogList.ts`), с индексом 0 и той же
  геометрией строки;
- появляется `LoadingDialogSkeleton` на месте незагруженных индексов;
- **на каждую папку — свой скроллер и свой `ul`.** Причина прежнего отступления
  («N копий по M строк не потянем», комментарий `ChatList.tsx:80-82`) снимается
  виртуализацией: в DOM живут только видимые строки каждой папки. Ручной
  `scrollTop = 0` при смене папки (`useSidebarFolders.tsx:59`) исчезает — у
  каждой папки свой `scrollTop`, как в tweb; запись убирается и из таблицы
  исключений `core/scrollWriters.test.ts`.

### Источник данных: `useDialogListSource(filterId)`

```ts
type DialogListSource = {
  items: DialogItem[]        // диалоги папки, уже отсортированные (зеркало)
  totalCount: number         // сколько всего в папке (из getDialogs)
  isEnd: boolean
  requestItemForIdx: (idx: number, itemsLength: number) => void
}
```

- `items` — зеркало `chatsStore`, отфильтрованное по папке той же
  `matchesFolder`, что и в воркере (этап 2 сделал её общей);
- `totalCount`/`isEnd` — из `dialogs.getDialogs({filterId, limit, offsetIndex})`;
- `requestItemForIdx` → `SequentialCursorFetcher.fetchUntil(idx + 1, itemsLength)`,
  фетчер зовёт `dialogs.getDialogs(...)`, который догружает страницу и сливает
  её в зеркало операцией `upsert` (этап 2). Отдельного состояния списка на main
  нет — единственный писатель зеркала остаётся проектор.
- размер страницы — `guessLoadCount() = max(windowHeight / 64 * 1.25 | 0, 20)`
  (`base.ts:216-219`, `DIALOG_LOAD_COUNT = 20`);
- первая загрузка оборачивается `blockAnimation()` (`dialogs.ts:251`).

**Первичная загрузка становится страничной.** Сейчас `boot.ts` зовёт
`dialogs.refresh()` — полный список одним куском, после чего `loadedAll = true`
и пагинация не работает никогда. Сетевой догон на старте переходит на
`getDialogs({limit: guessLoadCount()})`; `refresh()` остаётся тем, чем и был, —
явным полным ресинком (его зовут Sidebar, deep-links, resync-кадр). Без этой
замены этап 2 остаётся мёртвым кодом.

### Отступления от tweb (осознанные)

1. **Shrink не портируем** (`deferredSortedVirtualList.tsx:226-239`,
   `EXTRA_ITEMS_TO_KEEP = 50`, `onListShrinked`, откат курсора). Причина: в tweb
   список ВЛАДЕЕТ своими элементами и обрезка реально освобождает память —
   и данные, и DOM-узлы. У нас список данными не владеет: они лежат в кэше
   воркера и в зеркале, обрезка на main их не освободит, а только рассинхронизирует
   витрину с владельцем. DOM-узлы и так ограничены окном видимости. Портировать
   механизм, который в нашей архитектуре ничего не освобождает и создаёт второй
   источник истины, — хуже, чем не портировать. Записывается комментарием у
   `DeferredSortedVirtualList` и здесь.
2. **Анимация пишет в DOM напрямую, минуя состояние React** (см. выше). Внешне
   идентично; иначе React перерисовывал бы список 60 раз в секунду.
3. **Скелетон-плейсхолдер первой загрузки остаётся canvas'ный**
   (`dialogsPlaceholder.ts`) — он уже портирован из tweb и там же и живёт
   (tweb использует ОБА: canvas-плейсхолдер до первой загрузки и
   `LoadingDialogSkeleton` под незагруженными индексами). Ничего не меняем.

## Тесты

Норма: строка проводки без теста, чья мутация краснеет, — нарушение.
Виртуализация тестируется в jsdom: `scrollTop`/`clientHeight` там не считаются
сами — задавать их явно (`Object.defineProperty`), как это уже делает
`useChatScroll`-тестовый сетап.

**Новые:**
- `components/virtual/VerticalVirtualList.test.tsx` — формула окна (граница
  ровно на `padding`), высота `ul` = `count*72+8`, `forceHostHeight` до первой
  загрузки, пересчёт окна на скролл;
- `components/virtual/useShouldAnimate.test.ts` — одинаковый сдвиг всех видимых
  → анимация отменена и `scrollTop` компенсирован; разный сдвиг → анимация;
  пустое пересечение → анимация;
- `components/virtual/useAnimatedTop.test.ts` — значение идёт от старого к новому
  за 120 мс, `--background` стоит только во время движения, `canAnimate=false`
  ставит значение мгновенно;
- `components/virtual/LoadingDialogSkeleton.test.tsx` — ширины детерминированы
  seed'ом (те же числа, что даёт формула tweb), shimmer появляется через 1500 мс;
- `components/virtual/DeferredSortedVirtualList.test.tsx` — дырки заполняются
  скелетонами, `requestItemForIdx` зовётся для незагруженного индекса и НЕ
  зовётся для загруженного, reveal идёт по одному индексу за 8.3 мс,
  `blockAnimation` глушит анимацию и отпускает;
- `core/hooks/useDialogListSource.test.tsx` — фильтр папки, `totalCount`,
  `requestItemForIdx` доходит до `getDialogs` через фетчер;
- `components/ChatList.test.tsx` — в DOM только видимые строки; `ul` несёт
  `virtual-chatlist` и высоту; архив — первый элемент СПИСКА, а не узел над ним.

**Переориентируются:** `core/scrollWriters.test.ts` (исключение
`useSidebarFolders.tsx:59` уходит), `TabSlide.test.tsx` (внутри слайда теперь
скроллер).

## Критерии приёмки

1. `npm test`, `npm run typecheck`, `npm run lint` зелёные — с выводом.
2. В DOM при 1000 диалогов — только видимые строки плюс overscan 4 сверху и
   снизу; `ul` несёт `height: 1000*72+8`.
3. Отступы совпадают с замерами tweb: левый край строки `+24` от края сайдбара,
   аватар `+9` от края строки, текст на `+72`.
4. Новое сообщение в чате из середины списка поднимает ЕГО строку анимацией
   120 мс, остальные видимые строки не дёргаются (`useShouldAnimate`).
5. Переключение папки сохраняет свой `scrollTop` у каждой папки.
6. Первая загрузка не анимируется.
7. Проверено на стенде `:38080`.
