/** @jsxImportSource solid-js */
// Порт tweb `src/components/verticalVirtualList.tsx` (812502980, 248 строк) — 1:1.
// Абсолютно спозиционированные строки внутри `ul` фиксированной высоты; в DOM
// живут только индексы из окна видимости, посчитанного из `scrollTop` хоста.
//
// Это ОРИГИНАЛЬНАЯ (Solid) форма того же ядра, что раньше портировано под React
// в `components/virtual/VerticalVirtualList.tsx`: там окно — состояние
// родителя с троттлингом измерения, здесь — `createSelector` + `<Show>` на
// строку, как у tweb (`:65-74`, `:103-109`). Потребители — Solid-ядро списков
// диалогов (`components/deferredSortedVirtualList.solid.tsx`) и список
// вкладки контактов (`sidebarLeft/contactsList.solid.tsx`).
//
// Отличия только в типах: `any[]` → generic `T`, `Ref` → колбэк (вызывающие
// передают колбэк), у `prevDiff`/`prevLayout` явный стартовый `undefined` —
// `strict` у нас включён.
//
// Дельта 812502980, доехавшая сюда вместе со списком контактов
// (`components/sidebarLeft/contactsList.solid.tsx`, коммиты 60a83a6f1 и ee6f7f9c2):
// `layout` для строк разной высоты (`ItemsLayout`, `createItemsLayout`), класс
// строки `VIRTUAL_LIST_ITEM_CLASS_NAME`, память высоты хоста нулевой высоты
// (`hostHeight`) и `role="presentation"` у `ul` (472e3e76b).
//
// Расхождение (наше, задача 1-4 волны 7): пустой список, получивший строки, заново
// читает `scrollTop` хоста (`refreshScrollAmount`). Список папки чатлиста чистится,
// пока её кадр скрыт (`.tabs-tab { display: none }`, `appDialogsManager` — по концу
// перехода и перед показом), а браузер обнуляет позицию скрытого скроллера БЕЗ
// события `scroll`: у оригинала окно видимости при возврате в папку считалось бы от
// прежней прокрутки, и верх списка оставался бы пустым. Прежний React-список чинил
// то же пересозданием `ul` на каждый `clear()` (замер на стенде, задача 6 плана папок).
import {
  createSignal,
  onCleanup,
  onMount,
  createSelector,
  createMemo,
  For,
  Show,
  createComputed,
  on,
  untrack,
  type Accessor,
  type Component,
} from 'solid-js'

import createAnimatedValue from '@helpers/solid/createAnimatedValue'
import ListenerSetter from '@helpers/listenerSetter'
import useElementSize from '@helpers/solid/useElementSize'
import styles from '@components/verticalVirtualList.module.scss'

/** What every item the list places wears - it lies over the list at the place the list gives it */
export const VIRTUAL_LIST_ITEM_CLASS_NAME = styles.item

export type VerticalVirtualListItemProps<T = unknown> = {
  item: T
  top: number
  idx: number
  animating: boolean
}

export type VerticalVirtualListProps<T> = {
  ref?: (el: HTMLUListElement) => void
  list: T[]
  ListItem: Component<VerticalVirtualListItemProps<T>>

  class?: string
  scrollableHost: HTMLElement

  itemHeight: number
  /**
   * Where the items start, for a list whose items are not all `itemHeight` tall - a section header
   * between the rows, say (`createItemsLayout` lays one out). Without it every item is `itemHeight`,
   * and the items are laid out by their index alone.
   */
  layout?: ItemsLayout
  thresholdPadding: number

  animate: boolean

  forceHostHeight?: boolean
  extraPaddingBottom?: number
}

function VerticalVirtualList<T>(props: VerticalVirtualListProps<T>) {
  const totalCount = createMemo(() => props.list.length)

  const [scrollAmount, setScrollAmount] = createSignal(0)
  const hostSize = useElementSize(() => props.scrollableHost)
  // * a host of no height is not laid out at all - its tab is hidden (`display: none`, settings
  // * opened over the chat list) - rather than one that shows nothing. The window of rows is kept as
  // * it was: shrinking it to nothing would drop every row, only to build them all anew - avatars and
  // * custom emoji along with them - the moment the tab is back
  const hostHeight = createMemo<number>((prev) => hostSize.height || prev, 0)

  // расхождение шапки: окно видимости заново от фактической прокрутки хоста
  createComputed(on(() => props.list.length > 0, (hasItems, hadItems) => {
    if(hasItems && !hadItems) setScrollAmount(props.scrollableHost.scrollTop)
  }, { defer: true }))

  onMount(() => {
    const listenerSetter = new ListenerSetter()

    listenerSetter.add(props.scrollableHost)('scroll', () => {
      setScrollAmount(props.scrollableHost.scrollTop)
    })

    onCleanup(() => {
      listenerSetter.removeAll()
    })
  })

  // * where every item starts, and where the last one ends: for a list of equal items it is their
  // * index times the height, as it always was
  const getLayout = (): ItemsLayout => props.layout || createUniformLayout(props.itemHeight)

  const onScrollShift = (amount: number) => {
    untrack(() => {
      props.scrollableHost.scrollTop -= amount
    })
  }

  const shouldAnimate = useShouldAnimate({
    list: () => props.list,
    hostHeight,
    getLayout,
    scrollAmount,
    onScrollShift,
  })

  const canAnimate = createMemo(() => shouldAnimate() && props.animate)

  const isVisible = createSelector(
    () => [scrollAmount(), hostHeight(), getLayout(), props.thresholdPadding] as const,
    (
      idx: number,
      [scrollAmount, hostHeight, layout, padding],
    ) => (
      layout.top(idx) >= scrollAmount - padding &&
      layout.top(idx + 1) <= scrollAmount + hostHeight + padding
    ),
  )

  const Item: Component<{ idx: number, item: T }> = (itemProps) => {
    const animatedTop = createAnimatedValue(() => getLayout().top(itemProps.idx), 120, undefined, canAnimate)

    return (
      <props.ListItem
        idx={itemProps.idx}
        item={itemProps.item}
        top={animatedTop()}
        animating={animatedTop.animating()}
      />
    )
  }

  const computedItemsHeight = () => getLayout().top(totalCount()) + Number(!!totalCount()) * (props.extraPaddingBottom || 0)

  const height = createMemo(() => props.forceHostHeight ? hostHeight() : computedItemsHeight())

  // `role="presentation"` is the same call `createChatList` already makes, for
  // the same reason: items go into this <ul> directly, so it has no <li> to own
  // and claiming to be a list would announce a structure that is not there. The
  // items are links and keep their own semantics — presentation only drops what
  // this element says about itself.
  //
  // Real list semantics would be worse than none here rather than better: the
  // list is windowed, so it would announce the size of the window instead of the
  // number of chats — "12 items" to someone who has two hundred is a confident
  // wrong answer. Giving that orientation back means `aria-setsize` /
  // `aria-posinset` carrying the real totals, and those need the items to be
  // listitems: a deliberate change, not an attribute.
  return (
    <ul
      ref={props.ref}
      class={props.class}
      role="presentation"
      style={{
        height: height() + 'px',
        overflow: props.forceHostHeight ? 'hidden' : undefined,
      }}
    >
      <For each={props.list}>
        {(item, idx) => (
          <Show when={isVisible(idx())}>
            <Item idx={idx()} item={item} />
          </Show>
        )}
      </For>
    </ul>
  )
}

/** Where the items of a list start: `top(idx)` for any index up to the length, which is where the list ends */
export type ItemsLayout = {
  top: (idx: number) => number
}

function createUniformLayout(itemHeight: number): ItemsLayout {
  return {
    top: (idx) => idx * itemHeight,
  }
}

/** Lays out a list whose items differ in height, for `VerticalVirtualList`'s `layout` */
export function createItemsLayout<T>(list: T[], getItemHeight: (item: T) => number): ItemsLayout {
  const tops = new Array<number>(list.length + 1)
  tops[0] = 0
  for(let i = 0; i < list.length; ++i) {
    tops[i + 1] = tops[i] + getItemHeight(list[i])
  }

  return {
    top: (idx) => tops[Math.min(idx, list.length)],
  }
}

type UseShouldAnimateArgs<T> = {
  list: Accessor<T[]>
  scrollAmount: Accessor<number>
  getLayout: Accessor<ItemsLayout>
  hostHeight: Accessor<number>

  onScrollShift: (amount: number) => void
}

/**
 * If all the items from the viewport of the host element shift by the same amount, don't animate them
 *
 * For example when a new chat appears on top, and we have some scroll, prevent all the chats from viewport
 * moving at the same time
 */
function useShouldAnimate<T>({ list, scrollAmount, hostHeight, getLayout, onScrollShift }: UseShouldAnimateArgs<T>) {
  const [shouldAnimate, setShouldAnimate] = createSignal(true)

  const isActuallyVisible = (layout: ItemsLayout, idx: number) => {
    const top = scrollAmount()
    return layout.top(idx + 1) >= top &&
      layout.top(idx) <= top + hostHeight()
  }

  // * the layout the previous list was laid out with - an item that has not moved in the list can
  // * still have moved on screen, when an item of another height went in above it
  let prevLayout: ItemsLayout | undefined
  createComputed(on(list, (current, prev: T[] = []) => {
    const layout = getLayout()
    const visiblePrev = prevLayout ? prev.filter((_, i) => isActuallyVisible(prevLayout!, i)) : []
    const visibleNow = current.filter((_, i) => isActuallyVisible(layout, i))

    const visiblePrevAndNow = Array.from(new Set([...visibleNow, ...visiblePrev]))

    let allChangedTheSameAmount = true
    let prevDiff: number | undefined

    for(const item of visiblePrevAndNow) {
      const prevIdx = prev.indexOf(item)
      const currentIdx = current.indexOf(item)

      if(prevIdx === -1 || currentIdx === -1) {
        allChangedTheSameAmount = false
        break
      }

      const diff = prevLayout!.top(prevIdx) - layout.top(currentIdx)

      if(typeof prevDiff === 'undefined') {
        prevDiff = diff
        continue
      }

      if(prevDiff !== diff) {
        allChangedTheSameAmount = false
        break
      }
    }

    if(!visiblePrevAndNow.length) {
      allChangedTheSameAmount = false
      prevDiff = 0
    }

    prevLayout = layout

    setShouldAnimate(!allChangedTheSameAmount)

    if(allChangedTheSameAmount) {
      onScrollShift(prevDiff ?? 0)
    }

    return current
  }))

  return shouldAnimate
}

export default VerticalVirtualList
