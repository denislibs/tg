// Тесты тач-разводки SwipeHandler и кликов `AppMediaViewerBase` (порт tweb
// mediaViewer/base.ts:522-587, 1058-1130 — Task 12). Профиль —
// IS_TOUCH_SUPPORTED = true (vi.mock touchSupport); сам SwipeHandler замокан
// с захватом опций: тесты дёргают его колбэки (onSwipe/onDoubleClick/
// verifyTouchTarget) напрямую — жест-детектор покрыт своим
// core/dom/swipeHandler.test.ts, здесь проверяется именно разводка вьювера.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SwipeHandlerOptions } from '@core/dom/swipeHandler'
import windowSize from '@helpers/windowSize'
import mediaSizes from '@helpers/mediaSizes'
import AppMediaViewerBase from './base'
import ListLoader from './listLoader'

const captured = vi.hoisted(() => ({ options: null as unknown }))

vi.mock('@environment/touchSupport', () => ({ default: true }))
vi.mock('@core/dom/swipeHandler', () => ({
  default: class {
    constructor(options: unknown) {
      captured.options = options
    }

    removeListeners() {}
  },
}))

type Target = { element: HTMLElement }

class TestViewer extends AppMediaViewerBase<never, 'forward' | 'delete', Target> {
  get whole() { return this.wholeDiv }
  get moversEl() { return this.moversContainer }
  get contentMap() { return this.content }
  get buttonsMap() { return this.buttons }
  get zoom() { return this.zoomElements }
  get transformState() { return this.transform }
  get isZoomingState() { return this.isZooming }
  callSetListeners() { this.setListeners() }
  callOnSwipeFirst(e?: { type?: string }) { this.onSwipeFirst(e) }
  callOnSwipeReset(e?: Event) { this.onSwipeReset(e) }
  callChangeZoomByPosition(x: number, y: number, scale: number) { this.changeZoomByPosition(x, y, scale) }
  setMoverPromiseStub(p: Promise<void> | null) { this.setMoverPromise = p }
}

function makeViewer() {
  const listLoader = new ListLoader<Target, Target>({
    loadMore: async () => ({ count: 0, items: [] }),
  })
  const v = new TestViewer(listLoader, [])
  v.callSetListeners()
  const options = captured.options as SwipeHandlerOptions
  return { v, listLoader, options }
}

function stubRect(el: HTMLElement, r: { left: number, top: number, width: number, height: number }) {
  el.getBoundingClientRect = () => ({
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    right: r.left + r.width,
    bottom: r.top + r.height,
    x: r.left,
    y: r.top,
    toJSON: () => r,
  }) as DOMRect
}

const FULL_RECT = { left: 0, top: 0, width: windowSize.width, height: windowSize.height }

type SwipeEvent = Parameters<SwipeHandlerOptions['onSwipe']>[2]
const touchEvent = { type: 'touchmove' } as SwipeEvent

// `mediaSizes.isMobile` — обычное поле объекта (порт tweb helpers/mediaSizes.ts:103),
// которое пересчитывается по resize окна; тест ставит нужный экран прямо на
// владельце и возвращает исходное значение после кейса.
const wasMobile = mediaSizes.isMobile
const setMobile = (value: boolean) => { mediaSizes.isMobile = value }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  mediaSizes.isMobile = wasMobile
  document.body.replaceChildren()
})

describe('разводка SwipeHandler (tweb base.ts:522-587)', () => {
  it('SwipeHandler висит на wholeDiv', () => {
    makeViewer()
    const options = captured.options as SwipeHandlerOptions & { element: HTMLElement }
    expect(options.element.classList.contains('media-viewer-whole')).toBe(true)
  })

  it('горизонтальный свайп > 125px → клик next/prev (через кнопки, гейт setMoverPromise)', () => {
    const { v, listLoader, options } = makeViewer()
    const go = vi.spyOn(listLoader, 'go').mockImplementation(() => undefined)

    // 130/1024 ≈ 0.127 < 20% — срабатывает именно порог 125px
    expect(options.onSwipe(-130, 0, touchEvent)).toBe(true)
    expect(go).toHaveBeenCalledWith(1)

    expect(options.onSwipe(130, 0, touchEvent)).toBe(true)
    expect(go).toHaveBeenCalledWith(-1)

    // полёт мувера в процессе — клик по кнопке проглатывается (tweb :465-466)
    go.mockClear()
    v.setMoverPromiseStub(Promise.resolve())
    options.onSwipe(-130, 0, touchEvent)
    expect(go).not.toHaveBeenCalled()
  })

  it('свайп ниже порога (100px и < 20%) — не листает и не закрывает', () => {
    const { v, listLoader, options } = makeViewer()
    const go = vi.spyOn(listLoader, 'go').mockImplementation(() => undefined)
    const close = vi.spyOn(v, 'close')

    expect(options.onSwipe(-100, 0, touchEvent)).toBe(false)
    expect(options.onSwipe(0, 100, touchEvent)).toBe(false)
    expect(go).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('вертикальный свайп > 125px → close()', () => {
    const { v, options } = makeViewer()
    const close = vi.spyOn(v, 'close')

    expect(options.onSwipe(0, 130, touchEvent)).toBe(true)
    expect(close).toHaveBeenCalled()
  })

  it('в зуме свайп — пан через adjustPosition + cancelDrag, без close', () => {
    const { v, options } = makeViewer()
    stubRect(v.contentMap.media, FULL_RECT)
    const close = vi.spyOn(v, 'close')

    v.callOnSwipeFirst(touchEvent)
    v.callChangeZoomByPosition(windowSize.width / 2, windowSize.height / 2, 2)
    v.callOnSwipeFirst(touchEvent)

    const cancelDrag = vi.fn()
    const before = v.transformState.x
    expect(options.onSwipe(-50, 0, touchEvent, cancelDrag)).toBeUndefined()

    expect(v.transformState.x).toBe(before - 50)
    expect(close).not.toHaveBeenCalled()
    expect(cancelDrag).toHaveBeenCalledWith(false, false)
  })

  it('инерция пана: k = 0.1 (onSwipeReset tweb :634-646)', () => {
    const { v, options } = makeViewer()
    stubRect(v.contentMap.media, FULL_RECT)
    const t0 = Date.now()

    v.callOnSwipeFirst(touchEvent)
    v.callChangeZoomByPosition(windowSize.width / 2, windowSize.height / 2, 2)
    v.callOnSwipeFirst(touchEvent) // lastTransform ← {−512,−384,2}, t=t0

    options.onSwipe(-50, 0, touchEvent) // пан: x −512→−562, дельта/оффсет −50

    vi.setSystemTime(t0 + 100) // скорость жеста: 50px за 100мс
    v.callOnSwipeReset(new Event('touchend'))

    // Vx = 50/100 = 0.5; x1 = −562 − 50·0.5·0.1·50 = −687
    expect(v.transformState.x).toBe(-687)
    expect(v.transformState.scale).toBe(2)
  })

  it('дабл-тап: вне зума — scale 3 в точку, в зуме — reset (tweb :565-572)', () => {
    const { v, options } = makeViewer()
    stubRect(v.contentMap.media, FULL_RECT)
    v.callOnSwipeFirst(touchEvent) // initialContentRect

    options.onDoubleClick!({ centerX: windowSize.width / 2, centerY: windowSize.height / 2 })
    expect(v.transformState.scale).toBe(3)
    expect(v.transformState.x).toBe(windowSize.width / 2 - 3 * (windowSize.width / 2))
    expect(v.isZoomingState).toBe(true)

    options.onDoubleClick!({ centerX: 10, centerY: 10 })
    expect(v.transformState).toEqual({ x: 0, y: 0, scale: 1 })
    expect(v.isZoomingState).toBe(false)
  })

  it('verifyTouchTarget: белый список хрома (tweb :575-585)', () => {
    const { v, options } = makeViewer()
    const verify = options.verifyTouchTarget!

    const asEvent = (target: EventTarget, type = 'touchstart') =>
      ({ target, type } as unknown as Parameters<typeof verify>[0])

    expect(verify(asEvent(v.zoom.btnIn))).toBe(false) // внутри zoom-container

    const controls = document.createElement('div')
    controls.className = 'ckin__controls'
    const inControls = document.createElement('button')
    controls.append(inControls)
    expect(verify(asEvent(inControls))).toBe(false)

    const caption = document.createElement('div')
    caption.className = 'media-viewer-caption'
    expect(verify(asEvent(caption))).toBe(false)

    // топбар глотает жесты, КРОМЕ wheel (зум колесом над топбаром работает)
    expect(verify(asEvent(v.buttonsMap.close))).toBe(false)
    expect(verify(asEvent(v.buttonsMap.close, 'wheel'))).toBe(true)

    expect(verify(asEvent(v.whole))).toBe(true)
  })
})

describe('клик (tweb base.ts:1058-1130, тач-профиль)', () => {
  it('тап на мобиле → toggle chrome-hidden (tweb :1077-1084)', () => {
    setMobile(true)
    const { v } = makeViewer()

    v.whole.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(v.whole.classList.contains('chrome-hidden')).toBe(true)

    v.whole.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(v.whole.classList.contains('chrome-hidden')).toBe(false)
  })

  it('тап по топбару на мобиле хром не прячет', () => {
    setMobile(true)
    const { v } = makeViewer()

    v.buttonsMap.close.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(v.whole.classList.contains('chrome-hidden')).toBe(false)
  })

  it('тап (не мобила) → подсветка свитчеров highlight-switchers на 3000 мс (tweb :1086-1099)', () => {
    setMobile(false)
    const { v } = makeViewer()

    v.whole.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(v.whole.classList.contains('highlight-switchers')).toBe(true)

    vi.advanceTimersByTime(3000)
    expect(v.whole.classList.contains('highlight-switchers')).toBe(false)
  })

  it('ignoreNextClick после mouse-drag проглатывает ровно один клик (tweb :612-614, :1066-1069)', () => {
    setMobile(true)
    const { v, options } = makeViewer()
    stubRect(v.contentMap.media, FULL_RECT)

    // зум + мышиный пан → draggingType 'mousemove'
    v.callOnSwipeFirst()
    v.callChangeZoomByPosition(windowSize.width / 2, windowSize.height / 2, 2)
    v.callOnSwipeFirst()
    options.onSwipe(-10, 0, { type: 'mousemove' } as SwipeEvent)
    v.callOnSwipeReset(new Event('mouseup'))

    v.whole.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(v.whole.classList.contains('chrome-hidden')).toBe(false) // проглочен

    v.whole.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(v.whole.classList.contains('chrome-hidden')).toBe(true) // следующий — живой
  })
})
