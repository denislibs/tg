/** @jsxImportSource solid-js */
// Пины Solid-порта tweb `src/components/deferredSortedVirtualList.tsx` (812502980) —
// `deferredSortedVirtualList.solid.tsx` поверх `verticalVirtualList.solid.tsx`.
//
// Откуда сценарии (спека § 5: «тесты-предохранители переписываются, а не удаляются»):
// - тесты tweb `src/tests/deferredSortedVirtualListDiscard.test.tsx` и
//   `deferredSortedVirtualListReveal.test.ts` — дословно по смыслу;
// - пины React-ядра `components/virtual/{DeferredSortedVirtualList,useShouldAnimate,
//   useAnimatedTop}.test.*` — в новой форме: ядро здесь владеет элементами (фабрика
//   tweb), поэтому пины гонят его API, а не пропы React-компонента. React-пины
//   стабильности ссылок (`memo`/`useCallback`, «класс переживает смену className»)
//   предмета не имеют: строку строит `getItemElement` один раз на монтирование,
//   её `class` React не переписывает.
// - shrink (`EXTRA_ITEMS_TO_KEEP`) — новый пин: в React-ядре его не было
//   (снятое Отступление 1 спеки `2026-08-13-virtual-chatlist-design.md`).
//
// Геометрия: itemSize 72, хост 720 (стаб `getBoundingClientRect` — его читает
// `useElementSize`), thresholdPadding 72*4 = 288 → при scrollTop 0 в окне индексы
// 0..13; «по-настоящему видимые» (`useShouldAnimate`, без overscan) — 0..10.
// Таймеры фейковые во всех тестах: волна раскрытия, shrink и анимация `top`
// (`createAnimatedValue` → `requestAnimationFrame`) — на них.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batch } from 'solid-js'

import { createDeferredSortedVirtualList, getNextRevealIdx, type DeferredSortedVirtualListItem } from './deferredSortedVirtualList.solid'
import { VIRTUAL_LIST_ITEM_CLASS_NAME } from './verticalVirtualList.solid'
import skeletonStyles from './loadingDialogSkeleton.module.scss'

type Chat = { title: string }
type List = ReturnType<typeof createDeferredSortedVirtualList<Chat>>
type Args = Parameters<typeof createDeferredSortedVirtualList<Chat>>[0]

const HOST_HEIGHT = 720
const ITEM = 72

let lists: List[] = []

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const list of lists) list.dispose()
  lists = []
  document.body.innerHTML = ''
  vi.useRealTimers()
})

/** Сортировка как у `sortedDialogList.ts:126` (`b - a`): больший индекс — выше. Идут id 0, 1, 2… */
const item = (id: number | string, index = 1000 - Number(id)): DeferredSortedVirtualListItem<Chat> => ({
  id,
  index,
  value: { title: 'chat ' + id },
})

const items = (n: number, from = 0) => Array.from({ length: n }, (_, i) => item(from + i))

function setup(over: Partial<Args> = {}) {
  const scrollable = document.createElement('div')
  scrollable.getBoundingClientRect = () =>
    ({ width: 360, height: HOST_HEIGHT, top: 0, left: 0, right: 360, bottom: HOST_HEIGHT, x: 0, y: 0, toJSON() {} }) as DOMRect
  document.body.append(scrollable)

  const spies = {
    onItemDiscard: vi.fn<(value: Chat) => void>(),
    onItemMount: vi.fn<(value: Chat, element: HTMLElement) => void>(),
    onItemUnmount: vi.fn<(value: Chat) => void>(),
    onListShrinked: vi.fn<() => void>(),
    onListLengthChange: vi.fn<() => void>(),
    requestItemForIdx: vi.fn<(idx: number, itemsLength: number) => void>(),
  }

  const list = createDeferredSortedVirtualList<Chat>({
    scrollable,
    getItemElement: (value, id) => {
      const element = document.createElement('a')
      element.className = 'row'
      element.dataset.id = String(id)
      element.title = value.title
      return element
    },
    sortWith: (a, b) => b - a,
    itemSize: 72,
    ...spies,
    ...over,
  })
  // * владелец сам кладёт `ul` в скроллер — `sortedDialogList.ts:141`, `this.list = virtualList.list`
  scrollable.append(list.list)
  lists.push(list)

  const scrollTo = (top: number) => {
    scrollable.scrollTop = top
    scrollable.dispatchEvent(new Event('scroll'))
  }

  return { list, scrollable, scrollTo, ...spies }
}

/** Первая отдача владельца: всё, что уже есть, раскрывается разом (`:121-125`). */
function fetched(list: List, loaded: DeferredSortedVirtualListItem<Chat>[], totalCount = loaded.length) {
  batch(() => {
    list.addItems(loaded)
    list.setTotalCount(totalCount)
    list.setWasAtLeastOnceFetched(true)
  })
}

const rows = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('.row'))
const rowIds = (host: HTMLElement) => rows(host).map((el) => el.dataset.id)
const row = (host: HTMLElement, id: number | string) => host.querySelector<HTMLElement>(`.row[data-id="${id}"]`)!
const skeletons = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('.loading-dialog-skeleton'))
const ul = (host: HTMLElement) => host.querySelector('ul')!
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i))

describe('getNextRevealIdx — порог волны раскрытия (108d3f301, tweb deferredSortedVirtualListReveal.test.ts)', () => {
  it('пустая очередь — раскрывать нечего', () => {
    expect(getNextRevealIdx([])).toBe(null)
  })

  it('вся готовая пачка — одним шагом, независимо от порядка постановки', () => {
    expect(getNextRevealIdx(Array.from({ length: 20 }, (_, i) => 290 + i))).toBe(310)
    expect(getNextRevealIdx([305, 291, 300, 290])).toBe(306)
  })

  it('окно в 20 строк сливается за один шаг, а не за 20 (старое правило min + 1)', () => {
    const drain = (queued: number[], step: (q: number[]) => number) => {
      let remaining = queued.slice()
      let hops = 0
      while(remaining.length) {
        const next = step(remaining)
        remaining = remaining.filter((n) => n >= next)
        ++hops
      }
      return hops
    }

    const window = Array.from({ length: 20 }, (_, i) => 290 + i)
    expect(drain(window, (q) => Math.min(...q) + 1)).toBe(20)
    expect(drain(window, (q) => getNextRevealIdx(q)!)).toBe(1)
  })

  it('одна строка и индекс 0 — не путаются с пустой очередью', () => {
    expect(getNextRevealIdx([7])).toBe(8)
    expect(getNextRevealIdx([0])).toBe(1)
  })
})

describe('дырки под незагруженными индексами (:102-110, :395-406)', () => {
  it('totalCount 100 при 10 загруженных: 10 строк и скелетоны на остальных индексах окна', () => {
    const { list, scrollable } = setup()
    fetched(list, items(10), 100)

    expect(rowIds(scrollable)).toEqual(range(0, 9))
    // Окно — 0..13, значит дырок ровно 4: 10, 11, 12, 13.
    expect(skeletons(scrollable).map((el) => el.style.top)).toEqual(['720px', '792px', '864px', '936px'])
  })

  it('высота ul — по totalCount плюс extraPaddingBottom 8 (`:84`), а не по числу загруженных', () => {
    const { list, scrollable } = setup()
    fetched(list, items(10), 100)

    expect(ul(scrollable).style.height).toBe(100 * ITEM + 8 + 'px')
  })

  it('до первой отдачи ul ростом с хост и overflow hidden (`forceHostHeight`, :358)', () => {
    const { scrollable } = setup()

    expect(ul(scrollable).style.height).toBe(HOST_HEIGHT + 'px')
    expect(ul(scrollable).style.overflow).toBe('hidden')
  })

  it('скелетон: класс позиционирования, size/noAvatar доезжают, seed — индекс', () => {
    const { list, scrollable } = setup({ itemSize: 64, noAvatar: true })
    fetched(list, [], 100)

    const all = skeletons(scrollable)
    expect(all[0].classList.contains(VIRTUAL_LIST_ITEM_CLASS_NAME)).toBe(true)
    expect(all[0].classList.contains(skeletonStyles.size64)).toBe(true)
    expect(all[0].classList.contains(skeletonStyles.noAvatar)).toBe(true)
    // шаг позиционирования — itemSize (`:356`): окно (idx + 1) * 64 <= 720 + 288 → idx <= 14
    expect(all.map((el) => el.style.top).slice(0, 3)).toEqual(['0px', '64px', '128px'])
    expect(all).toHaveLength(15)

    // Мутация `seed={props.idx}` → `seed={0}` делает весь столбец одинаковым.
    const widths = (el: HTMLElement) =>
      Array.from(el.querySelectorAll<HTMLElement>('div')).map((d) => d.style.getPropertyValue('--width')).join('|')
    expect(widths(all[0])).not.toBe(widths(all[1]))
  })
})

describe('requestItemForIdx (:376-380)', () => {
  it('зовётся для незагруженного индекса окна со вторым аргументом items.length, для загруженного — нет', () => {
    const { list, requestItemForIdx } = setup()
    fetched(list, items(10), 100)

    const requested = new Set(requestItemForIdx.mock.calls.map(([idx]) => idx))
    expect([...requested].sort((a, b) => a - b)).toEqual([10, 11, 12, 13])
    for (const [, length] of requestItemForIdx.mock.calls) expect(length).toBe(10)
  })

  it('индекс уменьшен на число закреплённых — владелец про них не знает', () => {
    const { list, scrollable, requestItemForIdx } = setup()
    batch(() => {
      list.addPinnedItems([item('archive', 0)])
      list.setTotalCount(100)
      list.setWasAtLeastOnceFetched(true)
    })
    vi.advanceTimersByTime(8)

    // Длина списка — totalCount ПЛЮС закреплённые (`:107`).
    expect(ul(scrollable).style.height).toBe(101 * ITEM + 8 + 'px')
    // Окно 0..13; idx 0 занят закреплённым, дырки 1..13 → запросы 0..12. До шага волны
    // закреплённый ещё не раскрыт (revealIdx = items.length = 0) и тоже просит -1 — так у tweb.
    const requested = new Set(requestItemForIdx.mock.calls.map(([idx]) => idx).filter((idx) => idx >= 0))
    expect([...requested].sort((a, b) => a - b)).toEqual(range(0, 12).map(Number))
    for (const [, length] of requestItemForIdx.mock.calls) expect(length).toBe(0)
  })
})

describe('закреплённые сверху (:105, :148-172)', () => {
  it('идут первыми, загруженные — следом по sortWith', () => {
    const { list, scrollable } = setup()
    batch(() => {
      list.addPinnedItems([item('archive', 0)])
      fetched(list, [item(2), item(0), item(1)])
    })
    // revealIdx = items.length = 3, закреплённый в этой длине не учтён — последний
    // индекс раскрывается шагом волны (поведение tweb 1:1).
    vi.advanceTimersByTime(8)

    expect(rowIds(scrollable)).toEqual(['archive', '0', '1', '2'])
    expect(rows(scrollable).map((el) => el.style.top)).toEqual(['0px', '72px', '144px', '216px'])
    expect(ul(scrollable).style.height).toBe(4 * ITEM + 8 + 'px')
  })

  it('ensurePinnedItems не заменяет уже закреплённый', () => {
    const { list, onItemDiscard } = setup()
    list.addPinnedItems([item('p', 0)])
    list.ensurePinnedItems([{ id: 'p', index: 0, value: { title: 'other' } }, item('q', 0)])

    expect(list.get('p')).toEqual({ title: 'chat p' })
    expect(list.has('q')).toBe(true)
    expect(onItemDiscard).not.toHaveBeenCalled()
  })
})

describe('волна раскрытия пачкой (:61-68, :273-289, 108d3f301)', () => {
  it('приехавшие после первой отдачи строки раскрываются ВСЕЙ пачкой за один шаг 1000/60/2', () => {
    const { list, scrollable } = setup()
    fetched(list, [], 100)

    list.addItems(items(10))
    expect(rowIds(scrollable)).toEqual([])

    // 1000/60/2 ≈ 8.33 мс; фейковые таймеры усекают задержку до целых — граница 7/8.
    vi.advanceTimersByTime(7)
    expect(rowIds(scrollable)).toEqual([])

    // Мутация: getNextRevealIdx → min + 1 (старая волна) — здесь была бы одна строка ['0'].
    vi.advanceTimersByTime(1)
    expect(rowIds(scrollable)).toEqual(range(0, 9))
  })

  it('уже загруженное на момент первой отдачи раскрывается сразу, без волны (:121-125)', () => {
    const { list, scrollable } = setup()
    fetched(list, items(10), 100)

    expect(rowIds(scrollable)).toEqual(range(0, 9))
  })

  it('строка ушла из окна, не дождавшись раскрытия, — снимается с очереди (:364-374)', () => {
    const { list, scrollable, scrollTo } = setup()
    fetched(list, [], 200)
    list.addItems(items(30))

    // Уезжаем до шага волны — в окне одни дырки, строки очереди размонтированы.
    scrollTo(100 * ITEM)
    expect(rowIds(scrollable)).toEqual([])
    vi.advanceTimersByTime(500)

    // Мутация «не снимать с очереди»: таймер очереди дотикал бы вслепую, и по
    // возвращении все 14 строк стояли бы сразу.
    scrollTo(0)
    expect(rowIds(scrollable)).toEqual([])

    vi.advanceTimersByTime(8)
    expect(rowIds(scrollable)).toEqual(range(0, 13))
  })

  it('clear() возвращает раскрытие в исходное «всё, что есть» (:218-231)', () => {
    const { list, scrollable, onItemDiscard } = setup()
    fetched(list, items(10), 100)

    list.clear()
    expect(rowIds(scrollable)).toEqual([])
    expect(ul(scrollable).style.height).toBe(HOST_HEIGHT + 'px')
    expect(onItemDiscard).toHaveBeenCalledTimes(10)

    // Без `setRevealIdx(Infinity)` порог залип бы на 10 — строки 10, 11 остались бы скелетонами.
    list.addItems(items(12))
    expect(rowIds(scrollable)).toEqual(range(0, 11))
  })
})

describe('shrink — EXTRA_ITEMS_TO_KEEP (:48, :291-307, :325-352)', () => {
  it('держит maxVisible + 50, хвост отдаёт onItemDiscard и зовёт onListShrinked', () => {
    const { list, scrollable, onItemDiscard, onListShrinked } = setup()
    fetched(list, items(120), 200)
    expect(list.itemsLength()).toBe(120)

    vi.advanceTimersByTime(1)

    // окно 0..13 → toKeep = 13 - 0 + 50 = 63
    expect(list.itemsLength()).toBe(63)
    expect(list.sortedItems()[62].id).toBe(62)
    expect(onListShrinked).toHaveBeenCalledTimes(1)
    expect(onItemDiscard.mock.calls.map(([value]) => value.title)).toEqual(range(63, 119).map((id) => 'chat ' + id))
    // Видимые строки не тронуты, высота — по totalCount.
    expect(rowIds(scrollable)).toEqual(range(0, 13))
    expect(ul(scrollable).style.height).toBe(200 * ITEM + 8 + 'px')
  })

  it('закреплённые не входят в счёт: toKeep = maxVisible - pinned + 50', () => {
    const { list } = setup()
    batch(() => {
      list.addPinnedItems([item('archive', 0)])
      fetched(list, items(120), 200)
    })

    vi.advanceTimersByTime(1)

    expect(list.itemsLength()).toBe(13 - 1 + 50)
  })

  it('ждёт тика, в котором окно не двигалось, и режет по окну на момент среза', () => {
    const { list, scrollTo } = setup()
    fetched(list, items(120), 200)

    // окно: idx * 72 >= 2880 - 288 → idx >= 36; (idx + 1) * 72 <= 2880 + 1008 → idx <= 53
    scrollTo(40 * ITEM)

    // Мутация «не перевзводить таймер, если окно двигалось» — срез случился бы уже здесь.
    vi.runOnlyPendingTimers()
    expect(list.itemsLength()).toBe(120)

    vi.runOnlyPendingTimers()
    expect(list.itemsLength()).toBe(53 + 50)
  })

  it('не режет, пока загружено не больше, чем нужно держать', () => {
    const { list, onListShrinked } = setup()
    fetched(list, items(63), 200)

    vi.advanceTimersByTime(1)

    expect(list.itemsLength()).toBe(63)
    expect(onListShrinked).not.toHaveBeenCalled()
  })
})

describe('анимация переезда (verticalVirtualList `useShouldAnimate` + `createAnimatedValue`)', () => {
  it('вставка сверху при прокрутке: видимая строка не сдвигается — без анимации, scrollTop компенсирован', () => {
    const { list, scrollable, scrollTo } = setup()
    fetched(list, items(60))
    scrollTo(20 * ITEM)
    expect(row(scrollable, 25).style.top).toBe(25 * ITEM + 'px')

    list.addItems([item('new', 2000)])

    // Мутация «анимировать невидимые» (видимость без границ вьюпорта) — новый элемент
    // попал бы в сравнение, единый сдвиг сломался бы, и строки поехали бы анимацией.
    expect(row(scrollable, 25).style.top).toBe(26 * ITEM + 'px')
    expect(row(scrollable, 25).style.getPropertyValue('--background')).toBe('')
    expect(scrollable.scrollTop).toBe(21 * ITEM)
  })

  it('перестановка видимых анимирует top 120 мс и ставит --background на время пути', () => {
    const { list, scrollable } = setup()
    fetched(list, items(20))
    const moved = row(scrollable, 3)
    expect(moved.style.top).toBe(3 * ITEM + 'px')

    list.updateItem(3, 2000)
    expect(rowIds(scrollable).slice(0, 4)).toEqual(['3', '0', '1', '2'])

    vi.advanceTimersByTime(112)
    const mid = parseFloat(moved.style.top)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(3 * ITEM)
    expect(moved.style.getPropertyValue('--background')).toBe('var(--surface-color)')

    // первый кадр, где прошло >= 120 мс, — 128-й (кадр фейкового rAF = 16 мс)
    vi.advanceTimersByTime(16)
    expect(moved.style.top).toBe('0px')
    expect(moved.style.getPropertyValue('--background')).toBe('')
  })

  it('перестановка только за краем вьюпорта (в overscan) — мгновенно, видимые не трогаются', () => {
    const { list, scrollable } = setup()
    fetched(list, items(20))
    // по-настоящему видимы 0..10, в DOM (overscan) — 0..13
    const twelve = row(scrollable, 12)

    list.updateItem(12, 1000 - 13.5)

    expect(rowIds(scrollable).slice(11, 14)).toEqual(['11', '13', '12'])
    // Мутация «анимировать невидимые» — строка 12 поехала бы анимацией.
    expect(twelve.style.top).toBe(13 * ITEM + 'px')
    expect(twelve.style.getPropertyValue('--background')).toBe('')
    expect(scrollable.scrollTop).toBe(0)
  })

  it('blockAnimation: пока держат — мгновенно, после отпускания — снова анимация; двойной release не уводит в минус', () => {
    const { list, scrollable } = setup()
    fetched(list, items(20))

    const release = list.blockAnimation()
    list.updateItem(3, 2000)
    // Мутация `animate={true}` — здесь была бы анимация.
    expect(row(scrollable, 3).style.top).toBe('0px')
    expect(row(scrollable, 3).style.getPropertyValue('--background')).toBe('')

    release()
    release()
    list.updateItem(5, 3000)
    expect(row(scrollable, 5).style.getPropertyValue('--background')).toBe('var(--surface-color)')
    vi.advanceTimersByTime(200)

    const releaseAgain = list.blockAnimation()
    list.updateItem(7, 4000)
    expect(row(scrollable, 7).style.top).toBe('0px')
    releaseAgain()
  })
})

describe('строка (:236-266)', () => {
  it('несёт класс позиционирования и top = idx * itemSize', () => {
    const { list, scrollable } = setup()
    fetched(list, items(5))

    expect(rows(scrollable).every((el) => el.classList.contains(VIRTUAL_LIST_ITEM_CLASS_NAME))).toBe(true)
    expect(row(scrollable, 3).style.top).toBe(3 * ITEM + 'px')
  })

  it('onItemMount — когда строка уже в документе; уход из окна — onItemUnmount, а не onItemDiscard', () => {
    const { list, scrollable, scrollTo, onItemMount, onItemUnmount, onItemDiscard } = setup()
    fetched(list, items(5), 100)

    expect(onItemMount).toHaveBeenCalledTimes(5)
    onItemMount.mockClear()
    let connectedAtMount: boolean | undefined
    onItemMount.mockImplementation((_, element) => {
      connectedAtMount = element.isConnected
    })
    list.addItems([item(5)])
    // строка 5 приехала после первой отдачи — она в волне раскрытия
    expect(onItemMount).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8)
    expect(onItemMount).toHaveBeenLastCalledWith({ title: 'chat 5' }, row(scrollable, 5))
    expect(connectedAtMount).toBe(true)

    scrollTo(50 * ITEM)
    expect(onItemUnmount).toHaveBeenCalledWith({ title: 'chat 5' })
    expect(onItemDiscard).not.toHaveBeenCalled()
    expect(list.has(5)).toBe(true)

    onItemMount.mockClear()
    scrollTo(0)
    expect(onItemMount).toHaveBeenCalledWith({ title: 'chat 5' }, row(scrollable, 5))
  })

  it('onListLengthChange — только после первой отдачи и на каждую смену длины', () => {
    const { list, onListLengthChange } = setup()
    list.addItems(items(3))
    expect(onListLengthChange).not.toHaveBeenCalled()

    list.setWasAtLeastOnceFetched(true)
    expect(onListLengthChange).toHaveBeenCalledTimes(1)

    list.addItems([item(3)])
    expect(onListLengthChange).toHaveBeenCalledTimes(2)
  })

  it('sortedItems / getAll — по sortWith; getAll включает закреплённые', () => {
    const { list } = setup()
    list.addPinnedItems([item('p', 0)])
    list.addItems([item(2), item(0), item(1)])

    expect(list.sortedItems().map((i) => i.id)).toEqual([0, 1, 2])
    expect([...list.getAll().keys()]).toEqual(['p', 2, 0, 1])
  })
})

describe('выброс элементов — onItemDiscard (2b00c4dae, tweb deferredSortedVirtualListDiscard.test.tsx)', () => {
  it('removeItem отдаёт снятый элемент', () => {
    const { list, onItemDiscard } = setup()
    list.addItems([item('a', 0), item('b', 1)])

    list.removeItem('a')

    expect(onItemDiscard).toHaveBeenCalledTimes(1)
    expect(onItemDiscard).toHaveBeenCalledWith({ title: 'chat a' })
  })

  it('removePinnedItem отдаёт закреплённый', () => {
    const { list, onItemDiscard } = setup()
    list.addPinnedItems([item('p', 0)])

    expect(list.removePinnedItem('p')).toBe(true)
    expect(onItemDiscard).toHaveBeenCalledWith({ title: 'chat p' })
  })

  it('каждая коллекция отвечает за себя', () => {
    const { list, onItemDiscard } = setup()
    list.addPinnedItems([item('p', 0)])
    list.addItems([item('a', 0)])

    expect(list.removeItem('p')).toBe(false)
    expect(list.removePinnedItem('a')).toBe(false)
    expect(onItemDiscard).not.toHaveBeenCalled()
    expect(list.has('p')).toBe(true)
    expect(list.removeItem('a')).toBe(true)
    expect(list.removePinnedItem('p')).toBe(true)
  })

  it('замена значения под тем же id отдаёт прежнее; тот же объект — нет', () => {
    const { list, onItemDiscard } = setup()
    const a = item('a', 0)
    list.addItems([a])

    list.addItems([{ ...a, index: 5 }])
    expect(onItemDiscard).not.toHaveBeenCalled()

    list.addItems([{ id: 'a', index: 0, value: { title: 'replacement' } }])
    expect(onItemDiscard).toHaveBeenCalledTimes(1)
    expect(onItemDiscard).toHaveBeenCalledWith({ title: 'chat a' })
  })

  it('id, которого не было, — не снятие', () => {
    const { list, onItemDiscard } = setup()
    list.addItems([item('a', 0)])

    expect(list.removeItem('missing')).toBe(false)
    expect(onItemDiscard).not.toHaveBeenCalled()
  })

  it('clear и dispose отдают всё', () => {
    const cleared = setup()
    cleared.list.addPinnedItems([item('p', 0)])
    cleared.list.addItems([item('a', 0), item('b', 1)])
    cleared.list.clear()
    expect(cleared.onItemDiscard.mock.calls.map(([v]) => v.title).sort()).toEqual(['chat a', 'chat b', 'chat p'])

    const disposed = setup()
    disposed.list.addItems([item('a', 0), item('b', 1)])
    disposed.list.dispose()
    lists = lists.filter((l) => l !== disposed.list)
    expect(disposed.onItemDiscard.mock.calls.map(([v]) => v.title).sort()).toEqual(['chat a', 'chat b'])
  })

  it('dispose снимает слушатель скролла хоста — окно больше не едет', () => {
    const { list, scrollable, scrollTo } = setup()
    fetched(list, items(60))
    list.dispose()
    lists = lists.filter((l) => l !== list)

    const before = rowIds(scrollable)
    scrollTo(30 * ITEM)
    expect(rowIds(scrollable)).toEqual(before)
  })
})
