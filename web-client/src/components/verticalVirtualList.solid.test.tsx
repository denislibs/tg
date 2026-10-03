/** @jsxImportSource solid-js */
// Пины `useShouldAnimate` Solid-ядра `verticalVirtualList.solid.tsx` (порт tweb
// `verticalVirtualList.tsx:129-189`, 812502980). Сценарии перенесены с React-носителя
// `components/virtual/useShouldAnimate.test.ts` (спека § 5: «тесты-предохранители
// переписываются, а не удаляются»; React-ядро снесено задачей 1-6 волны 7). Сценарии
// уровня списка диалогов (вставка сверху, перестановка видимых и за краем вьюпорта) —
// в `deferredSortedVirtualList.solid.test.tsx`; здесь — границы самого правила.
//
// Наблюдаем ВЫХОДЫ правила, а не внутренний сигнал: решение «не анимировать» видно
// по компенсирующей записи `scrollTop -= amount` (`onScrollShift`, :49-53) — её
// пишет только ветка «все видимые сдвинулись одинаково»; решение «анимировать» —
// по `animating` у переехавшей строки (`createAnimatedValue`).
//
// Элементы — объекты без идентификатора: правило обязано сравнивать по ссылке
// (`indexOf`). Высота строки 100, `thresholdPadding` 0.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'

import VerticalVirtualList, { type VerticalVirtualListItemProps } from './verticalVirtualList.solid'

type Tagged = { tag: number }

const ITEM = 100

let disposers: (() => void)[] = []

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const dispose of disposers) dispose()
  disposers = []
  document.body.innerHTML = ''
  vi.useRealTimers()
})

const makeItems = (n: number): Tagged[] => Array.from({ length: n }, (_, i) => ({ tag: i }))

function setup(initial: Tagged[], { scrollAmount, hostHeight }: { scrollAmount: number, hostHeight: number }) {
  const host = document.createElement('div')
  host.getBoundingClientRect = () =>
    ({ width: 360, height: hostHeight, top: 0, left: 0, right: 360, bottom: hostHeight, x: 0, y: 0, toJSON() {} }) as DOMRect
  // * записи `scrollTop` — это и есть `onScrollShift`; счётчик сдвигов — разность до/после
  let scrollTop = scrollAmount
  const shifts: number[] = []
  Object.defineProperty(host, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      shifts.push(scrollTop - value)
      scrollTop = value
    },
  })
  document.body.append(host)

  const [list, setList] = createSignal(initial)
  const Row = (props: VerticalVirtualListItemProps<Tagged>) => (
    <a class="row" data-tag={props.item.tag} data-animating={String(props.animating)} style={{ top: props.top + 'px' }} />
  )

  disposers.push(render(() => (
    <VerticalVirtualList
      list={list()}
      ListItem={Row}
      scrollableHost={host}
      itemHeight={ITEM}
      thresholdPadding={0}
      animate
    />
  ), host))

  // * сигнал прокрутки ядро берёт из события `scroll` (:44-50), стартовое значение — 0
  host.dispatchEvent(new Event('scroll'))

  const animating = (item: Tagged) => host.querySelector<HTMLElement>(`.row[data-tag="${item.tag}"]`)?.dataset.animating

  return { setList, shifts, animating }
}

describe('verticalVirtualList.solid — useShouldAnimate (:129-189)', () => {
  it('монтирование: сравнивать не с чем — сдвига нет', () => {
    const { shifts } = setup(makeItems(5), { scrollAmount: 0, hostHeight: 100000 })

    expect(shifts).toEqual([])
  })

  it('все видимые сдвинулись на +1 (элемент вне окна убран сверху) → компенсация scrollTop на 1 * itemHeight, без анимации', () => {
    // окно правила без overscan при 1000/600 — idx 9..16
    const items = makeItems(20)
    const { setList, shifts, animating } = setup(items, { scrollAmount: 1000, hostHeight: 600 })

    setList(items.slice(1))

    expect(shifts).toEqual([ITEM])
    expect(animating(items[12])).toBe('false')
  })

  it('сдвиг на -2 (два элемента добавлены вне окна сверху) → компенсация -2 * itemHeight', () => {
    const items = makeItems(20)
    const { setList, shifts } = setup(items, { scrollAmount: 1000, hostHeight: 600 })

    setList([...makeItems(2), ...items])

    expect(shifts).toEqual([-2 * ITEM])
  })

  it('swap внутри видимой области → анимация, без компенсации', () => {
    const [a, b, c, d, e] = makeItems(5)
    const { setList, shifts, animating } = setup([a, b, c, d, e], { scrollAmount: 0, hostHeight: 100000 })

    setList([a, b, d, c, e])

    expect(shifts).toEqual([])
    expect(animating(c)).toBe('true')
  })

  it('единственный видимый элемент исчез из списка → без компенсации (ветка prevIdx/currentIdx === -1)', () => {
    // Без проверки на -1 фиктивный diff = top(0) - top(-1) = 100 оказался бы первым и
    // единственным — правило сочло бы сдвиг единым и записало бы scrollTop.
    const [e] = makeItems(1)
    const { setList, shifts } = setup([e], { scrollAmount: 0, hostHeight: 50 })

    setList([])

    expect(shifts).toEqual([])
  })

  it('граница видимости, левая (>=): элемент РОВНО на кромке ломает единый сдвиг → без компенсации', () => {
    // B в `before` на idx 9: (9 + 1) * 100 === 1000 — корректное `>=` его включает, и его
    // сдвиг (9) расходится со сдвигом контрольной группы C (1). Под `>` B выпал бы, C
    // осталась бы одна — правило записало бы scrollTop на 100.
    const [b, c0, c1, c2, c3, c4] = makeItems(6)
    const before = [...makeItems(9), b, c0, c1, c2, c3, c4]
    const current = [b, ...makeItems(8), c0, c1, c2, c3, c4]
    const { setList, shifts } = setup(before, { scrollAmount: 1000, hostHeight: 1000 })

    setList(current)

    expect(shifts).toEqual([])
  })

  it('граница видимости, правая (<=): элемент РОВНО на кромке ломает единый сдвиг → без компенсации', () => {
    // B в `before` на idx 13: 13 * 100 === 650 + 650 — корректное `<=` его включает
    // (сдвиг 13 против 0 у неподвижной C). Под `<` осталась бы одна C — запись 0.
    const [bb, c0, c1, c2, c3, c4, c5, c6] = makeItems(8)
    const before = [...makeItems(6), c0, c1, c2, c3, c4, c5, c6, bb]
    const current = [bb, ...makeItems(5), c0, c1, c2, c3, c4, c5, c6]
    const { setList, shifts } = setup(before, { scrollAmount: 650, hostHeight: 650 })

    setList(current)

    expect(shifts).toEqual([])
  })

  it('видимых нет ни до, ни после → без компенсации', () => {
    const items = makeItems(5)
    const { setList, shifts } = setup(items, { scrollAmount: 1_000_000, hostHeight: 10 })

    setList([...items, ...makeItems(1)])

    expect(shifts).toEqual([])
  })

  it('новый массив с теми же ссылками в том же порядке → правило узнаёт элементы: компенсация 0, без анимации', () => {
    // Сравнение по ссылке обязано узнать элементы, хотя сам массив — другой объект.
    const items = makeItems(5)
    const { setList, shifts, animating } = setup(items, { scrollAmount: 0, hostHeight: 100000 })

    setList(items.map((x) => x))

    expect(shifts).toEqual([0])
    expect(animating(items[2])).toBe('false')
  })
})
