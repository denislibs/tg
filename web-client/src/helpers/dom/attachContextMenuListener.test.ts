// Тесты порта tweb `helpers/dom/attachContextMenuListener.ts` (см. шапку рядом).
//
// Ветка выбирается на вызове: `(IS_APPLE && IS_TOUCH_SUPPORTED) || listenerOptions`
// → long-press на 400 мс, иначе — `contextmenu`. В happy-dom оба флага ложны,
// поэтому обе ветки берутся честно: без `listenerOptions` — правый клик,
// с `listenerOptions` — долгое нажатие.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachContextMenuListener, cancelContextMenuOpening } from './attachContextMenuListener'
import ListenerSetter from '@helpers/listenerSetter'

function makeElement() {
  const element = document.createElement('div')
  document.body.append(element)
  return element
}

function touchStart(element: HTMLElement, touches = 1) {
  const e = new Event('touchstart', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: new Array(touches).fill({}), configurable: true })
  element.dispatchEvent(e)
  return e
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // сбросить «не открывать 400 мс» между тестами
  vi.advanceTimersByTime(400)
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('ветка правого клика', () => {
  it('contextmenu доводит событие до callback', () => {
    const element = makeElement()
    const callback = vi.fn()
    attachContextMenuListener({ element, callback })

    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('listenerSetter.removeAll снимает подписку', () => {
    const element = makeElement()
    const callback = vi.fn()
    const listenerSetter = new ListenerSetter()
    attachContextMenuListener({ element, callback, listenerSetter })

    listenerSetter.removeAll()
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))

    expect(callback).not.toHaveBeenCalled()
  })
})

describe('ветка long-press (передан listenerOptions)', () => {
  const listenerOptions = { passive: false }

  it('callback стреляет через 400 мс удержания', () => {
    const element = makeElement()
    const callback = vi.fn()
    attachContextMenuListener({ element, callback, listenerOptions })

    touchStart(element)
    vi.advanceTimersByTime(399)
    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('touchmove до срабатывания отменяет открытие', () => {
    const element = makeElement()
    const callback = vi.fn()
    attachContextMenuListener({ element, callback, listenerOptions })

    touchStart(element)
    element.dispatchEvent(new Event('touchmove', { bubbles: true }))
    vi.advanceTimersByTime(400)

    expect(callback).not.toHaveBeenCalled()
  })

  it('touchend до срабатывания отменяет открытие', () => {
    const element = makeElement()
    const callback = vi.fn()
    attachContextMenuListener({ element, callback, listenerOptions })

    touchStart(element)
    element.dispatchEvent(new Event('touchend', { bubbles: true }))
    vi.advanceTimersByTime(400)

    expect(callback).not.toHaveBeenCalled()
  })

  it('второй палец отменяет открытие', () => {
    const element = makeElement()
    const callback = vi.fn()
    attachContextMenuListener({ element, callback, listenerOptions })

    touchStart(element, 2)
    vi.advanceTimersByTime(400)

    expect(callback).not.toHaveBeenCalled()
  })

  it('cancelContextMenuOpening, вызванный во время удержания, глушит открытие', () => {
    const element = makeElement()
    const callback = vi.fn()
    attachContextMenuListener({ element, callback, listenerOptions })

    touchStart(element)
    // жест (свайп/реакция) забрал касание себе на 100-й мс
    vi.advanceTimersByTime(100)
    cancelContextMenuOpening()
    vi.advanceTimersByTime(300)
    expect(callback).not.toHaveBeenCalled()

    // окно глушения (400 мс от вызова) истекло — следующее удержание открывает
    vi.advanceTimersByTime(400)
    touchStart(element)
    vi.advanceTimersByTime(400)
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
