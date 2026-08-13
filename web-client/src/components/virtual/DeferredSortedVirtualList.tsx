// Порт tweb `components/deferredSortedVirtualList.tsx:44-356`
// (`createDeferredSortedVirtualList`, читать целиком): поверх окна видимости
// `VerticalVirtualList` добавляются «дырки» ещё не загруженных индексов
// (скелетоны + запрос страницы), закреплённые сверху элементы и волна раскрытия
// (reveal) свежезагруженных строк.
//
// Форма порта. Оригинал — фабрика на `createRoot`, ВЛАДЕЮЩАЯ данными: у неё свои
// сигналы `items`/`pinnedItems`/`totalCount`/`wasAtLeastOnceFetched` и мутирующие
// их методы (`addItems`, `removeItem`, `updateItem`, `clear`, …). У нас данными
// владеет воркер, а витрина их зеркалит (корневой инвариант
// `web-client/CLAUDE.md`, «Владение фактами»), поэтому здесь это обычный
// React-компонент, а всё перечисленное приходит пропами.
//
// ЧТО НЕ ПОРТИРУЕТСЯ — shrink (`checkShrink` `:226-239`, `EXTRA_ITEMS_TO_KEEP`
// `:41`, `onListShrinked` `:237`, сигнал `visibleItems` `:66, :293-303, :257-263`).
// В tweb список ВЛАДЕЕТ элементами, и обрезка реально освобождает и данные, и
// DOM-узлы, а `onListShrinked` откатывает курсор пагинации владельца. У нас
// список данными не владеет: они лежат в кэше воркера и в зеркале, обрезка на
// main ничего не освободит — она лишь рассинхронизирует витрину с владельцем и
// заведёт второй источник истины о том, сколько диалогов загружено. DOM-узлы и
// так ограничены окном видимости `VerticalVirtualList`. Портировать механизм,
// который в нашей архитектуре ничего не освобождает и создаёт второй источник
// истины, хуже, чем не портировать (спека `2026-08-13-virtual-chatlist-design.md`,
// «Отступления от tweb», №1).
//
// `blockAnimation` (`:241-253`) при этом портируется — но живёт снаружи: счётчик
// глушилки держит владелец загрузки, а сюда приходит уже готовое `animate`
// (`:270` — `animate={blockedAnimationCount() === 0}`).
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Key,
  type ReactNode,
  type Ref,
} from 'react'

import LoadingDialogSkeleton, { type LoadingDialogSkeletonSize } from './LoadingDialogSkeleton'
import VerticalVirtualList, { type VirtualListItemProps } from './VerticalVirtualList'

import styles from './DeferredSortedVirtualList.module.scss'

/**
 * `:34-38`, без поля `index`: в оригинале оно нужно `sortedItems` (`:70`), а тот
 * здесь не портируется — см. комментарий у `fullItems`.
 */
export type DeferredSortedVirtualListItem<T> = {
  id: number | string
  value: T
}

export type DeferredSortedVirtualListRenderItemProps<T> = {
  value: T
  id: number | string
  itemRef: (el: HTMLElement | null) => void
}

export type DeferredSortedVirtualListProps<T> = {
  scrollableHost: HTMLElement | null
  /**
   * Уже упорядоченные элементы — компонент их НЕ пересортировывает. Порядок
   * приходит готовым от владельца (воркер считает `dialogIndex`, зеркало
   * раскладывает по нему в `chatsStore.sortDialogsByIndex`); второе правило
   * сортировки на витрине запрещено пином `stores/noManualOrder.test.ts`.
   * Требования к ссылкам (оба выполняет зеркало `stores/chatsStore`,
   * `reconcileById`):
   * 1. ссылка на САМ массив меняется только при реальном изменении состава или
   *    порядка — по её смене пересчитывается решение анимировать переезд
   *    (`useShouldAnimate`), а элементы сравниваются между старым и новым
   *    списком ПО ССЫЛКЕ;
   * 2. элемент с изменившимся СОДЕРЖИМЫМ приезжает НОВОЙ ссылкой, а не мутируется
   *    на месте — строка обёрнута в `memo` и сравнивает `item` по ссылке, поэтому
   *    мутация «в себя» не дошла бы до перерисовки (в оригинале это место — та же
   *    ссылка НАМЕРЕННО, `:144`: там мутируется только `index`, чтобы сработала
   *    анимация переезда, а содержимое строки живёт своей жизнью, вне списка).
   */
  items: readonly DeferredSortedVirtualListItem<T>[]
  /** Закреплённые сверху (у нас — архив). Требования к ссылкам те же. */
  pinnedItems?: readonly DeferredSortedVirtualListItem<T>[]
  totalCount: number
  /**
   * Список хоть раз получал ответ владельца. До этого `ul` ростом с хост
   * (`forceHostHeight`), после — раскрывает всё уже загруженное разом, а всё
   * приехавшее позже пускает волной reveal.
   *
   * Флаг ходит В ОБЕ СТОРОНЫ: сброс в `false` — это порт `clear()` оригинала
   * (`:157-166`), он возвращает раскрытие в исходное «показывать всё, что есть».
   * Сбрасывать его владелец обязан ВМЕСТЕ с составом (`items`, `totalCount`), как
   * это и делает `clear()`, а не отдельно: иначе на экране останутся строки уже
   * неактуального состава, а очередь reveal не опустеет (её чистят сами
   * размонтированные строки, `:283`).
   */
  wasAtLeastOnceFetched: boolean
  itemSize: LoadingDialogSkeletonSize
  noAvatar?: boolean
  animate: boolean
  /**
   * Стабильная ссылка (`useCallback`): зовётся из эффекта каждой непоказанной
   * строки окна, и новая ссылка на каждом рендере родителя означает шторм
   * запросов страниц.
   */
  requestItemForIdx: (idx: number, itemsLength: number) => void
  /** Стабильная ссылка: строка обёрнута в `memo` (см. `VerticalVirtualList`). */
  renderItem: (p: DeferredSortedVirtualListRenderItemProps<T>) => ReactNode
  listRef?: Ref<HTMLUListElement>
  className?: string
  extraPaddingBottom?: number
}

/** `:328` — overscan в 4 строки. */
const THRESHOLD_PADDING = 72 * 4
/** `:218` — шаг волны раскрытия, половина кадра. */
const REVEAL_STEP = 1000 / 60 / 2

const NO_PINNED_ITEMS: readonly never[] = []

function DeferredSortedVirtualList<T>({
  scrollableHost,
  items,
  pinnedItems = NO_PINNED_ITEMS,
  totalCount,
  wasAtLeastOnceFetched,
  itemSize,
  noAvatar,
  animate,
  requestItemForIdx,
  renderItem,
  listRef,
  className,
  extraPaddingBottom = 8, // `:55`
}: DeferredSortedVirtualListProps<T>) {
  // `:73-81`. Массив длиной `max(totalCount + pinnedItems.length, realItems.length)`,
  // где ещё не загруженные индексы — `null`.
  //
  // `sortedItems` оригинала (`:70`, `sortWith` у единственного вызывающего —
  // `(a, b) => b - a`, `sortedDialogList.ts:102`) здесь НЕ портируется: там список
  // владеет элементами и добирает их порциями в произвольном порядке, поэтому
  // обязан упорядочить их сам — сортировка там защитная. У нас порядок —
  // производная зеркала и считается ровно в одном месте на main
  // (`chatsStore.sortDialogsByIndex`, инвариант `stores/noManualOrder.test.ts`);
  // `items` приезжают уже отсортированными, а второе правило сортировки здесь —
  // ровно тот баг, ради которого заведён инвариант. Вместе с сортировкой из типа
  // элемента ушло и поле `index` — читать его стало некому.
  const fullItems = useMemo(() => {
    const realItems = [...pinnedItems, ...items]

    // Идиома построения — `Array.from({length})` вместо `new Array(n).fill(null)`
    // оригинала (`unicorn(no-new-array)` в нашем oxlint); длина и содержимое
    // ячейки — дословно, включая `|| null` на месте дырки.
    return Array.from(
      { length: Math.max(totalCount + pinnedItems.length, realItems.length) },
      (_, idx): DeferredSortedVirtualListItem<T> | null => realItems[idx] || null,
    )
  }, [pinnedItems, items, totalCount])

  const [revealIdx, setRevealIdx] = useState(Infinity) // `:62`
  // Значение `revealIdx` для чтения из таймера/эффекта — solid читает сигнал в
  // момент срабатывания (`:215-216`), React же замкнул бы значение рендера.
  const revealIdxRef = useRef(revealIdx)

  const itemsLengthRef = useRef(items.length)
  itemsLengthRef.current = items.length

  // `:92-96` — `on(wasAtLeastOnceFetched, ...)`: реакция ТОЛЬКО на смену флага.
  // `items().length` внутри читается нетрекаемо (у `on` явный список
  // зависимостей), поэтому длина берётся из рефа, а не из зависимостей эффекта:
  // уже загруженная первая страница раскрывается целиком, волна reveal ниже
  // достаётся только тому, что приедет ПОСЛЕ.
  //
  // Ветка сброшенного флага — порт `clear()` (`:157-166`): там
  // `setWasAtLeastOnceFetched(false)` идёт ОДНИМ батчем с `setRevealIdx(Infinity)`
  // (`:162`), то есть сброс флага возвращает раскрытие в исходное «показывать всё,
  // что есть». Флаг ходит в ОБЕ стороны, поэтому ветка обязана быть симметричной:
  // иначе `revealIdx` залипал бы на длине прошлого состава и часть строк нового
  // оставалась бы скелетонами навсегда. Очередь reveal отдельно не чистится — как
  // и в оригинале: `clear()` там обнуляет `items`, строки размонтируются и снимают
  // свои индексы с очереди сами (`:283`), а у нас это делает владелец, обязанный
  // гасить флаг вместе с составом (см. докблок пропа). Установка `Infinity` на
  // монтировании (флаг ещё false) холостая — React гасит её сравнением по `Object.is`.
  useEffect(() => {
    if (!wasAtLeastOnceFetched) {
      revealIdxRef.current = Infinity
      setRevealIdx(Infinity)
      return
    }

    revealIdxRef.current = itemsLengthRef.current
    setRevealIdx(itemsLengthRef.current)
  }, [wasAtLeastOnceFetched])

  const [queuedToBeRevealed, setQueuedToBeRevealed] = useState<readonly number[]>([]) // `:199`

  // `:201-205`
  const minQueuedToBeRevealed = useMemo(
    () => (!queuedToBeRevealed.length ? null : Math.min(...queuedToBeRevealed)),
    [queuedToBeRevealed],
  )

  // `:208-223` — раскрываем по одному индексу за `REVEAL_STEP`, из очереди уходят
  // все индексы, оказавшиеся ниже нового `revealIdx`.
  useEffect(() => {
    const mn = minQueuedToBeRevealed
    if (mn === null) return

    const timeout = self.setTimeout(() => {
      // `Math.max` (`:215`) — защита оригинала от отката `revealIdx` назад;
      // СОЗНАТЕЛЬНО НЕ ПОКРЫТА тестом: мутация `Math.max(mn + 1, …) → mn + 1`
      // ничего не красит, потому что откатывать нечего. В очередь встают только
      // индексы с `idx >= revealIdx` (`isRevealed` ложен), значит `mn + 1` всегда
      // больше того `revealIdx`, при котором индекс туда попал; единственный
      // второй писатель `revealIdx` — эффект `wasAtLeastOnceFetched` выше — на
      // сбросе флага чистит очередь вместе с `revealIdx := Infinity`, а на
      // взведении застаёт её пустой (при `Infinity` раскрыто всё, вставать в
      // очередь некому). Оставлена дословно: удалять защиту оригинала ради
      // красного теста — хуже.
      const next = Math.max(mn + 1, revealIdxRef.current)
      revealIdxRef.current = next
      setRevealIdx(next)
      // Снятие раскрытого индекса с очереди. Дублирует `dequeueReveal` в cleanup
      // строки (`:283` оригинала — там ровно та же пара), поэтому по отдельности
      // ни одна из двух не красит тест; наблюдаемой разницы между ними в
      // React-порте нет (разбор — в отчёте задачи), а нагруженная из них —
      // именно cleanup строки: только он снимает с очереди индекс, чья строка
      // уехала из окна, так и не дождавшись раскрытия (тест «строка ушла из
      // окна…»). Обе сохранены 1:1 с оригиналом.
      setQueuedToBeRevealed((prev) => prev.filter((n) => next <= n))
    }, REVEAL_STEP)

    return () => {
      self.clearTimeout(timeout)
    }
  }, [minQueuedToBeRevealed])

  const enqueueReveal = useCallback((idx: number) => {
    setQueuedToBeRevealed((prev) => [...prev, idx])
  }, [])

  const dequeueReveal = useCallback((idx: number) => {
    setQueuedToBeRevealed((prev) => prev.filter((n) => n !== idx))
  }, [])

  // Solid'овский `<For>` ключует строку по ССЫЛКЕ на элемент; React требует явный
  // ключ (см. шапку `VerticalVirtualList.tsx`, п.3). Дырка ссылки не имеет —
  // ключуется индексом, на котором стоит.
  const getKey = useCallback(
    (item: DeferredSortedVirtualListItem<T> | null, idx: number): Key => (item ? item.id : `hole:${idx}`),
    [],
  )

  const pinnedCount = pinnedItems.length
  const itemsLength = items.length

  // Строке отдаётся уже готовый БУЛЕВ `isRevealed`, а не число `revealIdx`: иначе
  // каждый шаг волны (раз в 8.3 мс) менял бы проп у всех строк окна и
  // перерисовывал бы их все, хотя раскрывается ровно одна. Это покрыто тестом
  // «шаг волны reveal перерисовывает ровно одну строку».
  //
  // Сам `useCallback` здесь СОЗНАТЕЛЬНО НЕ ПОКРЫТ: его снятие не красит ни одного
  // теста и в принципе не наблюдаемо снаружи. Он экономит холостой проход по окну
  // на тех рендерах `DeferredSortedVirtualList`, где ни одна зависимость ниже не
  // изменилась (а таких много: очередь reveal — состояние этого компонента, любой
  // enqueue/dequeue его перерисовывает), — без него строки окна перерисовались бы
  // все, но дальше их всё равно останавливает `memo` на `DeferredItem`: его пропы
  // на таком рендере равны по ссылке, и дорогой `renderItem` потребителя не
  // зовётся. То есть строка экономит работу React'а, но не меняет ничего, что
  // видно тесту.
  const renderVirtualItem = useCallback(
    (p: VirtualListItemProps<DeferredSortedVirtualListItem<T> | null>) => (
      <DeferredItem
        item={p.item}
        idx={p.idx}
        itemRef={p.itemRef}
        isRevealed={p.idx < revealIdx} // `:272`
        pinnedCount={pinnedCount}
        itemsLength={itemsLength}
        itemSize={itemSize}
        noAvatar={noAvatar}
        requestItemForIdx={requestItemForIdx}
        enqueueReveal={enqueueReveal}
        dequeueReveal={dequeueReveal}
        renderItem={renderItem}
      />
    ),
    [
      revealIdx,
      pinnedCount,
      itemsLength,
      itemSize,
      noAvatar,
      requestItemForIdx,
      enqueueReveal,
      dequeueReveal,
      renderItem,
    ],
  )

  return (
    <VerticalVirtualList
      listRef={listRef}
      className={className}
      list={fullItems} // `:268`
      getKey={getKey}
      renderItem={renderVirtualItem}
      scrollableHost={scrollableHost} // `:327`
      itemHeight={itemSize} // `:267`
      forceHostHeight={!wasAtLeastOnceFetched} // `:269`
      animate={animate} // `:270`
      thresholdPadding={THRESHOLD_PADDING} // `:328`
      extraPaddingBottom={extraPaddingBottom} // `:329`
    />
  )
}

/**
 * Строка списка: либо реальный элемент (`InnerItem`, `:173-197`), либо скелетон на
 * месте ещё не загруженного индекса (`:306-324`). Отдельный компонент, потому что
 * ему нужны свои эффекты — очередь reveal и запрос недостающей страницы.
 */
function DeferredItemInner<T>({
  item,
  idx,
  itemRef,
  isRevealed,
  pinnedCount,
  itemsLength,
  itemSize,
  noAvatar,
  requestItemForIdx,
  enqueueReveal,
  dequeueReveal,
  renderItem,
}: {
  item: DeferredSortedVirtualListItem<T> | null
  idx: number
  itemRef: (el: HTMLElement | null) => void
  isRevealed: boolean
  pinnedCount: number
  itemsLength: number
  itemSize: LoadingDialogSkeletonSize
  noAvatar?: boolean
  requestItemForIdx: (idx: number, itemsLength: number) => void
  enqueueReveal: (idx: number) => void
  dequeueReveal: (idx: number) => void
  renderItem: (p: DeferredSortedVirtualListRenderItemProps<T>) => ReactNode
}) {
  const canShow = !!item && isRevealed // `:273`

  // `:275-285` — индекс, который уже есть, но ещё не раскрыт, встаёт в очередь;
  // уход строки из окна снимает его с очереди.
  useEffect(() => {
    if (!item || isRevealed) return

    enqueueReveal(idx)

    return () => {
      dequeueReveal(idx)
    }
  }, [item, isRevealed, idx, enqueueReveal, dequeueReveal])

  // `:287-291` — за всё, что показать нельзя, просим страницу у владельца.
  // Индекс — БЕЗ закреплённых сверху: их владелец в своей нумерации не знает.
  // Индекс может выйти ОТРИЦАТЕЛЬНЫМ: пока волна reveal не дошла до закреплённой
  // строки, она тоже считается непоказанной и даёт `0 - pinnedCount`. Так же ведёт
  // себя оригинал (`:290`); владелец обязан игнорировать отрицательный и уже
  // загруженный индекс.
  useEffect(() => {
    if (canShow) return

    requestItemForIdx(idx - pinnedCount, itemsLength)
  }, [canShow, idx, pinnedCount, itemsLength, requestItemForIdx])

  const elRef = useRef<HTMLElement | null>(null)

  const setEl = useCallback(
    (el: HTMLElement | null) => {
      elRef.current = el
      itemRef(el)
    },
    [itemRef],
  )

  // `:176` — класс позиционирования навешивает список, а не строка. В отличие от
  // оригинала — не один раз при создании узла, а после КАЖДОГО коммита: в tweb
  // строка — vanilla-узел, её классы правит точечный `classList.toggle`, а у нас
  // атрибутом `class` владеет React, и первая же смена `className` потребителя
  // (выделение, unread) перезапишет атрибут целиком и снимет наш класс — строка
  // потеряет `position: absolute` и вывалится из потока списка.
  useLayoutEffect(() => {
    elRef.current?.classList.add(styles.Item)
  })

  if (!canShow || !item) {
    return (
      <LoadingDialogSkeleton
        className={styles.Item}
        // В оригинале скелетон получает тот же АНИМИРОВАННЫЙ `top`, что и строка
        // (`:314`). У нас анимированное значение живёт в DOM за `itemRef`
        // (`useAnimatedTop`), а `LoadingDialogSkeleton` — порт 1:1 и ref наружу не
        // отдаёт; оборачивать его лишним узлом ради этого — сломать DOM 1:1 с tweb
        // ради 120 мс перехода у плейсхолдера. Позиция скелетона всегда
        // `idx * itemHeight`, как и целевое значение анимации.
        style={{ top: idx * itemSize + 'px' }}
        seed={idx}
        size={itemSize}
        noAvatar={noAvatar}
      />
    )
  }

  return <>{renderItem({ id: item.id, value: item.value, itemRef: setEl })}</>
}

// Второй рубеж мемоизации (первый — сама строка списка, `VerticalVirtualList`).
// Шаг волны reveal меняет `revealIdx` и, значит, ссылку на `renderVirtualItem` —
// строки окна перерисовываются все. Здесь это заканчивается: у `memo` меняется
// ровно один проп ровно у одной строки — её `isRevealed`, — поэтому дорогой
// `renderItem` потребителя (у нас это `ChatListItem`: аватар, rich-text превью,
// бэйджи) на шаге волны вызывается один раз, а не по разу на каждую раскрытую
// строку окна. Каст — обход потери дженерик-параметра в `memo`.
const DeferredItem = memo(DeferredItemInner) as typeof DeferredItemInner

export default DeferredSortedVirtualList
