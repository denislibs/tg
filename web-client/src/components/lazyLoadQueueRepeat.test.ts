// Пины `LazyLoadQueueRepeat` (порт tweb `lazyLoadQueueRepeat.ts`, П-6): элемент грузится на КАЖДОЕ
// появление в виду; пока очередь заперта (панель анимирует открытие/закрытие), появления копятся
// и уходят в загрузку на `unlockAndRefresh`; ушедший из вида элемент не грузится; `onVisibilityChange`
// узнаёт и об уходе (ячейка возвращается к превью).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LazyLoadQueueRepeat from './lazyLoadQueueRepeat'

type Callback = IntersectionObserverCallback
let observers: { callback: Callback, targets: Set<Element> }[] = []

class FakeIntersectionObserver {
  private record: { callback: Callback, targets: Set<Element> }
  constructor(callback: Callback) {
    this.record = { callback, targets: new Set() }
    observers.push(this.record)
  }
  observe(target: Element) { this.record.targets.add(target) }
  unobserve(target: Element) { this.record.targets.delete(target) }
  disconnect() { this.record.targets.clear() }
  takeRecords() { return [] }
}

const fire = (target: Element, isIntersecting: boolean) => {
  for(const { callback, targets } of observers) {
    if(targets.has(target)) callback([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver)
  }
}

const flush = async() => {
  for(let i = 0; i < 5; ++i) await Promise.resolve()
}

beforeEach(() => {
  observers = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LazyLoadQueueRepeat', () => {
  it('грузит элемент на каждое появление и сообщает об уходе', async() => {
    const onVisibilityChange = vi.fn()
    const queue = new LazyLoadQueueRepeat(undefined, onVisibilityChange)
    const div = document.createElement('div')
    const load = vi.fn(async() => {})
    queue.observe({ div, load })

    fire(div, true)
    await flush()
    expect(load).toHaveBeenCalledTimes(1)

    fire(div, false)
    expect(onVisibilityChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: div, visible: false }))

    fire(div, true)
    await flush()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('запертая очередь копит появления и грузит их на unlockAndRefresh', async() => {
    const queue = new LazyLoadQueueRepeat()
    const div = document.createElement('div')
    const load = vi.fn(async() => {})
    queue.observe({ div, load })

    fire(div, true)
    queue.lock()
    // пока заперта — наблюдатель молчит, как у tweb (`VisibilityIntersector.locked`)
    fire(div, false)
    fire(div, true)
    await flush()
    expect(load).toHaveBeenCalledTimes(1)

    queue.unlockAndRefresh()
    await flush()
    expect(load).toHaveBeenCalledTimes(1) // видимость не менялась — новой загрузки нет
  })

  it('элемент, ушедший из вида до своей очереди, не грузится', async() => {
    const queue = new LazyLoadQueueRepeat(1)
    let release!: () => void
    const busy = document.createElement('div')
    queue.observe({ div: busy, load: () => new Promise<void>((resolve) => release = resolve) })
    const div = document.createElement('div')
    const load = vi.fn(async() => {})
    queue.observe({ div, load })

    fire(busy, true) // занял единственный слот
    fire(div, true)
    fire(div, false)
    release()
    await flush()
    expect(load).not.toHaveBeenCalled()

    queue.delete({ div })
    fire(div, true)
    await flush()
    expect(load).not.toHaveBeenCalled()
  })
})
