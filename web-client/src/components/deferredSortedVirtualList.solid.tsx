/** @jsxImportSource solid-js */
// Порт tweb `src/components/deferredSortedVirtualList.tsx` (812502980, 449 строк) — 1:1.
// Надстройка над окном видимости `verticalVirtualList.solid.tsx`: список ВЛАДЕЕТ
// своими элементами (сигналы `items`/`pinnedItems`/`totalCount`), под ещё не
// загруженными индексами рисует скелетоны и просит владельца догрузить
// (`requestItemForIdx`), свежезагруженное раскрывает волной (`revealIdx`), а хвост
// дальше `EXTRA_ITEMS_TO_KEEP` за последней видимой строкой отрезает (`checkShrink`)
// и отдаёт (`onItemDiscard`), чтобы владелец откатил курсор (`onListShrinked`).
//
// Потребитель у tweb — `components/sortedDialogList.ts:64-141` (у нас — задача 1-4
// волны 7: `SortedDialogList` строит строку `DialogElement` в `getItemElement`,
// сам кладёт `list` в скроллер и зовёт `dispose` в `destroy`).
//
// Включены коммиты дельты 812502980: 108d3f301 (reveal всей готовой пачкой —
// `getNextRevealIdx`, и один таймер shrink вместо переарма на каждую строку),
// 2b00c4dae (`onItemDiscard`), ee6f7f9c2 (`onItemMount`).
//
// Это Solid-форма ядра, которое раньше портировано под React
// (`components/virtual/DeferredSortedVirtualList.tsx`, данными не владеет). Её
// Отступления (спека `docs/superpowers/specs/2026-08-13-virtual-chatlist-design.md`)
// здесь сняты: shrink портирован (№1 — у Solid-ядра есть владение элементами, ради
// которого shrink и существует), анимация `top` и класс позиционирования пишутся
// одним владельцем — самим ядром (№2, №3). React-ядро живёт, пока его держат
// React-потребители (`ChatList`, `ArchiveList`, `TopicsPanel`), и уходит с последним
// из них (задача 1-6).
//
// Отличия от оригинала — только типы (`strict`, без `any`):
// 1. ключ элемента `any` → `unknown` (у `sortedDialogList` ключ — `PeerId` или
//    объект кастомной строки, `:97-98`);
// 2. `ref={list}` → колбэк `(el) => list = el` — так `ref` объявлен у нашего
//    `VerticalVirtualList` (см. его шапку), компилятор Solid делает то же присваивание;
// 3. JSX списка — генерик `VerticalVirtualList<Item | null>`, `props.item?.value`
//    приводится к `T` (оригинал полагается на `any`).
import {
  createSignal,
  createMemo,
  createRenderEffect,
  Show,
  createEffect,
  createRoot,
  batch,
  untrack,
  onCleanup,
  createComputed,
  on,
} from 'solid-js'

import LoadingDialogSkeleton, { type LoadingDialogSkeletonSize } from '@components/loadingDialogSkeleton.solid'
import VerticalVirtualList, { type VerticalVirtualListItemProps, VIRTUAL_LIST_ITEM_CLASS_NAME } from '@components/verticalVirtualList.solid'

type CreateDeferredSortedVirtualListArgs<T> = {
  scrollable: HTMLElement
  getItemElement: (item: T, id: unknown) => HTMLElement
  // * The row is in the list now - the one moment its place in the DOM can be relied upon: an item
  // * is built before it is ever mounted (the list loads ahead of the scroll), and a row that is
  // * remounted may have missed whatever the list went through while it was out
  onItemMount?: (item: T, element: HTMLElement) => void
  onItemUnmount?: (item: T) => void
  // * Unlike onItemUnmount (the row merely left the rendered window and is kept for re-mounting),
  // * this fires when the list drops the item for good - removed, trimmed by checkShrink, cleared or
  // * disposed - and the owner will never see it again. Without it an owner that allocates per-item
  // * resources (middleware, players, canvases) has no point at which to release them.
  onItemDiscard?: (item: T) => void
  onListShrinked: () => void
  requestItemForIdx: (idx: number, itemsLength: number) => void
  sortWith: (a: number, b: number) => number
  itemSize: LoadingDialogSkeletonSize
  noAvatar?: boolean
  onListLengthChange?: () => void
  extraPaddingBottom?: number
}

export type DeferredSortedVirtualListItem<T> = {
  id: unknown
  index: number
  value: T
}

const EXTRA_ITEMS_TO_KEEP = 50

/**
 * How far the reveal threshold jumps once a batch of loaded-but-hidden rows is ready.
 *
 * Reveal used to advance to (lowest queued index + 1), which let through exactly ONE row
 * per timer: a window of N rows needed N serial ~8ms hops, and every hop is a `setTimeout`,
 * so a main thread busy with scrolling stretches them and the tail of the window keeps
 * showing skeletons for up to a second even though the dialogs are already in memory.
 * The whole ready batch can go at once — the single tick still keeps rows from popping in
 * on the same frame they arrive.
 */
export function getNextRevealIdx(queued: number[]) {
  let max = -1
  for(const idx of queued) {
    if(idx > max) max = idx
  }

  return max < 0 ? null : max + 1
}

export const createDeferredSortedVirtualList = <T, >(args: CreateDeferredSortedVirtualListArgs<T>) => createRoot((dispose) => {
  const {
    scrollable,
    getItemElement,
    onItemMount,
    onItemUnmount,
    onItemDiscard,
    onListShrinked,
    requestItemForIdx,
    sortWith,
    itemSize,
    onListLengthChange,
    noAvatar,
    extraPaddingBottom = 8,
  } = args

  const [items, setItems] = createSignal<DeferredSortedVirtualListItem<T>[]>([])
  const [pinnedItems, setPinnedItems] = createSignal<DeferredSortedVirtualListItem<T>[]>([])
  const [totalCount, setTotalCount] = createSignal(0)
  const [wasAtLeastOnceFetched, setWasAtLeastOnceFetched] = createSignal(false)
  const [revealIdx, setRevealIdx] = createSignal(Infinity)
  const [blockedAnimationCount, setBlockedAnimationCount] = createSignal(0)
  const blockedAnimationCallbacks = new Set<object>()

  const [visibleItems, setVisibleItems] = createSignal(new Set<number>(), { equals: false })

  const sortedItems = createMemo(() => items().slice().sort((a, b) => sortWith(a.index, b.index)))
  const itemsMap = createMemo(() => new Map([...pinnedItems(), ...items()].map((item) => [item.id, item.value])))

  const fullItems = createMemo(() => {
    const realItems = [...pinnedItems(), ...sortedItems()]

    return new Array(Math.max(totalCount() + pinnedItems().length, realItems.length))
    .fill(null)
    .map((_, idx): DeferredSortedVirtualListItem<T> | null => realItems[idx] || null)
  })

  const itemsLength = createMemo(() => items().length)

  createEffect(() => {
    if(!wasAtLeastOnceFetched()) return

    itemsLength()
    untrack(() => onListLengthChange?.())
  })

  createComputed(on(wasAtLeastOnceFetched, () => {
    if(!wasAtLeastOnceFetched()) return

    setRevealIdx(items().length)
  }))

  // * Re-adding an id replaces the value behind it, so the previous one is dropped for good - unless
  // * it is the very same object being re-added, which is the common no-op case
  const replacedBy = (
    previous: DeferredSortedVirtualListItem<T>[],
    newItems: DeferredSortedVirtualListItem<T>[],
  ) => {
    const values = new Map(newItems.map((item) => [item.id, item.value]))
    return previous.filter((item) => values.has(item.id) && values.get(item.id) !== item.value)
  }

  const addItems = (newItems: DeferredSortedVirtualListItem<T>[]) => {
    if(!newItems.length) return
    const ids = new Set(newItems.map((item) => item.id))
    const replaced = replacedBy(items(), newItems)
    setItems((prev) => [
      ...prev.filter((item) => !ids.has(item.id)),
      ...newItems,
    ])
    discard(replaced)
  }

  const addPinnedItems = (newItems: DeferredSortedVirtualListItem<T>[]) => {
    if(!newItems.length) return
    const ids = new Set(newItems.map((item) => item.id))
    const replaced = replacedBy(pinnedItems(), newItems)
    setPinnedItems((prev) => [
      ...prev.filter((item) => !ids.has(item.id)),
      ...newItems,
    ])
    discard(replaced)
  }

  /**
   * Doesn't replace if already pinned
   */
  const ensurePinnedItems = (newItems: DeferredSortedVirtualListItem<T>[]) => {
    if(!newItems.length) return

    setPinnedItems((prev) => {
      const ids = new Set(prev.map((item) => item.id))
      return [
        ...prev,
        ...newItems.filter((item) => !ids.has(item.id)),
      ]
    })
  }

  const discard = (discarded: DeferredSortedVirtualListItem<T>[]) => {
    if(!onItemDiscard) return
    for(const item of discarded) onItemDiscard(item.value)
  }

  // * Both bail before writing when the id is not theirs: the setter would hand back a fresh array
  // * either way, invalidating the signal and every memo over it (itemsMap, the rendered list) for a
  // * removal that did not happen. delete() calls both on every key, so one of them always misses.
  const removePinnedItem = (id: unknown) => {
    const discarded = pinnedItems().filter((item) => id === item.id)
    if(!discarded.length) return false

    setPinnedItems((prev) => prev.filter((item) => id !== item.id))
    discard(discarded)
    return true
  }

  // * Reports what it actually removed. It used to answer from itemsMap(), which merges the pinned
  // * collection in, so a pinned id got a truthy answer from a call that removed nothing.
  const removeItem = (id: unknown) => {
    const discarded = items().filter((item) => id === item.id)
    if(!discarded.length) return false

    setItems((prev) => prev.filter((item) => id !== item.id))
    discard(discarded)
    return true
  }

  const updateItem = (id: unknown, index: number) => {
    setItems((prev) => {
      const foundItem = prev.find((item) => item.id === id)
      if(foundItem) foundItem.index = index // we're not spreading here as we want to keep the same object reference for the animation to trigger
      return [...prev]
    })
  }

  const has = (id: unknown) => {
    return itemsMap().has(id)
  }

  const get = (id: unknown) => {
    return itemsMap().get(id)
  }

  const clear = () => {
    const discarded = [...pinnedItems(), ...items()]
    batch(() => {
      setItems([])
      setPinnedItems([])
      setTotalCount(0)
      setWasAtLeastOnceFetched(false)
      setRevealIdx(Infinity)
      blockedAnimationCallbacks.clear()
      setBlockedAnimationCount(0)
    })
    discard(discarded)
  }

  let list!: HTMLUListElement

  const InnerItem = (props: { id: unknown, value: T, top: number, animating: boolean }) => {
    const element = createMemo(() => {
      const element = getItemElement(props.value, props.id)
      element?.classList.add(VIRTUAL_LIST_ITEM_CLASS_NAME)

      onCleanup(() => {
        onItemUnmount?.(props.value)
      })

      return element
    })

    // * effects run once the rendered nodes are in the document, so the row is inside the list here
    createEffect(() => {
      const _element = element()
      if(_element) untrack(() => onItemMount?.(props.value, _element))
    })

    createRenderEffect(() => {
      element()?.style.setProperty('top', props.top + 'px')
    })

    createEffect(() => {
      if(props.animating)
        element()?.style.setProperty('--background', /* 'red' */'var(--surface-color)')
      else
        element()?.style.removeProperty('--background')
    })

    return <>{element()}</>
  }

  const [queuedToBeRevealed, setQueuedToBeRevealed] = createSignal<number[]>([])

  const nextRevealIdx = createMemo(() => getNextRevealIdx(queuedToBeRevealed()))

  createEffect(() => {
    const next = nextRevealIdx()

    if(next === null) return

    const timeout = self.setTimeout(() => {
      batch(() => {
        setRevealIdx((prev) => Math.max(next, prev))
        setQueuedToBeRevealed((prev) => prev.filter((n) => next <= n))
      })
    }, 1000 / 60 / 2)

    onCleanup(() => {
      self.clearTimeout(timeout)
    })
  })

  function checkShrink(visibleItems: Set<number>, itemsLength: number) {
    const maxVisible = Math.max(0, ...Array.from(visibleItems.values()))

    const toKeep = maxVisible - pinnedItems().length + EXTRA_ITEMS_TO_KEEP

    if(itemsLength > toKeep) {
      // The trimmed tail is dropped for good - hand it to the owner before it goes out of reach
      const discarded = sortedItems().slice(toKeep)
      batch(() => {
        // Should be sortedItems() here, because the updated cursor is based on the last item from the list, and might skip a few dialogs if wasn't set the right cursor
        setItems(sortedItems().slice(0, toKeep))
        setRevealIdx(toKeep)
      })
      discard(discarded)
      onListShrinked()
    }
  }

  function blockAnimation() {
    setBlockedAnimationCount((prev) => prev + 1)

    const ref = {}
    blockedAnimationCallbacks.add(ref)

    return () => {
      if(blockedAnimationCallbacks.has(ref)) {
        blockedAnimationCallbacks.delete(ref)
        setBlockedAnimationCount((prev) => Math.max(0, prev - 1))
      }
    }
  }

  let shrinkTimeout: number | undefined
  let shrinkMovedSinceScheduled = false

  // Wait for a tick in which nothing moved before shrinking, so the list is never cut
  // out from under a scroll that is still running. `visibleItems` is written on EVERY
  // row mount and unmount, though, and re-arming the timer on each of those churned a
  // clearTimeout + setTimeout pair per row; one pending timer that re-checks on each
  // tick debounces exactly the same way for a fraction of the timer traffic.
  const scheduleShrink = () => {
    shrinkTimeout = self.setTimeout(() => {
      if(shrinkMovedSinceScheduled) {
        shrinkMovedSinceScheduled = false
        scheduleShrink()
        return
      }

      shrinkTimeout = undefined
      checkShrink(visibleItems(), itemsLength())
    }, 0)
  }

  createEffect(on(visibleItems, () => {
    if(shrinkTimeout !== undefined) {
      shrinkMovedSinceScheduled = true
      return
    }

    shrinkMovedSinceScheduled = false
    scheduleShrink()
  }))

  // * узел списка забирает `ref` — сам JSX-результат никуда не вставляется (владелец кладёт `list` сам)
  void (<VerticalVirtualList<DeferredSortedVirtualListItem<T> | null>
    ref={(el) => list = el}
    itemHeight={itemSize}
    list={fullItems()}
    forceHostHeight={!wasAtLeastOnceFetched()}
    animate={blockedAnimationCount() === 0}
    ListItem={(props: VerticalVirtualListItemProps<DeferredSortedVirtualListItem<T> | null>) => {
      const isRevealed = createMemo(() => props.idx < revealIdx())
      const canShow = createMemo(() => props.item && isRevealed())

      createEffect(() => {
        if(!props.item || isRevealed()) return

        const idx = props.idx

        setQueuedToBeRevealed((prev) => [...prev, idx])

        onCleanup(() => {
          setQueuedToBeRevealed((prev) => prev.filter((n) => n !== idx))
        })
      })

      createEffect(() => {
        if(canShow()) return

        requestItemForIdx(props.idx - pinnedItems().length, items().length)
      })

      createComputed(() => {
        const idx = props.idx
        setVisibleItems((prev) => prev.add(idx))

        onCleanup(() => {
          setVisibleItems((prev) => {
            prev.delete(idx)
            return prev
          })
        })
      })

      return (
        <Show
          when={canShow()}
          fallback={
            <LoadingDialogSkeleton
              class={VIRTUAL_LIST_ITEM_CLASS_NAME}
              style={{ top: props.top + 'px' }}
              seed={props.idx}
              size={itemSize}
              noAvatar={noAvatar}
            />
          }
        >
          <InnerItem
            id={props.item?.id}
            value={props.item?.value as T}
            top={props.top}
            animating={props.animating}
          />
        </Show>
      )
    }}
    scrollableHost={scrollable}
    thresholdPadding={72 * 4}
    extraPaddingBottom={extraPaddingBottom} // 0.5rem
  />)

  return {
    dispose: () => {
      const discarded = [...pinnedItems(), ...items()]
      dispose()
      discard(discarded)
    },

    list,

    setTotalCount,

    sortedItems,
    itemsLength,
    addItems,
    addPinnedItems,
    ensurePinnedItems,
    removePinnedItem,
    updateItem,
    removeItem,
    setWasAtLeastOnceFetched,

    blockAnimation,

    clear,
    has,
    get,
    getAll: () => itemsMap(),
  }
})
