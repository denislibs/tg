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

  it('darkens primary-color with darkenAlpha=0.04, not the generic 0.08 (tweb applyTheme:805-809)', () => {
    setTheme('day')
    const css = rootStyle()
    // hex #3390ec -> rgb(51,144,236) -> hsl(209.83783783783787deg, 82.95964125560539%, 56.27450980392157%);
    // darkenAlpha=0.04 => l -= 4 => 52.27450980392157%. (Пересчитано независимо от color.ts, по формуле
    // RGB->HSL из tweb `rgbaToHsla`.) С generic 0.08 значение l было бы 48.27450980392157% — другое число.
    expect(css).toContain(
      '--dark-primary-color:hsl(209.83783783783787, 82.95964125560539%, 52.27450980392157%);',
    )
  })

  it('mixes saved-color light-filled toward white at 0.64, not toward surface at 0.08 (tweb applyTheme:811-816)', () => {
    setTheme('day')
    const css = rootStyle()
    // hex #359AD4 -> rgb(53,154,212); mix toward [255,255,255] (не surface!) с весом 0.64:
    // floor(255 + (53-255)*0.64)=125, floor(255 + (154-255)*0.64)=190, floor(255 + (212-255)*0.64)=227
    // -> #7dbee3. Пастельно-голубой (base.scss:178 — аватарка Saved Messages), а не почти-белый,
    // который получился бы при generic mixColor=surface-color(#ffffff для day).
    expect(css).toContain('--light-filled-saved-color:#7dbee3')
  })
})
