/** @jsxImportSource solid-js */
// QrCode — QR входа. Solid-порт нашего React `auth/QrCode.tsx` (сам он — порт
// tweb `helpers/qrCode/paintQrCode.ts` + `SignQRCard`): `qr-code-styling` в
// CANVAS-режиме, логотип Telegram вшит в саму матрицу (`image` +
// `imageOptions {imageSize: 1, margin: 0}`), цвета берутся из CSS-переменных
// темы в момент отрисовки — фон `--light-filled-primary-color`, модули
// `--primary-text-color`, логотип `--primary-color`.
//
// В DOM это ровно один узел: `canvas.qrCanvas` внутри `._sticker`, без обёрток.
//
// отступление от tweb: tweb отдаёт хост библиотеке (`qrCode.append(host)`), и
// канву в DOM создаёт она. Наш `._sticker` рендерит Solid (MediaHeader),
// поэтому канву держим мы, а библиотека рисует в свою — и мы переносим её
// содержимое одним `drawImage`. Дерево получается идентичным, а Solid не
// теряет владение поддеревом.
import { createEffect, createSignal, onCleanup, onMount, on, type JSX } from 'solid-js'
import type QRCodeStyling from 'qr-code-styling'
// отступление от tweb: исходник логотипа берём `?raw` (текстом на этапе
// сборки), а не `fetch('assets/img/logo_padded.svg')` — наш бандлер инлайнит
// эту иконку в `data:`-URL, а `fetch` по `data:` режет CSP `connect-src`.
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

export type QrCodeProps = {
  /** что кодируем (ссылка входа) */
  data: string
  /** CSS-размер матрицы в px; атрибуты канвы — size × devicePixelRatio */
  size: number
  class?: string
  /** первая отрисовка завершена — карточка гасит прелоадер */
  onPainted?: () => void
}

export default function QrCode(props: QrCodeProps): JSX.Element {
  let canvasEl: HTMLCanvasElement | undefined
  // счётчик перерисовок: устаревший асинхронный кадр не должен затирать свежий
  let gen = 0
  let firstPaint = true
  const revealTimers: number[] = []

  // tweb перерисовывает QR по `theme_changed`: цвета матрицы приходят из
  // CSS-переменных, инверсией их не получить. Наш эквивалент события — смена
  // `data-theme` на <html> (единственный источник темы, core/theme/themeController).
  const [theme, setTheme] = createSignal(document.documentElement.getAttribute('data-theme') ?? '')
  onMount(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') ?? '')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    onCleanup(() => observer.disconnect())
  })

  onCleanup(() => {
    revealTimers.forEach(clearTimeout)
  })

  createEffect(
    on([() => props.data, () => props.size, theme], ([data, size]) => {
      if (!data) return
      const myGen = ++gen
      let alive = true
      onCleanup(() => {
        alive = false
      })

      const paint = async () => {
        const canvas = canvasEl
        if (!canvas) return
        const style = getComputedStyle(document.documentElement)
        const background = style.getPropertyValue('--light-filled-primary-color').trim()
        const foreground = style.getPropertyValue('--primary-text-color').trim()
        const logoColor = style.getPropertyValue('--primary-color').trim()

        const image = getLogoUrl(logoColor)
        const { default: Ctor } = await import('qr-code-styling')
        if (!alive || myGen !== gen) return

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

        // Библиотека рисует в свою канву внутри переданного хоста; хост
        // держим отсоединённым — в DOM уезжает только результат.
        const host = document.createElement('div')
        qr.append(host)
        await qr._canvasDrawingPromise
        if (!alive || myGen !== gen) return

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
        if (firstPaint) {
          firstPaint = false
          canvas.style.display = 'none'
          canvas.style.animation = 'grow-icon .4s forwards'
          revealTimers.push(
            window.setTimeout(() => {
              canvas.style.display = ''
            }, 150),
            window.setTimeout(() => {
              canvas.style.animation = ''
            }, 500),
          )
        }
        props.onPainted?.()
      }

      void paint()
    }),
  )

  return <canvas ref={canvasEl} class={props.class} aria-label="QR" />
}
