import { describe, it, expect } from 'vitest'
import { formatVideoTime, rateToString, VIDEO_RATES } from './videoPlayback'

describe('formatVideoTime', () => {
  it('mm:ss без часов, секунды всегда с нулём, минуты — без', () => {
    expect(formatVideoTime(0)).toBe('0:00')
    expect(formatVideoTime(5)).toBe('0:05')
    expect(formatVideoTime(65)).toBe('1:05')
    expect(formatVideoTime(600)).toBe('10:00')
  })
  it('h:mm:ss при длительности ≥ часа (минуты с нулём)', () => {
    expect(formatVideoTime(3600)).toBe('1:00:00')
    expect(formatVideoTime(3661)).toBe('1:01:01')
    expect(formatVideoTime(3600 + 5 * 60 + 9)).toBe('1:05:09')
  })
  it('дробные секунды усекаются вниз', () => {
    expect(formatVideoTime(65.9)).toBe('1:05')
  })
  it('невалидные значения → 0:00', () => {
    expect(formatVideoTime(NaN)).toBe('0:00')
    expect(formatVideoTime(-10)).toBe('0:00')
    expect(formatVideoTime(Infinity)).toBe('0:00')
  })
})

describe('VIDEO_RATES', () => {
  it('набор скоростей — как в tweb playbackRateButton', () => {
    expect([...VIDEO_RATES]).toEqual([0.5, 1, 1.5, 2, 3])
  })
})

describe('rateToString', () => {
  it('целая скорость — с «x», дробная — как есть (tweb toFixed(1).replace(/\\.0$/, "x"))', () => {
    expect(rateToString(1)).toBe('1x')
    expect(rateToString(2)).toBe('2x')
    expect(rateToString(3)).toBe('3x')
    expect(rateToString(0.5)).toBe('0.5')
    expect(rateToString(1.5)).toBe('1.5')
  })
})
