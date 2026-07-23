import { describe, expect, it } from 'vitest'
import {
  ADJUSTMENTS, ASPECT_PRESETS, ENHANCE_DEFAULTS, HISTORY_LIMIT, MIN_CROP,
  aspectOf, buildEnhanceFilter, centeredAspectCrop, clampCrop, coverScale, enhanceRange, fitScale,
  isDefaultEnhance, moveCrop, normalizeEnhance, pushHistory,
  resizeCrop, rotatePoint, warmthOverlay,
  type Rect,
} from './editorMath'

describe('ADJUSTMENTS / дефолты', () => {
  it('11 коррекций, дефолт каждой — 0', () => {
    const keys = ADJUSTMENTS.map((a) => a.key)
    expect(keys).toEqual([
      'enhance', 'brightness', 'contrast', 'saturation', 'warmth', 'fade',
      'highlights', 'shadows', 'vignette', 'grain', 'sharpen',
    ])
    for (const a of ADJUSTMENTS) expect(ENHANCE_DEFAULTS[a.key]).toBe(0)
    expect(Object.keys(ENHANCE_DEFAULTS)).toHaveLength(11)
  })

  it('диапазоны: to100 → 0..100, иначе −50..50', () => {
    expect(enhanceRange(true)).toEqual([0, 100])
    expect(enhanceRange(false)).toEqual([-50, 50])
    expect(ADJUSTMENTS.find((a) => a.key === 'enhance')?.to100).toBe(true)
    expect(ADJUSTMENTS.find((a) => a.key === 'brightness')?.to100).toBe(false)
  })

  it('isDefaultEnhance по всем 11 полям', () => {
    expect(isDefaultEnhance(ENHANCE_DEFAULTS)).toBe(true)
    expect(isDefaultEnhance({ ...ENHANCE_DEFAULTS, grain: 1 })).toBe(false)
    expect(isDefaultEnhance({ ...ENHANCE_DEFAULTS, warmth: -1 })).toBe(false)
  })
})

describe('normalizeEnhance', () => {
  it('value/(to100?100:50)', () => {
    expect(normalizeEnhance(100, true)).toBe(1)
    expect(normalizeEnhance(50, true)).toBe(0.5)
    expect(normalizeEnhance(0, true)).toBe(0)
    expect(normalizeEnhance(50, false)).toBe(1)
    expect(normalizeEnhance(-50, false)).toBe(-1)
    expect(normalizeEnhance(25, false)).toBe(0.5)
  })
})

describe('buildEnhanceFilter (CSS-fallback)', () => {
  it('все нули — none (фильтр не платится)', () => {
    expect(buildEnhanceFilter(ENHANCE_DEFAULTS)).toBe('none')
    // warmth в CSS-фильтр не входит — один он тоже даёт none
    expect(buildEnhanceFilter({ ...ENHANCE_DEFAULTS, warmth: 25 })).toBe('none')
  })

  it('нормализация как в шейдере (−50..50 → −1..1)', () => {
    // brightness 50 → 1 → 1+1*0.5=1.5; contrast −50 → −1 → 0.5; saturation 25 → 0.5 → 1.5
    expect(buildEnhanceFilter({ ...ENHANCE_DEFAULTS, brightness: 50, contrast: -50, saturation: 25 }))
      .toBe('brightness(1.5) contrast(0.5) saturate(1.5)')
  })

  it('низ клампится нулём', () => {
    expect(buildEnhanceFilter({ ...ENHANCE_DEFAULTS, saturation: -50 }))
      .toBe('brightness(1) contrast(1) saturate(0)')
  })
})

describe('warmthOverlay (CSS-fallback)', () => {
  it('0 — нет оверлея', () => {
    expect(warmthOverlay(0)).toBeNull()
  })
  it('тёплый — оранжевый, холодный — синий, alpha растёт с модулем', () => {
    expect(warmthOverlay(50)).toEqual({ color: '#ff8a00', alpha: 0.25 })
    expect(warmthOverlay(-20)).toEqual({ color: '#0a84ff', alpha: 0.1 })
  })
})

describe('aspectOf / centeredAspectCrop', () => {
  it('пресеты', () => {
    expect(aspectOf('free', 800, 600)).toBeNull()
    expect(aspectOf('original', 800, 600)).toBeCloseTo(4 / 3)
    expect(aspectOf('1:1', 800, 600)).toBe(1)
    expect(aspectOf('4:3', 800, 600)).toBeCloseTo(4 / 3)
    expect(aspectOf('16:9', 800, 600)).toBeCloseTo(16 / 9)
  })

  it('полный список пресетов (как в tweb cropTab)', () => {
    expect(ASPECT_PRESETS).toEqual([
      'free', 'original', '1:1', '3:2', '2:3', '4:3', '3:4',
      '5:4', '4:5', '7:5', '5:7', '16:9', '9:16',
    ])
    expect(aspectOf('3:2', 800, 600)).toBeCloseTo(3 / 2)
    expect(aspectOf('2:3', 800, 600)).toBeCloseTo(2 / 3)
    expect(aspectOf('9:16', 800, 600)).toBeCloseTo(9 / 16)
    expect(aspectOf('5:7', 800, 600)).toBeCloseTo(5 / 7)
    // портретные и альбомные пресеты — взаимно обратные
    expect(aspectOf('3:4', 800, 600)! * aspectOf('4:3', 800, 600)!).toBeCloseTo(1)
  })

  it('free — вся картинка', () => {
    expect(centeredAspectCrop(800, 600, null)).toEqual({ x: 0, y: 0, w: 800, h: 600 })
  })

  it('квадрат в альбомной — по высоте, отцентрован', () => {
    expect(centeredAspectCrop(800, 600, 1)).toEqual({ x: 100, y: 0, w: 600, h: 600 })
  })

  it('16:9 в альбомной 4:3 — по ширине', () => {
    const r = centeredAspectCrop(800, 600, 16 / 9)
    expect(r.w).toBe(800)
    expect(r.h).toBeCloseTo(450)
    expect(r.y).toBeCloseTo(75)
  })
})

describe('clampCrop / moveCrop', () => {
  it('кламп размера и позиции', () => {
    expect(clampCrop({ x: -10, y: 560, w: 900, h: 10 }, 800, 600))
      .toEqual({ x: 0, y: 536, w: 800, h: MIN_CROP })
  })

  it('сдвиг не выходит за границы', () => {
    const r = { x: 100, y: 100, w: 200, h: 200 }
    expect(moveCrop(r, -500, 50, 800, 600)).toEqual({ x: 0, y: 150, w: 200, h: 200 })
    expect(moveCrop(r, 5000, 5000, 800, 600)).toEqual({ x: 600, y: 400, w: 200, h: 200 })
  })
})

describe('resizeCrop (free)', () => {
  const r = { x: 100, y: 100, w: 200, h: 200 }

  it('юго-восточная ручка тянет правый/нижний края', () => {
    expect(resizeCrop(r, 'se', 50, -30, 800, 600, null))
      .toEqual({ x: 100, y: 100, w: 250, h: 170 })
  })

  it('северо-западная не даёт рамке стать меньше минимума', () => {
    expect(resizeCrop(r, 'nw', 500, 500, 800, 600, null))
      .toEqual({ x: 300 - MIN_CROP, y: 300 - MIN_CROP, w: MIN_CROP, h: MIN_CROP })
  })

  it('края клампятся границами картинки', () => {
    expect(resizeCrop(r, 'se', 5000, 5000, 800, 600, null))
      .toEqual({ x: 100, y: 100, w: 700, h: 500 })
    expect(resizeCrop(r, 'nw', -5000, -5000, 800, 600, null))
      .toEqual({ x: 0, y: 0, w: 300, h: 300 })
  })

  it('срединная ручка двигает только свою ось', () => {
    expect(resizeCrop(r, 'e', 40, 999, 800, 600, null))
      .toEqual({ x: 100, y: 100, w: 240, h: 200 })
    expect(resizeCrop(r, 'n', 999, -40, 800, 600, null))
      .toEqual({ x: 100, y: 60, w: 200, h: 240 })
  })
})

describe('resizeCrop (с аспектом)', () => {
  const r = { x: 100, y: 100, w: 200, h: 200 }

  it('угловая ручка держит аспект, якорь — противоположный угол', () => {
    const out = resizeCrop(r, 'se', 100, 0, 800, 600, 1)
    expect(out).toEqual({ x: 100, y: 100, w: 300, h: 300 })
  })

  it('вертикальная ручка ведёт высоту, ширина растёт от центра', () => {
    const out = resizeCrop(r, 's', 0, 100, 800, 600, 1)
    expect(out.h).toBe(300)
    expect(out.w).toBe(300)
    expect(out.x).toBe(50) // центр остался на 200
    expect(out.y).toBe(100)
  })

  it('аспект не даёт вылезти за границы (пропорциональное ужатие)', () => {
    const out = resizeCrop(r, 'se', 5000, 5000, 800, 600, 1)
    expect(out.w).toBe(out.h)
    expect(out.x + out.w).toBeLessThanOrEqual(800)
    expect(out.y + out.h).toBeLessThanOrEqual(600)
    expect(out.h).toBe(500) // упёрлись в высоту
  })

  it('минимум держится по обеим осям', () => {
    const out = resizeCrop(r, 'se', -500, -500, 800, 600, 1)
    expect(out.w).toBeGreaterThanOrEqual(MIN_CROP)
    expect(out.h).toBeGreaterThanOrEqual(MIN_CROP)
  })
})

describe('rotatePoint (свободный угол)', () => {
  it('поворот на 0 — тождество', () => {
    expect(rotatePoint({ x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 20 })
  })

  it('поворот на 90° по часовой (y-вниз): (x,y) → (-y, x)', () => {
    const p = rotatePoint({ x: 10, y: 0 }, Math.PI / 2)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(10)
  })

  it('поворот на 180° меняет знак обеих координат', () => {
    const p = rotatePoint({ x: 3, y: 7 }, Math.PI)
    expect(p.x).toBeCloseTo(-3)
    expect(p.y).toBeCloseTo(-7)
  })

  it('четыре поворота на 90° возвращают точку', () => {
    let p = { x: 12, y: -5 }
    for (let i = 0; i < 4; i++) p = rotatePoint(p, Math.PI / 2)
    expect(p.x).toBeCloseTo(12)
    expect(p.y).toBeCloseTo(-5)
  })
})

describe('coverScale (покрытие рамки при повороте)', () => {
  const full = (w: number, h: number): Rect => ({ x: 0, y: 0, w, h })

  it('без поворота полная рамка покрывается масштабом 1', () => {
    expect(coverScale(full(800, 600), 800, 600, 0)).toBeCloseTo(1)
  })

  it('поворот квадрата на 45° требует масштаб √2', () => {
    expect(coverScale(full(100, 100), 100, 100, Math.PI / 4)).toBeCloseTo(Math.SQRT2)
  })

  it('поворот на 90° альбомной картинки требует масштаб W/H', () => {
    // рамка 800×600, картинка 800×600, повёрнутая на 90° → нужно w/h
    expect(coverScale(full(800, 600), 800, 600, Math.PI / 2)).toBeCloseTo(800 / 600)
  })

  it('меньшая рамка внутри картинки без поворота не ужимает исходник (min 1)', () => {
    expect(coverScale({ x: 200, y: 150, w: 400, h: 300 }, 800, 600, 0)).toBe(1)
  })

  it('смещённая рамка учитывает эксцентриситет центра', () => {
    // рамка у края сильнее уходит из-под повёрнутой картинки → масштаб больше
    const centered = coverScale({ x: 300, y: 200, w: 200, h: 200 }, 800, 600, Math.PI / 6)
    const offCenter = coverScale({ x: 0, y: 0, w: 200, h: 200 }, 800, 600, Math.PI / 6)
    expect(offCenter).toBeGreaterThan(centered)
    expect(centered).toBeGreaterThanOrEqual(1)
  })
})

describe('pushHistory', () => {
  it('пушит в конец, не мутируя исходник', () => {
    const a = [1, 2]
    const b = pushHistory(a, 3)
    expect(b).toEqual([1, 2, 3])
    expect(a).toEqual([1, 2])
  })

  it('глубина ограничена HISTORY_LIMIT, вытесняются старые', () => {
    let st: number[] = []
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) st = pushHistory(st, i)
    expect(st).toHaveLength(HISTORY_LIMIT)
    expect(st[0]).toBe(5)
    expect(st[st.length - 1]).toBe(HISTORY_LIMIT + 4)
  })

  it('pop сверху (undo) снимает последний элемент', () => {
    const st = pushHistory(pushHistory([], 'a'), 'b')
    expect(st[st.length - 1]).toBe('b')
    expect(st.slice(0, -1)).toEqual(['a'])
  })
})

describe('fitScale', () => {
  it('вписывает без увеличения сверх 1:1', () => {
    expect(fitScale(2000, 1000, 1000, 1000)).toBe(0.5)
    expect(fitScale(100, 100, 1000, 1000)).toBe(1)
  })
})
