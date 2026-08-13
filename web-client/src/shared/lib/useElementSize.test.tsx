import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useElementSize } from './useElementSize'

// happy-dom (окружение тестов, см. vitest.config.ts) даёт настоящий класс
// ResizeObserver, но его колбэк никогда не срабатывает сам по себе — в
// happy-dom нет реального layout-движка (проверено: `new ResizeObserver(cb).observe(el)`
// не зовёт `cb` даже после макротика). Поэтому здесь — свой контролируемый
// мок, как и остальные ResizeObserver-подписчики в этом репозитории тестируют
// иначе (через прямой вызов эффекта, не через реальный резайз) — готового
// мока-заглушки для срабатывания колбэка в проекте нет, второй такой же не
// заводим, просто фиксируем минимальный.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  disconnected = false
  observed: Element[] = []
  constructor(private cb: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
  observe(el: Element) {
    this.observed.push(el)
  }
  unobserve(el: Element) {
    this.observed = this.observed.filter((o) => o !== el)
  }
  disconnect() {
    this.disconnected = true
  }
  trigger() {
    this.cb(
      this.observed.map((target) => ({ target }) as ResizeObserverEntry),
      this as unknown as ResizeObserver,
    )
  }
}

function setOffsetSize(el: HTMLElement, width: number, height: number) {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width })
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height })
}

function Probe({ onSize }: { onSize: (s: { width: number; height: number }) => void }) {
  const { ref, width, height } = useElementSize()
  onSize({ width, height })
  return <div ref={ref} data-testid="probe" />
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  FakeResizeObserver.instances.length = 0
})

describe('useElementSize', () => {
  it('размонтирование отписывает наблюдателя', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const sizes: { width: number; height: number }[] = []

    const { unmount } = render(<Probe onSize={(s) => sizes.push(s)} />)
    const observer = FakeResizeObserver.instances[0]
    expect(observer).toBeTruthy()
    expect(observer.disconnected).toBe(false)

    unmount()

    expect(observer.disconnected).toBe(true)
  })

  it('резайз через ResizeObserver обновляет width/height', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const sizes: { width: number; height: number }[] = []

    render(<Probe onSize={(s) => sizes.push(s)} />)
    // Начальный синхронный замер при монтировании — offsetWidth/Height ещё 0
    // (happy-dom без реального layout).
    expect(sizes[sizes.length - 1]).toEqual({ width: 0, height: 0 })

    const el = document.querySelector('[data-testid="probe"]') as HTMLElement
    setOffsetSize(el, 320, 48)
    const observer = FakeResizeObserver.instances[0]
    act(() => {
      observer.trigger()
    })

    expect(sizes[sizes.length - 1]).toEqual({ width: 320, height: 48 })
  })
})
