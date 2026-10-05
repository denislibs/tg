/**
 * Порт tweb `src/components/visibilityIntersector.ts` (812502980, 122 строки).
 *
 * Обёртка над `IntersectionObserver`, которая помнит последнее состояние
 * каждой цели и зовёт колбэк только на СМЕНЕ видимости: повторная запись с тем
 * же `isIntersecting` глушится (`:17-21`). Первый потребитель у нас —
 * `components/gifsMasonry.ts` (у tweb — через `LazyLoadQueueRepeat2.intersector`).
 *
 * Портирован целиком: блокировку (`lock`/`unlock`/`unlockAndRefresh`) и пересборку
 * (`refresh`/`refreshVisible`/`getVisible`/`clearVisible`) зовут очереди эмодзи-дропдауна
 * (`components/lazyLoadQueueRepeat.ts`, `emoticonsDropdown/index.ts::addLazyLoadQueueRepeat`).
 */
type TargetType = HTMLElement
export type OnVisibilityChangeItem = { target: TargetType, visible: boolean, entry: IntersectionObserverEntry, index: number }
export type OnVisibilityChange = (item: OnVisibilityChangeItem) => void

export default class VisibilityIntersector {
  private observer: IntersectionObserver
  private items: Map<TargetType, boolean> = new Map()
  private locked = false

  constructor(onVisibilityChange: OnVisibilityChange, options?: IntersectionObserverInit) {
    this.observer = new IntersectionObserver((entries) => {
      if(this.locked) {
        return
      }

      const changed: OnVisibilityChangeItem[] = []

      entries.forEach((entry, index) => {
        const target = entry.target as TargetType

        if(this.items.get(target) === entry.isIntersecting) {
          return
        } else {
          this.items.set(target, entry.isIntersecting)
        }

        const change: typeof changed[0] = { target, visible: entry.isIntersecting, entry, index }

        // ! order will be incorrect so can't use it
        changed.push(change)
      })

      changed.forEach((item) => {
        onVisibilityChange(item)
      })
    }, options)
  }

  public getVisible() {
    const items: TargetType[] = []
    this.items.forEach((value, key) => {
      if(value) {
        items.push(key)
      }
    })

    return items
  }

  public clearVisible() {
    const visible = this.getVisible()
    for(const target of visible) {
      this.items.set(target, false)
    }
  }

  public isVisible(target: TargetType) {
    return !!this.items.get(target)
  }

  public disconnect() {
    this.observer.disconnect()
    this.items.clear()
  }

  public refresh() {
    this.observer.disconnect()

    const targets = [...this.items.keys()]
    for(const target of targets) {
      this.observer.observe(target)
    }
  }

  public refreshVisible() {
    const visible = this.getVisible()
    for(const target of visible) {
      this.observer.unobserve(target)
    }

    for(const target of visible) {
      this.observer.observe(target)
    }
  }

  public observe(target: TargetType) {
    this.items.set(target, false)
    this.observer.observe(target)
  }

  public unobserve(target: TargetType) {
    this.observer.unobserve(target)
    this.items.delete(target)
  }

  public unlock() {
    this.locked = false
  }

  public unlockAndRefresh() {
    this.unlock()
    this.refresh()
  }

  public lock() {
    this.locked = true
  }
}
