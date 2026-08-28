// Отмена предыдущего rAF-цикла градиента (порт tweb `animateSingle(cb, this)` —
// ключ инстанса, `createAnimationInstance` начинает с `cancelAnimationByKey`).
//
// Живой сценарий: `core/chat/activeGradient.ts` зовёт `toNextPosition(getProgress)`
// на каждой отправке с прокруткой к низу, а `getProgress` живёт до 1000 мс. Две
// отправки подряд быстрее секунды дают ДВА цикла на одном рендерере: они дерутся
// за общие `_nextPositionTail`/`_frames`, и фон рвёт на целую фазу.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChatBackgroundGradientRenderer from './gradientRenderer'

// happy-dom отдаёт на getContext('2d') → null; рендереру нужен минимум:
// createImageData/putImageData/drawImage/fillRect.
type StubContext = ReturnType<typeof stubContext>

const stubContext = () => ({
  createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  putImageData: vi.fn(),
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  fillStyle: '',
})

// Контекст кэшируется НА ХОЛСТ: настоящий getContext тоже возвращает один и тот
// же объект, а тестам зеркал нужно смотреть в тот же ctx, что получил рендерер.
const contexts = new WeakMap<HTMLCanvasElement, StubContext>()

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: function(this: HTMLCanvasElement) {
    let ctx = contexts.get(this)
    if (!ctx) contexts.set(this, ctx = stubContext())
    return ctx
  },
})

let frames: FrameRequestCallback[] = []

const flushFrame = () => {
  const queue = frames
  frames = []
  queue.forEach((cb) => cb(0))
}

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb)
    return frames.length
  })
})

describe('gradientRenderer — один живой цикл анимации на рендерер', () => {
  it('второй toNextPosition гасит цикл первого', () => {
    const { gradientRenderer, canvas } = ChatBackgroundGradientRenderer.create('#111111,#222222')
    gradientRenderer.init(canvas)
    frames = []

    gradientRenderer.toNextPosition(() => 0)
    expect(frames).toHaveLength(1)

    // первый цикл прожил кадр и перевесил себя на следующий
    flushFrame()
    expect(frames).toHaveLength(1)

    // вторая отправка, пока первая не доиграла
    gradientRenderer.toNextPosition(() => 0)
    expect(frames).toHaveLength(2) // хвост первого + старт второго

    // Кадр: цикл прошлого поколения ДОЛЖЕН выйти молча и не перевесить себя,
    // живым остаётся только второй.
    flushFrame()
    expect(frames).toHaveLength(1)

    // и дальше остаётся ровно один — сколько бы кадров ни прошло
    flushFrame()
    expect(frames).toHaveLength(1)
  })
})

// tweb gradientRenderer.ts:55,268-270,332-335,344-365 — зеркала градиента.
// Живой потребитель: колонка папок (`components/folders/FoldersSidebar.tsx`,
// порт tweb foldersSidebarContent/index.tsx:94-116) рисует тот же градиент в
// своём холсте вместо дорогого `backdrop-filter: blur(40px)`.
describe('gradientRenderer — зеркала', () => {
  it('attachMirror приводит холст к разрешению градиента и рисует первый кадр сразу', () => {
    const { gradientRenderer } = ChatBackgroundGradientRenderer.create('#111111,#222222')
    const mirror = document.createElement('canvas')
    mirror.width = 7
    mirror.height = 9
    const ctx = mirror.getContext('2d') as unknown as StubContext

    gradientRenderer.attachMirror(mirror)

    expect(mirror.width).toBe(50)
    expect(mirror.height).toBe(50)
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
  })

  it('каждая перерисовка градиента перерисовывает зеркало, отписка это прекращает', () => {
    const { gradientRenderer, canvas } = ChatBackgroundGradientRenderer.create('#111111,#222222')
    const mirror = document.createElement('canvas')
    const ctx = mirror.getContext('2d') as unknown as StubContext

    const detach = gradientRenderer.attachMirror(mirror)
    ctx.drawImage.mockClear()

    gradientRenderer.init(canvas) // перерисовка (смена обоев/темы)
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)

    detach()
    gradientRenderer.init(canvas)
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
  })

  it('одноцветные обои — зеркало получает заливку (ветка без ImageData)', () => {
    const { gradientRenderer } = ChatBackgroundGradientRenderer.create('#0a0b0c')
    const mirror = document.createElement('canvas')
    const ctx = mirror.getContext('2d') as unknown as StubContext

    gradientRenderer.attachMirror(mirror)
    expect(ctx.fillRect).toHaveBeenCalledTimes(1)
    expect(ctx.drawImage).not.toHaveBeenCalled()

    ctx.fillRect.mockClear()
    gradientRenderer.init(ChatBackgroundGradientRenderer.createCanvas('#0a0b0c'))
    expect(ctx.fillRect).toHaveBeenCalledTimes(1)
  })
})
