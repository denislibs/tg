import { useEffect, useRef } from 'react'
import { Box, useTheme } from '@mui/material'
import { TWallpaper, type TWallpaperHandlers, type PatternOptions } from '@twallpaper/react'
import '@twallpaper/react/css'
import patternUrl from '../assets/pattern.svg'
import { useSettings } from '../settings'

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

export default function ChatBackground() {
  const theme = useTheme()
  const tg = theme.tg
  const mode = theme.palette.mode
  const { wallpaper, wallpaperBlur } = useSettings()
  const ref = useRef<TWallpaperHandlers>(null)
  const painted = useRef(false)

  // The gradient colours: an explicit preset, otherwise the theme default.
  const colors = wallpaper.kind === 'preset' ? wallpaper.colors : tg.bgGradient

  // A solid colour or uploaded image replaces the animated gradient entirely.
  const overlay =
    wallpaper.kind === 'color'
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
    ref.current?.updateColors(colors)
    ref.current?.updatePattern(patternFor(mode, tg.appBg, wallpaperBlur))
    // updateColors only stores the colours; the canvas is painted by init() on
    // first mount, so force a repaint (one position step) on later changes.
    if (painted.current) ref.current?.toNextPosition()
    else painted.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, colors.join(), tg.appBg, wallpaperBlur, !!overlay])

  // Animate the gradient one step forward on each sent message.
  useEffect(() => {
    const onSend = () => ref.current?.toNextPosition()
    window.addEventListener('tg-send', onSend)
    return () => window.removeEventListener('tg-send', onSend)
  }, [])

  if (overlay) {
    return (
      <Box
        sx={{
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
        pattern: patternFor(mode, tg.appBg, wallpaperBlur),
      }}
      style={{ zIndex: 0 }}
    />
  )
}
