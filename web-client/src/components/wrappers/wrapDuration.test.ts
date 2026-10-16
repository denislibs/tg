import { describe, it, expect } from 'vitest'
import { wrapStoriesStealthModeDuration } from './wrapDuration'

// tweb `wrapDuration.ts:55-57`: один старший разряд формами числа langPack.
describe('wrapStoriesStealthModeDuration', () => {
  it('300 с — «5 minutes», 1500 с — «25 minutes», 3600 с — «1 hour»', () => {
    expect(wrapStoriesStealthModeDuration(300).textContent).toBe('5 minutes')
    expect(wrapStoriesStealthModeDuration(1500).textContent).toBe('25 minutes')
    expect(wrapStoriesStealthModeDuration(3600).textContent).toBe('1 hour')
  })

  it('берёт один старший разряд: 5400 с — «1 hour», а не «1 hour, 30 minutes»', () => {
    expect(wrapStoriesStealthModeDuration(5400).textContent).toBe('1 hour')
  })
})
