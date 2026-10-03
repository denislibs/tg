// Порт tweb `src/components/lazyLoadQueueRepeat.ts` (812502980) вместе с нужной ему частью
// `lazyLoadQueueIntersector.ts` — очередь, которая грузит элемент КАЖДЫЙ раз, когда он
// становится видимым (стикеры и GIF эмодзи-дропдауна: видимая ячейка играет, ушедшая из вида
// возвращается к превью через `onVisibilityChange`).
//
// Расхождение: иерархии `LazyLoadQueueBase`/`LazyLoadQueueIntersector` у нас нет — потолок
// параллельных загрузок и «видимые вперёд» держит `core/lazyLoadQueue` (тот же
// `PARALLEL_LIMIT`), а эта очередь кладёт в неё задачу на каждое появление элемента. Задача
// элемента, ушедшего из вида до своей очереди, не запускается (у tweb — `indexOfAndSplice`
// из очереди, `:24-26`). Пока очередь заперта (`lock`), появления копятся и уходят в очередь
// после `unlock`/`unlockAndRefresh`.
import VisibilityIntersector, { type OnVisibilityChange } from '@components/visibilityIntersector'
import { createLazyLoadQueue, type LazyLoadQueue } from '@core/lazyLoadQueue'
import noop from '@helpers/noop'

export type LazyLoadElement = {
  div: HTMLElement
  load: (target: HTMLElement) => Promise<unknown>
}

export default class LazyLoadQueueRepeat {
  public intersector: VisibilityIntersector
  private queue: LazyLoadQueue
  private elementsMap: Map<HTMLElement, LazyLoadElement> = new Map()
  private locked = false
  private pending: Set<LazyLoadElement> = new Set()

  constructor(
    parallelLimit?: number,
    protected onVisibilityChange?: OnVisibilityChange,
    options?: IntersectionObserverInit,
  ) {
    this.queue = createLazyLoadQueue(parallelLimit)
    this.intersector = new VisibilityIntersector((item) => {
      const { target, visible } = item

      const queueItem = this.elementsMap.get(target)
      if(queueItem) {
        if(visible) {
          this.enqueue(queueItem)
        } else {
          this.pending.delete(queueItem)
        }
      }

      this.onVisibilityChange?.(item)
    }, options)
  }

  private enqueue(item: LazyLoadElement) {
    if(this.locked) {
      this.pending.add(item)
      return
    }

    const { div } = item
    const isVisible = () => this.intersector.isVisible(div)
    this.queue.push(() => {
      if(this.elementsMap.get(div) !== item || !isVisible()) {
        return Promise.resolve()
      }

      return item.load(div)
    }, isVisible).catch(noop)
  }

  public lock() {
    this.locked = true
    this.intersector.lock()
  }

  public unlock() {
    this.locked = false
    this.intersector.unlock()
    this.flushPending()
  }

  public unlockAndRefresh() {
    this.locked = false
    this.intersector.unlockAndRefresh()
    this.flushPending()
  }

  public refresh() {
    this.intersector.refresh()
  }

  private flushPending() {
    const pending = [...this.pending]
    this.pending.clear()
    pending.forEach((item) => this.enqueue(item))
  }

  public clear() {
    this.queue.clear()
    this.pending.clear()
    this.intersector.disconnect()
    this.elementsMap.clear()
  }

  public observe(el: LazyLoadElement) {
    this.elementsMap.set(el.div, el)
    this.intersector.observe(el.div)
  }

  public delete(el: Pick<LazyLoadElement, 'div'>) {
    const item = this.elementsMap.get(el.div)
    if(item) this.pending.delete(item)
    this.elementsMap.delete(el.div)
    this.intersector.unobserve(el.div)
  }
}
