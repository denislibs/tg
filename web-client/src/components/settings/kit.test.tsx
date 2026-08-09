// SettingsScreen — стек экранов на слайдере tweb (`tweb components/slider.ts:39-44`
// + `components/transition.ts:23-42`). Проверяем ровно то, что раньше делал
// AnimatePresence: саб-экран приходит соседней вкладкой и доживает в DOM до
// конца обратного слайда.
import { render, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen } from './kit'

const noop = () => {}

function Screen({ open }: { open: boolean }) {
  return (
    <SettingsScreen
      title="Privacy and Security"
      onBack={noop}
      sub={open ? <div data-testid="sub">саб</div> : null}
    >
      корень
    </SettingsScreen>
  )
}

describe('SettingsScreen', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('рисует контейнер слайдера с вкладками', () => {
    const { container } = render(<Screen open={false} />)
    const slider = container.querySelector('.tabs-container')
    expect(slider?.getAttribute('data-animation')).toBe('navigation')
    // единственная вкладка активна сразу — первый показ не анимируется
    expect(container.querySelectorAll('.tabs-tab')).toHaveLength(1)
    expect(container.querySelector('.tabs-tab')?.classList.contains('active')).toBe(true)
  })

  it('открывает саб соседней вкладкой и ведёт классы перехода', () => {
    const { container, rerender } = render(<Screen open={false} />)
    act(() => { rerender(<Screen open />) })

    const slider = container.querySelector('.tabs-container')!
    const [own, sub] = Array.from(container.querySelectorAll<HTMLElement>('.tabs-tab'))
    expect(slider.classList.contains('animating')).toBe(true)
    expect(slider.classList.contains('backwards')).toBe(false)
    // приходящая — `active to`, уходящая ещё видима и помечена `from`
    expect(sub.classList.contains('active')).toBe(true)
    expect(sub.classList.contains('to')).toBe(true)
    expect(own.classList.contains('from')).toBe(true)
    expect(own.classList.contains('active')).toBe(true)
  })

  it('держит саб в DOM, пока играет обратный слайд', () => {
    const { container, rerender } = render(<Screen open={false} />)
    act(() => { rerender(<Screen open />) })
    act(() => { vi.advanceTimersByTime(400) })

    act(() => { rerender(<Screen open={false} />) })
    expect(container.querySelector('[data-testid="sub"]')).not.toBeNull()
    expect(container.querySelector('.tabs-container')!.classList.contains('backwards')).toBe(true)

    act(() => { vi.advanceTimersByTime(400) })
    expect(container.querySelector('[data-testid="sub"]')).toBeNull()
    expect(container.querySelectorAll('.tabs-tab')).toHaveLength(1)
  })
})
