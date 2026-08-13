import { describe, expect, it } from 'vitest'
import { simpleEasing } from './easings'

// Опорные значения — кривая CSS `ease` (0.25, 0.1, 0.25, 1), tweb
// `src/helpers/easings.ts:6`. Если реальное simpleEasing(0.5) не ≈0.8024 —
// значит взята не та кривая, а не что тест неверный.
describe('simpleEasing', () => {
  it('края: simpleEasing(0) === 0, simpleEasing(1) === 1', () => {
    expect(simpleEasing(0)).toBe(0)
    expect(simpleEasing(1)).toBe(1)
  })

  it('опорная точка: simpleEasing(0.5) ≈ 0.8024', () => {
    expect(simpleEasing(0.5)).toBeCloseTo(0.8024, 3)
  })

  it('монотонность на сетке из 20 точек', () => {
    let prev = -Infinity
    for (let i = 0; i <= 20; i++) {
      const t = i / 20
      const v = simpleEasing(t)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})
