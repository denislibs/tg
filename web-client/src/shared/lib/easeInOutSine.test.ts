import { describe, expect, it } from 'vitest'
import { easeInOutSine } from './easeInOutSine'

// Сигнатура tweb (t: elapsed, b: старт, c: дельта, d: длительность).
describe('easeInOutSine', () => {
  it('края', () => {
    expect(easeInOutSine(0, 0, 1, 150)).toBeCloseTo(0)
    expect(easeInOutSine(150, 0, 1, 150)).toBeCloseTo(1)
  })
  it('середина = 0.5', () => {
    expect(easeInOutSine(75, 0, 1, 150)).toBeCloseTo(0.5)
  })
})
