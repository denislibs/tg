/**
 * Порт tweb `src/components/visibilityIntersector.ts` (812502980, 122 строки).
 *
 * Обёртка над `IntersectionObserver`, которая помнит последнее состояние
 * каждой цели и зовёт колбэк только на СМЕНЕ видимости: повторная запись с тем
 * же `isIntersecting` глушится (`:17-21`). Первый потребитель у нас —
 * `components/gifsMasonry.ts` (у tweb — через `LazyLoadQueueRepeat2.intersector`).
 *
 * Расхождения с оригиналом:
 *  1. Портирован объём единственного потребителя: `observe`/`unobserve`/
 *     `isVisible`/`disconnect`. Блокировка (`lock`/`unlock`/`unlockAndRefresh`,
 *     `locked` в колбэке, `:99-121`, `:12`) и пересборка (`refresh`/
 *     `refreshVisible`/`getVisible`/`clearVisible`, `:48-88`) нужны очередям
 *     ленты и дропдауна (`lazyLoadQueueIntersector.ts` `lock`/`refresh`), у нас
 *     их нет — придут с портом тех очередей.
 */
type TargetType = HTMLElement
export type OnVisibilityChangeItem = { target: TargetType, visible: boolean, entry: IntersectionObserverEntry, index: number }
export type OnVisibilityChange = (item: OnVisibilityChangeItem) => void

export default class VisibilityIntersector {
  private observer: IntersectionObserver
  private items: Map<TargetType, boolean> = new Map()

  constructor(onVisibilityChange: OnVisibilityChange, options?: IntersectionObserverInit) {
    this.observer = new IntersectionObserver((entries) => {
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

  public isVisible(target: TargetType) {
    return !!this.items.get(target)
  }

  public disconnect() {
    this.observer.disconnect()
    this.items.clear()
  }

  public observe(target: TargetType) {
    this.items.set(target, false)
    this.observer.observe(target)
  }

  public unobserve(target: TargetType) {
    this.observer.unobserve(target)
    this.items.delete(target)
  }
}
