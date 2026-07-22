import { useEffect, useRef } from 'react'
import { TWallpaper, type TWallpaperHandlers, type PatternOptions } from '@twallpaper/react'
import '@twallpaper/react/css'
import patternUrl from '../assets/pattern.svg'
import { useSettings } from '../settings'
import { activeBackground } from '../wallpapers'
import { mediaContentUrl, useMediaTokenVersion } from '../core/mediaUrl'

/**
 * Telegram-style animated wallpaper, powered by @twallpaper/react — the maintained
 * extraction of tweb's multicolor gradient renderer. The 4-colour gradient eases one
 * step forward on every sent message (dispatch `new Event('tg-send')`), same as tweb.
 *
 * The colours come from the user's wallpaper setting (a preset gradient or the theme
 * default). A solid colour or an uploaded image take over the whole layer instead.
 *
 * The react wrapper only inits once (empty-deps effect), so colour/pattern updates on
 * theme/wallpaper change go through the imperative ref handlers, not the `options` prop.
 */

const SIZE = '420px'

function patternFor(mode: 'light' | 'dark', appBg: string, blur: boolean): PatternOptions {
  const base = { image: patternUrl, size: SIZE, opacity: 0.5, blur: blur ? 6 : 0 }
  return mode === 'dark'
    ? { ...base, mask: true, background: appBg }
    : { ...base, mask: false }
}

// The TWallpaper canvas renderer parses CONCRETE hex — not CSS var() — so the theme
// values are read from the resolved custom properties (не из var-строк) + data-theme.
function readTheme() {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  const dt = document.documentElement.getAttribute('data-theme')
  return {
    mode: (dt === 'night' || dt === 'dark' ? 'dark' : 'light') as 'light' | 'dark',
    appBg: v('--tg-appBg'),
    grad: [v('--tg-bgGrad0'), v('--tg-bgGrad1'), v('--tg-bgGrad2'), v('--tg-bgGrad3')],
  }
}

export default function ChatBackground() {
  const { wallpaper, wallpaperBlur, themeChoice, customWallpaperMediaId, customWallpaperBlur } = useSettings()
  const ref = useRef<TWallpaperHandlers>(null)
  const painted = useRef(false)
  // Свои обои читаются по media-токену (живёт в воркере) — перерисоваться, когда
  // токен допримется/обновится, иначе url ушёл бы с пустым токеном → 401.
  useMediaTokenVersion()

  const th = readTheme()
  const mode = th.mode
  // The gradient colours: an explicit preset, otherwise the theme default.
  const colors = wallpaper.kind === 'preset' ? wallpaper.colors : th.grad

  // Приоритет: свои обои (загруженное фото) поверх пресета/цвета/дефолта.
  const ab = activeBackground({ customWallpaperMediaId, customWallpaperBlur, wallpaper })

  // A custom photo, solid colour or uploaded image replaces the animated gradient.
  const overlay =
    ab.kind === 'custom'
      ? {
          backgroundImage: `url(${mediaContentUrl(ab.mediaId)})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: ab.blur ? 'blur(10px)' : undefined,
          transform: ab.blur ? 'scale(1.05)' : undefined,
        }
      : wallpaper.kind === 'color'
        ? { background: wallpaper.color }
        : wallpaper.kind === 'image'
          ? {
              backgroundImage: `url(${wallpaper.src})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: wallpaperBlur ? 'blur(10px)' : undefined,
              transform: wallpaperBlur ? 'scale(1.05)' : undefined,
            }
          : null

  // Re-apply colours + pattern through the imperative handlers whenever the theme
  // or wallpaper changes (the wrapper itself never re-inits from a new `options` prop).
  useEffect(() => {
    if (overlay) {
      painted.current = false // TWallpaper is unmounted while the overlay shows
      return
    }
    // Read fresh values here (this passive effect runs after App's layout effect
    // has applied the new data-theme), so a theme switch repaints with real hex.
    const fresh = readTheme()
    const freshColors = wallpaper.kind === 'preset' ? wallpaper.colors : fresh.grad
    ref.current?.updateColors(freshColors)
    ref.current?.updatePattern(patternFor(fresh.mode, fresh.appBg, wallpaperBlur))
    // updateColors only stores the colours; the canvas is painted by init() on
    // first mount, so force a repaint (one position step) on later changes.
    if (painted.current) ref.current?.toNextPosition()
    else painted.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeChoice, colors.join(), wallpaperBlur, !!overlay])

  // Animate the gradient one step forward on each sent message.
  useEffect(() => {
    const onSend = () => ref.current?.toNextPosition()
    window.addEventListener('tg-send', onSend)
    return () => window.removeEventListener('tg-send', onSend)
  }, [])

  if (overlay) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          ...overlay,
        }}
      />
    )
  }

  return (
    <TWallpaper
      ref={ref}
      options={{
        colors,
        fps: 30,
        tails: 90,
        animate: false,
        pattern: patternFor(mode, th.appBg, wallpaperBlur),
      }}
      style={{ zIndex: 0 }}
    />
  )
}
