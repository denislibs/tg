// DotRenderer — порт tweb `components/dotRenderer.ts`. Пиним то, что отличает
// порт от «канваса с точками»:
//   • цель НЕ держит своей симуляции: все спойлеры сэмплят ОДИН инстанс, и он
//     заводится ровно один раз на всех (иначе десять спойлеров в ленте — десять
//     WebGL-контекстов, а их у браузера считаные единицы);
//   • канвас цели носит классы и размер оригинала (`canvas-thumbnail canvas-dots`,
//     сторона × dpr) — на них завязан `_bridge.scss` и поиск канваса в
//     `mediaSpoiler.ts::revealSpoilerWithAnimation`;
//   • цикл отрисовки крутится, только пока цель «играет», и ОБЯЗАН встать по
//     протухшему middleware: спойлер уехал из DOM — GPU молотить нечего.
//
// WebGL2 в happy-dom нет, поэтому подменён `dotRendererCore` — граница, за
// которой начинается драйвер. Всё остальное (учёт целей, интеграция с
// animationIntersector, машина play/pause) работает настоящее.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const draws = { count: 0 }
const cores: FakeCore[] = []

class FakeCore {
  public inited = false
  public lastDrawTime = 0
  public dpr = 1
  public config: unknown
  public destroyed = false

  constructor(public canvas: HTMLCanvasElement, config: unknown) {
    this.config = config
    cores.push(this)
  }

  resize(_w: number, _h: number, dpr: number, config: unknown) {
    this.dpr = dpr
    this.config = config
  }

  init() {
    this.inited = true
    return true
  }

  draw() {
    ++draws.count
  }

  destroy() {
    this.destroyed = true
    this.inited = false
  }
}

vi.mock('@lib/spoiler/dotRendererCore', () => ({
  default: FakeCore,
  buildDotRendererConfig: (_w: number, _h: number, dpr: number, config = {}) => ({ dpr, ...config }),
  getDefaultParticlesCount: () => 1000,
  drawClippingCircle: vi.fn(),
}))

// Воркерной ветки в happy-dom нет (нет OffscreenCanvas/transferControlToOffscreen) —
// принудительно уводим на главнопоточный путь, чтобы пинить именно его.
vi.mock('@lib/spoiler/spoilerSupport', () => ({
  TEXT_SPOILER_WIDTH: 240,
  TEXT_SPOILER_HEIGHT: 120,
  spoilerSimDpr: () => 1,
  animationsEnabled: () => true,
  isWorkerSimSupported: () => false,
}))

// happy-dom отдаёт `getContext('2d') → null`; цель-канвас рисует в 2d-контекст,
// поэтому подменяем его на счётчик вызовов (сами пиксели не проверяем).
const noop = () => {}
const fake2d = () => ({
  clearRect: noop, drawImage: noop, save: noop, restore: noop, beginPath: noop,
  arc: noop, fill: noop, fillRect: noop,
  globalCompositeOperation: '', fillStyle: '', shadowBlur: 0, shadowColor: '',
})
HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
  return id === '2d' ? (fake2d() as unknown as CanvasRenderingContext2D) : null
} as HTMLCanvasElement['getContext']

const observed = new Set<Element>()
class IntersectionObserverStub {
  constructor(_cb: (entries: IntersectionObserverEntry[]) => void) {}
  observe(el: Element) { observed.add(el) }
  unobserve(el: Element) { observed.delete(el) }
  disconnect() { observed.clear() }
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

const { default: DotRenderer } = await import('./dotRenderer')
const { getMiddleware } = await import('@helpers/middleware')
const { default: animationIntersector } = await import('./animationIntersector')

const nextFrames = (n = 3) => new Promise<void>((resolve) => setTimeout(resolve, n * 20))

const animationOf = (canvas: HTMLCanvasElement) => animationIntersector.getAnimations(canvas)[0].animation

beforeEach(() => {
  draws.count = 0
  cores.length = 0
  observed.clear()
  // dpr фиксируем: от него зависит размер канваса цели
  vi.stubGlobal('devicePixelRatio', 2)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DotRenderer.create — цель медиа-спойлера', () => {
  it('канвас цели носит классы и размер оригинала', () => {
    const helper = getMiddleware()
    const { canvas } = DotRenderer.create({
      width: 100, height: 50, middleware: helper.get(), animationGroup: 'chat',
    })

    expect(canvas.classList.contains('canvas-thumbnail')).toBe(true)
    expect(canvas.classList.contains('canvas-dots')).toBe(true)
    expect(canvas.width).toBe(200) // 100 × dpr(2)
    expect(canvas.height).toBe(100)

    helper.destroy()
  })

  it('две цели живут на ОДНОЙ симуляции', () => {
    const a = getMiddleware()
    const b = getMiddleware()

    DotRenderer.create({ width: 100, height: 50, middleware: a.get(), animationGroup: 'chat' })
    DotRenderer.create({ width: 80, height: 80, middleware: b.get(), animationGroup: 'chat' })

    expect(cores).toHaveLength(1)

    a.destroy()
    b.destroy()
  })

  it('канвас находится по элементу — на этом держится раскрытие по клику', () => {
    const helper = getMiddleware()
    const controls = DotRenderer.create({
      width: 100, height: 50, middleware: helper.get(), animationGroup: 'chat',
    })

    expect(DotRenderer.getImageSpoilerByElement(controls.canvas)).toBe(controls)
    expect(DotRenderer.getImageSpoilerByElement(document.createElement('canvas'))).toBeUndefined()

    helper.destroy()
  })
})

describe('DotRenderer — цикл отрисовки', () => {
  it('рисует, пока цель играет, и ВСТАЁТ по протухшему middleware', async () => {
    const helper = getMiddleware()
    const { canvas } = DotRenderer.create({
      width: 100, height: 50, middleware: helper.get(), animationGroup: 'chat',
    })

    // tweb: `init()` рисует ПЕРВЫЙ кадр сразу (иначе спойлер моргнёт пустым),
    // но цикла до play нет — счётчик стоит
    await nextFrames()
    const atInit = draws.count
    expect(atInit).toBe(1)
    await nextFrames()
    expect(draws.count).toBe(atInit)

    animationOf(canvas).play()
    await nextFrames()
    expect(draws.count).toBeGreaterThan(atInit)

    // middleware протух — animationIntersector снимает анимацию, цикл обязан встать
    helper.destroy()
    await nextFrames()
    const atStop = draws.count
    await nextFrames()

    expect(draws.count).toBe(atStop)
    expect(cores[0].destroyed).toBe(true)
  })

  it('последняя ушедшая цель гасит симуляцию, следующая заводит новую', async () => {
    const a = getMiddleware()
    const first = DotRenderer.create({ width: 100, height: 50, middleware: a.get(), animationGroup: 'chat' })
    animationOf(first.canvas).play()
    await nextFrames(1)

    a.destroy()
    await nextFrames(1)
    expect(cores).toHaveLength(1)
    expect(cores[0].destroyed).toBe(true)

    const b = getMiddleware()
    DotRenderer.create({ width: 100, height: 50, middleware: b.get(), animationGroup: 'chat' })
    expect(cores).toHaveLength(2)
    expect(cores[1].destroyed).toBe(false)

    b.destroy()
  })
})
