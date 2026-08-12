// Тесты зум/пан/поворота `AppMediaViewerBase` (порт tweb mediaViewer/base.ts
// :589-966 — Task 12), десктопный профиль (IS_TOUCH_SUPPORTED = false;
// тач-разводка SwipeHandler — base.touch.test.ts). Геометрия мокается на
// getBoundingClientRect (happy-dom отдаёт нули), вьюпорт берётся из
// windowSize (happy-dom 1024×768) — ожидания считаются от него же.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import windowSize from '@helpers/windowSize'
import { glyph } from '@core/tgico-icons'
import AppMediaViewerBase, {
  RESERVE_BOTTOM_DESKTOP,
  RESERVE_TOP_DESKTOP,
  ZOOM_MAX_VALUE,
} from './base'
import ListLoader from './listLoader'

type Target = { element: HTMLElement }

// Публикатор protected-полей/методов (штатный способ — сабкласс, как в
// base.test.ts / base.mover.test.ts).
class TestViewer extends AppMediaViewerBase<never, 'forward' | 'delete', Target> {
  get whole() { return this.wholeDiv }
  get moversEl() { return this.moversContainer }
  get contentMap() { return this.content }
  get buttonsMap() { return this.buttons }
  get zoom() { return this.zoomElements }
  get transformState() { return this.transform }
  get rotationState() { return this.rotation }
  get isZoomingState() { return this.isZooming }
  setTransformDirect(t: { x: number, y: number, scale: number }) { this.transform = t }
  callSetListeners() { this.setListeners() }
  callSetGlobalListeners() { this.setGlobalListeners() }
  callRemoveGlobalListeners() { this.removeGlobalListeners() }
  callBuildMoversTransform(scale?: number) { return this.buildMoversTransform(scale) }
  callRotateMedia() { this.rotateMedia() }
  callResetRotationForNav() { this.resetRotationForNav() }
  callIsRotated() { return this.isRotated() }
  callOnSwipeFirst(e?: { type?: string }) { this.onSwipeFirst(e) }
  callOnSwipeReset(e?: Event) { this.onSwipeReset(e) }
  callAddZoom(v: number) { this.addZoom(v) }
  callChangeZoomByPosition(x: number, y: number, scale: number) { this.changeZoomByPosition(x, y, scale) }
  callResetZoom() { this.resetZoom() }
}

function makeViewer() {
  const listLoader = new ListLoader<Target, Target>({
    loadMore: async () => ({ count: 0, items: [] }),
  })
  return { v: new TestViewer(listLoader, []), listLoader }
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

// Медиа 400×320 на (300,60) — сцена для формульных ожиданий.
const MEDIA_RECT = { left: 300, top: 60, width: 400, height: 320 }
// Полновьюпортное медиа — сцена с реальным простором для пана.
const FULL_RECT = { left: 0, top: 0, width: windowSize.width, height: windowSize.height }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('buildMoversTransform (tweb base.ts:856-873): две независимые transform-стопки', () => {
  it('rotation=0: rotate-обёртка ВСЁ РАВНО эмитится (identity) — пофункциональная интерполяция первого поворота', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, MEDIA_RECT)
    v.setTransformDirect({ x: 10, y: 20, scale: 2 })

    // центр медиа (500, 220) — пивот внутренней обёртки
    expect(v.callBuildMoversTransform()).toBe(
      'translate3d(10.000px, 20.000px, 0px) scale(2.000) ' +
      'translate(500.000px, 220.000px) rotate(0deg) scale(1.00000) translate(-500.000px, -220.000px)',
    )
  })

  it('rotation=−90: fit-скейл вписывает повёрнутый бокс в вьюпорт (getRotationFitScale)', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, MEDIA_RECT)

    v.callRotateMedia()

    const boxH = windowSize.height - RESERVE_TOP_DESKTOP - RESERVE_BOTTOM_DESKTOP
    const fit = Math.min(windowSize.width / MEDIA_RECT.height, boxH / MEDIA_RECT.width)
    expect(v.moversEl.style.transform).toContain(`rotate(-90deg) scale(${fit.toFixed(5)})`)
    expect(v.callIsRotated()).toBe(true)
  })

  it('зум/пан/поворот живут на moversContainer, transform мувера не трогается (пин двух стопок)', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, MEDIA_RECT)

    v.callRotateMedia()
    v.callOnSwipeFirst()
    v.callChangeZoomByPosition(500, 100, 3)

    expect(v.moversEl.style.transform).not.toBe('')
    expect(v.contentMap.mover.style.transform).toBe('')
  })
})

describe('зум-математика (tweb base.ts:658-833)', () => {
  it('changeZoomByPosition: зум в точку — x/y по формуле scaleOffset = p − scale·p', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, MEDIA_RECT)
    v.callOnSwipeFirst() // снимает initialContentRect (transform тождественен)

    v.callChangeZoomByPosition(500, 100, 3)

    expect(v.transformState).toEqual({ x: -1000, y: -200, scale: 3 })
    expect(v.moversEl.style.transform).toContain('translate3d(-1000.000px, -200.000px, 0px) scale(3.000)')
  })

  it('changeZoomByPosition: смещение клампится границами (calculateOffsetBoundaries/getZoomBoundaries)', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, MEDIA_RECT)
    v.callOnSwipeFirst()

    // зум в точку (0,0): свободный offset был бы (0,0) — клампится к
    // minX = −left·scale = −900, minY = −top·scale = −180
    v.callChangeZoomByPosition(0, 0, 3)

    expect(v.transformState).toEqual({ x: -900, y: -180, scale: 3 })
  })

  it('onZoom: bounce headroom до ZOOM_MAX·3 во время жеста, clamp-дебаунс 300 мс доводит к ZOOM_MAX', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, FULL_RECT)
    v.callSetListeners() // создаёт clampZoomDebounced

    v.callAddZoom(100)
    expect(v.transformState.scale).toBe(ZOOM_MAX_VALUE * 3) // 12 — потолок отскока

    vi.advanceTimersByTime(300) // clampZoomDebounced → onSwipeReset
    expect(v.transformState.scale).toBe(ZOOM_MAX_VALUE)
  })

  it('scale < 1 после жеста → resetZoom (onSwipeReset tweb :654-656)', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, FULL_RECT)
    v.callSetListeners()

    v.callAddZoom(-0.5)
    expect(v.transformState.scale).toBe(0.5)

    vi.advanceTimersByTime(300)
    expect(v.transformState).toEqual({ x: 0, y: 0, scale: 1 })
    expect(v.isZoomingState).toBe(false)
  })
})

describe('toggleZoom (tweb base.ts:731-756): классы и кнопки', () => {
  it('вход в зум: is-zooming на whole, is-visible на zoom-container, свап иконки zoomin→zoomout', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, FULL_RECT)

    v.callAddZoom(0.5)

    expect(v.whole.classList.contains('is-zooming')).toBe(true)
    expect(v.zoom.container.classList.contains('is-visible')).toBe(true)
    expect(v.isZoomingState).toBe(true)
    expect(v.buttonsMap.zoomin.querySelector('.button-icon')!.textContent).toBe(glyph('zoomout'))
  })

  it('resetZoom: классы сняты, иконка обратно zoomin, слайдер к 1', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, FULL_RECT)

    v.callAddZoom(0.5)
    v.callResetZoom()

    expect(v.whole.classList.contains('is-zooming')).toBe(false)
    expect(v.zoom.container.classList.contains('is-visible')).toBe(false)
    expect(v.buttonsMap.zoomin.querySelector('.button-icon')!.textContent).toBe(glyph('zoomin'))
    expect(v.zoom.rangeSelector.value).toBe(1)
  })

  it('inactive на кнопках на границах ZOOM_MIN/ZOOM_MAX (setZoomValue tweb :846-847)', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, FULL_RECT)

    v.callAddZoom(3) // scale 4 = max
    expect(v.zoom.btnIn.classList.contains('inactive')).toBe(true)
    expect(v.zoom.btnOut.classList.contains('inactive')).toBe(false)

    v.callResetZoom()
    v.callAddZoom(-0.5) // scale 0.5 = min
    expect(v.zoom.btnOut.classList.contains('inactive')).toBe(true)
    expect(v.zoom.btnIn.classList.contains('inactive')).toBe(false)
  })

  it('скраб слайдера зума → addZoom(value − scale) (проводка onScrub, tweb :382-387)', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, FULL_RECT)

    const seek = v.zoom.rangeSelector.container.querySelector<HTMLInputElement>('input')!
    seek.value = '2'
    seek.dispatchEvent(new Event('input'))

    expect(v.transformState.scale).toBe(2)
    expect(v.isZoomingState).toBe(true)
  })
})

describe('rotateMedia / resetRotationForNav (tweb base.ts:932-950, 2416-2425)', () => {
  it('каждый вызов — −90° против часовой, transform на moversContainer', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, MEDIA_RECT)

    v.callRotateMedia()
    expect(v.rotationState).toBe(-90)
    v.callRotateMedia()
    expect(v.rotationState).toBe(-180)
    expect(v.moversEl.style.transform).toContain('rotate(-180deg)')
    // 180° сохраняет бокс — fit 1
    expect(v.moversEl.style.transform).toContain('rotate(-180deg) scale(1.00000)')
  })

  it('resetRotationForNav: сброс к identity без transition (навигация — пер-медиа)', () => {
    const { v } = makeViewer()
    stubRect(v.contentMap.media, MEDIA_RECT)

    v.callRotateMedia()
    v.callResetRotationForNav()

    expect(v.rotationState).toBe(0)
    expect(v.callIsRotated()).toBe(false)
    expect(v.moversEl.style.transform).toContain('rotate(0deg)')
    expect(v.moversEl.classList.contains('no-transition')).toBe(false)
  })
})

describe('клавиатура (tweb base.ts:1132-1174)', () => {
  it('стрелки листают только вне зума; Ctrl+= / Ctrl+− шагают зум', () => {
    const { v, listLoader } = makeViewer()
    stubRect(v.contentMap.media, FULL_RECT)
    v.callSetListeners()
    v.callSetGlobalListeners()
    const go = vi.spyOn(listLoader, 'go').mockImplementation(() => undefined)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(go).toHaveBeenCalledWith(1)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(go).toHaveBeenCalledWith(-1)

    // ctrlKeyDown взводится любым keydown с ctrl (tweb :1150-1152)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true }))
    expect(v.transformState.scale).toBe(1.5)

    // в зуме стрелки не листают
    go.mockClear()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true }))
    expect(go).not.toHaveBeenCalled()

    // keyup без ctrl снимает ctrlKeyDown (tweb :1162-1174)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }))
    expect(v.transformState.scale).toBe(1.5) // без ctrl шаг не сработал

    v.callRemoveGlobalListeners()
    v.callResetZoom()
    go.mockClear()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(go).not.toHaveBeenCalled()
  })
})
