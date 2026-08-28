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
//     у нас этой глобали нет; её работу (Esc и браузерный Back снимают верхний
//     слой) делают ДВА существующих механизма приложения: LIFO Esc-стек
//     `core/hotkeys.pushEsc` и слой Back-навигации
//     `core/navigation/navigationStack.pushLayer/removeLayer`. Ровно так уже
//     подключён медиавьювер (`components/mediaViewer/openMediaViewer.ts:57-72`).
//     Параметр конструктора остался `navigationType?: string` — как в tweb, он
//     значит «этот оверлей участвует в навигации»; строка-тип у нас нужна
//     только как признак и для читаемости вызова `super('menu', true)`.
//   • строгий tsconfig: `element`/`overlay` честно `| undefined`.
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_MOBILE_SAFARI } from '@environment/userAgent'
import cancelEvent from '@helpers/dom/cancelEvent'
import { CLICK_EVENT_NAME, hasMouseMovedSinceDown } from '@helpers/dom/clickEvent'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import EventListenerBase from '@helpers/eventListenerBase'
import { pushEsc } from '@core/hotkeys'
import { pushLayer, removeLayer, type Layer } from '@core/navigation/navigationStack'

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

  /** снятие Esc-обработчика и слоя Back — наш эквивалент `removeByType` */
  private unregisterEsc?: () => void
  private navigationLayer?: Layer

  constructor(
    protected navigationType?: string,
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
      this.unregisterEsc?.()
      this.unregisterEsc = undefined
      if(this.navigationLayer) removeLayer(this.navigationLayer) // после Back слой уже снят — no-op
      this.navigationLayer = undefined
    }
  }

  public open(element: HTMLElement = document.body) {
    this.close()

    const doc = this.realmDocument = element.ownerDocument || document
    const win = this.realmWindow = (doc.defaultView as Window & typeof globalThis) || window

    if(!IS_MOBILE_SAFARI && this.navigationType) {
      this.unregisterEsc = pushEsc(() => { this.close() })
      this.navigationLayer = pushLayer(() => { this.close() })
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
