// useLazyVisibility — пин двух вещей, которые не покрыты потребителями
// косвенно: (1) снятие ячейки (register(key, null)) убирает её ключ из
// `visible`, а не оставляет его в множестве навсегда; (2) следствие первого —
// ключ, переиспользованный НОВОЙ ячейкой после снятия старой (тот же slug
// после нового поиска, ремаунт строки), не наследует чужую видимость и не
// становится видимым раньше, чем его реально увидит наблюдатель.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useLazyVisibility } from './useLazyVisibility'

// Управляемый стаб: `report(key, isIntersecting)` бьёт по колбэку так же, как
// реальный IntersectionObserver бил бы по вызову для элемента с этим
// data-lazy-key (register() пишет его в dataset — см. useLazyVisibility.ts).
let currentCb: IntersectionObserverCallback | null = null
class TestIntersectionObserver {
  constructor(cb: IntersectionObserverCallback) { currentCb = cb }
  observe() {}
  unobserve() {}
  disconnect() { currentCb = null }
}
function report(el: Element, isIntersecting: boolean) {
  currentCb?.([{ target: el, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver)
}

function Harness({ regRef }: { regRef: { current: ReturnType<typeof useLazyVisibility> | null } }) {
  const rootRef = { current: document.body }
  regRef.current = useLazyVisibility(rootRef, '0px')
  return null
}

describe('useLazyVisibility', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('register(key, null) убирает ключ из visible, а не оставляет его навсегда', () => {
    const regRef: { current: ReturnType<typeof useLazyVisibility> | null } = { current: null }
    render(<Harness regRef={regRef} />)
    const el = document.createElement('div')

    act(() => { regRef.current!.register('a', el) })
    act(() => { report(el, true) })
    expect(regRef.current!.visible.has('a')).toBe(true)

    act(() => { regRef.current!.register('a', null) })
    expect(regRef.current!.visible.has('a')).toBe(false)
  })

  it('ключ, переиспользованный новой ячейкой, не наследует видимость старой', () => {
    const regRef: { current: ReturnType<typeof useLazyVisibility> | null } = { current: null }
    render(<Harness regRef={regRef} />)
    const oldEl = document.createElement('div')
    const newEl = document.createElement('div')

    act(() => { regRef.current!.register('shared-key', oldEl) })
    act(() => { report(oldEl, true) })
    expect(regRef.current!.visible.has('shared-key')).toBe(true)

    // строка размонтировалась (новый поиск/ремаунт) — та же строка ключа
    // тут же занята НОВОЙ ячейкой, которую наблюдатель ещё не видел
    act(() => { regRef.current!.register('shared-key', null) })
    act(() => { regRef.current!.register('shared-key', newEl) })

    expect(regRef.current!.visible.has('shared-key')).toBe(false)
  })
})
