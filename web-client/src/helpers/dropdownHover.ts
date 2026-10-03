// Порт tweb `helpers/dropdownHover.ts` (812502980, 310 строк) 1:1 — база выпадашек по
// наведению: клавиатура бота (`chat/replyKeyboard.ts`) и эмодзи-дропдаун
// (`emoticonsDropdown/index.ts`). Правки — только под строгий tsconfig (поля с `!`/`?`,
// `toElement` — нестандартное поле события).
import { attachClickEvent } from '@helpers/dom/clickEvent'
import { getAppWindow } from '@helpers/appWindow'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import EventListenerBase from '@helpers/eventListenerBase'
import type ListenerSetter from '@helpers/listenerSetter'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import safeAssign from '@helpers/object/safeAssign'
import appNavigationController, { type NavigationItem } from '@core/navigation/appNavigationController'
import findUpClassName from '@helpers/dom/findUpClassName'
import liteMode from '@helpers/liteMode'
import { getFocusableElements } from '@helpers/dom/focusTrap'
import ensureButtonSemantics from '@helpers/dom/ensureButtonSemantics'

const KEEP_OPEN = false
const TOGGLE_TIMEOUT = 200
const ANIMATION_DURATION = 200

export type IgnoreMouseOutType = 'click' | 'menu' | 'popup' | 'tooltip'
type DropdownHoverTimeoutType = 'toggle' | 'done'

export default class DropdownHover extends EventListenerBase<{
  open: () => Promise<unknown> | void,
  openAfterLayout: () => void,
  opened: () => unknown,
  close: () => unknown,
  closed: () => unknown
}> {
  protected element!: HTMLElement
  protected forceClose: boolean
  protected inited: boolean
  protected ignoreMouseOut: Set<IgnoreMouseOutType>
  protected ignoreButtons: Set<HTMLElement>
  protected navigationItem?: NavigationItem
  protected ignoreOutClickClassName?: string
  protected suppressOutClick?: boolean
  protected timeouts: { [type in DropdownHoverTimeoutType]?: number }
  protected detachClickEvent?: () => void
  private keyboardTrigger?: HTMLElement

  constructor(options: {
    element: DropdownHover['element'],
    ignoreOutClickClassName?: string
  }) {
    super(false)
    safeAssign(this, options)
    this.forceClose = false
    this.inited = false
    this.ignoreMouseOut = new Set()
    this.ignoreButtons = new Set()
    this.timeouts = {}
  }

  public attachButtonListener(
    button: HTMLElement,
    listenerSetter: ListenerSetter,
  ) {
    let firstTime = true
    ensureButtonSemantics(button)
    const popupRole = this.element.getAttribute('role') || 'dialog'
    this.element.setAttribute('role', popupRole)
    const label = button.getAttribute('aria-label') || button.textContent?.trim()
    if(label && !this.element.hasAttribute('aria-label')) this.element.setAttribute('aria-label', label)
    button.setAttribute('aria-haspopup', popupRole)
    button.setAttribute('aria-expanded', 'false')
    listenerSetter.add(this)('open', () => button.setAttribute('aria-expanded', 'true'))
    listenerSetter.add(this)('close', () => button.setAttribute('aria-expanded', 'false'))
    attachClickEvent(button, (event) => {
      this.keyboardTrigger = event.type === 'click' && event.detail === 0 ? button : undefined
      if(IS_TOUCH_SUPPORTED) {
        if(firstTime) {
          firstTime = false
          void this.toggle(true)
        } else {
          void this.toggle()
        }
      } else {
        this.onButtonClick(button, event)
      }
    }, { listenerSetter })
    if(!IS_TOUCH_SUPPORTED) {
      listenerSetter.add(button)('mouseover', () => {
        if(firstTime) {
          listenerSetter.add(button)('mouseout', (e: MouseEvent) => {
            this.clearTimeout('toggle')
            this.onMouseOut(e)
          })
          firstTime = false
        }

        this.setTimeout('toggle', () => {
          void this.toggle(true)
        }, TOGGLE_TIMEOUT)
      })
    }
  }

  public onButtonClick = (button?: HTMLElement, _e?: MouseEvent) => {
    const type: IgnoreMouseOutType = 'click'
    const ignore = !this.ignoreMouseOut.has(type)

    if(ignore && !this.ignoreMouseOut.size) {
      if(button) this.ignoreButtons.add(button)
      setTimeout(() => {
        // Click-outside-to-close on the active window — the dropdown opens in whichever window the app
        // is in (the tab, or the Document PiP window), so a main-`window` listener never sees the
        // outside click there and the panel won't dismiss. Same `w` for add + detach so they match.
        const w = getAppWindow()
        if(this.suppressOutClick) {
          const options: AddEventListenerOptions = { capture: true }
          w.addEventListener('mousedown', this.onMouseDownOut, options)
          w.addEventListener('click', this.onClickOut, options)
          this.detachClickEvent = () => {
            w.removeEventListener('mousedown', this.onMouseDownOut, options)
            w.removeEventListener('click', this.onClickOut, options)
          }
        } else {
          this.detachClickEvent = attachClickEvent(w, this.onClickOut, { capture: true })
        }
      }, 0)
    }

    this.setIgnoreMouseOut(type, ignore)
    void this.toggle(ignore)
  }

  protected isOutClickTarget(target: HTMLElement) {
    return !findUpAsChild(target, this.element) &&
      !Array.from(this.ignoreButtons).some((button) => findUpAsChild(target, button) || target === button) &&
      this.ignoreMouseOut.size <= 1 &&
      (!this.ignoreOutClickClassName || !findUpClassName(target, this.ignoreOutClickClassName))
  }

  protected onClickOut = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if(e.isTrusted && this.isOutClickTarget(target)) {
      if(this.suppressOutClick) {
        e.stopImmediatePropagation()
        e.preventDefault()
      }

      void this.toggle(false)
    }
  }

  // swallow the mousedown that precedes the out-click, otherwise handlers that
  // act on mousedown (e.g. the chat list opening a peer) fire before we close
  protected onMouseDownOut = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if(e.isTrusted && this.isOutClickTarget(target)) {
      e.stopImmediatePropagation()
      e.preventDefault()
    }
  }

  protected onMouseOut = (e: MouseEvent) => {
    if(KEEP_OPEN || !this.isActive()) return
    this.clearTimeout('toggle')

    if(this.ignoreMouseOut.size) {
      return
    }

    const toElement = (e as MouseEvent & { toElement?: HTMLElement }).toElement
    if(toElement && findUpAsChild(toElement, this.element)) {
      return
    }

    this.setTimeout('toggle', () => {
      void this.toggle(false)
    }, TOGGLE_TIMEOUT)
  }

  protected clearTimeout(type: DropdownHoverTimeoutType) {
    if(this.timeouts[type] !== undefined) {
      clearTimeout(this.timeouts[type])
      delete this.timeouts[type]
    }
  }

  protected setTimeout(type: DropdownHoverTimeoutType, cb: () => void, timeout: number) {
    this.clearTimeout(type)
    this.timeouts[type] = window.setTimeout(() => {
      this.clearTimeout(type)
      cb()
    }, timeout)
  }

  public init(): void {
    if(!IS_TOUCH_SUPPORTED) {
      this.element.onmouseout = this.onMouseOut
      this.element.onmouseover = () => {
        if(this.forceClose) {
          return
        }

        this.clearTimeout('toggle')
      }
    }
  }

  public toggle = async(enable?: boolean) => {
    const willBeActive = (!!this.element.style.display && enable === undefined) || enable
    // tweb `if(this.init)`: первый показ зовёт `init` и обнуляет его (одноразовый)
    if(this.init) {
      if(willBeActive) {
        this.init()
        ;(this as { init: (() => void) | null }).init = null
      } else {
        return
      }
    }

    if(!!willBeActive === this.isActive()) {
      return
    }

    const delay = IS_TOUCH_SUPPORTED || !liteMode.isAvailable('animations') ? 0 : ANIMATION_DURATION
    if((this.element.style.display && enable === undefined) || enable) {
      const res = this.dispatchResultableEvent('open')
      await Promise.all(res.map((r) => Promise.resolve(r)))

      this.element.style.display = ''
      void this.element.offsetLeft // reflow
      this.element.classList.add('active')
      if(this.keyboardTrigger) {
        this.element.ownerDocument.defaultView?.requestAnimationFrame(() => {
          if(this.isActive()) getFocusableElements(this.element)[0]?.focus()
        })
      }

      this.dispatchEvent('openAfterLayout')

      appNavigationController.pushItem(this.navigationItem = {
        type: 'dropdown',
        noBlurOnPop: true,
        onPop: () => {
          void this.toggle(false)
        },
      })

      this.clearTimeout('toggle')
      this.setTimeout('done', () => {
        this.forceClose = false
        this.dispatchEvent('opened')
      }, delay)
    } else {
      this.dispatchEvent('close')
      this.ignoreMouseOut.clear()
      this.ignoreButtons.clear()

      this.element.classList.remove('active')
      if(this.keyboardTrigger?.isConnected) this.keyboardTrigger.focus()
      this.keyboardTrigger = undefined

      if(this.navigationItem) appNavigationController.removeItem(this.navigationItem)
      this.detachClickEvent?.()
      this.detachClickEvent = undefined

      this.clearTimeout('toggle')
      this.setTimeout('done', () => {
        this.element.style.display = 'none'
        this.forceClose = false
        this.dispatchEvent('closed')
      }, delay)
    }
  }

  public isActive() {
    return this.element.classList.contains('active')
  }

  /**
   * The `active` class comes off when the closing animation starts, but the panel stays on
   * screen until it ends — anything that must not be seen happening has to wait for `closed`.
   */
  public isDisplayed() {
    return this.element.style.display !== 'none'
  }

  public setIgnoreMouseOut(type: IgnoreMouseOutType, ignore: boolean) {
    if(ignore) this.ignoreMouseOut.add(type)
    else this.ignoreMouseOut.delete(type)
  }
}
