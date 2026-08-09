import { describe, expect, it } from 'vitest'
import { resolveTransition } from './chatBackgroundTransition'

// tweb chatBackground.tsx:349-359 — первый в жизни фон: из кэша instant, иначе fade.
describe('resolveTransition', () => {
  it('первый показ без кэша — fade', () => {
    expect(resolveTransition({ hadPrevious: false, cached: false })).toBe('fade')
  })
  it('первый показ из кэша — instant', () => {
    expect(resolveTransition({ hadPrevious: false, cached: true })).toBe('instant')
  })
  it('повторная установка того же фона — instant', () => {
    expect(resolveTransition({ hadPrevious: true, cached: true })).toBe('instant')
  })
})
