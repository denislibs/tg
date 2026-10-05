// Порт tweb `src/components/chat/autocompleteHelper.ts` (812502980) 1:1 — база
// хелперов автокомплита строки ввода (упоминания, команды, эмодзи, стикеры,
// инлайн-боты): контейнер `div.autocomplete-helper.z-depth-1`, показ/скрытие
// классом `is-visible` через `SetTransition`, навигация стрелками
// (`attachListNavigation`) и запись в стеке навигации (Esc закрывает хелпер).
// Пачка П-6, Б-34. Стили — `styles/tweb/_autocompleteHelper.scss`.
import attachListNavigation, { type ListNavigationOptions } from '@helpers/dom/attachListNavigation'
import EventListenerBase from '@helpers/eventListenerBase'
import { IS_MOBILE } from '@environment/userAgent'
import appNavigationController, { type NavigationItem } from '@core/navigation/appNavigationController'
import { setTransition as SetTransition } from '@core/dom/setTransition'
import safeAssign from '@helpers/object/safeAssign'
import liteMode from '@helpers/liteMode'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import type AutocompleteHelperController from './autocompleteHelperController'

export default class AutocompleteHelper extends EventListenerBase<{
  hidden: () => void,
  visible: () => void,
  hiding: () => void,
}> {
  protected hidden = true
  public container: HTMLElement
  protected list!: HTMLElement
  protected resetTarget?: () => void
  protected attach?: () => void
  protected detach?: () => void
  // У tweb `init` — метод наследника, который после первого показа затирается `null`;
  // у нас наследники объявляют его полем-стрелкой (`public init = () => {…}`), а здесь
  // оно только `declare`: под `useDefineForClassFields` обычное объявление поля
  // определило бы его `undefined` на экземпляре.
  declare protected init?: (() => void) | null

  protected controller?: AutocompleteHelperController
  protected listType!: 'xy' | 'x' | 'y'
  protected onSelect!: ListNavigationOptions['onSelect']
  protected getNavigationList?: () => HTMLElement | undefined
  protected waitForKey?: string[]

  protected navigationItem?: NavigationItem

  // * helpers in this set are allowed to remain visible alongside this one
  public siblings: Set<AutocompleteHelper> = new Set()
  // * per-helper middleware so concurrent sibling helpers don't cancel each other
  private middlewareHelper: MiddlewareHelper = getMiddleware()

  constructor(options: {
    appendTo: HTMLElement,
    controller?: AutocompleteHelper['controller'],
    listType: AutocompleteHelper['listType'],
    onSelect: AutocompleteHelper['onSelect'],
    waitForKey?: AutocompleteHelper['waitForKey'],
    getNavigationList?: AutocompleteHelper['getNavigationList'],
  }) {
    super(false)

    safeAssign(this, options)

    this.container = document.createElement('div')
    this.container.classList.add('autocomplete-helper', 'z-depth-1')

    options.appendTo.append(this.container)

    this.attachNavigation()

    this.controller?.addHelper(this)
  }

  public getMiddleware() {
    this.middlewareHelper.clean()
    return this.middlewareHelper.get()
  }

  public addSibling(other: AutocompleteHelper) {
    this.siblings.add(other)
    other.siblings.add(this)
  }

  public toggleListNavigation(enabled: boolean) {
    if(enabled) {
      this.attach?.()
    } else {
      this.detach?.()
    }
  }

  protected onVisible = () => {
    this.detach?.() // it can be so because 'visible' calls before animation's end

    const list = this.list
    const { attach, detach, resetTarget } = attachListNavigation({
      list: this.getNavigationList?.() || list,
      type: this.listType,
      onSelect: this.onSelect,
      once: true,
      waitForKey: this.waitForKey,
    })

    this.attach = attach
    this.detach = detach
    this.resetTarget = resetTarget
    if(!IS_MOBILE && !this.navigationItem) {
      this.navigationItem = {
        type: 'autocomplete-helper',
        onPop: () => {
          this.navigationItem = undefined
          this.toggle(true)
        },
        noBlurOnPop: true,
      }

      appNavigationController.pushItem(this.navigationItem)
    }

    this.addEventListener('hidden', () => {
      this.resetTarget = undefined
      this.attach = undefined
      this.detach = undefined

      list.replaceChildren()
      detach()

      if(this.navigationItem) {
        appNavigationController.removeItem(this.navigationItem)
        this.navigationItem = undefined
      }
    }, { once: true })
  }

  protected attachNavigation() {
    this.addEventListener('visible', this.onVisible)
  }

  public toggle(hide?: boolean, fromController = false, skipAnimation?: boolean) {
    if(hide === undefined) {
      hide = this.container.classList.contains('is-visible') && !this.container.classList.contains('backwards')
    }

    // * Cancel any in-flight suggestion load whenever we're hiding — including the
    // * early-return paths below (not yet initialized, or already hidden). Otherwise a
    // * slow request resolves later and shows the panel for input that was already
    // * cleared, since both of those paths used to skip middlewareHelper.clean().
    if(hide) {
      this.middlewareHelper.clean()
    }

    if(this.init) {
      return
    }

    if(this.hidden === hide) {
      if(!hide) {
        this.dispatchEvent('visible') // reset target and listener
      }

      return
    }

    this.hidden = hide

    if(!hide) {
      if(this.controller) {
        // * preserve self + siblings so a sibling that's still loading isn't killed by us showing
        const preserve = new Set<AutocompleteHelper>([this])
        this.siblings.forEach((sibling) => preserve.add(sibling))
        this.controller.hideOtherHelpers(preserve)
      }

      this.dispatchEvent('visible') // fire it before so target will be set
    } else {
      if(this.navigationItem) {
        appNavigationController.removeItem(this.navigationItem)
        this.navigationItem = undefined
      }

      if(!fromController && this.controller) {
        this.controller.hideOtherHelpers()
      }

      this.detach?.() // force detach here
    }

    const useRafs = this.controller || hide ? 0 : 2

    if(hide) {
      this.dispatchEvent('hiding')
    }

    SetTransition({
      element: this.container,
      className: 'is-visible',
      forwards: !hide,
      duration: liteMode.isAvailable('animations') && !skipAnimation ? 300 : 0,
      onTransitionEnd: () => {
        if(this.hidden) this.dispatchEvent('hidden')
      },
      useRafs,
    })
  }
}
