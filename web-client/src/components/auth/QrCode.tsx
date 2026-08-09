import { useEffect, useRef } from 'react'
import type QRCodeStyling from 'qr-code-styling'

/**
 * A real (scannable) QR rendered with `qr-code-styling`, styled to match tweb's
 * login QR (rounded dots + extra-rounded finder corners). `data` is the URL to
 * encode; changing it re-renders (used for the 30s auto-rotation).
 *
 * Styling mirrors tweb's `paintQrCode` (`src/helpers/qrCode/paintQrCode.ts`):
 *   dotsOptions       { type: 'rounded', color }
 *   cornersSquareOptions { type: 'extra-rounded', color }
 *   qrOptions         { errorCorrectionLevel: 'L' }
 * tweb embeds an actual logo image (`imageOptions: { imageSize: 1, margin: 0 }`);
 * here the center logo is the caller's overlay, so we just keep the area clear
 * via `imageOptions.hideBackgroundDots` instead of embedding an image.
 */
export default function QrCode({
  data,
  size = 220,
  /** цвет модулей; по умолчанию — тематический `--primary-text-color`, как в tweb */
  color,
  className = '',
}: {
  data: string
  size?: number
  color?: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const qrRef = useRef<QRCodeStyling | null>(null)

  useEffect(() => {
    if (!data) return
    let alive = true
    void import('qr-code-styling').then((mod) => {
      if (!alive || !ref.current) return
      const Ctor = mod.default
      // tweb (paintQrCode) читает цвета из CSS-переменных в момент отрисовки —
      // библиотеке нужно конкретное значение, `var(...)` она не понимает.
      const resolved =
        color ??
        getComputedStyle(document.documentElement).getPropertyValue('--primary-text-color').trim() ??
        '#fff'
      const opts = {
        width: size,
        height: size,
        type: 'svg' as const,
        data,
        margin: 0,
        qrOptions: { errorCorrectionLevel: 'L' as const },
        dotsOptions: { type: 'rounded' as const, color: resolved },
        cornersSquareOptions: { type: 'extra-rounded' as const, color: resolved },
        backgroundOptions: { color: 'transparent' },
        imageOptions: { hideBackgroundDots: true, imageSize: 0.28, margin: 4 },
      }
      // Recreate the instance on every `data` change: `.update({ data })`
      // doesn't reliably repaint the svg renderer across versions.
      ref.current.replaceChildren()
      qrRef.current = new Ctor(opts)
      qrRef.current.append(ref.current)
    })
    return () => {
      alive = false
    }
  }, [data, size, color])

  return <div ref={ref} className={className} style={{ width: size, height: size }} aria-label="QR code" />
}
