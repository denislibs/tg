// ── ПИН tweb 7082e1a18 → 091b476a9: круг смены темы стартует из точки клика ──
//
// Круговое раскрытие темы (View Transitions) задавалось в px CSS-пикселей.
// Старый Chromium гонит композитную анимацию `clip-path` в пикселях
// backing store — круг вырастал из точки 1/DPR от клика и не дотягивался до
// углов (tweb 7082e1a18 лечил это умножением на DPR). Итог tweb 812502980
// (091b476a9) — КРУГ В ПРОЦЕНТАХ собственного бокса снапшота: процент
// разрешается в том пространстве, где бокс разложен, поэтому точка и радиус
// верны во всех движках без сниффинга версий и DPR.
//
// Вместе с этим перенесено то, что шло в оригинале рядом и чего у нас не было:
// направление (`reverse`: при уходе в ночь сжимается СТАРЫЙ снапшот, при уходе
// в день растёт новый) и длительность из `getTransition('standard')`, ×2.
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '../../settings'
import { useThemeToggle } from './useThemeToggle'

type Animate = (keyframes: Keyframe[], options: KeyframeAnimationOptions) => Animation

let animate: ReturnType<typeof vi.fn<Animate>>
let finish: () => void

beforeEach(() => {
  animate = vi.fn<Animate>(() => ({ cancel: () => {} }) as Animation)
  document.documentElement.animate = animate as unknown as typeof document.documentElement.animate
  let resolveFinished!: () => void
  const finished = new Promise<void>((r) => { resolveFinished = r })
  finish = resolveFinished
  ;(document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => void) => {
    cb()
    return { ready: Promise.resolve(), finished, skipTransition: () => {} }
  }
  // Бокс снапшота `::view-transition-*(root)`: 1000×500 (вьюпорт у снапшота
  // может не совпадать с innerWidth — ровно поэтому оригинал меряет его).
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) =>
    pseudo ? ({ width: '1000px', height: '500px' } as CSSStyleDeclaration) : real(el, pseudo),
  )
})

afterEach(() => {
  finish()
  vi.restoreAllMocks()
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
  document.documentElement.classList.remove('no-view-transition', 'reverse')
})

const flush = () => new Promise((r) => setTimeout(r, 0))

// Радиус до дальнего угла от (250, 100) в боксе 1000×500: hypot(750, 400) = 850;
// в процентах — от диагонали/√2 (правило `circle()` для процентного радиуса).
const R = `${850 / Math.hypot(1000, 500) * Math.SQRT2 * 100}%`
const AT = 'at 25% 20%'

describe('useThemeToggle — круговое раскрытие (tweb themeController.ts:430-460)', () => {
  it('день → ночь: сжимается СТАРЫЙ снапшот, круг в процентах бокса, 500 мс', async () => {
    useSettingsStore.getState().update({ themeChoice: 'day' })
    const { result } = renderHook(() => useThemeToggle())

    result.current({ x: 250, y: 100 })
    expect(document.documentElement.classList.contains('no-view-transition')).toBe(true)
    expect(document.documentElement.classList.contains('reverse')).toBe(true)
    await flush()

    expect(animate).toHaveBeenCalledTimes(1)
    const [keyframes, options] = animate.mock.calls[0]!
    expect(keyframes).toEqual([
      { clipPath: `circle(${R} ${AT})` },
      { clipPath: `circle(0% ${AT})` },
    ])
    expect(options).toMatchObject({
      pseudoElement: '::view-transition-old(root)',
      duration: 500,
      easing: 'cubic-bezier(.4, .0, .2, 1)',
      fill: 'forwards',
    })
  })

  it('ночь → день: растёт НОВЫЙ снапшот, 600 мс', async () => {
    useSettingsStore.getState().update({ themeChoice: 'night' })
    const { result } = renderHook(() => useThemeToggle())

    result.current({ x: 250, y: 100 })
    expect(document.documentElement.classList.contains('reverse')).toBe(false)
    await flush()

    const [keyframes, options] = animate.mock.calls[0]!
    expect(keyframes).toEqual([
      { clipPath: `circle(0% ${AT})` },
      { clipPath: `circle(${R} ${AT})` },
    ])
    expect(options).toMatchObject({ pseudoElement: '::view-transition-new(root)', duration: 600 })
  })

  it('по окончании перехода классы снимаются', async () => {
    useSettingsStore.getState().update({ themeChoice: 'day' })
    const { result } = renderHook(() => useThemeToggle())
    result.current({ x: 250, y: 100 })
    finish()
    await flush()
    expect(document.documentElement.classList.contains('no-view-transition')).toBe(false)
    expect(document.documentElement.classList.contains('reverse')).toBe(false)
  })
})
