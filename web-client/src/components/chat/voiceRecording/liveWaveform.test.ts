// Волна панели записи (порт tweb `voiceRecording/liveWaveform.ts`): живые пики нормируются
// по максимуму за всю запись и прижаты к правому краю, окно — сколько столбиков влезает по
// ширине, полная волна на паузе ужимается максимумом по корзинам, прогресс прослушивания
// гасит непроигранное до 30 %, клик по волне — перемотка, только когда она разрешена.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LiveWaveform from './liveWaveform'

type Bar = { x: number, y: number, w: number, h: number, alpha: number }

let bars: Bar[]

beforeEach(() => {
  bars = []
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    setTransform: () => {},
    clearRect: () => { bars = [] },
    beginPath: () => {},
    fill: () => {},
    fillRect: () => {},
    roundRect(x: number, y: number, w: number, h: number) {
      bars.push({ x, y, w, h, alpha: this.globalAlpha })
    },
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const WIDTH = 60 // (60 + 3) / (3 + 3) → 10 столбиков
const HEIGHT = 36

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** Узел в DOM и первый кадр — замер ширины (у браузера его делает `ResizeObserver`). */
async function mount() {
  const waveform = new LiveWaveform()
  waveform.element.getBoundingClientRect = () => ({ left: 100, width: WIDTH, height: HEIGHT } as DOMRect)
  document.body.append(waveform.element)
  waveform.clear()
  await frame()
  return waveform
}

describe('LiveWaveform', () => {
  it('живой пик нормируется по максимуму за запись, столбики растут от правого края', async() => {
    const waveform = await mount()
    waveform.pushPeak(0.1)
    waveform.pushPeak(0.2)
    waveform.pushPeak(0.1)
    await frame()

    expect(bars.map((b) => b.h)).toEqual([HEIGHT, HEIGHT, HEIGHT / 2])
    // три столбика по 3 px через 3 px — 15 px у правого края
    expect(bars.map((b) => b.x)).toEqual([45, 51, 57])
    expect(bars.every((b) => b.alpha === 1)).toBe(true)
    waveform.destroy()
  })

  it('окно — сколько влезает по ширине: старые столбики уезжают влево', async() => {
    const waveform = await mount()
    for(let i = 1; i <= 12; ++i) waveform.pushPeak(0.5)
    await frame()
    expect(bars).toHaveLength(10)
    expect(bars[0].x).toBe(3)
    waveform.destroy()
  })

  it('полная волна на паузе: корзины по максимуму, нормировка по самому высокому', async() => {
    const waveform = await mount()
    const peaks = Array.from({ length: 20 }, (_, i) => i === 7 ? 400 : 100)
    waveform.setPeaks(peaks)
    await frame()

    expect(bars).toHaveLength(10)
    // корзина 3 — пары (6, 7): в ней пик 400 → полная высота, остальные — четверть
    expect(bars.map((b) => b.h)).toEqual([9, 9, 9, HEIGHT, 9, 9, 9, 9, 9, 9])
    waveform.destroy()
  })

  it('прогресс прослушивания: проигранное ярко, остальное — 30 %; снятый прогресс возвращает всё', async() => {
    const waveform = await mount()
    waveform.setPeaks(Array.from({ length: 10 }, () => 1))
    waveform.setProgress(0.5)
    await frame()
    expect(bars.map((b) => b.alpha)).toEqual([1, 1, 1, 1, 1, 0.3, 0.3, 0.3, 0.3, 0.3])

    waveform.setProgress(undefined)
    await frame()
    expect(bars.every((b) => b.alpha === 1)).toBe(true)
    waveform.destroy()
  })

  it('клик — перемотка в долю ширины, только при `setSeekable(true)`', async() => {
    const waveform = await mount()
    const onSeek = vi.fn()
    waveform.onSeek = onSeek

    waveform.element.dispatchEvent(new MouseEvent('click', { clientX: 130 }))
    expect(onSeek).not.toHaveBeenCalled()

    waveform.setSeekable(true)
    waveform.element.dispatchEvent(new MouseEvent('click', { clientX: 130 }))
    expect(onSeek).toHaveBeenCalledWith(0.5)
    waveform.destroy()
  })

  it('clear сбрасывает и пики, и максимум за запись', async() => {
    const waveform = await mount()
    waveform.pushPeak(1)
    waveform.clear()
    waveform.pushPeak(0.025)
    await frame()
    // максимум снова 0,05 (стартовый), а не 1: столбик — половина высоты
    expect(bars.map((b) => b.h)).toEqual([HEIGHT / 2])
    waveform.destroy()
  })
})
