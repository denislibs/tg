// Порт tweb `components/chat/patternRenderer.ts` (812502980): общий рендерер на
// слой, холсты под размер × min(2, dpr), маска `#000` + `destination-out`,
// тайлинг от центра, снятие инстанса с последним холстом.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeCanvas } from '@/test/fakeCanvas'
import ChatBackgroundPatternRenderer from './patternRenderer'

let fakeCanvas: ReturnType<typeof installFakeCanvas>

beforeEach(() => {
  fakeCanvas = installFakeCanvas()
})

afterEach(() => {
  fakeCanvas.restore()
  vi.restoreAllMocks()
})

const element = () => document.createElement('div')

describe('ChatBackgroundPatternRenderer', () => {
  it('getInstance — один инстанс на слой и опции; другие опции — другой инстанс', () => {
    const layer = element()
    const a = ChatBackgroundPatternRenderer.getInstance({ element: layer, url: 'u', width: 10, height: 10 })
    const b = ChatBackgroundPatternRenderer.getInstance({ element: layer, url: 'u', width: 10, height: 10 })
    const c = ChatBackgroundPatternRenderer.getInstance({ element: layer, url: 'u', width: 10, height: 10, mask: true })
    expect(b).toBe(a)
    expect(c).not.toBe(a)
  })

  it('холст — размер × min(2, dpr), плотность на холсте', () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(3)
    const renderer = ChatBackgroundPatternRenderer.getInstance({ element: element(), url: 'u', width: 72, height: 96 })
    const canvas = renderer.createCanvas()
    expect([canvas.width, canvas.height, canvas.dpr]).toEqual([144, 192, 2])
    expect(canvas.dataset.originalHeight).toBe('192')
  })

  it('маска: заливка #000 во весь холст, узор — destination-out; без маски — source-over', async() => {
    vi.spyOn(HTMLImageElement.prototype, 'width', 'get').mockReturnValue(100)
    vi.spyOn(HTMLImageElement.prototype, 'height', 'get').mockReturnValue(100)
    const masked = ChatBackgroundPatternRenderer.getInstance({ element: element(), url: 'm', width: 300, height: 200, mask: true })
    const maskCanvas = masked.createCanvas()
    await masked.renderToCanvas(maskCanvas)
    const calls = fakeCanvas.ctxOf(maskCanvas)!.calls
    expect(calls[0]).toBe('fillRect(#000,0,0,300,200)')
    expect(calls.slice(1).every((call) => call === 'drawImage(destination-out)')).toBe(true)

    const plain = ChatBackgroundPatternRenderer.getInstance({ element: element(), url: 'p', width: 300, height: 200 })
    const plainCanvas = plain.createCanvas()
    await plain.renderToCanvas(plainCanvas)
    const plainCalls = fakeCanvas.ctxOf(plainCanvas)!.calls
    expect(plainCalls.some((call) => call.startsWith('fillRect'))).toBe(false)
    expect(plainCalls.length).toBeGreaterThan(0)
    expect(plainCalls.every((call) => call === 'drawImage(source-over)')).toBe(true)
  })

  it('cleanup последнего холста снимает инстанс — следующий getInstance создаёт новый', () => {
    const layer = element()
    const options = { element: layer, url: 'c', width: 10, height: 10 }
    const renderer = ChatBackgroundPatternRenderer.getInstance(options)
    const first = renderer.createCanvas()
    const second = renderer.createCanvas()
    renderer.cleanup(first)
    expect(ChatBackgroundPatternRenderer.getInstance(options)).toBe(renderer)
    renderer.cleanup(second)
    expect(ChatBackgroundPatternRenderer.getInstance(options)).not.toBe(renderer)
  })

  it('resizeInstancesOf — холсты инстансов слоя пересчитываются под новый размер слоя', async() => {
    const layer = element()
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({ width: 50, height: 40 } as DOMRect)
    const renderer = ChatBackgroundPatternRenderer.getInstance({ element: layer, url: 'r', width: 10, height: 10 })
    const canvas = renderer.createCanvas()
    await ChatBackgroundPatternRenderer.resizeInstancesOf(layer)
    expect([canvas.width, canvas.height]).toEqual([50, 40])
  })
})
