import { useEffect, useRef } from 'react'
import patternUrl from '../assets/pattern.svg'
import { useSettings } from '../settings'
import { activeBackground } from '../wallpapers'
import { mediaContentUrl, useMediaTokenVersion } from '../core/mediaUrl'
import { renderPattern, patternOpacity } from '../core/chat/patternRenderer'
import ChatBackgroundGradientRenderer from '../core/chat/gradientRenderer'
import { getAverageColor, hexToRgb, type ColorRgb } from '../shared/lib/color'
import { applyHighlightingColorFromRgb } from '../core/theme/themeController'

/**
 * Фон чата 1:1 с tweb (src/components/chat/bubbles/chatBackground.tsx): слой
 * анимированного mesh-градиента снизу (ChatBackgroundGradientRenderer, порт tweb —
 * 50×50 canvas, растянут CSS = сглаженный многоцветный градиент, сдвиг позиций при
 * отправке) + слой дудл-паттерна сверху (patternRenderer). Уходим от
 * @twallpaper/react, чей зашитый overlay+opacity 0.5 пересвечивал дудлы.
 *
 * Стратегии приглушения паттерна (1:1 tweb):
 *  • night — MASK: canvas залит #000, дудлы выбиты дырками (destination-out);
 *    приглушается ГРАДИЕНТ (opacity 0.3), сквозь дырки виден дим-градиент.
 *  • day/light — soft-light overlay, приглушается ПАТТЕРН (opacity 0.5).
 *  • tinted — soft-light overlay + invert (чёрные дудлы → светлые на тёмно-синем),
 *    intensity форсится −38 (tweb Dark Blue).
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

export default function ChatBackground({ themeColors }: { themeColors?: string[] }) {
  const { wallpaper, wallpaperBlur, themeChoice, customWallpaperMediaId, customWallpaperBlur } = useSettings()
  const patternRef = useRef<HTMLCanvasElement>(null)
  const gradientRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<ChatBackgroundGradientRenderer | null>(null)
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

  // Инициализация/переинициализация mesh-градиента при смене цветов/темы.
  useEffect(() => {
    if (overlay) return
    const canvas = gradientRef.current
    if (!canvas) return
    canvas.dataset.colors = colors.filter(Boolean).join(',')
    if (!rendererRef.current) rendererRef.current = new ChatBackgroundGradientRenderer()
    rendererRef.current.init(canvas)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeChoice, colors.join(), !!overlay])

  // Сдвиг градиента на одну позицию при отправке сообщения (tweb toNextPosition).
  useEffect(() => {
    const onSend = () => rendererRef.current?.toNextPosition()
    window.addEventListener('tg-send', onSend)
    return () => window.removeEventListener('tg-send', onSend)
  }, [])

  // Отрисовка/перерисовка canvas-паттерна: под размер вьюпорта*dpr, стратегия по теме.
  useEffect(() => {
    if (overlay) return
    const canvas = patternRef.current
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

  // Средний цвет активных обоев → --message-highlighting-color (1:1 tweb
  // chatBackground.tsx:365 highlightingColor(pixel)). Глобально на documentElement:
  // фон/подложки реакций/сервис-баблов подстраиваются под обои открытого чата. Для
  // своего фото/картинки (overlay) оставляем per-preset дефолт из setTheme.
  useEffect(() => {
    if (overlay) return
    const rgbs = colors.filter(Boolean).map(hexToRgb)
    if (!rgbs.length) return
    const avg = rgbs.reduce((acc: ColorRgb, c) => getAverageColor(acc, c))
    applyHighlightingColorFromRgb(avg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors.join(), !!overlay])

  if (overlay) {
    return <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', ...overlay }} />
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {/* нижний слой — сплошной фон при mask (night), сквозь который дальше просвечивает дим-градиент */}
      {mode.mask && <div style={{ position: 'absolute', inset: 0, background: th.appBg }} />}
      {/* mesh-градиент: 50×50 canvas растянут на весь экран (браузер сглаживает) */}
      <canvas
        ref={gradientRef}
        width={50}
        height={50}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: gradientOpacity,
          filter: wallpaperBlur ? 'blur(6px)' : undefined,
        }}
      />
      {/* верхний слой — дудлы: mask (night) кроет чёрным с дырками; иначе soft-light overlay */}
      <canvas
        ref={patternRef}
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
