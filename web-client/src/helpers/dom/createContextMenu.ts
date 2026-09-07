// Порт tweb `src/helpers/dom/createContextMenu.ts` — фабрика контекстного меню
// поверх уже портированных примитивов: `attachContextMenuListener` (правый клик /
// long-press), `ButtonMenu` (разметка `div.btn-menu`), `positionMenu` (от точки
// события) и `contextMenuController` (один открытый корень + оверлей).
//
// Существенное — ФИЛЬТР ПУНКТОВ: перед каждым открытием пункты прогоняются
// через свой `verify` (`filterAsync`, параллельно), и не прошедшие НЕ СОЗДАЮТСЯ
// вовсе — их нет в DOM меню. Так у tweb «нет права» означает «пункта нет», а не
// «пункт серый». Если не прошёл ни один — меню не открывается.
//
// Адаптации (каждая — из-за отсутствующей у нас подсистемы):
//   • `getOverlayRoot()` (`helpers/appWindow.ts`, боди окна Document PiP) →
//     `document.body`: Document PiP у нас нет (то же отступление — в
//     `helpers/positionMenu.ts`);
//   • `logger('createContextMenu')` — логгера-подсистемы нет; ошибка `onOpen`
//     по-прежнему гасит открытие через `onClose`, но не пишется в лог.
// Правки под строгий tsconfig: `element` объявлен `| undefined`, `target` из
// `findElement` — `| null`; проверки `'preventDefault' in e` оригинала (кросс-
// realm-безопасная «мышь ли это») сохранены как есть.
import ButtonMenu, { type ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import filterAsync from '@helpers/array/filterAsync'
import callbackify from '@helpers/callbackify'
import contextMenuController from '@helpers/contextMenuController'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type Middleware } from '@helpers/middleware'
import positionMenu from '@helpers/positionMenu'
import { attachContextMenuListener } from '@helpers/dom/attachContextMenuListener'
import { attachClickEvent } from '@helpers/dom/clickEvent'

export default function createContextMenu<T extends ButtonMenuItemOptionsVerifiable>({
  buttons,
  findElement,
  listenTo,
  appendTo,
  filterButtons,
  onOpen,
  onClose,
  onCloseAfter,
  onElementReady,
  onOpenBefore,
  listenerSetter: attachListenerSetter,
  middleware,
  listenForClick,
}: {
  buttons: T[],
  findElement?: (e: MouseEvent | TouchEvent) => HTMLElement | null,
  listenTo: HTMLElement,
  appendTo?: HTMLElement,
  filterButtons?: (buttons: T[]) => Promise<T[]>,
  onOpen?: (e: Event, target: HTMLElement) => unknown,
  onClose?: () => unknown,
  onCloseAfter?: () => unknown,
  onOpenBefore?: () => unknown,
  onElementReady?: (element: HTMLElement) => void,
  listenerSetter?: ListenerSetter,
  middleware?: Middleware,
  listenForClick?: boolean
}) {
  attachListenerSetter ??= new ListenerSetter()
  const listenerSetter = new ListenerSetter()
  const middlewareHelper = middleware ? middleware.create() : getMiddleware()
  let element: HTMLElement | undefined

  const open = (e: MouseEvent | TouchEvent) => {
    const target = findElement ? findElement(e) : listenTo
    if(!target) {
      return
    }

    let _element = element
    if('preventDefault' in e) e.preventDefault()
    if(_element && _element.classList.contains('active')) {
      return false
    }
    // tweb `:63` — `e.cancelBubble = true`; по спецификации DOM это ровно
    // `stopPropagation()`, а happy-dom отдаёт `cancelBubble` только геттером.
    if('stopPropagation' in e) e.stopPropagation()

    const r = async() => {
      try {
        await onOpen?.(e, target)
      } catch {
        onClose?.()
        return
      }

      const initResult = await init()
      if(!initResult) {
        onClose?.()
        return
      }

      target.classList.add('menu-open')

      _element = initResult.element
      const { cleanup, destroy } = initResult

      positionMenu(e, _element)
      contextMenuController.openBtnMenu(_element, () => {
        target.classList.remove('menu-open')
        onClose?.()
        cleanup()

        setTimeout(() => {
          onCloseAfter?.()
          destroy()
        }, 300)
      }, target)
    }

    void r()
  }

  attachContextMenuListener({
    element: listenTo,
    callback: open,
    listenerSetter: attachListenerSetter,
  })

  const cleanup = () => {
    listenerSetter.removeAll()
    middlewareHelper.clean()
  }

  const destroy = () => {
    cleanup()
    attachListenerSetter.removeAll()
  }

  const init = async() => {
    cleanup()

    buttons.forEach((button) => button.element = undefined)
    const f = filterButtons || ((buttons: T[]) => filterAsync(buttons, (button) => {
      return button?.verify ? callbackify(button.verify(), (result) => result ?? false) : true
    }))

    const filteredButtons = await f(buttons)
    if(!filteredButtons.length) {
      return
    }

    const _element = element = await ButtonMenu({
      buttons: filteredButtons,
      listenerSetter,
    })
    _element.classList.add('contextmenu')

    await onOpenBefore?.()
    onElementReady?.(_element)

    ;(appendTo ?? document.body).append(_element)

    return {
      element: _element,
      cleanup,
      destroy: () => {
        _element.remove()
      },
    }
  }

  if(middleware) {
    middleware.onDestroy(() => {
      destroy()
    })
  }

  if(listenForClick) {
    attachClickEvent(listenTo, open, { listenerSetter: attachListenerSetter })
  }

  return { element, destroy, open }
}
