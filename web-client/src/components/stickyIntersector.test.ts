// stickyIntersector — порт tweb components/stickyIntersector.ts. IntersectionObserver
// в happy-dom нет, поэтому подменяем его заглушкой (тот же приём, что и в
// animationIntersector.test.ts) и дёргаем колбэки наблюдателей руками.
import { describe, it, expect, beforeEach, vi } from 'vitest'

type Entry = { target: Element; boundingClientRect: { top: number; bottom: number }; rootBounds: { top: number } | null; isIntersecting: boolean }

let instances: IntersectionObserverStub[] = []

class IntersectionObserverStub {
  cb: (entries: Entry[]) => void
  observed = new Set<Element>()
  constructor(cb: (entries: Entry[]) => void) {
    this.cb = cb
    instances.push(this)
  }
  observe(el: Element) { this.observed.add(el) }
  unobserve(el: Element) { this.observed.delete(el) }
  disconnect() { this.observed.clear() }
}

vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

const { default: StickyIntersector } = await import('./stickyIntersector')

// Находит наблюдатель(и), у которых сейчас числится этот target, и дёргает его
// колбэк одной entry — имитация срабатывания реального IntersectionObserver.
function intersect(target: Element, entry: Omit<Entry, 'target'>) {
  for (const inst of instances) {
    if (inst.observed.has(target)) inst.cb([{ target, ...entry }])
  }
}

function makeContainer() {
  const root = document.createElement('div')
  const section = document.createElement('section')
  root.append(section)
  document.body.append(root)
  return { root, section }
}

function sentinelOf(section: Element) {
  return section.querySelector('.sticky_sentinel--top')!
}

beforeEach(() => {
  instances = []
  document.body.innerHTML = ''
})

describe('stickyIntersector', () => {
  it('дата прилипает, когда сентинел уходит за верхнюю границу root', () => {
    const { root, section } = makeContainer()
    const handler = vi.fn()
    const intersector = new StickyIntersector(root, handler)
    intersector.observeStickyHeaderChanges(section)

    const sentinel = sentinelOf(section)
    // headersObserver: bottom сентинела ушёл выше rootBounds.top → застряла
    intersect(sentinel, { boundingClientRect: { top: -10, bottom: -2 }, rootBounds: { top: 0 }, isIntersecting: false })

    expect(handler).toHaveBeenCalledWith(true, section)
  })

  it('дата отлипает, когда сентинел возвращается в root', () => {
    const { root, section } = makeContainer()
    const handler = vi.fn()
    const intersector = new StickyIntersector(root, handler)
    intersector.observeStickyHeaderChanges(section)
    const sentinel = sentinelOf(section)

    intersect(sentinel, { boundingClientRect: { top: -10, bottom: -2 }, rootBounds: { top: 0 }, isIntersecting: false })
    expect(handler).toHaveBeenLastCalledWith(true, section)

    // сентинел снова целиком внутри root (bottom ниже rootBounds.top) — не застряла
    intersect(sentinel, { boundingClientRect: { top: 5, bottom: 15 }, rootBounds: { top: 0 }, isIntersecting: true })
    expect(handler).toHaveBeenLastCalledWith(false, section)
  })

  it('elementsObserver подхватывает застревание, если сентинел его пропустил (быстрый скролл)', () => {
    const { root, section } = makeContainer()
    const handler = vi.fn()
    const intersector = new StickyIntersector(root, handler)
    intersector.observeStickyHeaderChanges(section)

    // сама секция пересекает root, её верх выше rootBounds.top → застряла
    intersect(section, { boundingClientRect: { top: -50, bottom: 200 }, rootBounds: { top: 0 }, isIntersecting: true })
    expect(handler).toHaveBeenCalledWith(true, section)

    // секция ушла из viewport целиком (пролистали дальше) — не застряла
    intersect(section, { boundingClientRect: { top: -500, bottom: -300 }, rootBounds: { top: 0 }, isIntersecting: false })
    expect(handler).toHaveBeenLastCalledWith(false, section)
  })

  it('disconnect() отписывает оба наблюдателя', () => {
    const { root, section } = makeContainer()
    const handler = vi.fn()
    const intersector = new StickyIntersector(root, handler)
    intersector.observeStickyHeaderChanges(section)
    const sentinel = sentinelOf(section)
    expect(instances.every((inst) => inst.observed.size > 0)).toBe(true)

    intersector.disconnect()

    expect(instances.every((inst) => inst.observed.size === 0)).toBe(true)
    // после disconnect() руками дёрнуть колбэк уже некому — instances.observed пуст,
    // так что intersect() не находит наблюдателя и не зовёт handler
    handler.mockClear()
    intersect(sentinel, { boundingClientRect: { top: -10, bottom: -2 }, rootBounds: { top: 0 }, isIntersecting: false })
    expect(handler).not.toHaveBeenCalled()
  })

  it('unobserve() снимает конкретный элемент, не трогая остальные', () => {
    const { root, section } = makeContainer()
    const section2 = document.createElement('section')
    root.append(section2)
    const handler = vi.fn()
    const intersector = new StickyIntersector(root, handler)
    intersector.observeStickyHeaderChanges(section)
    intersector.observeStickyHeaderChanges(section2)

    intersector.unobserve(section)

    intersect(section, { boundingClientRect: { top: -50, bottom: 200 }, rootBounds: { top: 0 }, isIntersecting: true })
    expect(handler).not.toHaveBeenCalled()

    intersect(section2, { boundingClientRect: { top: -50, bottom: 200 }, rootBounds: { top: 0 }, isIntersecting: true })
    expect(handler).toHaveBeenCalledWith(true, section2)
  })

  it('отсутствие IntersectionObserver не роняет конструктор и методы', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    let intersector: InstanceType<typeof StickyIntersector> | undefined
    expect(() => {
      intersector = new StickyIntersector(document.createElement('div'), vi.fn())
    }).not.toThrow()

    const section = document.createElement('section')
    expect(() => intersector!.observeStickyHeaderChanges(section)).not.toThrow()
    // сентинел-нода всё равно создаётся — это чистый DOM, IO тут ни при чём
    expect(section.querySelector('.sticky_sentinel--top')).not.toBeNull()
    expect(() => intersector!.setRootMargin('-10px 0px 0px 0px')).not.toThrow()
    expect(() => intersector!.unobserve(section)).not.toThrow()
    expect(() => intersector!.disconnect()).not.toThrow()

    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
  })
})
