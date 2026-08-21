import { describe, it, expect } from 'vitest'
import { hexToRgb, rgbToHex, mixColors, relativeLuminance, darkenToMaxLuminance } from './color'

describe('color', () => {
  it('hexToRgb', () => {
    expect(hexToRgb('#3390ec')).toEqual([51, 144, 236])
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255])
  })
  it('rgbToHex round-trips', () => {
    expect(rgbToHex([51, 144, 236]).toLowerCase()).toBe('#3390ec')
  })
  it('mixColors half blends channels', () => {
    // tweb: out[i] = Math.floor(v2 + (v1 - v2) * weight) — для 0/255 при
    // weight=0.5 даёт floor(255 - 127.5) = 127, а не 128 (не round). Формула
    // портирована 1:1 из tweb helpers/color.ts — тест подогнан под неё.
    expect(mixColors([0, 0, 0], [255, 255, 255], 0.5)).toEqual([127, 127, 127])
  })

  // tweb helpers/color.ts:310-336 — прижатие чернил QR к порогу контраста.
  describe('relativeLuminance / darkenToMaxLuminance', () => {
    it('relativeLuminance линеаризует гамму sRGB (белый 1, чёрный 0)', () => {
      expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 10)
      expect(relativeLuminance([0, 0, 0])).toBe(0)
      // Средне-серый: нелинейная метрика дала бы ~0.5, WCAG — заметно меньше.
      expect(relativeLuminance([128, 128, 128])).toBeCloseTo(0.2158, 3)
    })

    it('цвет, уже укладывающийся в порог, не трогается', () => {
      expect(darkenToMaxLuminance('#6ba587', 0.5)).toBe('#6ba587')
      // не-#rrggbb возвращается как есть
      expect(darkenToMaxLuminance('rgb(1,2,3)', 0.18)).toBe('rgb(1,2,3)')
    })

    it('светлый стоп прижимается РОВНО к порогу, а не глубже', () => {
      const out = darkenToMaxLuminance('#dbddbb', 0.18)
      const lum = relativeLuminance(hexToRgb(out))
      expect(lum).toBeLessThanOrEqual(0.18)
      // Двоичный поиск tweb садится вплотную к порогу. Одно деление
      // `max / lum` по НЕлинейной яркости (как было в QrModal) дало бы
      // ~#2e2e27 с яркостью ~0.027 — на порядок темнее.
      expect(lum).toBeGreaterThan(0.17)
    })

    it('тон сохраняется (отношения каналов)', () => {
      const [r, g, b] = hexToRgb(darkenToMaxLuminance('#dd6cb9', 0.18))
      const [R, G, B] = hexToRgb('#dd6cb9')
      expect(r / R).toBeCloseTo(g / G, 1)
      expect(g / G).toBeCloseTo(b / B, 1)
    })
  })
})
