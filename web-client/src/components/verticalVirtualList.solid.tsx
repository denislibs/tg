/** @jsxImportSource solid-js */
// Порт tweb `src/components/verticalVirtualList.tsx` (191 строка) — 1:1.
// Абсолютно спозиционированные строки внутри `ul` фиксированной высоты; в DOM
// живут только индексы из окна видимости, посчитанного из `scrollTop` хоста.
//
// Это ОРИГИНАЛЬНАЯ (Solid) форма того же ядра, что раньше портировано под React
// в `components/virtual/VerticalVirtualList.tsx`: там окно — состояние
// родителя с троттлингом измерения, здесь — `createSelector` + `<Show>` на
// строку, как у tweb (`:65-74`, `:103-109`). Потребитель — Solid-вкладка
// «Чаты» правой колонки (`sidebarRight/savedDialogsTab.solid.tsx`).
//
// Отличия только в типах: `any[]` → generic `T`, `Ref` → колбэк (единственный
// вызывающий передаёт колбэк), у `prevDiff` явный стартовый `undefined` —
// `strict` у нас включён.
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
  thresholdPadding: number

  animate: boolean

  forceHostHeight?: boolean
  extraPaddingBottom?: number
}

function VerticalVirtualList<T>(props: VerticalVirtualListProps<T>) {
  const totalCount = createMemo(() => props.list.length)

  const [scrollAmount, setScrollAmount] = createSignal(0)
  const hostSize = useElementSize(() => props.scrollableHost)

  onMount(() => {
    const listenerSetter = new ListenerSetter()

    listenerSetter.add(props.scrollableHost)('scroll', () => {
      setScrollAmount(props.scrollableHost.scrollTop)
    })

    onCleanup(() => {
      listenerSetter.removeAll()
    })
  })

  const onScrollShift = (amount: number) => {
    untrack(() => {
      props.scrollableHost.scrollTop -= amount
    })
  }

  const shouldAnimate = useShouldAnimate({
    list: () => props.list,
    hostHeight: () => hostSize.height,
    itemHeight: () => props.itemHeight,
    scrollAmount,
    onScrollShift,
  })

  const canAnimate = createMemo(() => shouldAnimate() && props.animate)

  const isVisible = createSelector(
    () => [scrollAmount(), hostSize.height, props.itemHeight, props.thresholdPadding] as const,
    (
      idx: number,
      [scrollAmount, hostHeight, itemHeight, padding],
    ) => (
      idx * itemHeight >= scrollAmount - padding &&
      (idx + 1) * itemHeight <= scrollAmount + hostHeight + padding
    ),
  )

  const Item: Component<{ idx: number, item: T }> = (itemProps) => {
    const animatedTop = createAnimatedValue(() => itemProps.idx * props.itemHeight, 120, undefined, canAnimate)

    return (
      <props.ListItem
        idx={itemProps.idx}
        item={itemProps.item}
        top={animatedTop()}
        animating={animatedTop.animating()}
      />
    )
  }

  const computedItemsHeight = () => totalCount() * props.itemHeight + Number(!!totalCount()) * (props.extraPaddingBottom || 0)

  const height = createMemo(() => props.forceHostHeight ? hostSize.height : computedItemsHeight())

  return (
    <ul
      ref={props.ref}
      class={props.class}
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

type UseShouldAnimateArgs<T> = {
  list: Accessor<T[]>
  scrollAmount: Accessor<number>
  itemHeight: Accessor<number>
  hostHeight: Accessor<number>

  onScrollShift: (amount: number) => void
}

/**
 * If all the items from the viewport of the host element shift by the same amount, don't animate them
 *
 * For example when a new chat appears on top, and we have some scroll, prevent all the chats from viewport
 * moving at the same time
 */
function useShouldAnimate<T>({ list, scrollAmount, hostHeight, itemHeight, onScrollShift }: UseShouldAnimateArgs<T>) {
  const [shouldAnimate, setShouldAnimate] = createSignal(true)

  const isActuallyVisible = createSelector(
    () => [scrollAmount(), hostHeight(), itemHeight()] as const,
    (
      idx: number,
      [scrollAmount, hostHeight, itemHeight],
    ) => (
      (idx + 1) * itemHeight >= scrollAmount &&
      idx * itemHeight <= scrollAmount + hostHeight
    ),
  )

  createComputed(on(list, (current, prev: T[] = []) => {
    const visiblePrev = prev.filter((_, i) => isActuallyVisible(i))
    const visibleNow = current.filter((_, i) => isActuallyVisible(i))

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

      const diff = prevIdx - currentIdx

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

    setShouldAnimate(!allChangedTheSameAmount)

    if(allChangedTheSameAmount) {
      onScrollShift((prevDiff ?? 0) * itemHeight())
    }

    return current
  }))

  return shouldAnimate
}

export default VerticalVirtualList
