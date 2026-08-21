// Чернила QR/подписи — затемнённые стопы обоев (tweb popups/myQrCode.tsx:69-72
// `darkenInkStops`). Без прижатия яркости светлые стопы дневных обоев дают
// ~3.9:1 на белой карте, и QR перестаёт сканироваться; с ПЕРЕизобретённой
// формулой (одно деление по нелинейной яркости, как было прямо здесь) чернила
// систематически темнее оригинала.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import QrModal from './QrModal'
import { WALLPAPER_PRESETS } from '../wallpapers'
import { relativeLuminance, hexToRgb } from '../shared/lib/color'
import s from './QrModal.module.scss'

// qr-code-styling грузится динамическим import'ом и лезет в canvas — к чернилам
// отношения не имеет (цвета ему отдаёт тот же inkStops, что и подписи).
vi.mock('qr-code-styling', () => ({
  default: class {
    append() {}
    getRawData() { return Promise.resolve(null) }
  },
}))

afterEach(cleanup)

describe('QrModal — чернила прижаты к порогу контраста', () => {
  it('градиент подписи собран из затемнённых стопов, а не из сырых обоев', () => {
    render(
      <QrModal
        open
        onClose={() => {}}
        url="https://t.me/durov"
        label="@durov"
        avatar={{ text: 'D' }}
      />,
    )

    const username = document.querySelector<HTMLElement>(`.${s.username}`)!
    const gradient = username.style.backgroundImage
    const stops = [...gradient.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0])

    // Первая тема карусели — day; её стопы светлые и обязаны быть прижаты.
    const raw = (WALLPAPER_PRESETS.find((p) => p.id === 'day') ?? WALLPAPER_PRESETS[0]).colors
    expect(stops).toHaveLength(raw.length)
    expect(stops).not.toEqual(raw)

    for (const stop of stops) {
      // tweb QR_INK_MAX_LUMINANCE = 0.18 (≥ ~4.5:1 на белой карте)
      expect(relativeLuminance(hexToRgb(stop))).toBeLessThanOrEqual(0.18)
    }
    // …и не глубже: двоичный поиск tweb садится вплотную к порогу. Прежнее
    // одно деление давало здесь ~0.03 — чернила почти чёрные.
    expect(Math.max(...stops.map((c) => relativeLuminance(hexToRgb(c))))).toBeGreaterThan(0.17)
  })
})
