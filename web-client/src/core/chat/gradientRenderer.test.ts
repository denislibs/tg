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
const stubContext = () => ({
  createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  putImageData: () => {},
  drawImage: () => {},
  fillRect: () => {},
  clearRect: () => {},
  fillStyle: '',
})

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => stubContext(),
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
