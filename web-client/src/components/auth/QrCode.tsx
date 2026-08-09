// QrCode — QR входа. Порт tweb `helpers/qrCode/paintQrCode.ts` + `SignQRCard`:
// `qr-code-styling` в CANVAS-режиме, логотип Telegram вшит в саму матрицу
// (`image` + `imageOptions {imageSize: 1, margin: 0}`), цвета берутся из
// CSS-переменных темы в момент отрисовки — фон `--light-filled-primary-color`,
// модули `--primary-text-color`, логотип `--primary-color`.
//
// В DOM это ровно один узел: `canvas.qrCanvas` внутри `._sticker`, без обёрток.
//
// отступление от tweb: tweb отдаёт хост библиотеке (`qrCode.append(host)`), и
// канву в DOM создаёт она. Наш `._sticker` рендерит React (MediaHeader), поэтому
// канву держим мы, а библиотека рисует в свою — и мы переносим её содержимое
// одним `drawImage`. Дерево получается идентичным, а React не теряет владение
// поддеревом.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type QRCodeStyling from 'qr-code-styling'
// отступление от tweb: исходник логотипа берём `?raw` (текстом на этапе сборки),
// а не `fetch('assets/img/logo_padded.svg')` — наш бандлер инлайнит эту иконку в
// `data:`-URL, а `fetch` по `data:` режет CSP `connect-src`.
import logoSvg from '../../assets/logo_padded.svg?raw'

// Логотип перекрашивается под цвет темы ровно как в tweb (`getLogoUrl`):
// подмена `fill:…;` в единственном правиле стиля + data-URL. Кэш — по цвету.
const logoUrlCache = new Map<string, string>()
function getLogoUrl(logoColor: string): string {
  let url = logoUrlCache.get(logoColor)
  if (!url) {
    url =
      'data:image/svg+xml,' +
      encodeURIComponent(logoSvg.replace(/(fill:).+?(;)/, `$1${logoColor}$2`))
    logoUrlCache.set(logoColor, url)
  }
  return url
}

// tweb перерисовывает QR по `theme_changed`: цвета матрицы приходят из
// CSS-переменных, инверсией их не получить. Наш эквивалент события — смена
// `data-theme` на <html> (единственный источник темы, core/theme/themeController).
function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}
const getTheme = () => document.documentElement.getAttribute('data-theme') ?? ''

export default function QrCode({
  data,
  size,
  className = '',
  onPainted,
}: {
  /** что кодируем (ссылка входа) */
  data: string
  /** CSS-размер матрицы в px; атрибуты канвы — size × devicePixelRatio */
  size: number
  className?: string
  /** первая отрисовка завершена — карточка гасит прелоадер */
  onPainted?: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const onPaintedRef = useRef(onPainted)
  onPaintedRef.current = onPainted
  // счётчик перерисовок: устаревший асинхронный кадр не должен затирать свежий
  const genRef = useRef(0)
  const firstPaintRef = useRef(true)
  const revealTimers = useRef<number[]>([])
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => '')

  useEffect(
    () => () => {
      revealTimers.current.forEach(clearTimeout)
    },
    [],
  )

  useEffect(() => {
    if (!data) return
    const gen = ++genRef.current
    let alive = true

    const paint = async () => {
      const canvas = ref.current
      if (!canvas) return
      const style = getComputedStyle(document.documentElement)
      const background = style.getPropertyValue('--light-filled-primary-color').trim()
      const foreground = style.getPropertyValue('--primary-text-color').trim()
      const logoColor = style.getPropertyValue('--primary-color').trim()

      const image = getLogoUrl(logoColor)
      const { default: Ctor } = await import('qr-code-styling')
      if (!alive || gen !== genRef.current) return

      const pixelRatio = window.devicePixelRatio || 1
      const px = Math.round(size * pixelRatio)
      const qr = new Ctor({
        width: px,
        height: px,
        type: 'canvas',
        data,
        image,
        dotsOptions: { color: foreground, type: 'rounded' },
        cornersSquareOptions: { type: 'extra-rounded', color: foreground },
        // saveAsBlob (дефолт библиотеки) тянет картинку через fetch — по
        // `data:`-URL это режет CSP `connect-src`; грузим её как <img>.
        imageOptions: { imageSize: 1, margin: 0, saveAsBlob: false },
        backgroundOptions: { color: background },
        qrOptions: { errorCorrectionLevel: 'L' },
      }) as QRCodeStyling & { _canvasDrawingPromise?: Promise<void> }

      // Библиотека рисует в свою канву внутри переданного хоста; хост держим
      // отсоединённым — в DOM уезжает только результат.
      const host = document.createElement('div')
      qr.append(host)
      await qr._canvasDrawingPromise
      if (!alive || gen !== genRef.current) return

      const painted = host.querySelector('canvas')
      const ctx = canvas.getContext('2d')
      if (!painted || !ctx) return
      canvas.width = px
      canvas.height = px
      ctx.clearRect(0, 0, px, px)
      ctx.drawImage(painted, 0, 0, px, px)

      // Первая отрисовка: канва въезжает `grow-icon .4s forwards`, показываясь
      // через 150 мс (пока уезжает прелоадер), анимация снимается через 500 мс —
      // это костыль самого tweb (библиотека не даёт событий).
      if (firstPaintRef.current) {
        firstPaintRef.current = false
        canvas.style.display = 'none'
        canvas.style.animation = 'grow-icon .4s forwards'
        revealTimers.current.push(
          window.setTimeout(() => {
            canvas.style.display = ''
          }, 150),
          window.setTimeout(() => {
            canvas.style.animation = ''
          }, 500),
        )
      }
      onPaintedRef.current?.()
    }

    void paint()
    return () => {
      alive = false
    }
  }, [data, size, theme])

  return <canvas ref={ref} className={className} aria-label="QR" />
}
