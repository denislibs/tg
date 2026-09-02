// Порт tweb `helpers/overlayClickHandler.ts` — база «оверлей, который сам себя
// закрывает по клику мимо». Наследники в tweb: `contextMenuController`
// (`new OverlayClickHandler('menu', true)`), тост и тултип (без оверлея,
// поэтому `capture: true`).
//
// Адаптации:
//   • `getOverlayRoot()` (боди активного окна Document PiP) → `document.body`:
//     Document PiP у нас нет — то же отступление уже записано в
//     `helpers/positionMenu.ts`. Резолв «реалма» из `element.ownerDocument`
//     (`realmDocument`/`realmWindow`) при этом СОХРАНЁН как в tweb: он не про
//     PiP, а про то, в каком документе живёт открытый узел, и его читает
//     `contextMenuController` (mousemove-слежка).
//   • `appNavigationController.pushItem({type, onPop}) / removeByType(type)` —
//     теперь ДОСЛОВНО (#108). Раньше на месте одной записи стояли два
//     механизма (`hotkeys.pushEsc` для клавиши + `navigationStack.pushLayer`
//     для Back), а `navigationType` был просто признаком «участвует в
//     навигации» — типом различать было нечего. Контроллер портирован, и тип
//     снова работает по назначению: `removeByType` снимает ИМЕННО свои записи,
//     не трогая чужие, что и нужно оверлею, который закрывают снаружи.
//   • строгий tsconfig: `element`/`overlay` честно `| undefined`.
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_MOBILE_SAFARI } from '@environment/userAgent'
import cancelEvent from '@helpers/dom/cancelEvent'
import { CLICK_EVENT_NAME, hasMouseMovedSinceDown } from '@helpers/dom/clickEvent'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import EventListenerBase from '@helpers/eventListenerBase'
import appNavigationController, { type NavigationItemType } from '@core/navigation/appNavigationController'

export default class OverlayClickHandler extends EventListenerBase<{
  toggle: (open: boolean) => void
}> {
  protected element?: HTMLElement
  protected overlay?: HTMLElement
  protected listenerOptions: AddEventListenerOptions
  // Реалм (документ/окно), в котором живёт открытый сейчас узел. По умолчанию
  // главный, переопределяется в `open()` из `element.ownerDocument`.
  protected realmDocument: Document = document
  protected realmWindow: Window & typeof globalThis = window

  constructor(
    protected navigationType?: NavigationItemType,
    protected withOverlay?: boolean,
  ) {
    super(false)
    this.listenerOptions = withOverlay ? {} : { capture: true }
  }

  protected onClick = (e: MouseEvent | TouchEvent) => {
    if(hasMouseMovedSinceDown(e)) {
      return
    }

    if(this.element) {
      const isRoot = this.element === this.element.ownerDocument.body
      if(!isRoot && findUpAsChild(e.target as HTMLElement, this.element)) {
        return
      }
    }

    if(this.listenerOptions?.capture) {
      cancelEvent(e)
    }

    this.close(e)
  }

  // `_e` база не читает — событие нужно наследнику (`ContextMenuController.close`
  // отсекает клик по самому `.btn-menu`); подчёркивание — под `noUnusedParameters`.
  public close(_e?: MouseEvent | TouchEvent) {
    if(this.element) {
      this.overlay?.remove()
      this.element = undefined
      this.dispatchEvent('toggle', false)
    }

    if(!IS_TOUCH_SUPPORTED) {
      this.realmWindow.removeEventListener('contextmenu', this.onClick as EventListener, this.listenerOptions)
    }

    this.realmDocument.removeEventListener(CLICK_EVENT_NAME, this.onClick as EventListener, this.listenerOptions)

    if(!IS_MOBILE_SAFARI && this.navigationType) {
      appNavigationController.removeByType(this.navigationType)
    }
  }

  public open(element: HTMLElement = document.body) {
    this.close()

    const doc = this.realmDocument = element.ownerDocument || document
    const win = this.realmWindow = (doc.defaultView as Window & typeof globalThis) || window

    if(!IS_MOBILE_SAFARI && this.navigationType) {
      appNavigationController.pushItem({
        type: this.navigationType,
        onPop: () => {
          this.close()
        },
      })
    }

    this.element = element

    // Оверлей пересоздаётся при смене документа — узел одного документа нельзя
    // переиспользовать в другом.
    if((!this.overlay || this.overlay.ownerDocument !== doc) && this.withOverlay) {
      this.overlay = doc.createElement('div')
      this.overlay.classList.add('btn-menu-overlay')

      // ! because this event must be canceled, and can't cancel on menu click (below)
      this.overlay.addEventListener(CLICK_EVENT_NAME, (e) => {
        cancelEvent(e)
        this.onClick(e as MouseEvent)
      })
    }

    const isRoot = this.element === doc.body
    if(this.overlay) {
      if(isRoot) {
        this.element.append(this.overlay)
      } else {
        this.element.parentElement?.insertBefore(this.overlay, this.element)
      }
    }

    if(!IS_TOUCH_SUPPORTED) {
      win.addEventListener('contextmenu', this.onClick as EventListener, { ...this.listenerOptions, once: true })
    }

    // ! safari iOS doesn't handle window click event on overlay, idk why
    doc.addEventListener(CLICK_EVENT_NAME, this.onClick as EventListener, this.listenerOptions)

    this.dispatchEvent('toggle', true)
  }
}
