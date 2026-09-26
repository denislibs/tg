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

// Задача 7 плана 2D: прежний React-экран «Данных и памяти» считал месяц 30 днями,
// вкладка по tweb — 31. Сохранённые «k месяцев» читаются как те же «k месяцев»
// tweb, остальные значения не трогаются.
describe('settings.load() — срок медиакэша прежнего экрана', () => {
  beforeEach(() => localStorage.clear())

  const DAY = 86400
  const withTTL = (cacheTTL: number) => {
    localStorage.setItem('tg-settings', JSON.stringify({ cacheTTL }))
    return load().cacheTTL
  }

  it('30·k дней (k = 1…6) → 31·k дней', () => {
    for(let k = 1; k <= 6; k++) expect(withTTL(30 * k * DAY)).toBe(31 * k * DAY)
  })

  it('дни, недели, год и уже tweb-месяц — как есть', () => {
    for(const ttl of [DAY, 6 * DAY, 7 * DAY, 21 * DAY, 31 * DAY, 186 * DAY, 365 * DAY]) {
      expect(withTTL(ttl)).toBe(ttl)
    }
  })
})
