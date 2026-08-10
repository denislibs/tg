// Порт tweb `components/stickyIntersector.ts` — 1:1 по логике; правки только
// под наш tsconfig, под наш oxlint и там, где у нас физически нет зависимости.
//
// Отличия от tweb:
//   • форматирование (без `;`, отступ пробелами в `{ }` литералах объектов) —
//     под `.oxlintrc.json` этого репозитория, чинится `oxlint --fix`; логика
//     не менялась ни на строку;
//   • `strictNullChecks` у нас включён (tweb в своём tsconfig явно его
//     выключает — см. TWEB/tsconfig.json), поэтому в колбэках наблюдателей
//     добавлены `!`: rootBounds/target.parentElement у наблюдателя с явно
//     заданным root-контейнером не бывают null в рантайме (sentinel всегда
//     внутри своего контейнера);
//   • `IntersectionObserver` в happy-dom (наши тесты) отсутствует — как и в
//     `components/animationIntersector.ts`, наблюдатели создаются мягко:
//     без глобального IO конструктор не падает, а `observe`/`disconnect`
//     просто ничего не делают (`?.`), только сентинел-нода в DOM остаётся
//     настоящей (её создание не зависит от IO).

export type StickyIntersectorOptions = {
  rootMargin?: string
}

export default class StickyIntersector {
  private headersObserver: IntersectionObserver | undefined
  private elementsObserver: IntersectionObserver | undefined
  private observed = new Map<HTMLElement, HTMLElement>() // sticky-target element → its top sentinel
  private rootMargin: string | undefined

  constructor(
    private container: HTMLElement,
    private handler: (stuck: boolean, target: HTMLElement) => void,
    options?: StickyIntersectorOptions,
  ) {
    this.rootMargin = options?.rootMargin
    this.createObservers()
  }

  private createObservers() {
    if(typeof IntersectionObserver === 'undefined') {
      return
    }

    this.headersObserver = new IntersectionObserver((entries) => {
      for(const entry of entries) {
        const targetInfo = entry.boundingClientRect
        const stickyTarget = entry.target.parentElement!
        const rootBoundsInfo = entry.rootBounds!

        // Stuck while the sentinel sits above the root's top edge. Otherwise the
        // section is either in view or scrolled past below — both mean not stuck.
        this.handler(targetInfo.bottom < rootBoundsInfo.top, stickyTarget)
      }
    }, { threshold: 0, root: this.container, rootMargin: this.rootMargin })

    this.elementsObserver = new IntersectionObserver((entries) => {
      // A section is "stuck" while it straddles the root's top edge. Containers
      // have real height, so unlike thin sentinels the observer can't skip their
      // intersection transitions on fast scrolls — this serves as a backup that
      // clears state when headersObserver missed a sentinel crossing.
      for(const entry of entries) {
        const stuck = entry.isIntersecting && entry.boundingClientRect.top < entry.rootBounds!.top
        this.handler(stuck, entry.target as HTMLElement)
      }
    }, { root: this.container, rootMargin: this.rootMargin })
  }

  public setRootMargin(rootMargin: string | undefined) {
    if(this.rootMargin === rootMargin) return
    this.rootMargin = rootMargin
    this.headersObserver?.disconnect()
    this.elementsObserver?.disconnect()
    this.createObservers()
    for(const [element, sentinel] of this.observed) {
      this.headersObserver?.observe(sentinel)
      this.elementsObserver?.observe(element)
    }
  }

  /**
   * @param {!Element} container
   * @param {string} className
   */
  private addSentinel(container: HTMLElement, className: string) {
    const sentinel = document.createElement('div')
    sentinel.classList.add('sticky_sentinel', className)
    return container.appendChild(sentinel)
  }

  /**
   * Notifies when elements w/ the `sticky` class begin to stick or stop sticking.
   * Note: the elements should be children of `container`.
   * @param {!Element} container
   */
  public observeStickyHeaderChanges(element: HTMLElement) {
    const headerSentinel = this.addSentinel(element, 'sticky_sentinel--top')
    this.observed.set(element, headerSentinel)
    this.headersObserver?.observe(headerSentinel)
    this.elementsObserver?.observe(element)
  }

  public disconnect() {
    this.headersObserver?.disconnect()
    this.elementsObserver?.disconnect()
    this.observed.clear()
  }

  public unobserve(element: HTMLElement, headerSentinel?: HTMLElement) {
    this.elementsObserver?.unobserve(element)
    const sentinel = this.observed.get(element) ?? headerSentinel
    if(sentinel) {
      this.headersObserver?.unobserve(sentinel)
    }
    this.observed.delete(element)
  }
}
