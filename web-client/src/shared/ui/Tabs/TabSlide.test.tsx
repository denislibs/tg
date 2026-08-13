// src/shared/ui/Tabs/TabSlide.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { useEffect } from 'react'
import TabSlide from './TabSlide'

const ORDER = ['a', 'b', 'c'] as const

afterEach(cleanup)

/**
 * Считает МОНТИРОВАНИЯ своего таба: так видно, пережил ли кадр уход с него
 * (пересоздание узла — это и потеря состояния DOM, ради которого живёт
 * `keepMounted`: у списка чатов там `scrollTop` папки).
 */
const mounts: string[] = []
function Probe({ id, value }: { id: string; value: number }) {
  useEffect(() => {
    mounts.push(id)
  }, [id])
  return <div>{`${id}:${value}`}</div>
}

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

describe('TabSlide keepMounted (tweb: .tabs-container хранит все свои .tabs-tab)', () => {
  it('показанный таб остаётся в DOM, показан ровно текущий, возврат его не пересоздаёт', () => {
    vi.useFakeTimers()
    mounts.length = 0
    const { container, rerender } = render(
      <TabSlide tab="a" order={ORDER} keepMounted>
        <Probe id="a" value={1} />
      </TabSlide>,
    )
    const root = container.firstElementChild!
    expect(root.querySelectorAll('.tabs-tab')).toHaveLength(1)
    const frameA = root.querySelector<HTMLElement>('[data-tab="a"]')!

    act(() => {
      rerender(
        <TabSlide tab="b" order={ORDER} keepMounted>
          <Probe id="b" value={1} />
        </TabSlide>,
      )
    })
    // пока играет слайд, показаны оба кадра
    expect(root.querySelectorAll('.tabs-tab')).toHaveLength(2)
    expect(root.querySelectorAll('.tabs-tab.active')).toHaveLength(2)

    act(() => { vi.advanceTimersByTime(300) })
    // слайд доигран: кадр 'a' ОСТАЛСЯ в DOM (без keepMounted его бы сняли),
    // но уже не показан — `active` носит один текущий
    expect(root.querySelector('[data-tab="a"]')).toBe(frameA)
    expect(frameA.classList.contains('active')).toBe(false)
    expect(root.querySelectorAll('.tabs-tab.active')).toHaveLength(1)
    // содержимое ушедшего таба заморожено на том, с которым он ушёл
    expect(frameA.textContent).toBe('a:1')

    act(() => {
      rerender(
        <TabSlide tab="a" order={ORDER} keepMounted>
          <Probe id="a" value={2} />
        </TabSlide>,
      )
    })
    // тот же узел, свежее поддерево, повторного монтирования не было
    expect(root.querySelector('[data-tab="a"]')).toBe(frameA)
    expect(frameA.textContent).toBe('a:2')
    expect(frameA.classList.contains('active')).toBe(true)
    act(() => { vi.advanceTimersByTime(300) })
    expect(mounts).toEqual(['a', 'b'])
    vi.useRealTimers()
  })

  it('таба не стало в order (папку удалили) — его кадр уходит из DOM', () => {
    vi.useFakeTimers()
    mounts.length = 0
    const { container, rerender } = render(
      <TabSlide tab="a" order={ORDER} keepMounted>
        <Probe id="a" value={1} />
      </TabSlide>,
    )
    const root = container.firstElementChild!

    act(() => {
      rerender(
        <TabSlide tab="b" order={ORDER} keepMounted>
          <Probe id="b" value={1} />
        </TabSlide>,
      )
    })
    act(() => { vi.advanceTimersByTime(300) })
    act(() => {
      rerender(
        <TabSlide tab="a" order={ORDER} keepMounted>
          <Probe id="a" value={1} />
        </TabSlide>,
      )
    })
    act(() => { vi.advanceTimersByTime(300) })
    expect(root.querySelector('[data-tab="b"]')).not.toBe(null)

    act(() => {
      rerender(
        <TabSlide tab="a" order={['a', 'c']} keepMounted>
          <Probe id="a" value={1} />
        </TabSlide>,
      )
    })
    expect(root.querySelector('[data-tab="b"]')).toBe(null)
    expect(root.querySelectorAll('.tabs-tab')).toHaveLength(1)
    vi.useRealTimers()
  })
})
