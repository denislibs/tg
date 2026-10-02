/**
 * Solid-порт tweb `hooks/useCollapsable.ts` — правила жеста дословные:
 * стартовое состояние свёрнуто; колесо вверх у верхнего края разворачивает,
 * вниз — сворачивает; прокрученный список сворачивает немедленно и не даёт
 * развернуть; `unfold`/`fold` — ручки владельца (клик по свёрнутой шапке и гейт
 * «нет фото»).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'solid-js'
import { useCollapsable } from './useCollapsable'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.useRealTimers()
})

function mount() {
  const listenWheelOn = document.createElement('div')
  const scrollable = document.createElement('div')
  const container = document.createElement('div')
  document.body.append(listenWheelOn)
  const api = createRoot((d) => {
    dispose = d
    return useCollapsable({ scrollable: () => scrollable, listenWheelOn, container: () => container })
  })
  const wheel = (deltaY: number) => {
    const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
    listenWheelOn.dispatchEvent(e)
    return e
  }
  return { api, scrollable, wheel }
}

describe('useCollapsable (Solid) — жесты', () => {
  it('стартует свёрнутым; колесо вверх у края разворачивает и гасит событие, вниз — сворачивает', () => {
    vi.useFakeTimers()
    const { api, wheel } = mount()
    expect(api.folded()).toBe(true)

    const up = wheel(-50)
    expect(api.folded()).toBe(false)
    expect(up.defaultPrevented).toBe(true)

    vi.advanceTimersByTime(1000)
    wheel(50)
    expect(api.folded()).toBe(true)
  })

  it('прокрученный список: развёрнутая шапка сворачивается на первом же колесе, вверх — не разворачивается', () => {
    vi.useFakeTimers()
    const { api, scrollable, wheel } = mount()
    api.unfold()
    expect(api.folded()).toBe(false)

    scrollable.scrollTop = 10
    wheel(-50)
    expect(api.folded()).toBe(true)

    vi.advanceTimersByTime(1000)
    wheel(-50)
    expect(api.folded()).toBe(true)
  })

  it('unfold разворачивает и гасит событие клика, fold сворачивает', () => {
    const { api } = mount()
    const e = { preventDefault: vi.fn(), stopPropagation: vi.fn() }
    api.unfold(e)
    expect(api.folded()).toBe(false)
    expect(e.preventDefault).toHaveBeenCalled()

    api.fold()
    expect(api.folded()).toBe(true)
  })
})
