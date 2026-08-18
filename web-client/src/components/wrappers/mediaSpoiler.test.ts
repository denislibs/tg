// wrapMediaSpoiler — ванильный порт tweb `components/wrappers/mediaSpoiler.ts`.
//
// Пиним свойства, которые отличают порт от «полупрозрачной плашки поверх фото»:
//   • дерево и классы совпадают с оригиналом (`div.media-spoiler-container` >
//     `canvas.media-spoiler-thumbnail` + `canvas.canvas-dots`) — на них завязаны
//     стили (`styles/tweb/_bridge.scss`), поиск канваса при раскрытии и
//     `findUpClassName(target, 'media-spoiler-container')` в ленте;
//   • ПОДЛОЖКА размытого превью стоит ПЕРВОЙ, точки — поверх неё: иначе точки
//     оказались бы под превью и спойлер выглядел бы просто блюром;
//   • клик РАСКРЫВАЕТ и сносит контейнер вместе с его middleware-хелпером
//     (обратного скрытия у медиа-спойлера нет — в отличие от текстового);
//   • повторный клик по уже раскрывающемуся спойлеру — no-op: в оригинале это
//     защита от того, чтобы второй клик не провалился на само медиа.
//
// Мокаем ГРАНИЦЫ: `@helpers/blur` (грузит Image из data-URI, happy-dom его не
// декодирует — тот же приём, что в `photo.test.ts`) и `dotRendererCore` (за ним
// начинается WebGL-драйвер, которого в happy-dom нет).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@helpers/blur', () => ({
  default: vi.fn((dataUri: string) => {
    const canvas = document.createElement('canvas')
    canvas.className = 'canvas-thumbnail'
    canvas.dataset.uri = dataUri
    return { canvas, promise: Promise.resolve() }
  }),
}))

class FakeCore {
  public inited = false
  public lastDrawTime = 0
  public dpr = 1
  public config: unknown
  constructor(public canvas: HTMLCanvasElement, config: unknown) { this.config = config }
  resize(_w: number, _h: number, dpr: number, config: unknown) { this.dpr = dpr; this.config = config }
  init() { this.inited = true; return true }
  draw() {}
  destroy() { this.inited = false }
}

vi.mock('@lib/spoiler/dotRendererCore', () => ({
  default: FakeCore,
  buildDotRendererConfig: (_w: number, _h: number, dpr: number, config = {}) => ({ dpr, ...config }),
  getDefaultParticlesCount: () => 1000,
  drawClippingCircle: vi.fn(),
}))

vi.mock('@lib/spoiler/spoilerSupport', () => ({
  TEXT_SPOILER_WIDTH: 240,
  TEXT_SPOILER_HEIGHT: 120,
  spoilerSimDpr: () => 1,
  animationsEnabled: () => true,
  // воркерной симуляции в happy-dom нет — главнопоточный путь
  isWorkerSimSupported: () => false,
}))

class IntersectionObserverStub {
  constructor(_cb: (entries: IntersectionObserverEntry[]) => void) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

const noop = () => {}
const fake2d = () => ({
  clearRect: noop, drawImage: noop, save: noop, restore: noop, beginPath: noop,
  arc: noop, fill: noop, fillRect: noop,
  globalCompositeOperation: '', fillStyle: '', shadowBlur: 0, shadowColor: '',
})
HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
  return id === '2d' ? (fake2d() as unknown as CanvasRenderingContext2D) : null
} as HTMLCanvasElement['getContext']

const { default: wrapMediaSpoiler, onMediaSpoilerClick, toggleMediaSpoiler } = await import('./mediaSpoiler')
const { getMiddleware } = await import('@helpers/middleware')

const STRIPPED = 'AAECAwQ='

const helpers: { destroy: () => void }[] = []
function makeSpoiler() {
  const helper = getMiddleware()
  helpers.push(helper)
  return wrapMediaSpoiler({
    strippedThumb: STRIPPED,
    width: 100,
    height: 50,
    middleware: helper.get(),
    animationGroup: 'chat',
  })
}

// SetTransition раскрытия идёт 250 мс (tweb `toggleMediaSpoiler`) — ждём дольше
const nextTicks = () => new Promise<void>((resolve) => setTimeout(resolve, 320))

beforeEach(() => {
  vi.stubGlobal('devicePixelRatio', 1)
})

afterEach(() => {
  helpers.splice(0).forEach((h) => h.destroy())
  vi.unstubAllGlobals()
})

describe('wrapMediaSpoiler — дерево оригинала', () => {
  it('контейнер, подложка превью и слой точек — в порядке оригинала', async () => {
    const container = await makeSpoiler()

    expect(container).toBeTruthy()
    expect(container!.classList.contains('media-spoiler-container')).toBe(true)

    const children = Array.from(container!.children)
    expect(children).toHaveLength(2)
    // подложка первой, точки — поверх
    expect(children[0].tagName).toBe('CANVAS')
    expect(children[0].classList.contains('media-spoiler-thumbnail')).toBe(true)
    expect(children[1].classList.contains('canvas-dots')).toBe(true)
    expect(children[1].classList.contains('canvas-thumbnail')).toBe(true)
  })

  it('контейнер носит СВОЙ middleware-хелпер — им его и сносят', async () => {
    const container = await makeSpoiler()
    expect(container!.middlewareHelper).toBeTruthy()
  })

  it('без stripped-превью спойлера нет вовсе (закрывать нечем)', async () => {
    const helper = getMiddleware()
    helpers.push(helper)
    const container = await wrapMediaSpoiler({
      strippedThumb: '',
      width: 100, height: 50, middleware: helper.get(), animationGroup: 'chat',
    })
    expect(container).toBeUndefined()
  })
})

describe('onMediaSpoilerClick — раскрытие', () => {
  it('клик раскрывает и сносит контейнер вместе с хелпером', async () => {
    const container = (await makeSpoiler())!
    const host = document.createElement('div')
    host.append(container)
    document.body.append(host)

    const destroy = vi.spyOn(container.middlewareHelper!, 'destroy')

    // событие без координат — путь `SetTransition('is-revealing')`,
    // тот же, что у оригинала, когда `revealWithAnimation` вернул false
    onMediaSpoilerClick({ mediaSpoiler: container, event: new Event('click') })
    await nextTicks()

    expect(container.isConnected).toBe(false)
    expect(destroy).toHaveBeenCalled()

    host.remove()
  })

  // Клик С КООРДИНАТАМИ идёт другой веткой: «дырка растёт из точки клика»
  // (DotRenderer.revealWithAnimation). Признак того, что взята именно она —
  // `data-is-revealing` на контейнере: пока анимация играет, контейнер остаётся
  // в DOM и ловит повторные клики вместо уже открытого медиа.
  it('клик с координатами уходит в анимацию раскрытия, а не в простое угасание', async () => {
    const container = (await makeSpoiler())!
    document.body.append(container)

    onMediaSpoilerClick({
      mediaSpoiler: container,
      event: new MouseEvent('click', { clientX: 10, clientY: 5 }),
    })

    expect(container.dataset.isRevealing).toBe('true')
    // это НЕ путь SetTransition — класса угасания нет
    expect(container.classList.contains('is-revealing')).toBe(false)
    expect(container.isConnected).toBe(true)

    container.remove()
  })

  it('обратного скрытия нет: повторный клик по раскрывающемуся — no-op', async () => {
    const container = (await makeSpoiler())!
    document.body.append(container)

    // имитируем идущее раскрытие ровно так, как его метит сам модуль
    container.dataset.isRevealing = 'true'
    const before = container.className

    onMediaSpoilerClick({ mediaSpoiler: container, event: new Event('click') })
    await nextTicks()

    // класс не тронут, контейнер на месте — второго прохода раскрытия нет
    expect(container.className).toBe(before)
    expect(container.isConnected).toBe(true)

    container.remove()
  })

  it('клик гасит событие — до медиа под спойлером оно не долетает', async () => {
    const container = (await makeSpoiler())!
    const event = new Event('click', { cancelable: true, bubbles: true })

    onMediaSpoilerClick({ mediaSpoiler: container, event })

    expect(event.defaultPrevented).toBe(true)
    expect(event.cancelBubble).toBe(true)
  })
})

describe('toggleMediaSpoiler', () => {
  it('reveal=false возвращает спойлер на место и НЕ сносит его', async () => {
    const container = (await makeSpoiler())!
    document.body.append(container)
    container.classList.add('is-revealing')

    toggleMediaSpoiler({ mediaSpoiler: container, reveal: false })
    await nextTicks()

    expect(container.classList.contains('is-revealing')).toBe(false)
    expect(container.isConnected).toBe(true)

    container.remove()
  })

  it('reveal=true с destroyAfter сносит узел', async () => {
    const container = (await makeSpoiler())!
    document.body.append(container)

    toggleMediaSpoiler({ mediaSpoiler: container, reveal: true, destroyAfter: true })
    await nextTicks()

    expect(container.isConnected).toBe(false)
  })
})
