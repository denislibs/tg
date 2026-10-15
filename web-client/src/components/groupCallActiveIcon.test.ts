// Иконка «идёт видеочат» в строке списка (порт tweb `groupCallActiveIcon.ts`):
// три столбца на канвасе 20×20, высота каждого ходит по easeInOutSine за 1 с.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import mediaSizes from '@core/dom/mediaSizes'
import groupCallActiveIcon from './groupCallActiveIcon'

// happy-dom отдаёт на getContext('2d') → null; иконке нужны clearRect и путь.
type StubContext = ReturnType<typeof stubContext>
const stubContext = () => ({
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  canvas: {} as HTMLCanvasElement,
  fillStyle: '' as string,
})
const contexts = new WeakMap<HTMLCanvasElement, StubContext>()
const ctxOf = (canvas: HTMLCanvasElement) => contexts.get(canvas)!

let frames: FrameRequestCallback[] = []

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(this: HTMLCanvasElement) {
    let ctx = contexts.get(this)
    if(!ctx) contexts.set(this, ctx = { ...stubContext(), canvas: this })
    return ctx as unknown as CanvasRenderingContext2D
  })
  document.documentElement.style.setProperty('--primary-color', '#3390ec')
  mediaSizes.isMobile = false
})

/** иконка в DOM с первого кадра: цикл заканчивается, когда канвас снят (`wasMounted`) */
function mount(isActive?: boolean) {
  const icon = groupCallActiveIcon(isActive)
  document.body.append(icon.canvas)
  return icon
}

afterEach(() => {
  // fastRaf держит очередь на уровне модуля: недокрученный кадр оставил бы её
  // занятой, и следующий тест не получил бы своего requestAnimationFrame
  document.body.replaceChildren()
  while(frames.length) { const queue = frames; frames = []; queue.forEach((cb) => cb(0)) }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.style.removeProperty('--primary-color')
  document.body.replaceChildren()
})

describe('groupCallActiveIcon', () => {
  it('канвас 20×20 в физических пикселях, три столбца за кадр', () => {
    const { canvas, startAnimation } = mount()
    const dpr = window.devicePixelRatio
    expect(canvas.width).toBe(20 * dpr)
    expect(canvas.height).toBe(20 * dpr)

    startAnimation()
    const ctx = ctxOf(canvas)
    expect(ctx.clearRect).toHaveBeenCalledTimes(1)
    expect(ctx.fill).toHaveBeenCalledTimes(3)
  })

  it('цвет — белый; в активной строке на десктопе — primary-color; setActive перекрашивает сразу', () => {
    const { canvas, startAnimation, setActive } = mount()
    startAnimation()
    expect(ctxOf(canvas).fillStyle).toBe('#fff')

    setActive(true)
    expect(ctxOf(canvas).fillStyle).toBe('#3390ec')

    // на мобильном строка не красится в primary-color — столбцы остаются белыми
    mediaSizes.isMobile = true
    setActive(true)
    expect(ctxOf(canvas).fillStyle).toBe('#fff')
  })

  it('открытый чат при создании: isActive = true даёт цвет сразу', () => {
    const { canvas, startAnimation } = mount(true)
    startAnimation()
    expect(ctxOf(canvas).fillStyle).toBe('#3390ec')
  })

  it('цикл кадров идёт, пока канвас в DOM, и останавливается после снятия', () => {
    const { canvas, startAnimation } = mount()
    startAnimation()
    const ctx = ctxOf(canvas)
    const drawn = () => ctx.clearRect.mock.calls.length

    const run = () => { const queue = frames; frames = []; queue.forEach((cb) => cb(0)) }
    run()
    const afterOne = drawn()
    expect(afterOne).toBeGreaterThan(1)
    run()
    expect(drawn()).toBeGreaterThan(afterOne)

    canvas.remove()
    run() // кадр видит, что канвас снят, и цикл не продолжает
    const stopped = drawn()
    run()
    expect(drawn()).toBe(stopped)
    expect(frames).toHaveLength(0)
  })
})
