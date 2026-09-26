/**
 * Порт tweb `src/helpers/dom/sortable.ts` + `sortableRun.ts` (812502980) —
 * перетаскивание строк `.row-sortable` (папки, наборы стикеров). Жест — мышью
 * через настоящий `SwipeHandler` (`core/dom/swipeHandler.ts`): тач-ветка
 * выключена моком `IS_TOUCH_SUPPORTED`, геометрия строк (50px) — заглушкой
 * `getBoundingClientRect`, которой happy-dom не считает. Переход «доезда»
 * (pause 250 при доступных анимациях) погашен тем же гейтом, что у оригинала:
 * `liteMode.all` («Энергосбережение»).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@environment/touchSupport', () => ({ default: false }))

import { useSettingsStore } from '@/settings'
import { getMiddleware } from '@helpers/middleware'
import Sortable from './sortable'
import getSortableRun from './sortableRun'

const ROW = 50

function makeList(count: number, extra?: (row: HTMLElement, index: number) => void) {
  const list = document.createElement('div')
  const rows = Array.from({ length: count }, (_, index) => {
    const row = document.createElement('div')
    row.className = 'row row-sortable'
    row.dataset.i = '' + index
    row.getBoundingClientRect = () => {
      const top = [...list.children].indexOf(row) * ROW
      return { top, bottom: top + ROW, left: 0, right: 300, width: 300, height: ROW, x: 0, y: top, toJSON() {} } as DOMRect
    }
    extra?.(row, index)
    list.append(row)
    return row
  })
  document.body.append(list)
  return { list, rows }
}

const mouse = (type: string, target: EventTarget, clientY: number) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY }))

/** жест мыши: нажатие → (задержка withDelay гасится первым mousemove) → сдвиг → отпускание */
async function drag(row: HTMLElement, fromY: number, toY: number, onMove?: () => void) {
  mouse('mousedown', row, fromY)
  mouse('mousemove', document, fromY) // досрочный выход из паузы withDelay
  await new Promise((resolve) => setTimeout(resolve, 0))
  mouse('mousemove', document, toY)
  onMove?.()
  mouse('mouseup', document, toY)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('Sortable', () => {
  it('перетаскивание второй строки на первое место: onSort(1, 0), is-dragging во время жеста', async() => {
    const { list, rows } = makeList(3)
    const onSort = vi.fn()
    const middleware = getMiddleware()
    new Sortable({ list, middleware: middleware.get(), onSort })

    let duringDrag: { dragging: boolean, reordering: boolean, transform: string } | undefined
    await drag(rows[1], 75, 25, () => {
      duringDrag = {
        dragging: rows[1].classList.contains('is-dragging'),
        reordering: list.classList.contains('is-reordering'),
        transform: rows[1].style.transform,
      }
    })

    expect(duringDrag).toEqual({ dragging: true, reordering: true, transform: `translateY(-${ROW}px)` })
    expect(onSort).toHaveBeenCalledOnce()
    expect(onSort.mock.calls[0].slice(0, 2)).toEqual([1, 0])
    expect(onSort.mock.calls[0][2]).toMatchObject({ element: rows[1], from: 1, to: 0 })
    // moveInDom по умолчанию: строка переставлена, следы жеста сняты
    expect([...list.children]).toEqual([rows[1], rows[0], rows[2]])
    expect(rows[1].classList.contains('is-dragging')).toBe(false)
    expect(list.classList.contains('is-reordering')).toBe(false)
    expect(rows.map((row) => row.style.transform)).toEqual(['', '', ''])
    middleware.destroy()
  })

  it('индекс для onSort — среди детей списка (whichChild), а не внутри прогона строк', async() => {
    const { list, rows } = makeList(3)
    const header = document.createElement('div')
    header.className = 'cant-sort'
    list.prepend(header)
    const onSort = vi.fn()
    const middleware = getMiddleware()
    new Sortable({ list, middleware: middleware.get(), onSort, moveInDom: false })

    // row[2] (ребёнок №3 списка) на место row[1]
    await drag(rows[2], 175, 125)

    expect(onSort.mock.calls[0].slice(0, 2)).toEqual([3, 2])
    expect(onSort.mock.calls[0][2]).toMatchObject({ from: 2, to: 1 })
    // moveInDom: false — порядок в DOM остаётся за моделью
    expect([...list.children]).toEqual([header, ...rows])
    middleware.destroy()
  })

  it('cant-sort ограничивает прогон, а одиночку не поднимают вовсе', () => {
    const { rows } = makeList(4, (row, index) => {
      if(index === 2) row.classList.add('cant-sort')
    })

    expect(getSortableRun(rows[1])).toEqual([rows[0], rows[1]])
    expect(getSortableRun(rows[3])).toEqual([rows[3]])
    expect(getSortableRun(rows[1], 'pinned')).toEqual([rows[1]])
  })

  it('отключённый список (enabled → false) жест не начинает', async() => {
    const { list, rows } = makeList(3)
    const onSort = vi.fn()
    const middleware = getMiddleware()
    new Sortable({ list, middleware: middleware.get(), onSort, enabled: () => false })

    await drag(rows[1], 75, 25)

    expect(rows[1].classList.contains('is-dragging')).toBe(false)
    expect(onSort).not.toHaveBeenCalled()
    middleware.destroy()
  })
})
