// Порт tweb `helpers/dom/attachContextMenuListener.ts` — 1:1.
//
// Единая точка «покажи контекстное меню»: на десктопе это правый клик
// (`contextmenu`), на Apple-таче (где событие `contextmenu` отменить нельзя) и
// всегда, когда переданы `listenerOptions`, — long-press на 400 мс с отменой по
// `touchmove`/`touchend`/`touchcancel` и вторым пальцем.
//
// `cancelContextMenuOpening()` — глобальный «не открывать 400 мс»: его зовут
// жесты, которые уже отработали касание (свайп по баблу, реакция), чтобы
// долгое нажатие не выстрелило меню следом.
//
// Отступлений от tweb нет; закомментированный черновик (`if(!isSafari)` с
// подавлением `contextmenu`, :78-82) не перенесён.
// Правки под строгий tsconfig (в tweb `strict` выключен): `timeout` объявлен с
// `= 0` (иначе TS2454 на `clearTimeout(timeout)` из `onCancel`), а `add`/`remove`
// получают колбэки через узкие касты вместо `@ts-ignore` оригинала.
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_APPLE } from '@environment/userAgent'
import contextMenuController from '@helpers/contextMenuController'
import ListenerSetter, { type ListenerOptions } from '@helpers/listenerSetter'
import cancelEvent from '@helpers/dom/cancelEvent'

let _cancelContextMenuOpening = false, _cancelContextMenuOpeningTimeout = 0
export function cancelContextMenuOpening() {
  if(_cancelContextMenuOpeningTimeout) {
    clearTimeout(_cancelContextMenuOpeningTimeout)
  }

  _cancelContextMenuOpeningTimeout = window.setTimeout(() => {
    _cancelContextMenuOpeningTimeout = 0
    _cancelContextMenuOpening = false
  }, .4e3)

  _cancelContextMenuOpening = true
}

export function attachContextMenuListener({
  element,
  callback,
  listenerSetter,
  listenerOptions,
}: {
  element: HTMLElement,
  callback: (e: TouchEvent | MouseEvent) => void,
  listenerSetter?: ListenerSetter,
  listenerOptions?: ListenerOptions
}) {
  const add = listenerSetter ? listenerSetter.add(element) : element.addEventListener.bind(element)
  const remove = listenerSetter ? listenerSetter.removeManual.bind(listenerSetter, element) : element.removeEventListener.bind(element)

  // can't cancel further events coming after 'contextmenu' event
  if((IS_APPLE && IS_TOUCH_SUPPORTED) || listenerOptions) {
    let timeout = 0

    const options: EventListenerOptions = {
      ...(listenerOptions || {}),
      capture: true,
    }

    const onCancel = () => {
      clearTimeout(timeout)
      remove('touchmove', onCancel as EventListener, options)
      remove('touchend', onCancel as EventListener, options)
      remove('touchcancel', onCancel as EventListener, options)
    }

    add('touchstart', ((e: TouchEvent) => {
      if(e.touches.length > 1) {
        onCancel()
        return
      }

      add('touchmove', onCancel as EventListener, options)
      add('touchend', onCancel as EventListener, options)
      add('touchcancel', onCancel as EventListener, options)

      timeout = window.setTimeout(() => {
        if(_cancelContextMenuOpening) {
          onCancel()
          return
        }

        callback(e)
        onCancel()

        if(contextMenuController.isOpened()) {
          add('touchend', cancelEvent as EventListener, { once: true }) // * fix instant closing
        }
      }, .4e3)
    }) as EventListener, listenerOptions)
  } else {
    add('contextmenu', (IS_TOUCH_SUPPORTED ? ((e: TouchEvent | MouseEvent) => {
      callback(e)

      if(contextMenuController.isOpened()) {
        add('touchend', cancelEvent as EventListener, { once: true }) // * fix instant closing
      }
    }) : callback) as EventListener, listenerOptions)
  }
}
