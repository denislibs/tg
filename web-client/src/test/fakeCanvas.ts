// Поддельный 2D-контекст холста для тестов фона чата: в happy-dom
// `getContext('2d')` — `null`, а фон (порт tweb `chatBackground.tsx`) рисует
// градиент, узор и считает средний цвет по холсту по-настоящему.
//
// Контекст не растеризует, а держит на холсте ОДИН цвет — средний по тому, что
// в него положили: `putImageData` усредняет пиксели, `drawImage` холста
// переносит цвет источника, `fillRect` — цвет заливки. `getImageData` отдаёт
// буфер, залитый этим цветом, — ровно столько нужно `averageColorFromCanvas`.
// Вызовы записываются (`calls`), чтобы пины видели стратегию узора.
import { vi } from 'vitest'

type Rgba = [number, number, number, number]

export type FakeContext = {
  canvas: HTMLCanvasElement
  calls: string[]
  color: Rgba
  fillStyle: string
  globalCompositeOperation: string
}

const parseStyle = (style: string): Rgba => {
  const hex = /^#([0-9a-f]{6})$/i.exec(style)
  if(hex) {
    const n = parseInt(hex[1], 16)
    return [n >> 16 & 255, n >> 8 & 255, n & 255, 255]
  }
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(style)
  return rgb ? [+rgb[1], +rgb[2], +rgb[3], 255] : [0, 0, 0, 255]
}

export function installFakeCanvas() {
  const contexts = new WeakMap<HTMLCanvasElement, FakeContext>()

  const make = (canvas: HTMLCanvasElement) => {
    const ctx = {
      canvas,
      calls: [] as string[],
      color: [0, 0, 0, 0] as Rgba,
      fillStyle: '#000000',
      globalCompositeOperation: 'source-over',
      fillRect(x: number, y: number, w: number, h: number) {
        ctx.calls.push(`fillRect(${ctx.fillStyle},${x},${y},${w},${h})`)
        ctx.color = parseStyle(ctx.fillStyle)
      },
      drawImage(source: CanvasImageSource) {
        ctx.calls.push(`drawImage(${ctx.globalCompositeOperation})`)
        const from = source instanceof HTMLCanvasElement ? contexts.get(source) : undefined
        if(from) ctx.color = [...from.color]
      },
      createImageData(width: number, height: number) {
        return { width, height, data: new Uint8ClampedArray(width * height * 4) }
      },
      putImageData(imageData: ImageData) {
        const { data } = imageData
        const sum = [0, 0, 0, 0]
        for(let i = 0; i < data.length; i += 4) {
          for(let c = 0; c < 4; ++c) sum[c] += data[i + c]
        }
        const count = data.length / 4
        ctx.color = sum.map((v) => Math.round(v / count)) as Rgba
      },
      getImageData(_x: number, _y: number, width: number, height: number) {
        const data = new Uint8ClampedArray(width * height * 4)
        for(let i = 0; i < data.length; i += 4) data.set(ctx.color, i)
        return { width, height, data }
      },
    }
    contexts.set(canvas, ctx)
    return ctx
  }

  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(this: HTMLCanvasElement) {
    return (contexts.get(this) ?? make(this)) as unknown as CanvasRenderingContext2D
  } as unknown as HTMLCanvasElement['getContext'])

  return {
    ctxOf: (canvas: HTMLCanvasElement) => contexts.get(canvas) as FakeContext | undefined,
    restore: () => spy.mockRestore(),
  }
}
