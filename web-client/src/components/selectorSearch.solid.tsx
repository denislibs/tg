/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/selectorSearch.tsx` (812502980) — шапка селектора
 * пиров: поле поиска и чипы выбранных над списком.
 *
 *   div.menu-horizontal-gradient-container.selector-search-gradient-container   ← gradient
 *   div.sidebar-left-section-container.selector-search-section-container        ← section.container
 *     div.sidebar-left-section.selector-search-section
 *       hr + div.sidebar-left-section-content
 *         div.selector-search-container > div.scrollable.scrollable-y
 *           div.selector-search > [div.selector-user…] + div.input-search.selector-search-input-container
 *
 * Эталон — дамп `docs/tweb/dom/dumps/14-left-30b-new-group-members-selected.json`.
 * Чип — `renderEntity` (`components/selectorEntity.ts`, порт
 * `SelectorSearch.renderEntity`, :332-414): он уже есть у глобального поиска и
 * здесь не дублируется.
 *
 * Расхождения с оригиналом:
 *  1. `managers` — опцией конструктора: его требует `renderEntity` (аватар и
 *     имя чипа объявляют пробел зеркала карточек, шапка `selectorEntity.ts`).
 *  2. `renderEntity` статикой класса не заводится (`static renderEntity`,
 *     :332) — это тот же экспорт `selectorEntity.ts`.
 *  3. Узел градиента — `Tabs.MenuGradient` вызовом функции с приведением к
 *     узлу, как `appSearchSuper.ts` (:1168) и оригинал (:89-93); Solid-корня
 *     у вызова нет — реактивных пропов у градиента тоже нет.
 */
import Section, { type SectionParts } from '@components/section.solid'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import Scrollable from '@components/scrollable'
import InputSearch from '@components/inputSearch'
import Tabs from '@components/tabs.solid'
import { observeResize } from '@components/resizeObserver'
import { renderEntity, type SelectorEntityManagers } from '@components/selectorEntity'
import findUpClassName from '@helpers/dom/findUpClassName'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import liteMode from '@helpers/liteMode'
import type { FocusDirection } from '@helpers/fastSmoothScroll'
import type { Middleware, MiddlewareHelper } from '@helpers/middleware'
import type { IconName } from '@core/tgico-icons'
import { isPeerId } from '@core/peers/peerId'

export default class SelectorSearch {
  public section: SectionParts
  public selectedContainer: HTMLElement
  public inputSearch: InputSearch
  public input: HTMLInputElement
  public gradient: HTMLElement
  private selectedScrollable: Scrollable
  private capturedRects?: Map<HTMLElement, DOMRect>
  private flipElements: Set<HTMLElement>
  private middlewareHelper: MiddlewareHelper
  private chipsMap: Map<string, HTMLElement>
  private managers: SelectorEntityManagers

  constructor(options: {
    middlewareHelper: MiddlewareHelper,
    managers: SelectorEntityManagers,
    multiSelect: boolean,
    onInput: () => void,
    onChipClick: (key: string | PeerId) => void
  }) {
    this.middlewareHelper = options.middlewareHelper
    this.managers = options.managers
    this.chipsMap = new Map()
    this.flipElements = new Set()

    // :41-52
    this.inputSearch = new InputSearch({
      placeholder: 'Search',
      onChange: options.onInput,
      debounceTime: 200,
      noBorder: true,
      noFocusEffect: true,
      noPlaceholderAnimation: true,
    })
    this.input = this.inputSearch.input
    this.inputSearch.container.classList.add('selector-search-input-container')
    this.input.classList.add('selector-search-input')
    this.inputSearch.clearBtn.remove()

    // :54-65
    const topContainer = document.createElement('div')
    topContainer.classList.add('selector-search-container')

    this.selectedContainer = document.createElement('div')
    this.selectedContainer.classList.add('selector-search')

    this.selectedContainer.append(this.inputSearch.container)
    this.flipElements.add(this.inputSearch.container)
    topContainer.append(this.selectedContainer)
    this.selectedScrollable = new Scrollable(topContainer)

    this.setupHeightAnimation()

    // :67-74
    if(options.multiSelect) attachClickEvent(this.selectedContainer, (e) => {
      const target = findUpClassName(e.target as HTMLElement, 'selector-user')
      if(!target) return
      const keyStr = target.dataset.key!
      const key: string | PeerId = isPeerId(keyStr) ? +keyStr : keyStr
      options.onChipClick(key)
    })

    // :76-94
    let content!: HTMLElement
    const container = wrapSolidComponent(() => (
      <Section
        class="selector-search-section-container"
        innerClass="selector-search-section"
        contentProps={{ ref: (element) => content = element }}
      >
        {topContainer}
      </Section>
    ), this.middlewareHelper.get())

    this.section = { container, content }

    this.gradient = Tabs.MenuGradient({
      color: 'background',
      className: 'selector-search-gradient',
      smaller: true,
    }) as HTMLElement
  }

  // :96-132
  private setupHeightAnimation() {
    if(!liteMode.isAvailable('animations')) return

    let prevHeight = 0
    let isAnimating = false
    const el = this.selectedContainer
    const unobserve = observeResize(el, () => {
      if(isAnimating) return

      el.style.height = ''
      const targetHeight = el.clientHeight
      if(!prevHeight || targetHeight === prevHeight) {
        prevHeight = targetHeight
        return
      }

      if(!targetHeight) {
        prevHeight = targetHeight
        return
      }

      isAnimating = true
      el.style.height = prevHeight + 'px'
      void el.offsetHeight
      el.style.height = targetHeight + 'px'
      prevHeight = targetHeight
    })

    el.addEventListener('transitionend', (e) => {
      if(e.target === el && e.propertyName === 'height') {
        isAnimating = false
        el.style.height = ''
      }
    })

    this.middlewareHelper.get().onDestroy(unobserve)
  }

  // :134-142
  private captureChildRects(exclude?: HTMLElement) {
    if(!liteMode.isAvailable('animations')) return
    this.capturedRects = new Map()
    for(const el of this.flipElements) {
      if(el !== exclude) {
        this.capturedRects.set(el, el.getBoundingClientRect())
      }
    }
  }

  // :144-171
  private animateChildrenFlip(exclude?: HTMLElement) {
    const rects = this.capturedRects
    if(!rects) return
    this.capturedRects = undefined

    const toAnimate: HTMLElement[] = []
    for(const [el, prevRect] of rects) {
      if(el === exclude) {
        continue
      }

      const newRect = el.getBoundingClientRect()
      const dx = prevRect.left - newRect.left
      const dy = prevRect.top - newRect.top
      if(!dx && !dy) continue

      el.style.transition = 'none'
      el.style.transform = `translate(${dx}px, ${dy}px)`
      toAnimate.push(el)
    }

    if(!toAnimate.length) return
    void this.selectedContainer.offsetHeight
    for(const el of toAnimate) {
      el.style.transition = ''
      el.style.transform = ''
    }
  }

  // :173-241
  public addChip({
    key,
    middleware,
    title,
    scroll = true,
    avatarSize = 30,
    fallbackIcon,
    primary,
  }: {
    key: PeerId | string,
    middleware: Middleware,
    title?: string | HTMLElement,
    scroll?: boolean,
    avatarSize?: number,
    fallbackIcon?: IconName,
    primary?: boolean
  }) {
    const rendered = renderEntity({
      key,
      middleware,
      managers: this.managers,
      title,
      avatarSize,
      fallbackIcon,
      primary,
    })
    const { element, promises } = rendered

    const keyStr = '' + key
    this.chipsMap.set(keyStr, element)

    const insert = () => {
      if(this.chipsMap.get(keyStr) !== element) {
        return
      }

      if(scroll) {
        element.classList.add('scale-in')
        element.addEventListener('animationend', () => {
          element.classList.remove('scale-in')
        }, { once: true })
      }

      const prevLast = this.inputSearch.container.previousElementSibling as HTMLElement | null
      if(prevLast?.classList.contains('selector-user')) {
        prevLast.classList.remove('is-last')
      }
      element.classList.add('is-last')

      this.captureChildRects()
      this.flipElements.add(element)
      this.inputSearch.container.before(element)
      this.animateChildrenFlip()

      if(scroll) {
        void this.selectedScrollable.scrollIntoViewNew({
          element: this.inputSearch.container,
          position: 'center',
        })
      }
    }

    if(promises.length) {
      void Promise.all(promises).then(insert)
    } else {
      insert()
    }

    return rendered
  }

  // :243-310
  public removeChip(key: PeerId | string, onRemoved?: () => void) {
    const keyStr = '' + key
    const div = this.chipsMap.get(keyStr)
    const cleanup = () => {
      if(div) {
        div.remove()
        div.middlewareHelper!.destroy()
      }

      onRemoved?.()
    }

    this.chipsMap.delete(keyStr)
    if(div) this.flipElements.delete(div)

    if(!div?.parentElement) {
      cleanup()
      return
    }

    const animate = liteMode.isAvailable('animations')
    const wasLast = div.classList.contains('is-last')

    if(animate) {
      this.captureChildRects(div)
      const chipRect = div.getBoundingClientRect()
      const containerRect = this.selectedContainer.getBoundingClientRect()
      const scrollEl = this.selectedScrollable.container
      const scrollBefore = scrollEl.scrollTop

      // Take chip out of flex flow so layout reflows immediately
      div.classList.remove('scale-in', 'is-last')
      div.style.position = 'absolute'
      div.style.left = (chipRect.left - containerRect.left) + 'px'

      const initialTop = chipRect.top - containerRect.top
      const scrollDelta = scrollBefore - scrollEl.scrollTop

      if(scrollDelta) {
        // Start at old visual position (compensated), then smoothly
        // transition to the new position — matching the FLIP animation of neighbors
        div.style.top = (initialTop - scrollDelta) + 'px'
        void div.offsetHeight
        div.style.transition = 'top .15s ease'
        div.style.top = initialTop + 'px'
      } else {
        div.style.top = initialTop + 'px'
      }
    } else {
      div.classList.remove('scale-in')
      cleanup()
    }

    if(wasLast) {
      const newLast = (animate ? div : this.inputSearch.container).previousElementSibling as HTMLElement | null
      if(newLast?.classList.contains('selector-user')) {
        newLast.classList.add('is-last')
      }
    }

    if(animate) {
      void div.offsetWidth
      div.classList.add('scale-out')
      this.animateChildrenFlip()

      div.addEventListener('animationend', cleanup, { once: true })
    }
  }

  // :312-314
  public clearInput() {
    this.inputSearch.value = ''
  }

  // :316-318
  public get value() {
    return this.inputSearch.value
  }

  // :320-326
  public scrollToInput(forceDirection?: FocusDirection) {
    void this.selectedScrollable.scrollIntoViewNew({
      element: this.inputSearch.container,
      position: 'center',
      forceDirection,
    })
  }

  // :328-330
  public destroy() {
    this.inputSearch.remove()
  }
}
