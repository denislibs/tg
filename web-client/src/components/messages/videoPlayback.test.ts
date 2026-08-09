import { describe, it, expect } from 'vitest'
import { formatVideoTime, bufferedEnd, bufferedPercent, rateToString, VIDEO_RATES, type TimeRangesLike } from './videoPlayback'

// Мини-фабрика TimeRanges-подобного объекта из массива [start, end] пар.
function ranges(pairs: [number, number][]): TimeRangesLike {
  return {
    length: pairs.length,
    start: (i) => pairs[i][0],
    end: (i) => pairs[i][1],
  }
}

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

describe('bufferedEnd', () => {
  it('пустые диапазоны → 0', () => {
    expect(bufferedEnd(ranges([]), 0)).toBe(0)
  })
  it('один диапазон с начала', () => {
    expect(bufferedEnd(ranges([[0, 30]]), 5)).toBe(30)
  })
  it('несколько диапазонов — берём ближайший к текущему времени (наибольший start ≤ currentTime)', () => {
    const r = ranges([[0, 10], [20, 40]])
    expect(bufferedEnd(r, 5)).toBe(10)
    expect(bufferedEnd(r, 25)).toBe(40)
  })
  it('текущее время до второго диапазона → остаёмся на первом', () => {
    const r = ranges([[0, 10], [20, 40]])
    expect(bufferedEnd(r, 15)).toBe(10)
  })
})

describe('bufferedPercent', () => {
  it('процент от длительности', () => {
    expect(bufferedPercent(ranges([[0, 30]]), 0, 60)).toBe(50)
    expect(bufferedPercent(ranges([[0, 60]]), 0, 60)).toBe(100)
  })
  it('нулевая/невалидная длительность → 0', () => {
    expect(bufferedPercent(ranges([[0, 30]]), 0, 0)).toBe(0)
    expect(bufferedPercent(ranges([[0, 30]]), 0, NaN)).toBe(0)
  })
  it('клампится в 0..100', () => {
    expect(bufferedPercent(ranges([[0, 120]]), 0, 60)).toBe(100)
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
