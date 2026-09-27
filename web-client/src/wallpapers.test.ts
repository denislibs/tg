// Адаптер нашей настройки обоев к `WallPaper` фона tweb (`wallpapers.ts`).
import { describe, it, expect } from 'vitest'
import { getColorsFromWallPaper } from '@shared/lib/color'
import { CHAT_THEMES } from './chatThemes'
import {
  DEFAULT_WALLPAPERS,
  getChatThemeBackground,
  getMediaIdFromWallPaperSlug,
  getThemeWallPaper,
  getWallPaperFromSettings,
  type Wallpaper,
} from './wallpapers'
import type { WallPaper } from '@layer'

const preset: Wallpaper = { kind: 'preset', colors: ['#111111', '#222222', '#333333', '#444444'] }

describe('умолчания тем — дословно tweb DEFAULT_THEME (config/state.ts:305-422)', () => {
  it('day → Classic, night → Night, tinted → Tinted, light → Day: цвета, интенсивность, узор', () => {
    const colors = (name: keyof typeof DEFAULT_WALLPAPERS) => getColorsFromWallPaper(DEFAULT_WALLPAPERS[name])
    expect(colors('day')).toBe('#dbddbb,#6ba587,#d5d88d,#88b884')
    expect(colors('night')).toBe('#fec496,#dd6cb9,#962fbf,#4f5bd5')
    expect(colors('tinted')).toBe('#1e3557,#182036,#1c4352,#16263a')
    expect(colors('light')).toBe('#b1e0fa,#82b0d8,#a0d8e8,#e5f0f8')
    expect(Object.values(DEFAULT_WALLPAPERS).map((w) => w.settings!.intensity)).toEqual([50, -50, -40, 50])
    expect(Object.values(DEFAULT_WALLPAPERS).every((w) => w.slug === 'pattern' && w.pFlags.pattern)).toBe(true)
  })
})

describe('getWallPaperFromSettings', () => {
  it('своё фото (media_id) перебивает пресет; blur — флаг настроек обоев', () => {
    const wallPaper = getWallPaperFromSettings({ wallpaper: preset, customWallpaperMediaId: 42, customWallpaperBlur: true }, 'day') as WallPaper.wallPaper
    expect(wallPaper._).toBe('wallPaper')
    expect(wallPaper.pFlags.pattern).toBeUndefined()
    expect(getMediaIdFromWallPaperSlug(wallPaper.slug)).toBe(42)
    expect(wallPaper.settings!.pFlags.blur).toBe(true)
  })

  it('mediaId === 0 — валидный id; blur по умолчанию выключен', () => {
    const wallPaper = getWallPaperFromSettings({ wallpaper: { kind: 'default' }, customWallpaperMediaId: 0 }, 'day') as WallPaper.wallPaper
    expect(getMediaIdFromWallPaperSlug(wallPaper.slug)).toBe(0)
    expect(wallPaper.settings!.pFlags.blur).toBeUndefined()
  })

  it('умолчание — обои темы; пресет — узор с интенсивностью темы', () => {
    expect(getWallPaperFromSettings({ wallpaper: { kind: 'default' } }, 'night')).toBe(DEFAULT_WALLPAPERS.night)
    const day = getWallPaperFromSettings({ wallpaper: preset }, 'day')
    const night = getWallPaperFromSettings({ wallpaper: preset }, 'night')
    expect(getColorsFromWallPaper(day)).toBe('#111111,#222222,#333333,#444444')
    expect(day.settings!.intensity).toBe(50)
    expect(night.settings!.intensity).toBe(-50)
  })

  it('сплошной цвет — wallPaperNoFile с background_color', () => {
    const wallPaper = getWallPaperFromSettings({ wallpaper: { kind: 'color', color: '#c4e1a6' } }, 'day')
    expect(wallPaper._).toBe('wallPaperNoFile')
    expect(getColorsFromWallPaper(wallPaper)).toBe('#c4e1a6')
  })

  it('одни входы — один и тот же объект (фон сравнивает обои по ссылке)', () => {
    expect(getWallPaperFromSettings({ wallpaper: preset }, 'day')).toBe(getWallPaperFromSettings({ wallpaper: preset }, 'day'))
    expect(getWallPaperFromSettings({ wallpaper: preset }, 'day')).not.toBe(getWallPaperFromSettings({ wallpaper: preset }, 'night'))
    const photo = { wallpaper: preset, customWallpaperMediaId: 3 }
    expect(getWallPaperFromSettings(photo, 'day')).toBe(getWallPaperFromSettings({ ...photo }, 'night'))
  })
})

describe('getThemeWallPaper — тема чата', () => {
  it('вариант режима текущей темы; объект темы стабилен', () => {
    const chatTheme = CHAT_THEMES[1]
    const theme = getChatThemeBackground(chatTheme)
    expect(getChatThemeBackground(chatTheme)).toBe(theme)
    const state = { wallpaper: preset }
    expect(getColorsFromWallPaper(getThemeWallPaper(theme, state, 'day'))).toBe(chatTheme.light.gradient.join(','))
    expect(getColorsFromWallPaper(getThemeWallPaper(theme, state, 'tinted'))).toBe(chatTheme.dark.gradient.join(','))
    expect(getThemeWallPaper(theme, state, 'day')).toBe(getThemeWallPaper(theme, state, 'day'))
  })
})
