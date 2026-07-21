import { describe, expect, it } from 'vitest'
import {
  ENHANCE_DEFAULTS, HISTORY_LIMIT, MIN_CROP,
  aspectOf, buildEnhanceFilter, centeredAspectCrop, clampCrop, fitScale,
  flipPointH, flipRectH, isDefaultEnhance, moveCrop, pushHistory,
  resizeCrop, rotatePointCW, rotateRectCW, warmthOverlay,
} from './editorMath'

describe('buildEnhanceFilter', () => {
  it('все нули — none (фильтр не платится)', () => {
    expect(buildEnhanceFilter(ENHANCE_DEFAULTS)).toBe('none')
    // warmth не входит в CSS-фильтр — один он тоже даёт none
    expect(buildEnhanceFilter({ ...ENHANCE_DEFAULTS, warmth: 50 })).toBe('none')
  })

  it('-100..100 линейно в множители 0..2', () => {
    expect(buildEnhanceFilter({ brightness: 100, contrast: -50, saturation: 25, warmth: 0 }))
      .toBe('brightness(2) contrast(0.5) saturate(1.25)')
  })

  it('низ клампится нулём', () => {
    expect(buildEnhanceFilter({ brightness: -100, contrast: 0, saturation: 0, warmth: 0 }))
      .toBe('brightness(0) contrast(1) saturate(1)')
  })

  it('isDefaultEnhance учитывает warmth', () => {
    expect(isDefaultEnhance(ENHANCE_DEFAULTS)).toBe(true)
    expect(isDefaultEnhance({ ...ENHANCE_DEFAULTS, warmth: 1 })).toBe(false)
  })
})

describe('warmthOverlay', () => {
  it('0 — нет оверлея', () => {
    expect(warmthOverlay(0)).toBeNull()
  })
  it('тёплый — оранжевый, холодный — синий, alpha растёт с модулем', () => {
    expect(warmthOverlay(100)).toEqual({ color: '#ff8a00', alpha: 0.25 })
    expect(warmthOverlay(-40)).toEqual({ color: '#0a84ff', alpha: 0.1 })
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

describe('поворот/отражение координат', () => {
  it('точка на 90° по часовой: (x,y) → (H-y, x)', () => {
    expect(rotatePointCW({ x: 10, y: 20 }, 600)).toEqual({ x: 580, y: 10 })
  })

  it('rect на 90°: четыре поворота возвращают исходник', () => {
    const r = { x: 10, y: 20, w: 100, h: 50 }
    let cur = r
    let W = 800
    let H = 600
    for (let i = 0; i < 4; i++) {
      cur = rotateRectCW(cur, H)
      ;[W, H] = [H, W]
    }
    expect(cur).toEqual(r)
  })

  it('отражение по горизонтали — инволюция', () => {
    const r = { x: 10, y: 20, w: 100, h: 50 }
    expect(flipRectH(r, 800)).toEqual({ x: 690, y: 20, w: 100, h: 50 })
    expect(flipRectH(flipRectH(r, 800), 800)).toEqual(r)
    expect(flipPointH({ x: 10, y: 20 }, 800)).toEqual({ x: 790, y: 20 })
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
