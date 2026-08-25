// Тесты того, что вернулось в `swipeHandler.ts` вместе с появлением
// `contextMenuController`: сброс активного жеста открытым контекстным меню
// (tweb swipeHandler.ts:51-54, :389) и опция `withDelay` (:167-175, :348-365).
//
// `IS_TOUCH_SUPPORTED` — модульная константа, поэтому каждая ветка грузит
// модуль заново с замоканным `@environment/touchSupport` (тот же приём, что в
// `swipeHandler.test.ts`). Вместе со swipeHandler переимпортируется и
// `contextMenuController` — подписка `toggle` должна быть на ТОТ ЖЕ инстанс.
import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadModules(touch: boolean) {
  vi.resetModules()
  vi.doMock('@environment/touchSupport', () => ({ default: touch }))
  const { default: SwipeHandler } = await import('./swipeHandler')
  const { default: contextMenuController } = await import('@helpers/contextMenuController')
  return { SwipeHandler, contextMenuController }
}

function makeEvent(type: string, props: Record<string, unknown>): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  for(const [key, value] of Object.entries(props)) {
    Object.defineProperty(e, key, { value, configurable: true })
  }
  return e
}

function createElement(): HTMLElement {
  const element = document.createElement('div')
  document.body.append(element)
  return element
}

afterEach(() => {
  vi.doUnmock('@environment/touchSupport')
  vi.resetModules()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('открытое контекстное меню сбрасывает жест', () => {
  it('после openBtnMenu движение мыши не доходит до onSwipe и жест сбрасывается', async() => {
    const { SwipeHandler, contextMenuController } = await loadModules(false)
    const element = createElement()
    const onSwipe = vi.fn()
    const onReset = vi.fn()
    new SwipeHandler({ element, onSwipe, onReset })

    element.dispatchEvent(makeEvent('mousedown', { clientX: 0, clientY: 0, target: element }))
    document.dispatchEvent(makeEvent('mousemove', { clientX: 20, clientY: 0, target: element }))
    expect(onSwipe).toHaveBeenCalledTimes(1)

    const menu = document.createElement('div')
    menu.classList.add('btn-menu')
    document.body.append(menu)
    contextMenuController.openBtnMenu(menu)

    document.dispatchEvent(makeEvent('mousemove', { clientX: 40, clientY: 0, target: element }))
    expect(onSwipe).toHaveBeenCalledTimes(1) // второе движение проглочено
    expect(onReset).toHaveBeenCalled()

    contextMenuController.close()
  })

  it('после закрытия меню жест снова работает', async() => {
    const { SwipeHandler, contextMenuController } = await loadModules(false)
    const element = createElement()
    const onSwipe = vi.fn()
    new SwipeHandler({ element, onSwipe })

    const menu = document.createElement('div')
    menu.classList.add('btn-menu')
    document.body.append(menu)
    contextMenuController.openBtnMenu(menu)
    contextMenuController.close()

    element.dispatchEvent(makeEvent('mousedown', { clientX: 0, clientY: 0, target: element }))
    document.dispatchEvent(makeEvent('mousemove', { clientX: 20, clientY: 0, target: element }))

    expect(onSwipe).toHaveBeenCalledTimes(1)
  })
})

describe('withDelay', () => {
  it('тач: жест стартует не по touchstart, а по удержанию 400 мс', async() => {
    vi.useFakeTimers()
    const { SwipeHandler } = await loadModules(true)
    const element = createElement()
    const onSwipe = vi.fn()
    new SwipeHandler({ element, onSwipe, withDelay: true })

    const touch = { clientX: 0, clientY: 0, pageX: 0, pageY: 0, target: element }
    element.dispatchEvent(makeEvent('touchstart', { touches: [touch] }))

    // сразу после касания жеста ещё нет
    document.dispatchEvent(makeEvent('touchmove', { touches: [{ ...touch, clientX: 30, pageX: 30 }] }))
    expect(onSwipe).not.toHaveBeenCalled()

    vi.advanceTimersByTime(400)
    await vi.runOnlyPendingTimersAsync()

    document.dispatchEvent(makeEvent('touchmove', { touches: [{ ...touch, clientX: 30, pageX: 30 }] }))
    expect(onSwipe).toHaveBeenCalledTimes(1)
  })

  it('тач без withDelay: жест стартует сразу по touchstart', async() => {
    const { SwipeHandler } = await loadModules(true)
    const element = createElement()
    const onSwipe = vi.fn()
    new SwipeHandler({ element, onSwipe })

    const touch = { clientX: 0, clientY: 0, pageX: 0, pageY: 0, target: element }
    element.dispatchEvent(makeEvent('touchstart', { touches: [touch] }))
    document.dispatchEvent(makeEvent('touchmove', { touches: [{ ...touch, clientX: 30, pageX: 30 }] }))

    expect(onSwipe).toHaveBeenCalledTimes(1)
  })

  it('мышь: движение в первые 300 мс досрочно снимает задержку', async() => {
    const { SwipeHandler } = await loadModules(false)
    const element = createElement()
    const onSwipe = vi.fn()
    new SwipeHandler({ element, onSwipe, withDelay: true })

    element.dispatchEvent(makeEvent('mousedown', { clientX: 0, clientY: 0, target: element }))
    // ещё внутри задержки — обработчик жеста не повешен
    document.dispatchEvent(makeEvent('mousemove', { clientX: 20, clientY: 0, target: element }))
    expect(onSwipe).not.toHaveBeenCalled()

    // тот же mousemove разрешил deferred → продолжение handleStart
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    document.dispatchEvent(makeEvent('mousemove', { clientX: 40, clientY: 0, target: element }))
    expect(onSwipe).toHaveBeenCalledTimes(1)
  })

  it('мышь без withDelay: жест стартует сразу по mousedown', async() => {
    const { SwipeHandler } = await loadModules(false)
    const element = createElement()
    const onSwipe = vi.fn()
    new SwipeHandler({ element, onSwipe })

    element.dispatchEvent(makeEvent('mousedown', { clientX: 0, clientY: 0, target: element }))
    document.dispatchEvent(makeEvent('mousemove', { clientX: 20, clientY: 0, target: element }))

    expect(onSwipe).toHaveBeenCalledTimes(1)
  })
})
