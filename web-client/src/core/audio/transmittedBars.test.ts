import { afterEach, describe, it, expect } from 'vitest'
import mediaSizes from '@core/dom/mediaSizes'
import { decodeTransmittedPeaks, buildWaveformBars, WAVEFORM_HEIGHT } from './waveform'
import { pack5bit } from './voiceWaveformAnalyser'
import { b64FromBytes } from '../secret/crypto'

const b64 = (vals: number[]) => b64FromBytes(pack5bit(vals))
const BAR_HEIGHT_MIN = 4

describe('decodeTransmittedPeaks (переданные пики)', () => {
  it('пустая строка → []', () => {
    expect(decodeTransmittedPeaks('')).toEqual([])
  })

  it('распаковывает сырые значения 0..31', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i % 32)
    expect(decodeTransmittedPeaks(b64(vals))).toEqual(vals)
  })

  it('битый base64 → [] (не бросает)', () => {
    expect(decodeTransmittedPeaks('!!!not base64!!!')).toEqual([])
  })
})

describe('buildWaveformBars (порт tweb createWaveformBars)', () => {
  const peaks = Array.from({ length: 100 }, (_, i) => i % 32)
  const wasMobile = mediaSizes.isMobile

  afterEach(() => {
    mediaSizes.isMobile = wasMobile
  })

  it('ширина волны — 190px у короткой записи, 256px у минутной', () => {
    expect(buildWaveformBars(peaks, 3).width).toBe(190)
    expect(buildWaveformBars(peaks, 60).width).toBe(256)
  })

  // tweb audio.ts:88-89 — своя пара minW/maxW на мобильном экране; экран знает
  // ОДИН владелец, `mediaSizes` (порт tweb helpers/mediaSizes.ts).
  it('мобильный экран — своя пара 152/190', () => {
    mediaSizes.isMobile = true
    expect(buildWaveformBars(peaks, 3).width).toBe(152)
    expect(buildWaveformBars(peaks, 60).width).toBe(190)
    // и число баров считается от неё же: 152/4 = 38
    expect(buildWaveformBars(peaks, 3).bars).toHaveLength(38)
    // пиков нет — ширина всё равно мобильного минимума
    expect(buildWaveformBars([], 3).width).toBe(152)
  })

  it('число баров = ширина волны / (бар + зазор); короткая запись → минимум 190px', () => {
    // availW = clamp(3/60*256, 190, 256) = 190 → 190/4 = 47
    expect(buildWaveformBars(peaks, 3).bars).toHaveLength(47)
    // минута и дольше упирается в максимум 256px → 64, но не больше числа пиков
    expect(buildWaveformBars(peaks, 60).bars).toHaveLength(64)
  })

  it('высоты в пикселях, не выше barHeightMax', () => {
    const { bars } = buildWaveformBars(peaks, 3)
    expect(bars.every((b) => b >= BAR_HEIGHT_MIN && b <= WAVEFORM_HEIGHT)).toBe(true)
  })

  it('ровная запись на пике → все бары одной высоты (нормировка на пик записи)', () => {
    // формула tweb упирается не в barHeightMax, а в (31*19 + 16)/32 ≈ 18.9
    const { bars } = buildWaveformBars(Array.from({ length: 100 }, () => 31), 3)
    expect(bars.every((b) => Math.abs(b - bars[0]) < 1e-9)).toBe(true)
    expect(bars[0]).toBeCloseTo(18.906, 2)
    expect(bars[0]).toBeLessThan(WAVEFORM_HEIGHT)
  })

  it('тишина → пол barHeightMin', () => {
    const { bars } = buildWaveformBars(Array.from({ length: 100 }, () => 0), 3)
    expect(bars.every((b) => b === BAR_HEIGHT_MIN)).toBe(true)
  })

  it('тихая запись НЕ растягивается до максимума одинаковых баров', () => {
    // половина тишины, половина умеренной громкости — форма должна сохраниться
    const mixed = Array.from({ length: 100 }, (_, i) => (i < 50 ? 0 : 8))
    const { bars } = buildWaveformBars(mixed, 3)
    expect(Math.min(...bars)).toBe(BAR_HEIGHT_MIN)
    expect(Math.max(...bars)).toBeGreaterThan(BAR_HEIGHT_MIN)
    expect(Math.max(...bars)).toBeLessThan(WAVEFORM_HEIGHT)
  })

  it('нет пиков → []', () => {
    expect(buildWaveformBars([], 3).bars).toEqual([])
  })
})
