// Тест на applyHighlightingColor — порт tweb helpers/themeController.ts:293-316.
import { describe, it, expect } from 'vitest'
import { applyHighlightingColor } from './themeController'

describe('applyHighlightingColor', () => {
  it('пишет --message-highlighting-color + -rgb + -alpha', () => {
    const el = document.createElement('div')
    applyHighlightingColor('night', el)
    expect(el.style.getPropertyValue('--message-highlighting-color')).toContain('hsla')
    expect(el.style.getPropertyValue('--message-highlighting-color-rgb').split(',').length).toBe(3)
    const a = parseFloat(el.style.getPropertyValue('--message-highlighting-alpha'))
    expect(a).toBeCloseTo(0.4, 1)
  })
})
