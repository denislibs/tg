// src/shared/ui/Tabs/TabSlide.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import TabSlide from './TabSlide'

const ORDER = ['a', 'b', 'c'] as const

afterEach(cleanup)

describe('TabSlide', () => {
  it('на переключении держит оба кадра в DOM и уводит их transform-ами', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(
      <TabSlide tab="a" order={ORDER}>
        <div>AAA</div>
      </TabSlide>,
    )
    const root = container.firstElementChild!
    expect(root.className).toContain('tabs-container')
    expect(root.getAttribute('data-animation')).toBe('tabs')
    expect(root.querySelectorAll('.tabs-tab')).toHaveLength(1)
    const firstTab = root.querySelector('.tabs-tab')!

    // вперёд по order: уходящий едет влево, приходящий приезжает справа к 0
    act(() => {
      rerender(
        <TabSlide tab="b" order={ORDER}>
          <div>BBB</div>
        </TabSlide>,
      )
    })
    const tabs = root.querySelectorAll<HTMLElement>('.tabs-tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toBe(firstTab) // DOM-узел уходящего кадра сохранён
    expect(tabs[0].textContent).toBe('AAA')
    expect(tabs[1].textContent).toBe('BBB')
    expect(tabs[0].style.transform).toBe('translate3d(0px, 0, 0)') // width в jsdom = 0
    expect(tabs[1].style.transform).toBe('')
    expect(root.className).toContain('animating')
    expect(root.className).not.toContain('backwards')

    // фолбэк-таймер (transitionTime + 100) снимает уходящий кадр
    act(() => { vi.advanceTimersByTime(300) })
    expect(root.querySelectorAll('.tabs-tab')).toHaveLength(1)
    expect(root.className).not.toContain('animating')

    // назад по order — контейнеру `backwards`
    act(() => {
      rerender(
        <TabSlide tab="a" order={ORDER}>
          <div>AAA</div>
        </TabSlide>,
      )
    })
    expect(root.className).toContain('backwards')
    act(() => { vi.advanceTimersByTime(300) })
    expect(root.querySelectorAll('.tabs-tab')).toHaveLength(1)
    vi.useRealTimers()
  })
})
