// Порт tweb `src/tests/mediaViewerClipPath.test.ts` — 1:1 (готовые фикстуры
// поведения из tweb). Адаптации: явный импорт из vitest (в tweb — jest-глобали),
// формат без `;` по `.oxlintrc.json`; файл лежит рядом с модулем, а не в
// `src/tests/` (наша раскладка тестов — колокейтед), импорт поэтому
// относительный.
import { describe, expect, test } from 'vitest'
import getMediaViewerClipPath from './clipPath'

describe('getMediaViewerClipPath', () => {
  test('masks only a chat-input overlap', () => {
    const clipPath = getMediaViewerClipPath({
      visibleRect: {
        rect: { top: 100, right: 500, bottom: 700, left: 100 },
        overflow: { top: false, right: false, bottom: true, left: false },
      },
      viewportWidth: 800,
      viewportHeight: 760,
    })

    expect(clipPath).toBe('inset(0px 0px 60px 0px)')
  })

  test('does not use the thumbnail edges on unclipped sides', () => {
    const clipPath = getMediaViewerClipPath({
      visibleRect: {
        rect: { top: 80, right: 620, bottom: 500, left: 140 },
        overflow: { top: true, right: false, bottom: false, left: false },
      },
      viewportWidth: 800,
      viewportHeight: 760,
    })

    expect(clipPath).toBe('inset(80px 0px 0px 0px)')
  })

  test('supports clipping on multiple ancestor sides', () => {
    const clipPath = getMediaViewerClipPath({
      visibleRect: {
        rect: { top: 40, right: 760, bottom: 710, left: 30 },
        overflow: { top: true, right: true, bottom: true, left: true },
      },
      viewportWidth: 800,
      viewportHeight: 760,
    })

    expect(clipPath).toBe('inset(40px 40px 50px 30px)')
  })
})
