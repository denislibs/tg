// Порт tweb `components/buttonMenu.ts` — конструктор разметки меню:
// `div.btn-menu` с пунктами `div.btn-menu-item.rp-overflow`. Все классы,
// геометрия, ховер, `scale(.96)` на нажатии и красный `.danger` приходят из уже
// портированного `styles/tweb/_button.scss` — своих стилей у модуля нет.
//
// Клик по пункту (tweb :154-188): пункт неактивного меню игнорируется,
// `checkForClose() === false` отменяет закрытие, иначе — `contextMenuController.close()`
// (кроме `keepOpen`).
//
// НЕ портировано (каждый пункт — из-за отсутствующей в проекте подсистемы):
//   • `ripple(el)` под `IS_MOBILE` (tweb :89-91) — ванильного `components/ripple.ts`
//     у нас нет (в tweb он на solid-js); класс-клип `rp-overflow` при этом стоит
//     на пункте безусловно, как в оригинале;
//   • `checkboxField` / `noCheckboxClickListener` / `radioGroup` / `radioGroups`
//     (`ButtonMenuSync` :226-232, :250-277) — `CheckboxField` и `RadioForm` не
//     портированы; вместе с ними ушла ветка `keepOpen = !!checkboxField`
//     (осталась `!!options.keepOpen`) и класс `has-checkbox`;
//   • `iconDoc` (`wrapAttachBotIcon`) — иконок attach-ботов в проекте нет
//     (боты меню вложений — О-80 волны 7);
//   • `new` (бейдж `span.btn-menu-item-badge`, tweb :178-183) — его ставят
//     только пункты attach-ботов бургера (`side_menu_disclaimer_needed`), а их
//     нет (О-80);
//   • `waitForAnimation` — мёртвое уже в tweb: читается только внутри
//     закомментированного черновика;
//   • `inner` (`has-inner` + `Icon('next')`) — потребителей нет.
//
// Поля-проводники `id` / `onOpen` / `onClose` / `dispose` сам этот файл не
// читает (кроме `dispose`, который пишет ветка `avatarInfo`): их читают
// владельцы меню — `createSubmenuTrigger`, бургер (`sidebarLeft/index.ts`)
// и уборка `ButtonMenuToggle` (`dispose`).
//
// `avatarInfo` (tweb :163-176, `AvatarNew` под `createRoot`) — наша ванильная
// аватарка `avatarNew` (`components/avatar.ts`) под своей мидлварью; `dispose`
// гасит её. Расхождение: менеджеры аватарке передаются явно (`managers` в
// `AvatarInfo`) — глобального `rootScope.managers` у нас нет; `accountNumber`
// оригинала не нужен — другой аккаунт приходит готовой карточкой `peer`
// (Отступление В7-4 волны 7).
import flatten from '@helpers/array/flatten'
import contextMenuController from '@helpers/contextMenuController'
import cancelEvent from '@helpers/dom/cancelEvent'
import { type AttachClickOptions, attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import setInnerHTML from '@helpers/dom/setInnerHTML'
import type ListenerSetter from '@helpers/listenerSetter'
import Icon from '@components/icon'
import { putPreloader } from '@components/putPreloader'
import type { IconName } from '@core/tgico-icons'
import { i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import { avatarNew, type AvatarManagers } from '@components/avatar'
import { getMiddleware } from '@helpers/middleware'
import type { Chat, User } from '@core/peers/peer'

// tweb :26-31
type AvatarInfo = {
  peerId?: PeerId,
  peer?: Chat | User,
  active?: boolean,
  managers: AvatarManagers,
}

export type ButtonMenuItemOptions = {
  id?: unknown,
  /** имя глифа; хвост после первого слова уезжает в className пункта
   *  (tweb: `icon: 'delete danger-cls'` кладёт `danger-cls` на пункт) */
  icon?: string,
  iconElement?: HTMLElement,
  emptyIcon?: boolean,
  avatarInfo?: AvatarInfo,
  danger?: boolean,
  className?: string,
  /**
   * КЛЮЧ, а не готовая строка (tweb :38) — переводит сам пункт меню.
   *
   * До задачи 7 здесь стояла «уже переведённая строка», ОБРАТНО тому, как
   * устроены `Button`/`Row`/`SettingSection`/`SliderSuperTab.setTitle`/
   * `toastNew`. По сигнатуре (`text?: string` против `text: LangPackKey`) одно
   * от другого не отличалось, и волна 2 на этом посадила боевой дефект: сырой
   * `'Terminate'` в контекстном меню вкладки «Устройства». Роль поля теперь
   * выражена ТИПОМ: ключ — сюда, готовое содержимое — в `regularText`.
   */
  text?: LangPackKey,
  textArgs?: FormatterArguments,
  /** ГОТОВОЕ содержимое (узел или строка) — то, что переводом не является
   *  вовсе: имя пира, эмодзи-набор, отформатированное число (tweb :40). */
  regularText?: Parameters<typeof setInnerHTML>[1],
  /** результат не читается (в tweb тип возврата `any`; `void` в TS принимает
   *  любой возврат, включая `Promise` асинхронных обработчиков) */
  onClick: (e: MouseEvent | TouchEvent) => void,
  checkForClose?: () => boolean,
  element?: HTMLElement,
  textElement?: HTMLElement,
  options?: AttachClickOptions,
  keepOpen?: boolean,
  separator?: boolean | HTMLElement,
  separatorDown?: boolean,
  multiline?: boolean,
  secondary?: boolean,
  loadPromise?: Promise<unknown>,
  dispose?: () => void,
  onOpen?: () => void,
  onClose?: () => void,
}

export type ButtonMenuItemOptionsVerifiable = ButtonMenuItemOptions & {
  verify?: () => boolean | Promise<boolean>
}

/**
 * tweb `setButtonMenuItemLoading` (`buttonMenu.ts:71-90`, 812502980, коммит
 * 508acd4f5) — 1:1: пункт с долгим действием (`keepOpen`, меню не закрывается)
 * показывает прелоадер НА МЕСТЕ своей иконки и глохнет для кликов
 * (`is-loading`, `_button.scss`), пока действие не кончится. Первый
 * потребитель — «Копировать» (`components/copyMessageMediaWithFeedback.ts`).
 */
export function setButtonMenuItemLoading(
  options: ButtonMenuItemOptions,
  loading: boolean,
  element = options.element,
) {
  const iconElement = element?.querySelector('.btn-menu-item-icon:not(.btn-menu-item-icon-right)')
  if (!element || !iconElement) {
    return
  }

  element.classList.toggle('is-loading', loading)
  const preloader = iconElement.querySelector('.btn-menu-item-preloader')
  if (loading && !preloader) {
    const newPreloader = putPreloader(undefined, true)
    newPreloader.classList.add('btn-menu-item-preloader')
    iconElement.append(newPreloader)
  } else if (!loading) {
    preloader?.remove()
  }
}

export function ButtonMenuItem(options: ButtonMenuItemOptions) {
  if(options.element) return [options.separator as HTMLElement, options.element].filter(Boolean)

  const {
    icon,
    iconElement,
    className,
    text,
    onClick,
    emptyIcon,
    avatarInfo,
  } = options
  const el = document.createElement('div')
  const iconSplitted = icon?.split(' ')
  el.className = 'btn-menu-item rp-overflow' +
    (iconSplitted && iconSplitted.length > 1 ? ' ' + iconSplitted.slice(1).join(' ') : '') +
    (className ? ' ' + className : '') +
    (options.danger ? ' danger' : '')

  if(iconElement) {
    iconElement.classList.add('btn-menu-item-icon')
    el.append(iconElement)
  } else if(iconSplitted) {
    el.append(Icon(iconSplitted[0] as IconName, 'btn-menu-item-icon'))
  } else if(emptyIcon) {
    const iconPlaceholder = document.createElement('span')
    iconPlaceholder.classList.add('btn-menu-item-icon')
    el.append(iconPlaceholder)
  }

  let textElement = options.textElement
  if(!textElement) {
    // tweb :106
    textElement = options.textElement = text ? i18n(text, options.textArgs) : document.createElement('span')
    if(options.regularText) {
      setInnerHTML(textElement, options.regularText)
      textElement.dir = ''
    }
  }

  // tweb :163-176
  if(avatarInfo) {
    const middlewareHelper = getMiddleware()
    options.dispose = () => middlewareHelper.destroy()
    const avatar = avatarNew({
      size: 24,
      peerId: avatarInfo.peerId,
      peer: avatarInfo.peer,
      middleware: middlewareHelper.get(),
      managers: avatarInfo.managers,
    })
    avatar.node.classList.add('btn-menu-item-icon', 'is-external', 'btn-menu-item-avatar')
    if(avatarInfo.active) {
      avatar.node.classList.add('active')
    }
    el.append(avatar.node)
  }

  textElement.classList.add('btn-menu-item-text')
  el.append(textElement)

  const keepOpen = !!options.keepOpen

  // * cancel mobile keyboard close
  onClick && attachClickEvent(el, (e) => {
    cancelEvent(e)

    const menu = findUpClassName(e.target as HTMLElement, 'btn-menu')
    if(menu && !menu.classList.contains('active')) {
      return
    }

    onClick(e)
    if(options.checkForClose?.() === false) {
      return
    }

    if(!keepOpen) {
      contextMenuController.close()
    }
  }, options.options)

  if(options.separator === true || options.separatorDown) {
    options.separator = document.createElement('hr')
  }

  if(options.secondary) {
    el.classList.add('is-secondary')
    options.multiline = true
  }

  if(options.multiline) {
    el.classList.add('is-multiline')
  }

  const ret: HTMLElement[] = [options.element = el]

  if(options.separator) {
    ret[options.separatorDown ? 'push' : 'unshift'](options.separator as HTMLElement)
  }

  return ret.filter(Boolean)
}

export function ButtonMenuSync({ listenerSetter, buttons }: {
  buttons: ButtonMenuItemOptions[],
  listenerSetter?: ListenerSetter
}) {
  const el: HTMLElement = document.createElement('div')
  el.classList.add('btn-menu')

  if(listenerSetter) {
    buttons.forEach((b) => {
      (b.options ??= {}).listenerSetter = listenerSetter
    })
  }

  const items = buttons.map((button) => ButtonMenuItem(button))
  el.append(...flatten(items))

  return el
}

export default async function ButtonMenu(options: Parameters<typeof ButtonMenuSync>[0]) {
  const el = ButtonMenuSync(options)
  await Promise.all(options.buttons.map(({ loadPromise }) => loadPromise))
  return el
}
