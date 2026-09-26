// DotRenderer, воркерный путь: молчащий воркер не держит спойлер вечно —
// порт tweb 293cb4509 (`DotRenderer.watchWorkerInit`).
//
// Воркер отвечает `media-inited` только когда `init()` его симуляции осел, а
// это может не случиться никогда (повисший запрос шейдера, потерянный
// WebGL-контекст). `wrapMediaSpoiler` ждёт этот deferred, поэтому раньше
// крышка спойлера так и не вставала поверх медиа, а защёлка `mediaInited`
// глушила любую повторную инициализацию до конца сессии. После дедлайна
// deferred резолвится (спойлер деградирует до размытого превью), защёлка
// снимается, и следующий спойлер шлёт init заново.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const posted: { type: string }[] = []

vi.mock('@lib/spoiler/spoilerRendererConnection', () => ({
  // воркер, который НИКОГДА не отвечает
  retainSpoilerRenderer: () => ({
    postMessage: (message: { type: string }) => { posted.push(message) },
    release: () => {},
  }),
  hasSpoilerRendererFailed: () => false,
}))

vi.mock('@lib/spoiler/spoilerSupport', () => ({
  TEXT_SPOILER_WIDTH: 240,
  TEXT_SPOILER_HEIGHT: 120,
  spoilerSimDpr: () => 1,
  animationsEnabled: () => true,
  isWorkerSimSupported: () => true,
}))

class IntersectionObserverStub {
  constructor(_cb: (entries: IntersectionObserverEntry[]) => void) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

HTMLCanvasElement.prototype.transferControlToOffscreen = function transferControlToOffscreen() {
  return {} as OffscreenCanvas
}

const { default: DotRenderer } = await import('./dotRenderer')
const { getMiddleware } = await import('@helpers/middleware')

const inits = (type: string) => posted.filter((message) => message.type === type).length

const helpers: { destroy: () => void }[] = []
function createMediaSpoiler() {
  const helper = getMiddleware()
  helpers.push(helper)
  return DotRenderer.create({ width: 100, height: 50, middleware: helper.get(), animationGroup: 'chat' })
}

function attachOverlay() {
  const helper = getMiddleware()
  helpers.push(helper)
  return DotRenderer.attachTextSpoilerOverlay({
    canvas: document.createElement('canvas'),
    middleware: helper.get(),
    animationGroup: 'chat',
    onPainted: () => {},
    onUnavailable: () => {},
  })!
}

beforeEach(() => {
  posted.length = 0
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  helpers.splice(0).forEach((helper) => helper.destroy())
  vi.useRealTimers()
})

describe('DotRenderer: дедлайн ответа воркера на init', () => {
  it('медийный спойлер: готовность осядет после дедлайна, а не никогда', async () => {
    const { readyResult } = createMediaSpoiler()
    expect(inits('media-init')).toBe(1)

    let settled = false
    void (readyResult as Promise<void>).then(() => { settled = true })

    await vi.advanceTimersByTimeAsync(7999)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
  })

  it('медийный спойлер: после дедлайна защёлка снята — следующий шлёт init заново', async () => {
    createMediaSpoiler()
    createMediaSpoiler()
    // пока ответ ещё может прийти, повторный init не шлётся (защёлка оригинала)
    expect(inits('media-init')).toBe(1)

    await vi.advanceTimersByTimeAsync(8000)

    createMediaSpoiler()
    expect(inits('media-init')).toBe(2)
  })

  it('текстовый оверлей: тот же дедлайн и та же снятая защёлка', async () => {
    const { readyResult } = attachOverlay()
    expect(inits('text-init')).toBe(1)

    let settled = false
    void (readyResult as Promise<void>).then(() => { settled = true })

    await vi.advanceTimersByTimeAsync(8000)
    expect(settled).toBe(true)

    attachOverlay()
    expect(inits('text-init')).toBe(2)
  })
})
