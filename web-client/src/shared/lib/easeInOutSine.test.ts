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
  it('t > d — ограничитель держит конечное значение, а не крутит косинус обратно', () => {
    // Без `t >= d ? b + c : …` косинус на t=200,d=150 дал бы 0.75, а не 1 — волна
    // стирания «отъезжала» бы назад и никогда не завершалась (см. комментарий в файле).
    expect(easeInOutSine(200, 0, 1, 150)).toBe(1)
  })
})
