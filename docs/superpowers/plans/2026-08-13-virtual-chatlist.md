# Виртуальный список чатов — план реализации (этап 3)

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ САБ-СКИЛЛ: `superpowers:subagent-driven-development`.

**Цель:** список чатов сайдбара становится виртуальным 1:1 с tweb — абсолютные
строки в `ul` фиксированной высоты, окно по арифметике индекса, JS-анимация
`top`, скелетоны под незагруженными индексами, свой скроллер на папку, архив
закреплённым элементом внутри списка.

**Спека:** `docs/superpowers/specs/2026-08-13-virtual-chatlist-design.md` —
читать перед началом; там зафиксированы отступления от tweb и их причины.

**Стек:** React 19, TypeScript strict, SCSS-модули, vitest + @testing-library.

## Global Constraints

- **Отвечать по-русски**, комментарии в коде — по-русски.
- **Референс — tweb** (`/Users/denisurevic/Documents/tweb`). Любую вёрстку,
  формулу, константу и порог брать **1:1 из оригинала**, не выдумывать. У
  каждого порта — комментарий со ссылкой `файл:строка` оригинала.
- **Мёртвый код удалять** агрессивно.
- **Норма тестов:** строка проводки без теста, чья мутация краснеет, —
  нарушение. Проверять буквально: сломать строку, убедиться, что тест краснеет,
  вернуть.
- **framer-motion и MUI не возвращать** — анимации на CSS-классах tweb и на
  `helpers/animation.ts`.
- **Единственный писатель `chatsStore.dialogs` — проектор** (`stores/noDuplicateDialogs.test.ts`).
  Виртуальный список НЕ заводит своей копии списка и ничего в стор не пишет.
- **Порядок рождается в воркере** (`stores/noManualOrder.test.ts`): на main
  нет `.sort(`/`dialogIndex` вне `sortDialogsByIndex`.
- **Записи `scrollTop`** пинятся `core/scrollWriters.test.ts` — любая новая
  запись обязана быть либо оправдана и внесена в таблицу, либо не появиться.
- Константы, которые обязаны совпасть с tweb буквально:
  `itemHeight = 72` (чаты) / `64` (топики), `thresholdPadding = 72 * 4`,
  `extraPaddingBottom = 8`, длительность анимации `top` = `120` мс,
  `simpleEasing = BezierEasing(0.25, 0.1, 0.25, 1)`, шаг reveal `1000 / 60 / 2`,
  задержка shimmer `1500` мс, `DIALOG_LOAD_COUNT = 20`.
- Рабочая директория — worktree
  `/Users/denisurevic/Documents/messenger-denis/.claude/worktrees/dialogs-virtual-list`.
- Прогон тестов: `cd web-client && npx vitest run --reporter=dot` (~25 с),
  типы: `npx tsc --noEmit`.

## Структура файлов

| Файл | Ответственность |
|---|---|
| `web-client/src/helpers/easings.ts` | `simpleEasing` поверх существующего `lib/spoiler/bezierEasing` |
| `web-client/src/shared/lib/useElementSize.ts` | `ResizeObserver` → `{width, height}` |
| `web-client/src/components/virtual/useAnimatedTop.ts` | порт `createAnimatedValue`, пишет в `style` по ref |
| `web-client/src/components/virtual/LoadingDialogSkeleton.tsx` + `.module.scss` | порт скелетона 1:1 |
| `web-client/src/components/virtual/useShouldAnimate.ts` | отмена анимации при равномерном сдвиге + компенсация скролла |
| `web-client/src/components/virtual/VerticalVirtualList.tsx` | окно видимости, высота `ul`, `canAnimate` |
| `web-client/src/components/virtual/DeferredSortedVirtualList.tsx` | `fullItems`, скелетоны, reveal-очередь, `blockAnimation` |
| `web-client/src/core/hooks/useDialogListSource.ts` | items/totalCount/requestItemForIdx для папки |
| `web-client/src/components/ChatList.tsx` | переезд на виртуальный список, архив внутрь |
| `web-client/src/components/ChatListItem.tsx` | принимает `className` и `ref` снаружи |

---

### Task 1: `simpleEasing` и `useElementSize`

**Файлы:**
- Create: `web-client/src/helpers/easings.ts` + `easings.test.ts`
- Create: `web-client/src/shared/lib/useElementSize.ts` + `useElementSize.test.tsx`

**Интерфейсы (Produces):**
```ts
// helpers/easings.ts — порт tweb src/helpers/easings.ts:5-7
export const simpleEasing: (t: number) => number   // BezierEasing(0.25, 0.1, 0.25, 1)

// shared/lib/useElementSize.ts
export function useElementSize(): { ref: (el: HTMLElement | null) => void; width: number; height: number }
```
Их потребляют Task 3 и Task 5.

**Осторожно:**
- `BezierEasing` уже есть — `web-client/src/lib/spoiler/bezierEasing.ts`. Посмотреть
  его экспорт и сигнатуру, ПЕРЕИСПОЛЬЗОВАТЬ, второй реализации не заводить.
- Рядом уже живёт `shared/lib/useMeasuredHeight.ts` (callback-ref + ResizeObserver,
  только высота, `Math.round(offsetHeight)`). Прочитать его и сделать
  `useElementSize` в ТОМ ЖЕ стиле. Если после появления `useElementSize`
  `useMeasuredHeight` становится его частным случаем — НЕ переписывать его
  колсайты в этой задаче (это чужая зона), но отметить в отчёте.
- В jsdom `ResizeObserver` отсутствует — посмотреть, как его подменяют
  существующие тесты (грепнуть `ResizeObserver` по `src/`), и использовать тот
  же приём, а не изобретать свой мок.

- [ ] **Шаг 1: тесты**
  - `easings.test.ts`: `simpleEasing(0) === 0`, `simpleEasing(1) === 1`,
    монотонность на сетке из 20 точек, и опорное значение
    `simpleEasing(0.5)` ≈ `0.8024` (кривая CSS `ease`; допуск 1e-3). Если
    реальное значение отличается — **сначала проверить, что взята кривая
    `(0.25, 0.1, 0.25, 1)`**, и только потом править ожидание.
  - `useElementSize.test.tsx`: смонтировать компонент с хуком, дёрнуть мок
    `ResizeObserver`, убедиться, что размеры приехали; размонтирование
    отписывает наблюдателя (мутация: убрать `disconnect()` — тест краснеет).
- [ ] **Шаг 2: убедиться, что тесты падают.**
- [ ] **Шаг 3: реализация.**
- [ ] **Шаг 4:** `npx vitest run src/helpers/easings.test.ts src/shared/lib/useElementSize.test.tsx && npx tsc --noEmit`
- [ ] **Шаг 5: коммит** — `feat(virtual): simpleEasing и useElementSize`

---

### Task 2: `useAnimatedTop` — порт `createAnimatedValue`

**Файлы:**
- Create: `web-client/src/components/virtual/useAnimatedTop.ts` + `.test.ts`

**Интерфейсы:**
- Consumes: `simpleEasing` (Task 1), `animate` из `web-client/src/helpers/animation.ts` (уже есть).
- Produces:
  ```ts
  /** Ставит элементу `top` и `--background`, анимируя переход. */
  export function useAnimatedTop(top: number, canAnimate: boolean): (el: HTMLElement | null) => void
  ```
  Его использует Task 5.

**Оригинал:** `/Users/denisurevic/Documents/tweb/src/helpers/solid/createAnimatedValue.ts`
(47 строк) — прочитать целиком. Формула прогресса и значения:
```
progress = easing(min(1, (performance.now() - startTime) / time))
current  = (target - startValue) * progress + startValue
```
`time = 120`. Флаг `animating` в tweb поднимается перед стартом и снимается,
когда `progress >= 1` либо при cleanup.

**Ключевое отличие порта (отступление №2 спеки):** значение НЕ попадает в
состояние React. Хук держит `current` в ref, а результат каждого кадра пишет
прямо в DOM:
```ts
el.style.top = current + 'px'
// во время движения — как в tweb (deferredSortedVirtualList.tsx:189-194)
animating ? el.style.setProperty('--background', 'var(--surface-color)')
          : el.style.removeProperty('--background')
```
Причина — комментарием у хука: иначе React перерисовывал бы строку 60 раз в
секунду.

Первое присвоение (монтирование) — БЕЗ анимации, как `{defer: true}` у
`createEffect(on(...))` в оригинале (`:37-38`).

- [ ] **Шаг 1: тесты** (`vi.useFakeTimers()` + мок `performance.now`; посмотреть,
  как это уже делается в тестах `helpers/` — грепнуть `performance.now` по `src/`):
  1. монтирование ставит `top` сразу, без промежуточных значений;
  2. смена `top` при `canAnimate=true` идёт от старого к новому и достигает
     цели ровно к 120 мс, промежуточное значение строго между;
  3. `canAnimate=false` ставит новое значение мгновенно;
  4. `--background` стоит во время движения и снят после;
  5. размонтирование гасит анимацию (мутация: убрать cleanup — тест краснеет).
- [ ] **Шаг 2: убедиться, что тесты падают.**
- [ ] **Шаг 3: реализация.**
- [ ] **Шаг 4:** `npx vitest run src/components/virtual/ && npx tsc --noEmit`
- [ ] **Шаг 5: коммит** — `feat(virtual): useAnimatedTop — порт createAnimatedValue`

---

### Task 3: `LoadingDialogSkeleton`

**Файлы:**
- Create: `web-client/src/components/virtual/LoadingDialogSkeleton.tsx`
- Create: `web-client/src/components/virtual/LoadingDialogSkeleton.module.scss`
- Create: `web-client/src/components/virtual/LoadingDialogSkeleton.test.tsx`

**Интерфейсы (Produces):**
```ts
export type LoadingDialogSkeletonSize = 72 | 64
const LoadingDialogSkeleton: React.FC<{
  className?: string
  style?: React.CSSProperties
  noAvatar?: boolean
  size: LoadingDialogSkeletonSize
  seed: number
}>
```
Его использует Task 5.

**Оригиналы (портировать 1:1, прочитать целиком):**
- `/Users/denisurevic/Documents/tweb/src/components/loadingDialogSkeleton.tsx` (56 строк)
- `/Users/denisurevic/Documents/tweb/src/components/loadingDialogSkeleton.module.scss`

Обязательно сохранить: класс `loading-dialog-skeleton` на корне (в
`_leftSidebar.scss:89-113` у нас уже лежит правило под collapsed-режим, которое
его ждёт); формулу псевдослучайной ширины
```ts
const x = Math.sin(seed * 10000 + 999999) * 10000
const rand = x - Math.floor(x)
return min + rand * (max - min)
```
и диапазоны `100..120` / `20..60` / `60..200` (все через `| 0`); задержку
shimmer `1500` мс; всю геометрию SCSS (`padding: 16px 16px 16px 9px`, аватар
`54`/`48`, `margin-right: 14px`, `gap: 18px`, плашки `height: 10px`,
`border-radius: 1000px`, `mask-size: 200% 100%`, `animation: shimmer 2.25s infinite linear`).

Миксин `animation-level-global` в SCSS-оригинале — посмотреть, чем он выражен у
нас (`src/styles/`), и использовать наш эквивалент; если такого нет —
завернуть в тот же гейт, что используют остальные анимации tweb в нашем проекте
(грепнуть `animation-level` по `src/styles/`).

- [ ] **Шаг 1: тесты**
  1. ширины детерминированы seed'ом — для `seed=0` и `seed=7` посчитать
     ожидаемые значения ТОЙ ЖЕ формулой в самом тесте и сверить с
     `style.getPropertyValue('--width')`; разные seed дают разные ширины;
  2. `size=72` и `size=64` дают разные классы размера;
  3. shimmer-класс появляется только через 1500 мс (`vi.useFakeTimers`);
  4. `noAvatar` скрывает аватар;
  5. размонтирование до 1500 мс не оставляет висящего таймера (мутация: убрать
     `clearTimeout` — тест краснеет).
- [ ] **Шаг 2: убедиться, что тесты падают.**
- [ ] **Шаг 3: реализация.**
- [ ] **Шаг 4:** `npx vitest run src/components/virtual/ && npx tsc --noEmit`
- [ ] **Шаг 5: коммит** — `feat(virtual): LoadingDialogSkeleton — порт tweb 1:1`

---

### Task 4: `useShouldAnimate`

**Файлы:**
- Create: `web-client/src/components/virtual/useShouldAnimate.ts` + `.test.ts`

**Интерфейсы (Produces):**
```ts
export function useShouldAnimate<T>(args: {
  list: readonly T[]
  scrollAmount: number
  hostHeight: number
  itemHeight: number
  onScrollShift: (amount: number) => void
}): boolean
```
Его использует Task 5.

**Оригинал:** `verticalVirtualList.tsx:114-189` — прочитать целиком и перенести
алгоритм БЕЗ упрощений:
- своя видимость, **без** `thresholdPadding`:
  `(idx + 1) * itemHeight >= scrollAmount && idx * itemHeight <= scrollAmount + hostHeight`;
- объединение видимых «до» и «сейчас» через `Set`;
- элемент, отсутствующий в одном из списков → `allChangedTheSameAmount = false`, выход;
- разные `diff` → `false`, выход;
- пустое пересечение → `allChangedTheSameAmount = false`, `prevDiff = 0`;
- при `allChangedTheSameAmount` — `onScrollShift(prevDiff * itemHeight)`.

**Осторожно:**
- Сравнение элементов в оригинале — по ссылке (`prev.indexOf(item)`). У нас
  элементы списка — объекты `DialogItem` из зеркала, и зеркало сохраняет ссылки
  при неизменившихся значениях (`reconcileById`, пин
  `stores/chatsStore.order.test.ts`) — то есть сравнение по ссылке работает и у
  нас. Но `reindex` создаёт новый массив с ПРЕЖНИМИ ссылками на диалоги — это
  ровно тот случай, ради которого механизм и написан. Проверить это тестом.
- `onScrollShift` пишет `scrollTop` — новая запись, которую увидит
  `core/scrollWriters.test.ts`. Внести её в таблицу исключений с обоснованием
  (это порт `verticalVirtualList.tsx:49-53`, компенсация вместо анимации).
- Хук вызывается в теле рендера и сравнивает с предыдущим списком — хранить
  предыдущий в ref. Побочный эффект (`onScrollShift`) обязан идти из эффекта,
  а не из тела рендера.

- [ ] **Шаг 1: тесты** (чистая проверка алгоритма, DOM не нужен):
  1. все видимые сдвинулись на +1 → `false` (не анимировать) и
     `onScrollShift(1 * itemHeight)`;
  2. один элемент переехал, остальные на месте → `true`, `onScrollShift` не звался;
  3. элемент исчез из списка → `true`;
  4. видимых нет вовсе → `true`, `onScrollShift` не звался;
  5. сдвиг на -2 → `false` и `onScrollShift(-2 * itemHeight)`;
  6. элементы те же по ссылке в новом массиве (сценарий `reindex`) → механизм
     срабатывает.
- [ ] **Шаг 2: убедиться, что тесты падают.**
- [ ] **Шаг 3: реализация.**
- [ ] **Шаг 4:** `npx vitest run src/components/virtual/ src/core/scrollWriters.test.ts && npx tsc --noEmit`
- [ ] **Шаг 5: коммит** — `feat(virtual): useShouldAnimate — отмена анимации при равномерном сдвиге`

---

### Task 5: `VerticalVirtualList` и `DeferredSortedVirtualList`

**Файлы:**
- Create: `web-client/src/components/virtual/VerticalVirtualList.tsx` + `.test.tsx`
- Create: `web-client/src/components/virtual/DeferredSortedVirtualList.tsx` + `.test.tsx`

**Интерфейсы:**
- Consumes: `useElementSize` (T1), `useAnimatedTop` (T2), `LoadingDialogSkeleton` (T3),
  `useShouldAnimate` (T4).
- Produces:
  ```ts
  export type VirtualListItemProps<T> = { item: T; idx: number; top: number; animating: boolean }

  const VerticalVirtualList: <T>(props: {
    listRef?: React.Ref<HTMLUListElement>
    list: readonly T[]
    renderItem: (p: { item: T; idx: number; itemRef: (el: HTMLElement | null) => void }) => React.ReactNode
    className?: string
    scrollableHost: HTMLElement | null
    itemHeight: number
    thresholdPadding: number
    animate: boolean
    forceHostHeight?: boolean
    extraPaddingBottom?: number
  }) => JSX.Element

  const DeferredSortedVirtualList: <T>(props: {
    scrollableHost: HTMLElement | null
    items: readonly { id: number | string; index: number; value: T }[]
    pinnedItems?: readonly { id: number | string; index: number; value: T }[]
    totalCount: number
    wasAtLeastOnceFetched: boolean
    itemSize: 72 | 64
    noAvatar?: boolean
    animate: boolean
    requestItemForIdx: (idx: number, itemsLength: number) => void
    renderItem: (p: { value: T; id: number | string; itemRef: (el: HTMLElement | null) => void }) => React.ReactNode
    listRef?: React.Ref<HTMLUListElement>
    className?: string
    extraPaddingBottom?: number
  }) => JSX.Element
  ```
  Их использует Task 7.

**Оригиналы (прочитать целиком):**
- `verticalVirtualList.tsx:15-112` — окно, высота, `canAnimate`, `Item`;
- `deferredSortedVirtualList.tsx:44-356` — `fullItems`, скелетоны, reveal, `blockAnimation`.

**Что портируем буквально:**
- высота: `totalCount * itemHeight + (totalCount ? extraPaddingBottom : 0)`,
  `extraPaddingBottom = 8`; при `forceHostHeight` — высота хоста и `overflow: hidden`;
- окно: `idx * h >= scroll - pad && (idx + 1) * h <= scroll + hostHeight + pad`;
- `fullItems`: длина `max(totalCount + pinnedItems.length, realItems.length)`,
  `realItems = [...pinnedItems, ...sortedItems]`, дырки `null`;
- `requestItemForIdx(idx - pinnedItems.length, items.length)` для каждого
  непоказываемого индекса;
- reveal: индекс в очередь, таймер `1000 / 60 / 2`, `revealIdx = max(min + 1, prev)`;
- скелетон на месте дырки — с тем же классом позиционирования и тем же `top`.

**Что НЕ портируем (отступление №1 спеки):** shrink (`checkShrink`,
`EXTRA_ITEMS_TO_KEEP`, `onListShrinked`, `visibleItems`). Причина — комментарием
в коде: список не владеет данными, обрезка на main ничего не освобождает и
создаёт второй источник истины. `blockAnimation` при этом ПОРТИРУЕТСЯ — он
приходит пропом `animate` снаружи (управляет им Task 6).

**Осторожно:**
- Класс позиционирования `.Item` (`position: absolute; width: 100%`) — из
  `deferredSortedVirtualList.module.scss`. Завести SCSS-модуль рядом и
  навешивать класс СНАРУЖИ на элемент строки, как делает tweb
  (`element.classList.add(styles.Item)`).
- Скролл слушается на `scrollableHost`; пересчёт окна — не чаще кадра. Посмотреть,
  как троттлит `src/components/scrollable.ts` (`onScroll`, rAF/24 мс), и
  использовать тот же приём, а не свой.
- `scrollableHost` может быть `null` на первом рендере (ref ещё не привязан) —
  ветка обязана быть корректной, а не падать.
- jsdom не считает `scrollTop`/`clientHeight` — в тестах задавать явно.

- [ ] **Шаг 1: тесты `VerticalVirtualList`**
  1. при 1000 элементах, `hostHeight=720`, `scrollTop=0` в DOM ровно те индексы,
     что даёт формула с `pad = 288`;
  2. граница окна: индекс ровно на границе включён, следующий — нет;
  3. `ul` несёт `height: 1000*72+8` px;
  4. `forceHostHeight` → высота хоста и `overflow: hidden`;
  5. скролл двигает окно;
  6. `animate=false` → `canAnimate` ложен у всех строк.
- [ ] **Шаг 2: тесты `DeferredSortedVirtualList`**
  1. `totalCount=100`, загружено 10 → в окне 10 строк и скелетоны на остальных
     видимых индексах;
  2. `requestItemForIdx` зовётся для незагруженного видимого индекса и НЕ
     зовётся для загруженного;
  3. аргумент `requestItemForIdx` уменьшен на число закреплённых;
  4. закреплённые идут первыми, их `top` — `idx * itemHeight`;
  5. reveal: после первой загрузки индексы раскрываются по одному с шагом
     `1000/60/2` (fake timers);
  6. `wasAtLeastOnceFetched=false` → `forceHostHeight`.
- [ ] **Шаг 3: убедиться, что тесты падают.**
- [ ] **Шаг 4: реализация** (сначала `VerticalVirtualList`, затем `Deferred…`).
- [ ] **Шаг 5:** `npx vitest run --reporter=dot && npx tsc --noEmit` — весь набор зелёный.
- [ ] **Шаг 6: проверить норму** — сломать по очереди: `pad` в формуле окна,
  `+ extraPaddingBottom` в высоте, вычитание `pinnedItems.length` в
  `requestItemForIdx`, шаг reveal. Каждая мутация красит свой тест.
- [ ] **Шаг 7: коммит** — `feat(virtual): VerticalVirtualList и DeferredSortedVirtualList`

---

### Task 6: источник данных списка папки

**Файлы:**
- Create: `web-client/src/core/hooks/useDialogListSource.ts` + `.test.tsx`
- Modify: `web-client/src/client/boot.ts` (первичный сетевой догон — страницей)

**Интерфейсы:**
- Consumes: `managers.dialogs.getDialogs({offsetIndex, limit, filterId})` (этап 2),
  `SequentialCursorFetcher` (`helpers/sequentialCursorFetcher.ts`, этап 2),
  `matchesFolder` (этап 2), зеркало `chatsStore`.
- Produces:
  ```ts
  export const DIALOG_LOAD_COUNT = 20
  export function guessLoadCount(): number   // max(window.innerHeight / 64 * 1.25 | 0, DIALOG_LOAD_COUNT)
  export function useDialogListSource(filterId: number): {
    items: { id: number; index: number; value: Chat }[]
    totalCount: number
    isEnd: boolean
    wasAtLeastOnceFetched: boolean
    animate: boolean
    requestItemForIdx: (idx: number, itemsLength: number) => void
  }
  ```
  Его использует Task 7.

**Осторожно:**
1. **Своего списка не заводить.** `items` — производная от зеркала
   (`useChatList()` + фильтр папки). Писать в `chatsStore` нельзя
   (`stores/noDuplicateDialogs.test.ts`), пересортировывать на main нельзя
   (`stores/noManualOrder.test.ts`) — порядок уже пришёл из воркера.
2. **`guessLoadCount`** — порт `autonomousDialogList/base.ts:216-219`, формула
   дословно, `DIALOG_LOAD_COUNT = 20` (посмотреть
   `/Users/denisurevic/Documents/tweb/src/components/autonomousDialogList/constants.ts`
   и убедиться в значении).
3. **`blockAnimation` первой загрузки** (`autonomousDialogList/dialogs.ts:251`):
   `animate` = false, пока первая загрузка не завершилась. Счётчиком, как в
   оригинале, а не булевым флагом.
4. **Первичный догон переходит на страницу.** Сейчас `boot.ts` зовёт
   `dialogs.refresh()` — полный список, после чего пагинация мертва. Заменить на
   `getDialogs({limit: guessLoadCount()})`. `refresh()` НЕ удалять — он остаётся
   явным полным ресинком (Sidebar, deep-links, resync-кадр); проверить грепом,
   что остальные колсайты не тронуты. Порядок применения на холодном старте
   (сначала `fillMirror` ответом RPC, потом сеть) сохранить — он пинится
   `client/boot.dialogs.test.ts` и `useAppBootstrap.*`.
5. **Под passcode-локом** сети быть не должно — посмотреть, как это выражено в
   `boot.ts` сейчас (`locked`), и сохранить.

- [ ] **Шаг 1: тесты**
  1. `items` фильтруются по папке той же `matchesFolder`;
  2. порядок `items` — тот, что пришёл из зеркала (не пересортировывается);
  3. `requestItemForIdx(idx)` доходит до `getDialogs` с ожидаемым `limit`;
  4. повторный вызов на тот же индекс не плодит запросов (фетчер сериализует);
  5. `totalCount`/`isEnd` берутся из ответа `getDialogs`;
  6. `animate` ложен до конца первой загрузки и истинен после;
  7. `guessLoadCount` — точное значение формулы при заданном `window.innerHeight`.
- [ ] **Шаг 2: тест на boot** — первичный догон идёт страницей с
  `limit = guessLoadCount()`, а не полным `refresh()`; под локом сети нет.
- [ ] **Шаг 3: убедиться, что тесты падают.**
- [ ] **Шаг 4: реализация.**
- [ ] **Шаг 5:** `npx vitest run --reporter=dot && npx tsc --noEmit`
- [ ] **Шаг 6: коммит** — `feat(dialogs): постраничный источник списка папки`

---

### Task 7: `ChatList` переезжает на виртуальный список

**Файлы:**
- Modify: `web-client/src/components/ChatList.tsx` (+ `.module.scss`)
- Modify: `web-client/src/components/ChatListItem.tsx` (+ `.module.scss`)
- Modify: `web-client/src/components/ArchiveRow` (стать элементом списка)
- Create: `web-client/src/components/ChatList.test.tsx`

**Интерфейсы:**
- Consumes: `DeferredSortedVirtualList` (T5), `useDialogListSource` (T6).
- Produces: DOM, совпадающий с замерами tweb (см. ниже).

**Целевой DOM (замеры живого tweb, соблюсти буквально):**
```
div.scrollable.scrollable-y.tabs-tab.chatlist-parts.folders-scrollable
└─ ul.chatlist.virtual-chatlist  style="height: N*72+8px"
   ├─ <архив>  class="…row-big _Item_"  style="top: 0px"      ← закреплённый элемент
   ├─ a.row.no-wrap.row-with-padding.row-clickable.hover-effect.rp
   │    .chatlist-chat.chatlist-chat-bigger.row-big[.is-muted][.active]
   │    _Item_   style="top: 72px"
   └─ …
```

**Осторожно:**
1. **Отступ переезжает с `padding` на `margin`.** Правило
   `.virtual-chatlist { margin: 0 .5rem !important; padding: 0 !important; width: auto !important }`
   уже лежит в `src/styles/tweb/_chatlist.scss:471` мёртвым — начать его
   применять, а не писать своё. Причина именно такой замены — в спеке
   (containing block абсолютного ребёнка — padding-box).
2. **`ChatListItem` принимает `className` и `ref` снаружи.** Класс
   позиционирования навешивает список, а не строка, — как в tweb. Уже имеющиеся
   классы строки НЕ трогать (комментарий в `ChatListItem.module.scss:8` про
   «у нас обычный поток» становится неверным — обновить его, а не оставить).
3. **Архив — закреплённый элемент внутри списка** (`pinnedItems`), аналог
   `CustomPinnedDialog` (`sortedDialogList.ts`). Прежний узел над `ul`
   удаляется. Условие показа прежнее: только в папке «Все чаты», только
   `loaded && !collapsed && archived.length > 0`.
4. **Canvas-плейсхолдер первой загрузки (`dialogsPlaceholder`) остаётся** —
   отступление №3 спеки. Проверить, что он по-прежнему цепляется к правильному
   контейнеру после переезда на `virtual-chatlist`, и что его `detach` зовётся.
5. **`collapsed`-режим** (форум-панель) — `_leftSidebar.scss:89-113` уже содержит
   правила под `.virtual-chatlist` и `.loading-dialog-skeleton`, которые до сих
   пор были мёртвыми. После переезда они оживут — проверить, что режим не
   поехал.
6. `ChatListItem` — `memo`. Убедиться, что переезд не сломал мемоизацию (строка
   не должна перерисовываться на каждый кадр скролла); в тесте зафиксировать
   счётчиком рендеров.

- [ ] **Шаг 1: тесты**
  1. при 500 диалогах в DOM только видимые строки + overscan, а не 500;
  2. `ul` несёт класс `virtual-chatlist` и `height: 500*72+8`;
  3. архив — ПЕРВЫЙ элемент внутри `ul`, а не узел над ним; при пустом архиве
     его нет и первый элемент — обычный чат;
  4. каждая строка несёт класс позиционирования и инлайновый `top`, кратный 72;
  5. строка не перерисовывается при скролле, если её данные не изменились;
  6. `collapsed` не ломает разметку.
- [ ] **Шаг 2: убедиться, что тесты падают.**
- [ ] **Шаг 3: реализация.**
- [ ] **Шаг 4:** `npx vitest run --reporter=dot && npx tsc --noEmit && npx eslint src`
- [ ] **Шаг 5: коммит** — `feat(chatlist): виртуальный список чатов, архив внутри списка`

---

### Task 8: свой скроллер на каждую папку

**Файлы:**
- Modify: `web-client/src/components/ChatList.tsx`, `web-client/src/components/Sidebar.tsx`
- Modify: `web-client/src/core/hooks/useSidebarFolders.tsx` (снос ручного `scrollTop = 0`)
- Modify: `web-client/src/core/scrollWriters.test.ts` (таблица исключений)
- Test: дополнить `ChatList.test.tsx` / `Sidebar`-тесты

**Интерфейсы:**
- Consumes: всё из T7.
- Produces: у каждой папки свой `.folders-scrollable` и свой `ul` — как в tweb
  (`autonomousDialogList/dialogs.ts:207-238`, `new Scrollable` на каждый фильтр).

**Почему это стало возможно:** прежнее отступление объяснено комментарием
`ChatList.tsx:80-82` — «N копий по M строк не потянем». Виртуализация это
снимает: в DOM живут только видимые строки каждой папки. Комментарий обязан
быть переписан, а не оставлен.

**Осторожно:**
1. `TabSlide` во время слайда держит В DOM оба кадра (`TabSlide.test.tsx`) —
   значит два скроллера и два виртуальных списка одновременно. Проверить, что
   второй список не дёргает загрузку и не ломает окно (у него свой
   `scrollableHost`).
2. `listScrollRef` из `Sidebar` используется рядом историй (`StoriesRow`
   `getScrollable`) и `--chatlist-overlay-height`. Теперь скроллеров несколько —
   решить, какой отдаётся наружу (активный), и объяснить комментарием.
3. Ручной `el.scrollTop = 0` при смене папки (`useSidebarFolders.tsx:59`)
   удаляется вместе со своей строкой в таблице исключений
   `core/scrollWriters.test.ts` — у каждой папки теперь свой `scrollTop`.
   Убедиться, что тест краснеет, если строку в таблице оставить.
4. `padding-top: var(--chatlist-overlay-height)` стоит на `.folders-scrollable`
   (`_leftSidebar.scss:411-418`) — теперь их несколько, проверить каждый.

- [ ] **Шаг 1: тесты**
  1. у каждой папки свой скроллер: скролл в папке A не меняет `scrollTop` папки B;
  2. возврат в папку A восстанавливает её `scrollTop`;
  3. во время слайда оба списка в DOM и оба корректны;
  4. `scrollWriters.test.ts` больше не содержит исключения `useSidebarFolders`.
- [ ] **Шаг 2: убедиться, что тесты падают.**
- [ ] **Шаг 3: реализация.**
- [ ] **Шаг 4:** `npx vitest run --reporter=dot && npx tsc --noEmit && npx eslint src`
- [ ] **Шаг 5: коммит** — `feat(chatlist): свой скроллер и свой ul на каждую папку`
