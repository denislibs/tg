// @vitest-environment happy-dom
// Бриф-шаблон просил `jsdom`, но репозиторий везде использует happy-dom
// (см. vitest.config.ts test.environment) и jsdom не установлен как зависимость —
// используем happy-dom, он даёт тот же document/head/style/classList API.
import { describe, it, expect } from 'vitest'
import { setTheme, getCurrentPreset } from './themeController'

const rootStyle = () => document.getElementById('theme')!.textContent || ''

describe('themeController', () => {
  it('injects primary-color + derived + rgb for day', () => {
    setTheme('day')
    const css = rootStyle()
    expect(css).toContain('--primary-color:#3390ec')
    expect(css).toMatch(/--primary-color-rgb:\s*51,\s*144,\s*236/)
    expect(css).toContain('--light-primary-color:')
    expect(document.documentElement.classList.contains('night')).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('day')
    expect(getCurrentPreset()).toBe('day')
  })

  it('night toggles .night class', () => {
    setTheme('night')
    expect(document.documentElement.classList.contains('night')).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('night')
    expect(getCurrentPreset()).toBe('night')
  })

  it('reuses single <style id=theme>', () => {
    setTheme('day')
    setTheme('night')
    expect(document.querySelectorAll('#theme').length).toBe(1)
  })

  it('overrides message-out-primary-color to white for dark presets (tweb applyTheme:889)', () => {
    setTheme('night')
    const css = rootStyle()
    expect(css).toContain('--message-out-primary-color:#ffffff')

    setTheme('tinted')
    expect(rootStyle()).toContain('--message-out-primary-color:#ffffff')

    setTheme('day')
    expect(rootStyle()).not.toContain('--message-out-primary-color:#ffffff')
  })
})
