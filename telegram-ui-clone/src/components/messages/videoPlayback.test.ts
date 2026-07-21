import { describe, it, expect } from 'vitest'
import { formatVideoTime, bufferedEnd, bufferedPercent, nextRate, VIDEO_RATES, type TimeRangesLike } from './videoPlayback'

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

describe('nextRate', () => {
  it('циклический перебор дефолтного списка', () => {
    expect(nextRate(0.5)).toBe(1)
    expect(nextRate(1)).toBe(1.5)
    expect(nextRate(1.5)).toBe(2)
    expect(nextRate(2)).toBe(0.5)
  })
  it('неизвестная скорость → первый элемент', () => {
    expect(nextRate(3)).toBe(VIDEO_RATES[0])
    expect(nextRate(0)).toBe(VIDEO_RATES[0])
  })
  it('кастомный список', () => {
    expect(nextRate(2, [1, 2])).toBe(1)
    expect(nextRate(1, [1, 2])).toBe(2)
  })
})
