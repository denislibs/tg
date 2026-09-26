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

// Энергосбережение (план 2D, задача 11): настройка — объект `liteMode` формы tweb
// `StateSettings.liteMode` (`config/state.ts:127`, дефолты `:525-545` — все false).
// Прежний флаг «Без анимаций» (`reduceMotion`) и есть tweb `liteMode.animations`
// (тумблер меню «Ещё», `sidebarLeft/index.ts:1016-1029`) — переезжает в него.
describe('settings.load() liteMode', () => {
  beforeEach(() => localStorage.clear())

  it('нет данных — все ключи false, как SETTINGS_INIT tweb', () => {
    const { liteMode } = load()
    expect(Object.values(liteMode).every((value) => value === false)).toBe(true)
    expect(Object.keys(liteMode).sort()).toEqual([
      'all', 'animations', 'blur', 'chat', 'chat_background', 'chat_spoilers',
      'effects', 'effects_emoji', 'effects_premiumstickers', 'effects_reactions',
      'emoji', 'emoji_appear', 'emoji_messages', 'emoji_panel', 'gif',
      'stickers', 'stickers_chat', 'stickers_panel', 'video',
    ])
  })

  it('старый reduceMotion: true переезжает в liteMode.animations, сам ключ не остаётся', () => {
    localStorage.setItem('tg-settings', JSON.stringify({ reduceMotion: true }))
    const settings = load()
    expect(settings.liteMode.animations).toBe(true)
    expect(settings.liteMode.all).toBe(false)
    expect('reduceMotion' in settings).toBe(false)
  })

  it('сохранённый объект без части ключей добирается дефолтами', () => {
    localStorage.setItem('tg-settings', JSON.stringify({ liteMode: { gif: true } }))
    const { liteMode } = load()
    expect(liteMode.gif).toBe(true)
    expect(liteMode.blur).toBe(false)
  })
})
