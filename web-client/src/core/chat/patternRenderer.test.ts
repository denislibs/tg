import { describe, it, expect } from 'vitest'
import { patternOpacity } from './patternRenderer'

// Математика приглушения обоев — 1:1 tweb chatBackground.tsx:266-270.
describe('patternOpacity', () => {
  it('night intensity −50 (mask) → 0.3 (пол Math.max)', () => {
    // |−0.5|·0.5 = 0.25 → floor 0.3
    expect(patternOpacity(-50, true)).toBeCloseTo(0.3, 6)
  })

  it('day intensity 50 (light/overlay) → 0.5', () => {
    expect(patternOpacity(50, false)).toBeCloseTo(0.5, 6)
  })

  it('tinted intensity −38 (overlay, mask=false) → 0.38', () => {
    expect(patternOpacity(-38, false)).toBeCloseTo(0.38, 6)
  })

  it('mask-путь всегда ≥ 0.3 (пол)', () => {
    expect(patternOpacity(-10, true)).toBe(0.3) // 0.05 → floor 0.3
    expect(patternOpacity(0, true)).toBe(0.3)
  })

  it('большая интенсивность в mask не выбивает пол вверх линейно', () => {
    // |−100|/100·0.5 = 0.5
    expect(patternOpacity(-100, true)).toBeCloseTo(0.5, 6)
  })
})
