// Порт tweb `src/components/createSubmenuTrigger.ts:1-114` (812502980) — файлом.
//
// Пункт меню, который раскрывает подменю по наведению: опции пункта для
// `ButtonMenu` (`keepOpen`, подпись с шевроном `arrowhead`) плюс `onOpen`/
// `onClose`, которые владелец меню зовёт на открытии и закрытии корня (бургер —
// `sidebarLeft/index.ts`, tweb `sidebarLeft/index.ts:849-857`). На
// открытии к узлу пункта цепляется `attachFloatingButtonMenu` (уровень 2,
// смещение `[-5, -5]`), а клик по самому пункту гасится в фазе захвата —
// меню не закрывается. После закрытия наведение 200 мс не открывает подменю
// заново (меню ещё уезжает).
//
// Расхождений с оригиналом нет. Подменю бургера «Ещё» — первый потребитель;
// `ChatContextMenu` (`components/chat/contextMenu.ts`) свои подменю пока
// строит без него (шапка того файла).
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import noop from '@helpers/noop'
import pause from '@helpers/schedulers/pause'
import { i18n } from '@lib/langPack'
import type { ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import attachFloatingButtonMenu, { type FloatingButtonMenuDirection } from '@components/floatingButtonMenu'
import Icon from '@components/icon'

let submenuHelperIdSeed = 0

export type CreateSubmenuArgs = {
  middleware: Middleware,
}

// `T` carries the menu-specific fields its owner puts on every one of its buttons
// (DialogsContextMenu's community mode, and the like) straight through to the result
type CreateSubmenuTriggerArgs<T> = {
  options: Pick<ButtonMenuItemOptionsVerifiable, 'text' | 'regularText' | 'icon' | 'verify' | 'separator' | 'separatorDown' | 'onClose'> & T,
  createSubmenu: (args: CreateSubmenuArgs) => HTMLElement | Promise<HTMLElement | undefined>,
  direction?: FloatingButtonMenuDirection,
}

export default function createSubmenuTrigger<T = object>({
  options,
  createSubmenu,
  direction = 'right-start',
}: CreateSubmenuTriggerArgs<T>) {
  let
    isDisabled = false,
    currentMiddleware: MiddlewareHelper | undefined,
    detachTriggerListeners: (() => void) | undefined

  const onOpen = () => {
    if(!menuBtnOptions.element) return
    // Menu item nodes are reused by several context-menu implementations.
    // Re-opening must replace the prior hover/keyboard listeners instead of
    // stacking another async submenu creator on the same trigger.
    detachTriggerListeners?.()
    currentMiddleware?.destroy()
    const middlewareHelper = currentMiddleware = getMiddleware()

    const stopPropagation = (e: Event) => {
      e.stopPropagation()
    }
    menuBtnOptions.element.addEventListener(CLICK_EVENT_NAME, stopPropagation, true)
    menuBtnOptions.element.classList.add('submenu-trigger')
    menuBtnOptions.element.setAttribute('aria-haspopup', 'menu')
    menuBtnOptions.element.setAttribute('aria-expanded', 'false')

    const detachFloatingMenu = attachFloatingButtonMenu({
      element: menuBtnOptions.element,
      direction,
      createMenu: async() => {
        const menu = await createSubmenu({ middleware: middlewareHelper.get() })
        // tweb отдаёт `undefined` протухшего прогона дальше — `attachFloatingButtonMenu`
        // сам его отбрасывает (`!menu`, :50); у нас это видно в типе
        menu?.classList.add('btn-menu-submenu')
        return menu!
      },
      offset: [-5, -5],
      level: 2,
      triggerEvent: 'mouseenter',
      canOpen: () => !isDisabled,
      onClose: onClose,
    })
    detachTriggerListeners = () => {
      menuBtnOptions.element?.removeEventListener(CLICK_EVENT_NAME, stopPropagation, true)
      detachFloatingMenu()
    }
  }

  const onClose = async() => {
    currentMiddleware?.destroy()
    // Prevents hover from triggering when the menu is closing
    isDisabled = true
    await pause(200)
    isDisabled = false
  }

  const menuBtnOptions: ButtonMenuItemOptionsVerifiable & T = {
    ...options,

    // * fix langpack
    get regularText() {
      const content = document.createElement('span')
      content.classList.add('submenu-label')
      const text = document.createElement('span')
      text.classList.add('submenu-label-text')
      text.append(options.regularText ?? i18n(options.text!))
      content.append(text, Icon('arrowhead'))
      return content
    },
    onClick: noop,
    keepOpen: true,
    onOpen,
    onClose: () => void onClose(),
    dispose: () => {
      detachTriggerListeners?.()
      detachTriggerListeners = undefined
      currentMiddleware?.destroy()
      currentMiddleware = undefined
    },
    id: submenuHelperIdSeed++,
  }

  delete menuBtnOptions.text

  return menuBtnOptions
}
