// Тесты полёта мувера `setMoverToTarget`/`moveTheMover` (порт tweb
// `mediaViewer/base.ts:1176-1798, 1928-1956`). Среда — happy-dom: CSS-переходы
// не играют, поэтому `waitForMoverTransition` резолвится СТРАХОВОЧНЫМ таймером
// duration+100 (tweb base.ts:1839) — тесты явно проверяют, что вся уборка/финал
// доезжают через него (это же контракт для настоящих браузеров, где transition
// может легитимно не создаться при равных значениях).
//
// Геометрия мокается на уровне getBoundingClientRect конкретных элементов:
// happy-dom всем отдаёт нули, а вся математика полёта — на прямоугольниках.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppMediaViewerBase, { NO_MEDIA_VIEWER_CLIP_PATH, type MoverElement } from './base'
import ListLoader from './listLoader'

type Target = { element: HTMLElement }

// Публикатор protected-методов (штатный способ — сабкласс, как и в base.test.ts).
class TestViewer extends AppMediaViewerBase<never, 'forward' | 'delete', Target> {
  get whole() { return this.wholeDiv }
  get moversEl() { return this.moversContainer }
  get contentMap() { return this.content }
  callSetMoverToTarget(target: HTMLElement | undefined, closing?: boolean, fromRight?: number) {
    return this.setMoverToTarget(target, closing, fromRight)
  }
  callMoveTheMover(mover: MoverElement, toLeft?: boolean) { return this.moveTheMover(mover, toLeft) }
  callToggleWholeActive(active: boolean) { this.toggleWholeActive(active) }
}

function makeViewer() {
  const listLoader = new ListLoader<Target, Target>({
    loadMore: async () => ({ count: 0, items: [] }),
  })
  return new TestViewer(listLoader, [])
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

// Стандартная сцена: бабл с img-миниатюрой 50×40 на (100,200); целевой бокс
// вьювера (layout-ghost content.media) 400×320 на (300,60) → scale вниз 0.125.
function makeScene(v: TestViewer) {
  const bubble = document.createElement('div')
  bubble.classList.add('bubble')
  const img = document.createElement('img')
  img.src = 'blob:thumb'
  bubble.append(img)
  document.body.append(bubble)

  stubRect(img, { left: 100, top: 200, width: 50, height: 40 })
  stubRect(v.contentMap.media, { left: 300, top: 60, width: 400, height: 320 })
  return { bubble, img }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('setMoverToTarget: открытие (tweb base.ts:1176-1798)', () => {
  it('стартовый transform = translate3d(rect) + scale3d(rect/containerRect), мувер сайзится в целевой rect', async () => {
    const v = makeViewer()
    const { img } = makeScene(v)
    const mover = v.contentMap.mover

    const p = v.callSetMoverToTarget(img, false, 0)

    // синхронно, до doubleRaf: мувер = целевой rect, отскейленный вниз к источнику
    expect(mover.style.transform).toContain('translate3d(100px,200px,0)')
    expect(mover.style.transform).toContain('scale3d(0.125,0.125,1)')
    expect(mover.style.width).toBe('400px')
    expect(mover.style.height).toBe('320px')
    expect(mover.style.visibility).toBe('')
    expect(mover.classList.contains('opening')).toBe(true)
    // радиусы на старте выставлены (снятие — на целевом кадре)
    expect(mover.style.borderRadius).not.toBe('')

    await vi.advanceTimersByTimeAsync(400)
    await p
  })

  it('аспектер несёт counter-scale (rect-размер × scale3d(containerRect/rect))', async () => {
    const v = makeViewer()
    const { img } = makeScene(v)
    const mover = v.contentMap.mover

    const p = v.callSetMoverToTarget(img, false, 0)

    const aspecter = mover.firstElementChild as HTMLElement
    expect(aspecter.classList.contains('media-viewer-aspecter')).toBe(true)
    // 400/50 = 8, 320/40 = 8 — контр-масштаб к scale3d(0.125) мувера
    expect(aspecter.style.width).toBe('50px')
    expect(aspecter.style.height).toBe('40px')
    expect(aspecter.style.transform).toBe('scale3d(8, 8, 1)')

    await vi.advanceTimersByTimeAsync(400)
    await p
  })

  it('nav-ветка (fromRight): старт за экраном без scale3d, класс moving', async () => {
    const v = makeViewer()
    const { img } = makeScene(v)
    const mover = v.contentMap.mover

    const p = v.callSetMoverToTarget(img, false, 1)

    // fromRight=1 — старт справа за вьюпортом (windowSize.width), топ целевого rect
    expect(mover.style.transform).toContain(`translate3d(${window.innerWidth}px,60px,0)`)
    expect(mover.style.transform).not.toContain('scale3d')
    // радиусы в nav-ветке не ставятся (tweb :1482 — только !wasActive)
    expect(mover.style.borderRadius).toBe('')

    // первый кадр: fastRaf вешает moving (не active)
    await vi.advanceTimersByTimeAsync(20)
    expect(mover.classList.contains('moving')).toBe(true)
    expect(mover.classList.contains('active')).toBe(false)

    await vi.advanceTimersByTimeAsync(400)
    await p
  })

  it('целевой кадр: translate3d(containerRect)+scale3d(1,1,1), радиусы сняты; финал по таймеру — center+active', async () => {
    const v = makeViewer()
    const { img } = makeScene(v)
    const mover = v.contentMap.mover

    const p = v.callSetMoverToTarget(img, false, 0)
    expect(mover.classList.contains('active')).toBe(false)

    // первый rAF: fastRaf вешает active
    await vi.advanceTimersByTimeAsync(20)
    expect(mover.classList.contains('active')).toBe(true)

    // после doubleRaf назначен целевой transform, радиусы сняты
    await vi.advanceTimersByTimeAsync(30)
    expect(mover.style.transform).toBe('translate3d(300px,60px,0) scale3d(1,1,1)')
    expect(mover.style.borderRadius).toBe('')
    expect(mover.classList.contains('center')).toBe(false)

    // страховочный таймер (OPEN_TRANSITION_TIME+100): финальный кадр — center
    await vi.advanceTimersByTimeAsync(310)
    expect(mover.classList.contains('opening')).toBe(false)
    expect(mover.classList.contains('center')).toBe(true)
    expect(mover.classList.contains('active')).toBe(true)
    // applyCenterStyles (tweb :2236-2252)
    expect(mover.style.left).toBe('50%')
    expect(mover.style.transform).toBe('translate3d(-50%, -50%, 0)')

    const ret = await p
    await ret.onAnimationEnd
  })

  it('needOpacity (источник вне вьюпорта скролла): opacity 0 на старте, снят на целевом кадре', async () => {
    const v = makeViewer()
    const { bubble, img } = makeScene(v)
    const scrollable = document.createElement('div')
    scrollable.classList.add('scrollable')
    scrollable.append(bubble)
    document.body.append(scrollable)
    // скролл-вьюпорт целиком НИЖЕ миниатюры → getVisibleRect === null
    stubRect(scrollable, { left: 0, top: 400, width: 800, height: 300 })

    const mover = v.contentMap.mover
    const p = v.callSetMoverToTarget(img, false, 0)

    expect(mover.style.opacity).toBe('0')

    await vi.advanceTimersByTimeAsync(50)
    expect(mover.style.opacity).toBe('')

    await vi.advanceTimersByTimeAsync(350)
    await p
  })

  it('клип: wrapper получает inset() урезанной стороны на старте и inset(0px) на цели; мувер без клипа', async () => {
    const v = makeViewer()
    const { bubble, img } = makeScene(v)
    const scrollable = document.createElement('div')
    scrollable.classList.add('scrollable')
    scrollable.append(bubble)
    document.body.append(scrollable)
    // миниатюра 100 высотой, верхние 50px спрятаны за верхней кромкой скролла
    stubRect(img, { left: 100, top: 50, width: 50, height: 100 })
    stubRect(scrollable, { left: 0, top: 100, width: 800, height: 600 })

    const mover = v.contentMap.mover
    const wrapper = mover.parentElement!
    const p = v.callSetMoverToTarget(img, false, 0)

    // клип живёт на WRAPPER (интерполяция в px вьюпорта), мувер чист
    expect(wrapper.style.clipPath).toBe('inset(100px 0px 0px 0px)')
    expect(mover.style.clipPath).toBe('')

    await vi.advanceTimersByTimeAsync(50)
    expect(wrapper.style.clipPath).toBe(NO_MEDIA_VIEWER_CLIP_PATH)

    // финал: клип снят совсем
    await vi.advanceTimersByTimeAsync(350)
    expect(wrapper.style.clipPath).toBe('')
    await p
  })
})

describe('setMoverToTarget: закрытие (tweb base.ts:1257-1274, 1690-1725)', () => {
  async function openAndSettle(v: TestViewer, img: HTMLElement) {
    const p = v.callSetMoverToTarget(img, false, 0)
    await vi.advanceTimersByTimeAsync(400)
    const ret = await p
    await ret.onAnimationEnd
  }

  it('re-measure: целевой transform закрытия считается от НОВОГО rect источника', async () => {
    const v = makeViewer()
    const { img } = makeScene(v)
    const mover = v.contentMap.mover
    await openAndSettle(v, img)

    // источник уехал (скролл ленты под вьювером) — закрытие обязано лететь
    // в новое место, а не в запомненное при открытии
    stubRect(img, { left: 500, top: 400, width: 80, height: 64 })

    const p = v.callSetMoverToTarget(img, true)
    await vi.advanceTimersByTimeAsync(50) // doubleRaf закрытия

    expect(mover.style.transform).toContain('translate3d(500px,400px,0)')
    expect(mover.style.transform).toContain('scale3d(0.2,0.2,1)')

    await vi.advanceTimersByTimeAsync(350)
    await p
  })

  it('toggleWholeActive(false) вызван; уборка по таймеру возвращает муверу стартовый cssText', async () => {
    const v = makeViewer()
    const { img } = makeScene(v)
    const mover = v.contentMap.mover
    v.callToggleWholeActive(true)
    await openAndSettle(v, img)

    const wrapper = mover.parentElement!
    const p = v.callSetMoverToTarget(img, true)
    await vi.advanceTimersByTimeAsync(50)

    // закрытие стартовало: whole уходит backwards (порт «активен + задом наперёд»)
    expect(v.whole.classList.contains('backwards')).toBe(true)

    // страховочный таймер закрытия: полная уборка мувера
    await vi.advanceTimersByTimeAsync(350)
    expect(mover.style.visibility).toBe('hidden')
    expect(mover.style.width).toBe('1px')
    expect(mover.style.height).toBe('1px')
    expect(mover.classList.contains('active')).toBe(false)
    expect(mover.classList.contains('moving')).toBe(false)
    expect(wrapper.style.clipPath).toBe('')

    const ret = await p
    await ret.onAnimationEnd
  })
})

describe('moveTheMover (tweb base.ts:1928-1956)', () => {
  it('уходящий мувер получает .moving, уезжает за экран, wrapper удаляется по страховочному таймеру', async () => {
    const v = makeViewer()
    const { img } = makeScene(v)
    const mover = v.contentMap.mover as MoverElement
    const wrapper = mover.parentElement!

    const p = v.callSetMoverToTarget(img, false, 0)
    await vi.advanceTimersByTimeAsync(400)
    const ret = await p
    await ret.onAnimationEnd

    stubRect(mover, { left: 300, top: 60, width: 400, height: 320 })
    v.callMoveTheMover(mover, true)

    expect(mover.classList.contains('moving')).toBe(true)
    // removeCenterFromMover вернул translate3d от rect медиа — X заменён на -width
    expect(mover.style.transform).toContain('translate3d(-400px,')

    // wrapper ещё жив до конца перехода
    expect(wrapper.parentElement).toBe(v.moversEl)
    await vi.advanceTimersByTimeAsync(460) // MOVE_TRANSITION_TIME + 100
    expect(wrapper.parentElement).toBeNull()
  })

  it('toLeft=false уезжает вправо на windowSize.width', async () => {
    const v = makeViewer()
    const { img } = makeScene(v)
    const mover = v.contentMap.mover as MoverElement

    const p = v.callSetMoverToTarget(img, false, 0)
    await vi.advanceTimersByTimeAsync(400)
    await p

    stubRect(mover, { left: 300, top: 60, width: 400, height: 320 })
    v.callMoveTheMover(mover, false)
    expect(mover.style.transform).toContain(`translate3d(${window.innerWidth}px,`)
    await vi.advanceTimersByTimeAsync(500)
  })
})
