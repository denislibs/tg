// wrapBubbleMediaSpoiler — порт ветки скрытого медиа ОДИНОЧНОГО бабла
// (tweb `ChatBubbles.wrapMediaSpoiler`, bubbles.ts:6034-6066 + вызовы
// :7923/:8580).
//
// Пиним связку, которой нет ни у `wrapMediaSpoiler`, ни у врапперов по
// отдельности:
//   • крышка ждёт промис медиа и берёт размер УЖЕ ПОСТАВЛЕННОГО бокса вложения
//     (иначе точки рисовались бы по нулевому прямоугольнику);
//   • медиа под крышкой грузится как обычно — крышка её не отменяет;
//   • автоплей под крышкой НЕ идёт (`noAutoplayAttribute` у вызывающего), а
//     раскрытие его включает — `onMediaSpoilerClick` → `autoplay` + `play()`;
//   • протухшее поколение в бабл ничего не дописывает.
//
// Мокаем границы: владельца URL (managers.media.*), `@helpers/blur` и
// `dotRendererCore` (за ним WebGL, которого в happy-dom нет) — сами
// `wrapPhoto`/`wrapVideo`/`wrapMediaSpoiler` работают настоящие.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { downloadMediaURL, contentUrl, streamUrl, tokenInfo } = vi.hoisted(() => ({
  downloadMediaURL: vi.fn<(id: number, opts?: { thumb?: boolean }) => Promise<string>>(),
  contentUrl: vi.fn<(id: number) => Promise<string>>(),
  streamUrl: vi.fn<(id: number) => Promise<string>>(),
  tokenInfo: vi.fn<() => Promise<{ token: string, expiresAt: number }>>(),
}))
vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL, contentUrl, streamUrl, tokenInfo } } }),
}))

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
  constructor(public canvas: HTMLCanvasElement, public config: unknown) {}
  resize() {}
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
HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
  return id === '2d' ? ({
    clearRect: noop, drawImage: noop, save: noop, restore: noop, beginPath: noop,
    arc: noop, fill: noop, fillRect: noop,
    globalCompositeOperation: '', fillStyle: '', shadowBlur: 0, shadowColor: '',
  } as unknown as CanvasRenderingContext2D) : null
} as HTMLCanvasElement['getContext']

const { default: wrapBubbleMediaSpoiler } = await import('./bubbleMediaSpoiler')
const { default: wrapPhoto } = await import('@components/wrappers/photo')
const { default: wrapVideo } = await import('@components/wrappers/video')
const { getMiddleware } = await import('@helpers/middleware')
const mediaUrl = await import('@core/mediaUrl')

const STRIPPED = 'AAECAwQ='
const REGULAR = { boxWidth: 420, boxHeight: 400 }

const flush = async () => {
  for (let i = 0; i < 5; ++i) await new Promise<void>((r) => { setTimeout(r, 0) })
}
/** SetTransition раскрытия идёт 250 мс (tweb `toggleMediaSpoiler`) */
const afterReveal = () => new Promise<void>((resolve) => setTimeout(resolve, 320))

const helpers: { destroy: () => void }[] = []
const mw = () => {
  const helper = getMiddleware()
  helpers.push(helper)
  return helper.get()
}

const attachment = () => {
  const div = document.createElement('div')
  div.classList.add('attachment')
  document.body.append(div)
  return div
}

beforeAll(() => {
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>
  const define = (key: string, desc: PropertyDescriptor) =>
    Object.defineProperty(proto, key, { configurable: true, ...desc })
  define('paused', { get(this: { _playing?: boolean }) { return !this._playing } })
  proto.play = function(this: { _playing?: boolean } & EventTarget) {
    this._playing = true
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  proto.load = noop
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true, writable: true, value: () => Promise.resolve(),
  })
})

beforeEach(() => {
  vi.stubGlobal('devicePixelRatio', 1)
  downloadMediaURL.mockReset()
  downloadMediaURL.mockImplementation((id, o) => Promise.resolve(`blob:${id}${o?.thumb ? '_thumb' : ''}`))
  contentUrl.mockReset()
  contentUrl.mockImplementation((id) => Promise.resolve(`/api/media/${id}/content?token=T1`))
  streamUrl.mockReset()
  streamUrl.mockImplementation((id) => Promise.resolve(`/dnp-stream/${id}`))
  tokenInfo.mockReset()
  tokenInfo.mockResolvedValue({ token: 'T1', expiresAt: Date.now() + 900_000 })
  mediaUrl.applyMediaToken({ token: 'T1', expiresAt: Date.now() + 900_000 })
})

afterEach(() => {
  helpers.splice(0).forEach((h) => h.destroy())
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('wrapBubbleMediaSpoiler: фото-бабл', () => {
  it('крышка встаёт поверх вложения и берёт размер его бокса', async () => {
    const attachmentDiv = attachment()
    const middleware = mw()

    const promise = wrapPhoto({
      mediaId: 7, width: 1600, height: 900, strippedThumb: STRIPPED,
      container: attachmentDiv, middleware, ...REGULAR,
    })
    await wrapBubbleMediaSpoiler({
      strippedThumb: STRIPPED, promise, middleware, attachmentDiv, animationGroup: 'chat',
    })
    await flush()

    const cover = attachmentDiv.querySelector('.media-spoiler-container') as HTMLElement
    expect(cover).toBeTruthy()
    expect(cover.parentElement).toBe(attachmentDiv)
    expect(cover.querySelector('canvas.media-spoiler-thumbnail')).toBeTruthy()

    // размер — из бокса, который враппер уже поставил контейнеру
    const dots = cover.querySelector('canvas.canvas-dots') as HTMLCanvasElement
    expect(parseInt(attachmentDiv.style.width)).toBeGreaterThan(0)
    expect(dots.width).toBe(parseInt(attachmentDiv.style.width))
    expect(dots.height).toBe(parseInt(attachmentDiv.style.height))

    // медиа под крышкой грузится как обычно — крышка загрузку не отменяет
    expect(downloadMediaURL).toHaveBeenCalledWith(7, { thumb: false })
    expect(attachmentDiv.querySelector('img.media-photo')).toBeTruthy()
  })

  it('протухшее поколение в бабл ничего не дописывает', async () => {
    const attachmentDiv = attachment()
    const helper = getMiddleware()
    const middleware = helper.get()

    const promise = wrapPhoto({
      mediaId: 7, width: 1600, height: 900, strippedThumb: STRIPPED,
      container: attachmentDiv, middleware, ...REGULAR,
    })
    helper.destroy()
    await wrapBubbleMediaSpoiler({
      strippedThumb: STRIPPED, promise, middleware, attachmentDiv, animationGroup: 'chat',
    })
    await flush()

    expect(attachmentDiv.querySelector('.media-spoiler-container')).toBeNull()
  })
})

describe('wrapBubbleMediaSpoiler: видео-бабл', () => {
  const videoDoc = {
    id: 7, type: 'video' as const, width: 1600, height: 900, duration: 46,
    size: 3 * 1024 * 1024, mime: 'video/mp4', strippedThumb: STRIPPED, hasThumb: true,
  }

  /** Так бабл строит скрытое видео: `noAutoplayAttribute: !!spoiler` (bubbles.ts:8571). */
  const hiddenVideo = async () => {
    const attachmentDiv = attachment()
    const middleware = mw()

    const promise = wrapVideo({
      doc: videoDoc, container: attachmentDiv, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware, noAutoplayAttribute: true,
    })
    await wrapBubbleMediaSpoiler({
      strippedThumb: STRIPPED, promise, middleware, attachmentDiv, animationGroup: 'chat',
    })
    const res = await promise
    res.video?.dispatchEvent(new Event('canplay'))
    await flush()

    return { attachmentDiv, video: res.video! }
  }

  it('под крышкой видео не автоплеится', async () => {
    const { attachmentDiv, video } = await hiddenVideo()

    expect(attachmentDiv.querySelector('.media-spoiler-container')).toBeTruthy()
    expect(video.autoplay).toBe(false)
    expect(video.paused).toBe(true)
  })

  it('клик раскрывает: крышка уходит, видео начинает играть', async () => {
    const { attachmentDiv, video } = await hiddenVideo()
    const { onMediaSpoilerClick } = await import('@components/wrappers/mediaSpoiler')

    const cover = attachmentDiv.querySelector('.media-spoiler-container') as HTMLElement
    onMediaSpoilerClick({ mediaSpoiler: cover, event: new Event('click') })

    expect(video.autoplay).toBe(true)
    expect(video.paused).toBe(false)

    await afterReveal()
    expect(attachmentDiv.querySelector('.media-spoiler-container')).toBeNull()
  })
})
