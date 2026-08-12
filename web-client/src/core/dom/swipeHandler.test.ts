// Тесты порта tweb `components/swipeHandler.ts` (см. `swipeHandler.ts` рядом).
//
// `IS_TOUCH_SUPPORTED` вычисляется на уровне модуля при импорте, поэтому
// каждая ветка (мышь/тач) загружает модуль заново с замоканным
// `@environment/touchSupport` (`vi.resetModules` + `vi.doMock` + динамический
// import) — как советует сам vitest для module-level констант.
import { afterEach, describe, expect, it, vi } from 'vitest'

type SwipeHandlerModule = typeof import('./swipeHandler')

async function loadModule(touch: boolean): Promise<SwipeHandlerModule> {
  vi.resetModules()
  vi.doMock('@environment/touchSupport', () => ({ default: touch }))
  return await import('./swipeHandler')
}

// happy-dom не даёт выставить clientX/pageX/x/touches через конструкторы всех
// нужных типов событий (WheelEvent/TouchEvent) — собираем базовый Event и
// довешиваем поля через defineProperty (код хендлера читает их как поля).
function makeEvent(type: string, props: Record<string, unknown>): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  for(const [key, value] of Object.entries(props)) {
    Object.defineProperty(e, key, { value, configurable: true })
  }
  return e
}

// Точка касания в форме, которую читает хендлер (clientX/clientY для диффов,
// pageX/pageY для дистанции/центра пинча).
function touchPoint(x: number, y: number, target: EventTarget) {
  return { clientX: x, clientY: y, pageX: x, pageY: y, target }
}

function createElement(): HTMLElement {
  const element = document.createElement('div')
  document.body.append(element)
  return element
}

afterEach(() => {
  vi.doUnmock('@environment/touchSupport')
  vi.resetModules()
  document.body.replaceChildren()
})

describe('SwipeHandler: мышь/колесо (IS_TOUCH_SUPPORTED=false)', () => {
  it('горизонтальный свайп доводит onSwipe с корректными xDiff/yDiff', async() => {
    const { default: SwipeHandler } = await loadModule(false)
    const element = createElement()
    const onSwipe = vi.fn()
    const handler = new SwipeHandler({ element, onSwipe })

    element.dispatchEvent(makeEvent('mousedown', { clientX: 100, clientY: 100, button: 0 }))
    await Promise.resolve() // handleStart асинхронный

    document.dispatchEvent(makeEvent('mousemove', { clientX: 130, clientY: 110 }))
    expect(onSwipe).toHaveBeenCalledWith(30, 10, expect.anything())

    document.dispatchEvent(makeEvent('mousemove', { clientX: 160, clientY: 95 }))
    // диффы считаются от точки нажатия, а не от предыдущего move
    expect(onSwipe).toHaveBeenLastCalledWith(60, -5, expect.anything())

    handler.removeListeners()
  })

  it('wheel с ctrl вызывает onZoom с zoomAdd (дельта clamp(deltaY,-25,25)*0.01)', async() => {
    const { default: SwipeHandler } = await loadModule(false)
    const element = createElement()
    const onSwipe = vi.fn()
    const onZoom = vi.fn()
    const handler = new SwipeHandler({ element, onSwipe, onZoom })

    element.dispatchEvent(makeEvent('wheel', {
      ctrlKey: true,
      deltaX: 0,
      deltaY: -50, // клампится до -25 → wheelZoom 1.25 → zoomAdd 0.25
      clientX: 200, clientY: 150,
      x: 200, y: 150,
    }))

    expect(onZoom).toHaveBeenCalledTimes(1)
    const details = onZoom.mock.calls[0][0]
    expect(details.zoomAdd).toBeCloseTo(0.25)
    expect(details.initialCenterX).toBe(200)
    expect(details.initialCenterY).toBe(150)

    handler.removeListeners()
  })

  it('wheel без модификаторов идёт drag-путём: onSwipe с cancelDrag, onZoom не зовётся', async() => {
    const { default: SwipeHandler } = await loadModule(false)
    const element = createElement()
    const onSwipe = vi.fn()
    const onZoom = vi.fn()
    const handler = new SwipeHandler({ element, onSwipe, onZoom })

    element.dispatchEvent(makeEvent('wheel', {
      ctrlKey: false, metaKey: false, shiftKey: false,
      deltaX: -20, deltaY: -10,
      clientX: 300, clientY: 200,
      x: 300, y: 200,
    }))

    expect(onZoom).not.toHaveBeenCalled()
    // drag-оффсет накапливается со знаком минус от дельт колеса
    expect(onSwipe).toHaveBeenCalledWith(20, 10, expect.anything(), expect.any(Function))

    handler.removeListeners()
  })

  it('verifyTouchTarget=false глушит жест: onSwipe не зовётся', async() => {
    const { default: SwipeHandler } = await loadModule(false)
    const element = createElement()
    const onSwipe = vi.fn()
    const verifyTouchTarget = vi.fn(() => false)
    const handler = new SwipeHandler({ element, onSwipe, verifyTouchTarget })

    element.dispatchEvent(makeEvent('mousedown', { clientX: 100, clientY: 100, button: 0 }))
    await Promise.resolve()
    document.dispatchEvent(makeEvent('mousemove', { clientX: 150, clientY: 100 }))

    expect(verifyTouchTarget).toHaveBeenCalled()
    expect(onSwipe).not.toHaveBeenCalled()

    handler.removeListeners()
  })
})

describe('SwipeHandler: тач (IS_TOUCH_SUPPORTED=true)', () => {
  it('dblclick вызывает onDoubleClick с центром (pageX/pageY)', async() => {
    const { default: SwipeHandler } = await loadModule(true)
    const element = createElement()
    const onSwipe = vi.fn()
    const onDoubleClick = vi.fn()
    const handler = new SwipeHandler({ element, onSwipe, onDoubleClick })

    element.dispatchEvent(makeEvent('dblclick', { pageX: 44, pageY: 55 }))

    expect(onDoubleClick).toHaveBeenCalledWith({ centerX: 44, centerY: 55 })

    handler.removeListeners()
  })

  it('пинч двумя касаниями вызывает onZoom с zoomFactor и центром', async() => {
    const { default: SwipeHandler } = await loadModule(true)
    const element = createElement()
    const onSwipe = vi.fn()
    const onZoom = vi.fn()
    const handler = new SwipeHandler({ element, onSwipe, onZoom })

    element.dispatchEvent(makeEvent('touchstart', { touches: [touchPoint(100, 100, element)] }))
    await Promise.resolve() // handleStart асинхронный

    // второй палец: фиксируется initialDistance=100 и центр (150, 100)
    element.dispatchEvent(makeEvent('touchstart', {
      touches: [touchPoint(100, 100, element), touchPoint(200, 100, element)],
    }))
    await Promise.resolve()

    // пальцы разошлись до дистанции 200 → zoomFactor 2, центр не сместился
    document.dispatchEvent(makeEvent('touchmove', {
      touches: [touchPoint(50, 100, element), touchPoint(250, 100, element)],
    }))

    expect(onZoom).toHaveBeenCalledTimes(1)
    const details = onZoom.mock.calls[0][0]
    expect(details.zoomFactor).toBeCloseTo(2)
    expect(details.initialCenterX).toBe(150)
    expect(details.initialCenterY).toBe(100)
    expect(details.currentCenterX).toBe(150)
    expect(details.dragOffsetX).toBe(0)

    handler.removeListeners()
  })
})
