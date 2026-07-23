// Текстовая модель медиа-редактора (C4): раскладка строк layoutText (чистая,
// без canvas) — паддинги/межстрочный интервал/выравнивание/базовая линия — и
// контрастный цвет текста для стилей outline/background.
import { describe, it, expect } from 'vitest'
import { layoutText, fontInfoMap } from './sceneRender'
import { contrastColor } from './editorMath'

describe('layoutText — паддинги и межстрочный интервал', () => {
  it('normal/outline: padX = 0.2*size, lineHeight = 1.33*size', () => {
    const l = layoutText([100], ['a'], 40, 'normal', 'left', 0.75)
    expect(l.padX).toBe(8) // 40 * 0.2
    expect(l.lineHeight).toBeCloseTo(53.2) // 40 * 1.33
    expect(l.width).toBe(100 + 8 * 2)
    expect(l.height).toBeCloseTo(53.2)
    expect(l.baselineOffset).toBeCloseTo(53.2 * 0.75)
  })

  it('background: padX = 0.3*size', () => {
    const l = layoutText([100], ['a'], 40, 'background', 'left', 0.75)
    expect(l.padX).toBe(12) // 40 * 0.3
    expect(l.width).toBe(100 + 12 * 2)
  })

  it('высота = число строк * lineHeight', () => {
    const l = layoutText([50, 80, 30], ['a', 'b', 'c'], 20, 'normal', 'left', 0.75)
    expect(l.lines).toHaveLength(3)
    expect(l.height).toBeCloseTo(20 * 1.33 * 3)
  })

  it('baselineOffset учитывает baseline шрифта', () => {
    const wide = layoutText([10], ['x'], 40, 'normal', 'left', fontInfoMap.playwrite.baseline)
    expect(wide.baselineOffset).toBeCloseTo(40 * 1.33 * 0.85)
  })
})

describe('layoutText — выравнивание', () => {
  const widths = [100, 40] // бокс по широкой строке
  const size = 20
  const padX = size * 0.2 // 4
  const boxWidth = 100 + padX * 2 // 108
  const narrow = 40 + padX * 2 // 48

  it('left: обе строки прижаты влево (left = 0)', () => {
    const l = layoutText(widths, ['aa', 'b'], size, 'normal', 'left', 0.75)
    expect(l.lines[0].left).toBe(0)
    expect(l.lines[1].left).toBe(0)
    expect(l.width).toBe(boxWidth)
  })

  it('center: узкая строка центрирована', () => {
    const l = layoutText(widths, ['aa', 'b'], size, 'normal', 'center', 0.75)
    expect(l.lines[0].left).toBe(0) // широкая занимает весь бокс
    expect(l.lines[1].left).toBeCloseTo((boxWidth - narrow) / 2)
  })

  it('right: узкая строка прижата вправо (right = boxWidth)', () => {
    const l = layoutText(widths, ['aa', 'b'], size, 'normal', 'right', 0.75)
    expect(l.lines[1].left).toBeCloseTo(boxWidth - narrow)
    expect(l.lines[1].right).toBeCloseTo(boxWidth)
    expect(l.lines[0].right).toBeCloseTo(boxWidth)
  })
})

describe('contrastColor — контрастный цвет текста (порт tweb getContrastColor)', () => {
  it('очень светлый фон (l≥80) → чёрный текст', () => {
    expect(contrastColor('#ffffff')).toBe('#000000')
    expect(contrastColor('#eeeeee')).toBe('#000000')
  })
  it('насыщенный/тёмный фон (l<80) → белый текст', () => {
    expect(contrastColor('#000000')).toBe('#ffffff')
    expect(contrastColor('#fe4438')).toBe('#ffffff')
    expect(contrastColor('#0a84ff')).toBe('#ffffff')
    expect(contrastColor('#ffd60a')).toBe('#ffffff') // жёлтый: HSL-светлота ~52
  })
})

describe('fontInfoMap — 8 шрифтов с метриками', () => {
  it('содержит ровно 8 ключей', () => {
    expect(Object.keys(fontInfoMap)).toHaveLength(8)
  })
  it('у каждого — семейство, начертание и baseline', () => {
    for (const info of Object.values(fontInfoMap)) {
      expect(info.fontFamily).toMatch(/^'.+'$/)
      expect(info.fontWeight).toBeGreaterThan(0)
      expect(info.baseline).toBeGreaterThan(0)
    }
  })
})
