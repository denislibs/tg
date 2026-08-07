// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { load } from './settings'

// Регрессия финального ревью Task 4/5: 'light' — первоклассная тема (не legacy),
// не должна молча откатываться в 'day' на каждом load(). Плюс миграция удалённых
// пресетов classic→day / dark→night и tolerance к битому JSON.
describe('settings.load() theme migration', () => {
  beforeEach(() => localStorage.clear())

  const withChoice = (choice: string) => {
    localStorage.setItem('tg-settings', JSON.stringify({ themeChoice: choice }))
    return load().themeChoice
  }

  it("'light' survives (first-class theme, not migrated)", () => {
    expect(withChoice('light')).toBe('light')
  })
  it("'tinted' / 'day' / 'night' / 'system' pass through", () => {
    expect(withChoice('tinted')).toBe('tinted')
    expect(withChoice('day')).toBe('day')
    expect(withChoice('night')).toBe('night')
    expect(withChoice('system')).toBe('system')
  })
  it('removed presets migrate: classic→day, dark→night', () => {
    expect(withChoice('classic')).toBe('day')
    expect(withChoice('dark')).toBe('night')
  })
  it('legacy standalone tg-theme key still migrates when tg-settings absent', () => {
    localStorage.setItem('tg-theme', 'dark')
    expect(load().themeChoice).toBe('night')
    localStorage.clear()
    localStorage.setItem('tg-theme', 'light')
    expect(load().themeChoice).toBe('day')
  })
  it('no persisted data → system default', () => {
    expect(load().themeChoice).toBe('system')
  })
})
