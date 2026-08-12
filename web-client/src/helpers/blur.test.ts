// Порт tweb blur.ts (Task 9): кэш канвасов на 150 записей со сбросом целиком.
// happy-dom не умеет 2D-канвас: getContext замокан стабом, который считает
// вызовы drawImage по канвасам; Image заменён фейком, стреляющим onload на
// установку src (happy-dom картинки не грузит).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Нативный путь (ctx.filter): в happy-dom `getContext('2d')` → null, и флаг
// вычислился бы в false (фолбэк fastBlur) — мокаем поддержку фильтра.
vi.mock('@environment/canvasFilterSupport', () => ({ default: true }))

class FakeImage {
  width = 40
  height = 30
  onload: (() => void) | null = null
  set src(_v: string) {
    queueMicrotask(() => this.onload?.())
  }
}

type Draw = { canvas: HTMLCanvasElement; source: unknown }
const draws: Draw[] = []
const ctxByCanvas = new Map<HTMLCanvasElement, { filter: string; drawImage: (source: unknown) => void }>()

function stubCanvas() {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    let ctx = ctxByCanvas.get(this)
    if (!ctx) {
      ctx = { filter: '', drawImage: (source: unknown) => { draws.push({ canvas: this, source }) } }
      ctxByCanvas.set(this, ctx)
    }
    return ctx
  } as unknown as typeof HTMLCanvasElement.prototype.getContext
}

const imageDraws = () => draws.filter((d) => d.source instanceof FakeImage)
const copyDraws = () => draws.filter((d) => d.source instanceof HTMLCanvasElement)

let blur: typeof import('./blur').default

beforeEach(async () => {
  draws.length = 0
  ctxByCanvas.clear()
  stubCanvas()
  vi.stubGlobal('Image', FakeImage)
  // Свежий модуль на каждый тест: кэш блюра — модульное состояние.
  vi.resetModules()
  blur = (await import('./blur')).default
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('helpers/blur — порт tweb blur.ts', () => {
  it('рисует через ctx.filter=blur(2px) в канвас .canvas-thumbnail; повторный вызов того же URL не рисует заново, а копирует из кэша', async () => {
    const uri = 'data:image/jpeg;base64,AAAA'
    const first = blur(uri)
    expect(first.canvas.className).toBe('canvas-thumbnail')
    await first.promise

    // ровно одна «тяжёлая» отрисовка исходной картинки, с нативным фильтром
    expect(imageDraws().length).toBe(1)
    expect(imageDraws()[0].canvas).toBe(first.canvas)
    expect(ctxByCanvas.get(first.canvas)!.filter).toBe('blur(2px)')
    // processBlurNext выставил размеры канваса по картинке (40×30)
    expect(first.canvas.width).toBe(40)

    const second = blur(uri)
    // каждый вызов отдаёт СВОЙ канвас (их монтируют в разные места DOM)…
    expect(second.canvas).not.toBe(first.canvas)
    // …но размеры уже скопированы синхронно из кэшированного
    expect(second.canvas.width).toBe(40)
    await second.promise
    await Promise.resolve() // копия рисуется в .then на уже резолвнутом промисе

    // исходную картинку заново НЕ рисовали — в новый канвас скопирован кэшированный
    expect(imageDraws().length).toBe(1)
    expect(copyDraws().length).toBe(1)
    expect(copyDraws()[0].canvas).toBe(second.canvas)
    expect(copyDraws()[0].source).toBe(first.canvas)
  })

  it('кэш живёт до 150 записей включительно, на 151-й сбрасывается целиком', async () => {
    const uri = 'data:image/jpeg;base64,AAAA'
    const first = blur(uri)
    await first.promise
    expect(first.canvas.width).toBe(40)

    // добить кэш до ровно 150 записей — запись uri ещё жива
    for (let i = 1; i <= 149; i++) blur(`data:image/jpeg;base64,u${i}`)
    expect(blur(uri).canvas.width).toBe(40) // синхронная копия из кэша

    // 151-я запись → следующий вызов сбрасывает кэш ЦЕЛИКОМ (tweb blur.ts:60-62)
    blur('data:image/jpeg;base64,u150')
    const afterReset = blur(uri)
    // копии из кэша не было (размер канваса остался дефолтным) — uri пойдёт
    // на повторную отрисовку как некэшированный
    expect(afterReset.canvas.width).not.toBe(40)
    await afterReset.promise
    expect(imageDraws().filter((d) => d.canvas === afterReset.canvas).length).toBe(1)
  })
})
