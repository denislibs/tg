// src/core/dom/setTransition.test.ts
// Машина классов перехода tweb (`components/singleTransition.ts`) — один
// экземпляр на императивный `setTransition` и на React-обёртку `useSetTransition`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { setTransition, transitionClasses } from './setTransition'
import { useSetTransition } from '../hooks/useSetTransition'
import { useSettingsStore } from '../../settings'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // гейт анимаций — `liteMode.isAvailable('animations')`, т.е. настройка «Без анимаций»
  useSettingsStore.setState({ reduceMotion: false })
  vi.useRealTimers()
})

describe('transitionClasses', () => {
  it('прямой ход: className + forwards, animating только на время анимации', () => {
    expect(transitionClasses([], 'is-visible', true, true)).toEqual(['is-visible', 'forwards', 'animating'])
    expect(transitionClasses(['is-visible', 'forwards', 'animating'], 'is-visible', true, false))
      .toEqual(['is-visible', 'forwards'])
  })

  it('обратный ход: backwards + animating, по окончании снимается и сам className', () => {
    expect(transitionClasses(['is-visible', 'forwards'], 'is-visible', false, true))
      .toEqual(['is-visible', 'backwards', 'animating'])
    expect(transitionClasses(['is-visible', 'backwards', 'animating'], 'is-visible', false, false)).toEqual([])
  })

  it('обратный ход НЕ навешивает className, которого не было (tweb singleTransition.ts:50)', () => {
    expect(transitionClasses([], 'is-connecting', false, true)).toEqual(['backwards', 'animating'])
  })

  it('прямой ход снимает backwards, оставшийся от прерванного обратного (tweb :75)', () => {
    // `toggle('backwards', !forwards)` у tweb — симметрично `toggle('forwards', forwards)`:
    // `forwards` и `backwards` на узле одновременно быть не могут, а `.backwards` —
    // живой селектор у потребителей useSetTransition
    expect(transitionClasses(['is-visible', 'backwards', 'animating'], 'is-visible', true, true))
      .toEqual(['is-visible', 'animating', 'forwards'])
  })

  it('посторонние классы узла не трогает', () => {
    expect(transitionClasses(['btn', 'is-visible', 'forwards'], 'is-visible', false, false)).toEqual(['btn'])
  })
})

describe('setTransition', () => {
  it('ведёт классы на узле и зовёт onTransitionEnd по истечении duration', () => {
    const element = document.createElement('div')
    const onTransitionEnd = vi.fn()
    setTransition({ element, className: 'is-connecting', forwards: true, duration: 250, onTransitionEnd })
    expect([...element.classList]).toEqual(['is-connecting', 'forwards', 'animating'])
    expect(onTransitionEnd).not.toHaveBeenCalled()

    vi.advanceTimersByTime(250)
    expect([...element.classList]).toEqual(['is-connecting', 'forwards'])
    expect(onTransitionEnd).toHaveBeenCalledTimes(1)
  })

  it('повторный вызов на том же узле отменяет незавершённый переход', () => {
    const element = document.createElement('div')
    const first = vi.fn()
    const second = vi.fn()
    setTransition({ element, className: 'is-connecting', forwards: true, duration: 250, onTransitionEnd: first })
    vi.advanceTimersByTime(100)
    setTransition({ element, className: 'is-connecting', forwards: false, duration: 250, onTransitionEnd: second })
    vi.advanceTimersByTime(250)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect([...element.classList]).toEqual([])
  })

  it('прерванный обратный ход не оставляет backwards вместе с forwards', () => {
    const element = document.createElement('div')
    setTransition({ element, className: 'is-connecting', forwards: true, duration: 250 })
    vi.advanceTimersByTime(250)
    setTransition({ element, className: 'is-connecting', forwards: false, duration: 250 })
    vi.advanceTimersByTime(100)
    expect([...element.classList]).toContain('backwards')

    setTransition({ element, className: 'is-connecting', forwards: true, duration: 250 })
    expect([...element.classList]).toEqual(['is-connecting', 'animating', 'forwards'])
  })

  it('при выключенных анимациях применяет конечное состояние синхронно', () => {
    useSettingsStore.setState({ reduceMotion: true })
    const element = document.createElement('div')
    const onTransitionEnd = vi.fn()
    setTransition({ element, className: 'is-connecting', forwards: true, duration: 250, onTransitionEnd })
    expect([...element.classList]).toEqual(['is-connecting', 'forwards'])
    expect(onTransitionEnd).toHaveBeenCalledTimes(1)
  })
})

describe('useSetTransition поверх того же ядра', () => {
  it('строки классов те же, что до выноса ядра', () => {
    const { result, rerender } = renderHook(({ forwards }) => useSetTransition(forwards, 'is-selecting', 200), {
      initialProps: { forwards: false },
    })
    expect(result.current).toBe('')

    rerender({ forwards: true })
    expect(result.current).toBe('is-selecting forwards animating')
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe('is-selecting forwards')

    rerender({ forwards: false })
    expect(result.current).toBe('is-selecting backwards animating')
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe('')
  })
})
