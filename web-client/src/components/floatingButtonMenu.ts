// Порт tweb `src/components/floatingButtonMenu.ts:1-111` (812502980) — файлом.
//
// Плавающее меню второго уровня у пункта-триггера: по событию (`mouseenter` —
// подменю бургера и контекстных меню) строит меню `createMenu()`, кладёт в
// overlay-root, ставит рядом с триггером `positionFloatingMenu` и отдаёт
// `contextMenuController.addAdditionalMenu` — закрытие (уход курсора, клик мимо,
// закрытие корня) берёт контроллер. Подменю открывается, только пока открыт
// корень (`contextMenuController.isOpened()`), а уход курсора до готовности
// меню отменяет его (`hovered`/`requestId`).
//
// Расхождение с оригиналом:
//  1. Пятый аргумент `addAdditionalMenu(…, activatedWithKeyboard)` (фокус в
//     подменю при открытии с клавиатуры, tweb `:73`) не передаётся: клавиатурной
//     навигации меню (`menuKeyboard`, `focusTrap` в `contextMenuController`) у
//     нас нет — О-84 волны 7. Сам `onKeyDown` (ArrowRight/Enter/Space открывают
//     подменю, `:98-110`) перенесён.
import contextMenuController from '@helpers/contextMenuController'
import { getOverlayRoot } from '@helpers/appWindow'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import { type FloatingMenuDirection, positionFloatingMenu } from '@helpers/positionMenu'
import { doubleRaf } from '@helpers/schedulers'

export type FloatingButtonMenuDirection = FloatingMenuDirection

export type AttachFloatingButtonMenuOptions = {
  element: HTMLElement,
  triggerEvent: keyof HTMLElementEventMap,
  direction: FloatingButtonMenuDirection,
  level: number,
  offset?: [number, number],
  createMenu: () => HTMLElement | Promise<HTMLElement>,
  canOpen?: () => boolean,
  onClose?: () => void,
}

export default function attachFloatingButtonMenu({
  element,
  triggerEvent,
  direction,
  level,
  offset = [0, 0],
  createMenu,
  canOpen = () => true,
  onClose: onCloseArg,
}: AttachFloatingButtonMenuOptions) {
  let opened = false
  let hovered = false
  let requestId = 0

  const listener = (event?: Event): void => void (async() => {
    const activatedWithKeyboard = event?.type === 'keydown' ||
      (event?.type === 'click' && (event as MouseEvent).detail === 0)
    hovered = true
    if(opened || !canOpen()) return
    const currentRequestId = ++requestId

    const triggerBcr = element.getBoundingClientRect()

    let menu: HTMLElement | undefined
    try {
      menu = await createMenu()
    } catch{}

    if(
      !menu ||
      opened ||
      currentRequestId !== requestId ||
      (!hovered && !activatedWithKeyboard) ||
      !canOpen() ||
      !contextMenuController.isOpened()
    ) {
      return
    }

    opened = true

    const onClose = () => {
      opened = false
      onCloseArg?.()
    }

    getOverlayRoot().append(menu)

    positionFloatingMenu(triggerBcr, menu, direction, offset)

    await doubleRaf()
    if(currentRequestId !== requestId || !contextMenuController.isOpened()) {
      opened = false
      menu.remove()
      return
    }

    // расхождение 1: без `activatedWithKeyboard`
    contextMenuController.addAdditionalMenu(menu, element, level, onClose)
  })()

  const onMouseLeave = () => {
    hovered = false
    ++requestId
  }

  element.addEventListener(triggerEvent, listener)
  const detachActivation = triggerEvent === 'mouseenter' ?
    attachClickEvent(element, listener) :
    undefined
  if(triggerEvent === 'mouseenter') {
    element.addEventListener('mouseleave', onMouseLeave)
    element.addEventListener('keydown', onKeyDown)
  }

  return () => {
    ++requestId
    element.removeEventListener(triggerEvent, listener)
    element.removeEventListener('mouseleave', onMouseLeave)
    element.removeEventListener('keydown', onKeyDown)
    detachActivation?.()
  }

  function onKeyDown(e: KeyboardEvent) {
    if(e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    listener(e)
  }
}
