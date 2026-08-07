// Анимированный многоцветный mesh-градиент обоев чата — порт tweb 1:1
// (src/components/chat/gradientRenderer.ts, автор Artem Kolnogorov). Рисует
// градиент из 2..4 цветов на маленьком 50×50 canvas (браузер растягивает =
// сглаженный mesh), с плавным сдвигом позиций точек при отправке сообщения
// (toNextPosition). Зависимости tweb (animateSingle, easeOutQuad) инлайнены.
import { hexToRgb } from '../../shared/lib/color'

const WIDTH = 50
const HEIGHT = WIDTH

type Point = { x: number; y: number }

// RAF-цикл: зовёт cb каждый кадр, пока он возвращает true (порт tweb animateSingle).
function animateSingle(cb: () => boolean): void {
  const loop = () => {
    if (cb()) requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}

// easeOutQuad(t)·mult (порт tweb easeOutQuadApply).
function easeOutQuadApply(t: number, mult: number): number {
  return -mult * t * (t - 2)
}

export default class ChatBackgroundGradientRenderer {
  private readonly _width = WIDTH
  private readonly _height = HEIGHT
  private _phase = 0
  private _tail = 0
  private readonly _tails = 90
  private _frames: ImageData[] = []
  private _colors: { r: number; g: number; b: number }[] = []
  private readonly _curve = [
    0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 18.3, 18.6, 18.9,
    19.2, 19.5, 19.8, 20.1, 20.4, 20.7, 21.0, 21.3, 21.6, 21.9, 22.2, 22.5, 22.8, 23.1, 23.4, 23.7, 24.0, 24.3, 24.6,
    24.9, 25.2, 25.5, 25.8, 26.1, 26.3, 26.4, 26.5, 26.6, 26.7, 26.8, 26.9, 27,
  ]
  private readonly _incrementalCurve: number[]
  private readonly _positions: Point[] = [
    { x: 0.8, y: 0.1 },
    { x: 0.6, y: 0.2 },
    { x: 0.35, y: 0.25 },
    { x: 0.25, y: 0.6 },
    { x: 0.2, y: 0.9 },
    { x: 0.4, y: 0.8 },
    { x: 0.65, y: 0.75 },
    { x: 0.75, y: 0.4 },
  ]
  private readonly _phases = this._positions.length

  private _ctx!: CanvasRenderingContext2D
  private _hc!: HTMLCanvasElement
  private _hctx!: CanvasRenderingContext2D

  private _nextPositionTail?: number
  private _nextPositionTails?: number
  private _nextPositionLeft?: number

  constructor() {
    const diff = this._tails / this._curve[this._curve.length - 1]
    for (let i = 0, length = this._curve.length; i < length; ++i) {
      this._curve[i] = this._curve[i] * diff
    }
    this._incrementalCurve = this._curve.map((v, i, arr) => v - (arr[i - 1] ?? 0))
  }

  private rgb(hex: string) {
    const [r, g, b] = hexToRgb(hex)
    return { r, g, b }
  }

  private getPositions(shift: number): Point[] {
    const positions = this._positions.slice()
    positions.push(...positions.splice(0, shift))
    const result: Point[] = []
    for (let i = 0; i < positions.length; i += 2) result.push(positions[i])
    return result
  }

  private getNextPositions(phase: number, curveMax: number, curve: number[]): Point[][] {
    const pos = this.getPositions(phase)
    if (!curve[0] && curve.length === 1) return [pos]

    const nextPos = this.getPositions(++phase % this._phases)
    const distances = nextPos.map((np, idx) => ({
      x: (np.x - pos[idx].x) / curveMax,
      y: (np.y - pos[idx].y) / curveMax,
    }))
    return curve.map((value) => distances.map((distance, idx) => ({
      x: pos[idx].x + distance.x * value,
      y: pos[idx].y + distance.y * value,
    })))
  }

  private curPosition(phase: number, tail: number): Point[] {
    return this.getNextPositions(phase, this._tails, [tail])[0]
  }

  private changeTail(diff: number): void {
    this._tail += diff
    while (this._tail >= this._tails) {
      this._tail -= this._tails
      if (++this._phase >= this._phases) this._phase -= this._phases
    }
    while (this._tail < 0) {
      this._tail += this._tails
      if (--this._phase < 0) this._phase += this._phases
    }
  }

  private changeTailAndDraw(diff: number): void {
    this.changeTail(diff)
    this.drawGradient(this.curPosition(this._phase, this._tail))
  }

  private drawNextPositionAnimated = (getProgress?: () => number): boolean => {
    let done: boolean
    let id: ImageData | undefined
    if (getProgress) {
      const value = getProgress()
      done = value >= 1
      const transitionValue = easeOutQuadApply(value, 1)
      const nextPositionTail = this._nextPositionTail ?? 0
      const tail = (this._nextPositionTail = (this._nextPositionTails ?? 0) * transitionValue)
      const diff = tail - nextPositionTail
      if (diff) {
        this._nextPositionLeft = (this._nextPositionLeft ?? 0) - diff
        this.changeTailAndDraw(-diff)
      }
    } else {
      id = this._frames.shift()
      done = !this._frames.length
    }
    if (id) this.drawImageData(id)
    if (done) {
      this._nextPositionLeft = undefined
      this._nextPositionTails = undefined
      this._nextPositionTail = undefined
    }
    return !done
  }

  // Первый параметр (позиции) в tweb вестигиален — цвета интерполируются из
  // phase/progress; сохраняем сигнатуру порта, но помечаем как неиспользуемый.
  private getGradientImageData(_frame: Point[], phase = this._phase, progress = 1 - this._tail / this._tails): ImageData {
    const id = this._hctx.createImageData(this._width, this._height)
    const pixels = id.data
    const colorsLength = this._colors.length

    const positionsForPhase = (ph: number): Point[] => {
      const result: Point[] = []
      for (let i = 0; i !== 4; ++i) {
        const p = this._positions[(ph + i * 2) % this._positions.length]
        result[i] = { x: p.x, y: 1.0 - p.y }
      }
      return result
    }

    const previous = positionsForPhase((phase + 1) % this._positions.length)
    const current = positionsForPhase(phase)

    let offset = 0
    for (let y = 0; y < this._height; ++y) {
      const directPixelY = y / this._height
      const centerDistanceY = directPixelY - 0.5
      const centerDistanceY2 = centerDistanceY * centerDistanceY
      for (let x = 0; x < this._width; ++x) {
        const directPixelX = x / this._width
        const centerDistanceX = directPixelX - 0.5
        const centerDistance = Math.sqrt(centerDistanceX * centerDistanceX + centerDistanceY2)

        const swirlFactor = 0.35 * centerDistance
        const theta = swirlFactor * swirlFactor * 0.8 * 8.0
        const sinTheta = Math.sin(theta)
        const cosTheta = Math.cos(theta)

        const pixelX = Math.max(0.0, Math.min(1.0, 0.5 + centerDistanceX * cosTheta - centerDistanceY * sinTheta))
        const pixelY = Math.max(0.0, Math.min(1.0, 0.5 + centerDistanceX * sinTheta + centerDistanceY * cosTheta))

        let distanceSum = 0.0
        let r = 0.0
        let g = 0.0
        let b = 0.0
        for (let i = 0; i < colorsLength; ++i) {
          const colorX = previous[i].x + (current[i].x - previous[i].x) * progress
          const colorY = previous[i].y + (current[i].y - previous[i].y) * progress
          const distanceX = pixelX - colorX
          const distanceY = pixelY - colorY
          let distance = Math.max(0.0, 0.9 - Math.sqrt(distanceX * distanceX + distanceY * distanceY))
          distance = distance * distance * distance * distance
          distanceSum += distance
          r += distance * this._colors[i].r
          g += distance * this._colors[i].g
          b += distance * this._colors[i].b
        }
        pixels[offset++] = r / distanceSum
        pixels[offset++] = g / distanceSum
        pixels[offset++] = b / distanceSum
        pixels[offset++] = 0xff
      }
    }
    return id
  }

  private drawImageData(id: ImageData): void {
    this._hctx.putImageData(id, 0, 0)
    this._ctx.drawImage(this._hc, 0, 0, this._width, this._height)
  }

  private drawGradient(positions: Point[]): void {
    this.drawImageData(this.getGradientImageData(positions))
  }

  public init(el: HTMLCanvasElement): void {
    this._frames = []
    this._phase = 0
    this._tail = 0

    const colors = (el.getAttribute('data-colors') ?? '').split(',').filter(Boolean)
    this._colors = colors.map((c) => this.rgb(c))

    if (!this._hc) {
      this._hc = document.createElement('canvas')
      this._hc.width = this._width
      this._hc.height = this._height
      this._hctx = this._hc.getContext('2d', { alpha: false })!
    }

    this._ctx = el.getContext('2d', { alpha: false })!
    this.update()
  }

  private update(): void {
    if (this._colors.length < 2) {
      const color = this._colors[0]
      if (!color) return
      const fill = `rgb(${color.r}, ${color.g}, ${color.b})`
      this._ctx.fillStyle = fill
      this._ctx.fillRect(0, 0, this._width, this._height)
      return
    }
    this.drawGradient(this.curPosition(this._phase, this._tail))
  }

  /** Плавный сдвиг градиента на одну позицию — вызывается при отправке сообщения. */
  public toNextPosition(getProgress?: () => number): void {
    if (this._colors.length < 2) return

    if (getProgress) {
      this._nextPositionLeft = this._tails + (this._nextPositionLeft ?? 0)
      this._nextPositionTails = this._nextPositionLeft
      this._nextPositionTail = undefined
      animateSingle(() => this.drawNextPositionAnimated(getProgress))
      return
    }

    const tail = this._tail
    const tails = this._tails
    let nextPhaseOnIdx: number | undefined

    const curve: number[] = []
    for (let i = 0, length = this._incrementalCurve.length; i < length; ++i) {
      const inc = this._incrementalCurve[i]
      let value = (curve[i - 1] ?? tail) + inc
      if (+value.toFixed(2) > tails && nextPhaseOnIdx === undefined) {
        nextPhaseOnIdx = i
        value %= tails
      }
      curve.push(value)
    }

    const currentPhaseCurve = curve.slice(0, nextPhaseOnIdx)
    const nextPhaseCurve = nextPhaseOnIdx !== undefined ? curve.slice(nextPhaseOnIdx) : []

    ;[currentPhaseCurve, nextPhaseCurve].forEach((c, idx, curves) => {
      const last = c[c.length - 1]
      if (last !== undefined && last > tails) c[c.length - 1] = +last.toFixed(2)
      this._tail = last ?? 0
      if (!c.length) return
      const positions = this.getNextPositions(this._phase, tails, c)
      if (idx !== curves.length - 1) {
        if (++this._phase >= this._phases) this._phase -= this._phases
      }
      this._frames.push(...positions.map((pos) => this.getGradientImageData(pos)))
    })

    animateSingle(this.drawNextPositionAnimated)
  }

  public static createCanvas(colors?: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    canvas.height = HEIGHT
    if (colors !== undefined) canvas.dataset.colors = colors
    return canvas
  }

  public static create(colors?: string): { gradientRenderer: ChatBackgroundGradientRenderer; canvas: HTMLCanvasElement } {
    const canvas = this.createCanvas(colors)
    const gradientRenderer = new ChatBackgroundGradientRenderer()
    gradientRenderer.init(canvas)
    return { gradientRenderer, canvas }
  }
}
