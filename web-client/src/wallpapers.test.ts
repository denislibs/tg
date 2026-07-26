import { describe, it, expect } from 'vitest'
import { activeBackground } from './wallpapers'

describe('activeBackground: приоритет своих обоев над пресетом', () => {
  it('свои обои (media_id) перебивают пресет', () => {
    const ab = activeBackground({
      customWallpaperMediaId: 42,
      customWallpaperBlur: true,
      wallpaper: { kind: 'preset', colors: ['#111', '#222', '#333', '#444'] },
    })
    expect(ab).toEqual({ kind: 'custom', mediaId: 42, blur: true })
  })

  it('без своих обоев — активен обычный wallpaper (пресет)', () => {
    const wallpaper = { kind: 'preset' as const, colors: ['#111', '#222', '#333', '#444'] }
    const ab = activeBackground({ wallpaper })
    expect(ab).toEqual({ kind: 'wallpaper', wallpaper })
  })

  it('без своих обоев — активен дефолт', () => {
    const ab = activeBackground({ wallpaper: { kind: 'default' } })
    expect(ab).toEqual({ kind: 'wallpaper', wallpaper: { kind: 'default' } })
  })

  it('blur по умолчанию false, когда customWallpaperBlur не задан', () => {
    const ab = activeBackground({ customWallpaperMediaId: 7, wallpaper: { kind: 'default' } })
    expect(ab).toEqual({ kind: 'custom', mediaId: 7, blur: false })
  })

  it('mediaId === 0 считается заданным (жалоб нет, 0 — валидный id)', () => {
    const ab = activeBackground({ customWallpaperMediaId: 0, wallpaper: { kind: 'default' } })
    expect(ab.kind).toBe('custom')
  })
})
