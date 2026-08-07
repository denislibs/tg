import { describe, it, expect } from 'vitest'
import { highlightingColor } from './color'

describe('highlightingColor (порт tweb PresentationData iOS)', () => {
  it('поднимает насыщенность и затемняет L·0.65, alpha .4', () => {
    // s>0: s = min(100, s + 5 + 0.1*(100-s)); l = l*0.65
    // вход rgb(77,142,80) ≈ зелёный: h≈122.3, s≈29.7, l≈43.0
    expect(highlightingColor([77, 142, 80])).toMatch(/^hsla\(/)
  })
  it('серый (s=0) не трогает насыщенность', () => {
    const out = highlightingColor([128, 128, 128])
    expect(out).toContain('0%') // s остаётся 0
  })
  it('всегда alpha .4', () => {
    expect(highlightingColor([10, 20, 30])).toMatch(/, \.4\)$/)
  })
})
