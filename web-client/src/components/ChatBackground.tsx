import { useEffect, useMemo, useRef } from 'react'
import patternUrl from '../assets/pattern.svg'
import { useSettings } from '../settings'
import { activeBackground } from '../wallpapers'
import { mediaContentUrl, useMediaTokenVersion } from '../core/mediaUrl'
import { renderPattern, patternOpacity } from '../core/chat/patternRenderer'

/**
 * Фон чата 1:1 с tweb (src/components/chat/bubbles/chatBackground.tsx): слой
 * градиента снизу + слой дудл-паттерна сверху через свой canvas-рендер
 * (core/chat/patternRenderer — порт tweb). Уходим от @twallpaper/react, чей зашитый
 * mix-blend overlay + opacity 0.5 пересвечивал дудлы на всех темах.
 *
 * Стратегии приглушения паттерна (1:1 tweb):
 *  • night — MASK: canvas залит #000, дудлы выбиты дырками (destination-out);
 *    приглушается ГРАДИЕНТ (opacity 0.3), сквозь дырки виден дим-градиент.
 *  • day/light — soft-light overlay, приглушается ПАТТЕРН (opacity 0.5).
 *  • tinted — soft-light overlay + invert (чёрные дудлы → светлые на тёмно-синем),
 *    intensity форсится −38 (tweb Dark Blue).
 *
 * Анимированный mesh-градиент со сдвигом при отправке (tweb
 * ChatBackgroundGradientRenderer) — отложен в волну тяжёлых рендеров; здесь
 * статический многоцветный радиальный стек из 4 цветов обоев.
 */

type PatternMode = { intensity: number; mask: boolean; invert: boolean }

// Параметры рендера per-тема (1:1 tweb state.ts DEFAULT_THEME intensity +
// chatBackground.tsx стратегии). intensity — «сырое» tweb-значение (-50..50).
function modeFor(dataTheme: string | null): PatternMode {
  switch (dataTheme) {
    case 'night':
      return { intensity: -50, mask: true, invert: false }
    case 'tinted':
      return { intensity: -38, mask: false, invert: true } // overlay Dark Blue
    default: // day / light
      return { intensity: 50, mask: false, invert: false }
  }
}

function readTheme() {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  const dt = document.documentElement.getAttribute('data-theme')
  return {
    dataTheme: dt,
    appBg: v('--background-color'),
    grad: [v('--tg-bgGrad0'), v('--tg-bgGrad1'), v('--tg-bgGrad2'), v('--tg-bgGrad3')],
  }
}

// Статический многоцветный фон из 4 цветов — радиальные пятна по углам
// (аппроксимация tweb mesh-градиента; анимированный рендер — отдельная волна).
function gradientStack(colors: string[]): string {
  const [c0, c1, c2, c3] = colors
  return [
    `radial-gradient(60% 60% at 80% 10%, ${c0} 0%, transparent 70%)`,
    `radial-gradient(60% 60% at 20% 90%, ${c1} 0%, transparent 70%)`,
    `radial-gradient(60% 60% at 80% 90%, ${c2} 0%, transparent 70%)`,
    `radial-gradient(60% 60% at 20% 10%, ${c3} 0%, transparent 70%)`,
    c0,
  ].join(', ')
}

export default function ChatBackground({ themeColors }: { themeColors?: string[] }) {
  const { wallpaper, wallpaperBlur, themeChoice, customWallpaperMediaId, customWallpaperBlur } = useSettings()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  useMediaTokenVersion()

  const th = readTheme()
  const mode = modeFor(th.dataTheme)
  // Тема активного чата перекрывает глобальные обои; иначе пресет, затем дефолт темы.
  const colors = themeColors ?? (wallpaper.kind === 'preset' ? wallpaper.colors : th.grad)
  const ab = activeBackground({ customWallpaperMediaId, customWallpaperBlur, wallpaper })

  // Своё фото / сплошной цвет / загруженная картинка заменяют градиент+паттерн.
  const overlay = themeColors ? null :
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

  const patternOpacityMax = patternOpacity(mode.intensity, mode.mask)
  const gradientOpacity = mode.mask ? patternOpacityMax : 1
  const canvasOpacity = mode.mask ? 1 : patternOpacityMax

  const gradientBg = useMemo(() => gradientStack(colors), [colors.join()]) // eslint-disable-line react-hooks/exhaustive-deps

  // Отрисовка/перерисовка canvas-паттерна: под размер вьюпорта*dpr, стратегия по теме.
  useEffect(() => {
    if (overlay) return
    const canvas = canvasRef.current
    if (!canvas) return

    const paint = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.ceil(window.innerWidth * dpr)
      canvas.height = Math.ceil(window.innerHeight * dpr)
      const img = imgRef.current
      if (!img || !img.complete || !img.naturalWidth) return
      renderPattern(canvas, img as HTMLImageElement & { width: number; height: number }, {
        mask: mode.mask,
        viewportHeight: window.innerHeight,
        dpr,
      })
    }

    // Ленивая загрузка дудла (один раз), затем перерисовки — синхронные.
    if (!imgRef.current) {
      const img = new Image()
      img.onload = () => { imgRef.current = img; paint() }
      img.src = patternUrl
    } else {
      paint()
    }

    window.addEventListener('resize', paint)
    return () => window.removeEventListener('resize', paint)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeChoice, colors.join(), mode.mask, !!overlay])

  if (overlay) {
    return <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', ...overlay }} />
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {/* нижний слой — цвет/градиент; при mask дим до 0.3 (сквозь дырки паттерна) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: mode.mask ? th.appBg : undefined,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: gradientBg,
          opacity: gradientOpacity,
          filter: wallpaperBlur ? 'blur(6px)' : undefined,
        }}
      />
      {/* верхний слой — дудлы: mask (night) кроет чёрным с дырками; иначе soft-light overlay */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: canvasOpacity,
          mixBlendMode: mode.mask ? 'normal' : 'soft-light',
          filter: mode.invert ? 'invert(1)' : undefined,
        }}
      />
    </div>
  )
}
