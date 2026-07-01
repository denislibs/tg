import { describe, it, expect } from 'vitest'
import { fmtViews } from './fmtViews'

describe('fmtViews (compact channel-post view count)', () => {
  it('leaves sub-1000 counts as-is', () => {
    expect(fmtViews(0)).toBe('0')
    expect(fmtViews(1)).toBe('1')
    expect(fmtViews(999)).toBe('999')
  })
  it('formats thousands with one decimal, dropping whole-thousand decimals', () => {
    expect(fmtViews(1000)).toBe('1K')
    expect(fmtViews(1500)).toBe('1.5K')
    expect(fmtViews(9200)).toBe('9.2K')
    expect(fmtViews(12300)).toBe('12.3K')
  })
  it('formats millions', () => {
    expect(fmtViews(1_000_000)).toBe('1M')
    expect(fmtViews(1_500_000)).toBe('1.5M')
  })
})
