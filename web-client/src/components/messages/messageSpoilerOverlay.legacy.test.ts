// Legacy-путь оверлея спойлеров — порт tweb `messageSpoilerOverlay` при
// `useWorker === false` (WebGL2 в OffscreenCanvas недоступен).
//
// Пиним ровно то, ради чего путь существует: без воркера оверлей НЕ исчезает
// молча, а подключается к главнопоточной симуляции
// (`DotRenderer.attachTextSpoilerTarget`) и красит слова сам, в 2d-контекст
// своей канвы.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Нет WebGL2 в OffscreenCanvas → tweb выбирает legacy-путь
vi.mock('@lib/spoiler/spoilerSupport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/spoiler/spoilerSupport')>()),
  isWorkerSimSupported: () => false,
}))

const captured: { draw?: () => void } = {}
const sourceCanvas = document.createElement('canvas')
sourceCanvas.width = 240
sourceCanvas.height = 120

const spies = vi.hoisted(() => ({
  attachTextSpoilerTarget: vi.fn(),
  attachTextSpoilerOverlay: vi.fn(() => null),
}))
spies.attachTextSpoilerTarget.mockImplementation(({ draw }: { draw: () => void }) => {
  captured.draw = draw
  return {
    animation: { paused: false },
    sourceCanvas,
    dpr: 1,
    readyResult: true, // симуляция главного потока поднялась
  }
})
vi.mock('@components/dotRenderer', () => ({ default: spies }))

// happy-dom отдаёт `getContext('2d') → null`; подменяем на записывающую заглушку
const calls = { fillRect: 0, drawImage: 0 }
const fake2d = () => ({
  clearRect: () => {}, save: () => {}, restore: () => {}, beginPath: () => {},
  arc: () => {}, fill: () => {},
  fillRect: () => { ++calls.fillRect },
  drawImage: () => { ++calls.drawImage },
  globalCompositeOperation: '', fillStyle: '', shadowBlur: 0, shadowColor: '',
})
HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
  return id === '2d' ? (fake2d() as unknown as CanvasRenderingContext2D) : null
} as HTMLCanvasElement['getContext']

const { createMessageSpoilerOverlay } = await import('./messageSpoilerOverlay')

const SPAN_RECT = { left: 10, top: 4, width: 60, height: 18, right: 70, bottom: 22, x: 10, y: 4 }

/**
 * Тело сообщения со спойлерным словом — как его собирает лента: слово и оверлей
 * соседи внутри `.spoilers-container`. Клиентские прямоугольники слова
 * подменены: happy-dom их не считает.
 */
function mountOverlay() {
  const messageElement = document.createElement('div')
  messageElement.className = 'message spoilers-container'
  const span = document.createElement('span')
  span.className = 'spoiler-text'
  span.textContent = 'secret'
  span.getClientRects = (() => [SPAN_RECT]) as unknown as Element['getClientRects']
  messageElement.append(span)
  document.body.append(messageElement)

  const handle = createMessageSpoilerOverlay({ messageElement })
  handle && messageElement.append(handle.element)
  return { messageElement, handle }
}

beforeEach(() => {
  calls.fillRect = calls.drawImage = 0
  captured.draw = undefined
  spies.attachTextSpoilerTarget.mockClear()
  spies.attachTextSpoilerOverlay.mockClear()
  document.body.replaceChildren()
})

describe('оверлей спойлеров — legacy-путь', () => {
  it('без воркерной симуляции подключается к главнопоточной, а не пропадает', () => {
    const { messageElement } = mountOverlay()

    expect(spies.attachTextSpoilerTarget).toHaveBeenCalledTimes(1)
    expect(spies.attachTextSpoilerOverlay).not.toHaveBeenCalled()
    // оверлей остался в DOM — значит сообщение не свалилось на CSS-фолбэк
    expect(messageElement.querySelector('.message-spoiler-overlay')).not.toBeNull()
  })

  it('рисует слова спойлера в главном потоке', () => {
    mountOverlay()

    // цикл симуляции зовёт этот колбэк; в оригинале это `drawCallbacks`
    expect(captured.draw).toBeTypeOf('function')

    calls.fillRect = calls.drawImage = 0
    captured.draw!()

    // заливка прямоугольника слова + перенос подкрашенных частиц поверх неё
    expect(calls.fillRect).toBeGreaterThan(0)
    expect(calls.drawImage).toBeGreaterThan(0)
  })
})
