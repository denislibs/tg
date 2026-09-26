// Порт `SidebarSlider.selectTab` → `setTimeout(tab.onOpenAfterTimeout,
// TRANSITION_TIME)` (tweb slider.ts:133-137) для React-панели профиля:
// работа «после открытия» (у tweb `AppSharedMediaTab.onOpenAfterTimeout` →
// `scrollable.onScroll()`, sharedMediaTab.tsx:105-108 — пересчёт триггеров
// догрузки шаред-медиа) стартует ПОСЛЕ выезда колонки, а не в кадре клика.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { NAVIGATION_TRANSITION_TIME } from '@components/transition'
import { useOpenAfterTimeout } from './useOpenAfterTimeout'

function Harness({ open, cb }: { open: boolean; cb: () => void }) {
  useOpenAfterTimeout(open, cb)
  return null
}

describe('useOpenAfterTimeout — работа после выезда колонки (tweb onOpenAfterTimeout)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('закрытая панель колбэк не зовёт', () => {
    const cb = vi.fn()
    render(<Harness open={false} cb={cb} />)
    vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME * 4)
    expect(cb).not.toHaveBeenCalled()
  })

  it('по открытию — не в кадре клика, а через TRANSITION_TIME', () => {
    const cb = vi.fn()
    const { rerender } = render(<Harness open={false} cb={cb} />)
    rerender(<Harness open cb={cb} />)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME - 1)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('закрыли раньше, чем доехала, — колбэк отменён', () => {
    const cb = vi.fn()
    const { rerender } = render(<Harness open cb={cb} />)
    vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME / 2)
    rerender(<Harness open={false} cb={cb} />)
    vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME * 4)
    expect(cb).not.toHaveBeenCalled()
  })

  it('зовёт СВЕЖИЙ колбэк (перерисовка во время выезда не теряет новые замыкания)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Harness open cb={first} />)
    rerender(<Harness open cb={second} />)
    vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('перерисовка открытой панели таймер не перезапускает', () => {
    const cb = vi.fn()
    const { rerender } = render(<Harness open cb={cb} />)
    vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME - 10)
    rerender(<Harness open cb={() => cb()} />)
    vi.advanceTimersByTime(10)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
