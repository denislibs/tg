// Тесты порта tweb `helpers/solid/createAnimatedValue.ts` (см. useAnimatedTop.ts рядом).
//
// Фейковые таймеры vitest подменяют и `requestAnimationFrame` (кадр = 16 мс,
// см. src/components/preloader.test.ts), и `performance.now` — поэтому
// `animate()`/`fastRaf()` из helpers/animation.ts и замер времени в самом
// хуке прокручиваются `vi.advanceTimersByTime`. При таком дискретном шаге
// раскадровка ложится на 16, 32, …, 112, 128 мс — первый кадр, где
// `(now - start) >= 120`, это 128 мс (не 120 ровно), поэтому тест на финиш
// анимации продвигает таймер до 128 мс, а не до 120.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import { useAnimatedTop } from './useAnimatedTop'

interface Props {
  top: number
  canAnimate: boolean
}

function host(): HTMLElement {
  return document.createElement('div')
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAnimatedTop', () => {
  it('монтирование ставит top сразу, без промежуточных значений', () => {
    const { result } = renderHook(({ top, canAnimate }: Props) => useAnimatedTop(top, canAnimate), {
      initialProps: { top: 120, canAnimate: true },
    })
    const el = host()
    result.current(el)

    expect(el.style.top).toBe('120px')
    expect(el.style.getPropertyValue('--background')).toBe('')

    // ни один кадр анимации не должен был запуститься — значение не шевелится
    vi.advanceTimersByTime(200)
    expect(el.style.top).toBe('120px')
  })

  it('canAnimate=true: движение от старого к новому, финиш к 128 мс (первый кадр ⩾120), промежуточное значение строго между', () => {
    const { result, rerender } = renderHook(({ top, canAnimate }: Props) => useAnimatedTop(top, canAnimate), {
      initialProps: { top: 0, canAnimate: true },
    })
    const el = host()
    result.current(el)
    expect(el.style.top).toBe('0px')

    rerender({ top: 100, canAnimate: true })

    vi.advanceTimersByTime(112)
    const mid = parseFloat(el.style.top)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(100)
    expect(el.style.getPropertyValue('--background')).toBe('var(--surface-color)')

    vi.advanceTimersByTime(16) // итого 128 — первый кадр ⩾120мс
    expect(el.style.top).toBe('100px')
    expect(el.style.getPropertyValue('--background')).toBe('')
  })

  it('canAnimate=false ставит новое значение мгновенно', () => {
    const { result, rerender } = renderHook(({ top, canAnimate }: Props) => useAnimatedTop(top, canAnimate), {
      initialProps: { top: 0, canAnimate: true },
    })
    const el = host()
    result.current(el)

    rerender({ top: 50, canAnimate: false })

    expect(el.style.top).toBe('50px')
    expect(el.style.getPropertyValue('--background')).toBe('')
  })

  it('--background стоит во время движения и снят после его завершения', () => {
    const { result, rerender } = renderHook(({ top, canAnimate }: Props) => useAnimatedTop(top, canAnimate), {
      initialProps: { top: 0, canAnimate: true },
    })
    const el = host()
    result.current(el)
    expect(el.style.getPropertyValue('--background')).toBe('')

    rerender({ top: 40, canAnimate: true })
    expect(el.style.getPropertyValue('--background')).toBe('var(--surface-color)')

    vi.advanceTimersByTime(128)
    expect(el.style.getPropertyValue('--background')).toBe('')
  })

  it('размонтирование гасит анимацию — значение застывает', () => {
    const { result, rerender, unmount } = renderHook(({ top, canAnimate }: Props) => useAnimatedTop(top, canAnimate), {
      initialProps: { top: 0, canAnimate: true },
    })
    const el = host()
    result.current(el)

    rerender({ top: 100, canAnimate: true })
    vi.advanceTimersByTime(64) // где-то на середине пути
    const frozen = el.style.top
    const midValue = parseFloat(frozen)
    expect(midValue).toBeGreaterThan(0)
    expect(midValue).toBeLessThan(100)

    unmount()
    vi.advanceTimersByTime(1000)

    expect(el.style.top).toBe(frozen)
  })

  it('смена DOM-узла во время анимации гасит анимацию на старом и сразу синхронизирует новый', () => {
    const { result, rerender } = renderHook(({ top, canAnimate }: Props) => useAnimatedTop(top, canAnimate), {
      initialProps: { top: 0, canAnimate: true },
    })
    const oldEl = host()
    result.current(oldEl)

    rerender({ top: 100, canAnimate: true })
    vi.advanceTimersByTime(64) // где-то на середине пути
    const frozenTop = oldEl.style.top
    const frozenBackground = oldEl.style.getPropertyValue('--background')
    expect(frozenBackground).toBe('var(--surface-color)')

    const newEl = host()
    result.current(newEl)

    // новый узел получил актуальный top сразу — как при монтировании, без анимации
    expect(newEl.style.top).toBe('100px')
    expect(newEl.style.getPropertyValue('--background')).toBe('')

    vi.advanceTimersByTime(1000)

    // старый узел больше не получает обновлений — заморожен в момент подмены
    // (мутация: убрать `stopRef.current?.()` из setEl — тест краснеет, старый
    // узел продолжает получать кадры анимации)
    expect(oldEl.style.top).toBe(frozenTop)
    expect(oldEl.style.getPropertyValue('--background')).toBe(frozenBackground)
    expect(newEl.style.top).toBe('100px')
  })

  it('перезапуск эффекта без смены top (флип canAnimate) не запускает лишнюю анимацию', () => {
    const { result, rerender } = renderHook(({ top, canAnimate }: Props) => useAnimatedTop(top, canAnimate), {
      initialProps: { top: 0, canAnimate: true },
    })
    const el = host()
    result.current(el)

    rerender({ top: 50, canAnimate: true })
    vi.advanceTimersByTime(128) // анимация доехала: currentRef.current === 50 === top
    expect(el.style.top).toBe('50px')
    expect(el.style.getPropertyValue('--background')).toBe('')

    // top не меняется, меняется только canAnimate — эффект перезапустится
    // (deps [top, canAnimate]), но раз значение уже на месте, лишней анимации
    // быть не должно (мутация: убрать `currentRef.current === top` из раннего
    // return — тест краснеет, --background мигает попусту)
    rerender({ top: 50, canAnimate: false })
    rerender({ top: 50, canAnimate: true })
    expect(el.style.getPropertyValue('--background')).toBe('')
  })
})
