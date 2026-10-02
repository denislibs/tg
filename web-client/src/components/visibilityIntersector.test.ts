// VisibilityIntersector — порт tweb `components/visibilityIntersector.ts`.
// IntersectionObserver в happy-dom нет: подменяем заглушкой (тот же приём, что
// у `stickyIntersector.test.ts`) и дёргаем колбэк руками.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Entry = { target: Element, isIntersecting: boolean }
let instances: IntersectionObserverStub[] = []
class IntersectionObserverStub {
  observed = new Set<Element>()
  constructor(public cb: (entries: Entry[]) => void) {
    instances.push(this)
  }
  observe(el: Element) { this.observed.add(el) }
  unobserve(el: Element) { this.observed.delete(el) }
  disconnect() { this.observed.clear() }
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

const { default: VisibilityIntersector } = await import('./visibilityIntersector')

const fire = (...entries: Entry[]) => instances[0].cb(entries)

beforeEach(() => {
  instances = []
})

describe('VisibilityIntersector', () => {
  it('колбэк — только на СМЕНЕ видимости: повтор того же состояния глушится (tweb :17-21)', () => {
    const onChange = vi.fn()
    const intersector = new VisibilityIntersector(onChange)
    const a = document.createElement('div')
    intersector.observe(a)

    // только что наблюдаемая цель считается невидимой — «невидима» не событие
    fire({ target: a, isIntersecting: false })
    expect(onChange).not.toHaveBeenCalled()

    fire({ target: a, isIntersecting: true })
    fire({ target: a, isIntersecting: true })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toMatchObject({ target: a, visible: true, index: 0 })
    expect(intersector.isVisible(a)).toBe(true)

    fire({ target: a, isIntersecting: false })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(intersector.isVisible(a)).toBe(false)
  })

  it('unobserve/disconnect забывают состояние цели', () => {
    const intersector = new VisibilityIntersector(() => {})
    const a = document.createElement('div')
    const b = document.createElement('div')
    intersector.observe(a)
    intersector.observe(b)
    fire({ target: a, isIntersecting: true }, { target: b, isIntersecting: true })

    intersector.unobserve(a)
    expect(intersector.isVisible(a)).toBe(false)
    expect(instances[0].observed.has(a)).toBe(false)

    intersector.disconnect()
    expect(intersector.isVisible(b)).toBe(false)
    expect(instances[0].observed.size).toBe(0)
  })
})
