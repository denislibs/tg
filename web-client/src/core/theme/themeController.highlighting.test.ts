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

  // Соответствие имён — tweb `themeController.ts:191-196` (`themeNameToBaseTheme`):
  // day → baseThemeClassic (ОЛИВКОВАЯ подсветка под классическую зелёную тему),
  // light → baseThemeDay (синяя). Значения — `config/state.ts:392-395`.
  // Пин ровно на это: две темы легко перепутать, а расходится только оттенок.
  it('day берёт подсветку baseThemeClassic, а не baseThemeDay', () => {
    const day = document.createElement('div')
    applyHighlightingColor('day', day)
    expect(day.style.getPropertyValue('--message-highlighting-color'))
      .toBe('hsla(86.4, 43.846153%, 45.117647%, .4)')

    const light = document.createElement('div')
    applyHighlightingColor('light', light)
    expect(light.style.getPropertyValue('--message-highlighting-color'))
      .toBe('hsla(210, 67.741935%, 50.588235%, .4)')
  })
})
