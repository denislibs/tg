// Порт tweb `src/components/buttonMenuToggle.ts:1-189` — файлом.
//
// Кнопка (или готовый контейнер), по клику открывающая `ButtonMenu`: меню
// строится ЗАНОВО на каждое открытие из текущих опций (пункты с `verify`
// отсеиваются), монтируется в overlay-root, позиционируется от триггера
// `positionMenuTrigger` и открывается `contextMenuController.openBtnMenu` —
// то есть всё закрытие (клик мимо, увод курсора, ресайз, пункт меню) берёт
// портированный контроллер, своего здесь нет. Через 300 мс после закрытия
// (уход transition) узел снимается из DOM, а `element`/`textElement` опций
// обнуляются — так следующее открытие видит правки опций (иконку-галочку
// `ChatTypeMenu`, перевод).
//
// Все зависимости уже портированы: `contextMenuController`, `positionMenu`
// (`positionMenuTrigger`, тип `ButtonMenuDirection` вынесен туда — см. его
// шапку; здесь реэкспорт, как у оригинала `:60`), `callbackify`, `filterAsync`,
// `ListenerSetter`, `doubleRaf`, `getFullScreenElement`, `ButtonIcon`.
//
// Расхождения с оригиналом:
//  1. `getOverlayRoot()` (боди активного окна Document PiP, `:154`) →
//     `document.body`: Document PiP у нас нет — та же адаптация, что в
//     `helpers/overlayClickHandler.ts` и `helpers/positionMenu.ts`.
//  2. Неиспользуемый импорт `findUpClassName` оригинала (`:10`) не перенесён.
import contextMenuController from '@helpers/contextMenuController'
import cancelEvent from '@helpers/dom/cancelEvent'
import { type AttachClickOptions, CLICK_EVENT_NAME, hasMouseMovedSinceDown } from '@helpers/dom/clickEvent'
import ListenerSetter from '@helpers/listenerSetter'
import ButtonIcon from '@components/buttonIcon'
import ButtonMenu, { type ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import filterAsync from '@helpers/array/filterAsync'
import { doubleRaf } from '@helpers/schedulers'
import callbackify from '@helpers/callbackify'
import { type ButtonMenuDirection, type MenuPositionPadding, positionMenuTrigger } from '@helpers/positionMenu'
import { getFullScreenElement } from '@helpers/dom/fullScreen'

export type { ButtonMenuDirection }

// tweb :15 — TODO оригинала: «refactor for attachClickEvent, because if move
// finger after touchstart, it will start anyway»
export function ButtonMenuToggleHandler({
  el,
  onOpen,
  options,
  onClose,
}: {
  el: HTMLElement,
  onOpen?: (e: Event) => HTMLElement | void | Promise<HTMLElement | void>,
  options?: AttachClickOptions,
  onClose?: () => void,
}) {
  const add = options?.listenerSetter ? options.listenerSetter.add(el) : el.addEventListener.bind(el)

  add(CLICK_EVENT_NAME, (e: Event) => {
    if(!el.classList.contains('btn-menu-toggle') || hasMouseMovedSinceDown(e)) return false

    cancelEvent(e)

    if(el.classList.contains('menu-open')) {
      if(e.target && (e.target as HTMLElement).classList.contains('btn-menu')) {
        return
      }

      contextMenuController.close()
    } else {
      const result = onOpen?.(e)
      const open = (element?: HTMLElement | void) => {
        const openedMenu = element ?? el.querySelector<HTMLElement>('.btn-menu')
        if(!openedMenu) {
          return
        }

        contextMenuController.openBtnMenu(openedMenu, onClose, el)
      }

      void callbackify(result, open)
    }
  })
}

export function filterButtonMenuItems(buttons: ButtonMenuItemOptionsVerifiable[]) {
  return filterAsync(buttons, (button) => button?.verify ? button.verify() ?? false : true)
}

export default function ButtonMenuToggle({
  buttonOptions,
  listenerSetter: attachListenerSetter,
  container,
  direction,
  buttons,
  onOpenBefore,
  onOpen,
  onClose,
  onCloseAfter,
  noIcon,
  icon = 'more',
  appendTo,
  positionPadding,
}: {
  buttonOptions?: Parameters<typeof ButtonIcon>[1],
  listenerSetter?: ListenerSetter,
  container?: HTMLElement,
  appendTo?: HTMLElement,
  direction: ButtonMenuDirection,
  buttons: ButtonMenuItemOptionsVerifiable[],
  onOpenBefore?: (e: Event) => unknown,
  onOpen?: (e: Event, element: HTMLElement) => unknown,
  onClose?: () => void,
  onCloseAfter?: () => void,
  noIcon?: boolean,
  /** первое слово — глиф, хвост — классы кнопки (`ButtonIcon`) */
  icon?: string,
  positionPadding?: MenuPositionPadding,
}) {
  if(buttonOptions) {
    buttonOptions.asDiv = true
  }

  const button = container ?? ButtonIcon(noIcon ? undefined : icon, buttonOptions)
  const autoPosition = !appendTo
  button.classList.add('btn-menu-toggle')

  const listenerSetter = new ListenerSetter()

  const clearCloseTimeout = () => {
    clearTimeout(closeTimeout)
    closeTimeout = undefined
  }

  // * fix translation by deleting text elements on close
  const canDeleteTextElementsOnClose = buttons.filter((button) => !button.textElement)
  const previousButtons = buttons.slice()

  let element: HTMLElement | undefined, closeTimeout: number | undefined, tempId = 0
  ButtonMenuToggleHandler({
    el: button,
    onOpen: async(e) => {
      const _tempId = ++tempId
      await onOpenBefore?.(e)
      if(_tempId !== tempId) return
      if(closeTimeout) {
        clearCloseTimeout()
        if(element?.isConnected) {
          return element
        }
      }

      const filteredButtons = await filterButtonMenuItems(buttons)
      if(_tempId !== tempId) return
      if(!filteredButtons.length) {
        return
      }

      const newButtons = filteredButtons.slice().filter((button) => !previousButtons.includes(button))
      previousButtons.push(...newButtons)
      canDeleteTextElementsOnClose.push(...newButtons.filter((button) => !button.textElement))

      const _element = element = await ButtonMenu({
        buttons: filteredButtons,
        listenerSetter,
      })
      if(_tempId !== tempId) return
      _element.classList.add(direction)
      if(direction === 'bottom-center') {
        _element.style.setProperty('--parent-half-width', ((container ?? button).clientWidth / 2) + 'px')
      }

      await onOpen?.(e, _element)
      if(_tempId !== tempId) return

      // tweb :147-151: при полноэкранном элементе браузер рисует ТОЛЬКО его
      // поддерево (top layer), поэтому меню триггера оттуда монтируется внутрь
      // него, иначе — в overlay-root (расхождение 1)
      const fullScreenElement = getFullScreenElement()
      const mountTarget = appendTo ??
        (fullScreenElement?.contains(button) ? fullScreenElement : document.body)
      mountTarget.append(_element)
      if(autoPosition) {
        positionMenuTrigger(button, _element, direction, positionPadding ?? { top: 8, bottom: 8 })
      }
      await doubleRaf()
      if(_tempId !== tempId) {
        _element.remove()
      }

      return _element
    },
    options: {
      listenerSetter: attachListenerSetter,
    },
    onClose: () => {
      ++tempId
      clearCloseTimeout()
      onClose?.()

      closeTimeout = window.setTimeout(() => {
        onCloseAfter?.()
        closeTimeout = undefined
        listenerSetter.removeAll()
        buttons.forEach((button) => {
          // tweb :216 — аватарка пункта (`avatarInfo`) и слушатели подменю
          // (`createSubmenuTrigger`) гаснут вместе с меню
          try { button.dispose?.() } catch {}
          button.element = undefined
        })
        canDeleteTextElementsOnClose.forEach((button) => delete button.textElement)
        element?.remove()
      }, 300)
    },
  })

  return button
}
