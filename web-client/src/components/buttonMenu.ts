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
//   • `iconDoc` (`wrapAttachBotIcon`) — иконок attach-ботов в проекте нет;
//   • `avatarInfo` + `dispose` (`AvatarNew`, solid `createRoot`) — solid-js в
//     проекте нет;
//   • `textArgs` и тип `LangPackKey`: langPack не портирован. `text` — обычная
//     строка, узел собирается как у tweb `i18n()` — `span.i18n` с текстом
//     (та же подмена уже сделана в `components/chat/serviceMessage.ts`);
//   • `new` (бейдж `span.btn-menu-item-badge`, tweb :147-152) — ветка мёртвая
//     уже в tweb: `new: true` не ставит ни один потребитель меню (проверено
//     grep'ом по репозиторию tweb), плюс тянет langPack-ключ 'New';
//   • `waitForAnimation` — мёртвое уже в tweb: читается только внутри
//     закомментированного черновика (:171-174);
//   • `inner` (`has-inner` + `Icon('next')`, :207-211) и поля-проводники
//     `id` / `onOpen` / `onClose`: сам этот файл их не читает — их читают
//     `buttonMenuToggle` / `createSubmenuTrigger`, которых в проекте нет.
//     ChatContextMenu подменю делает через `createSubmenuTrigger`, а не `inner`.
import flatten from '@helpers/array/flatten'
import contextMenuController from '@helpers/contextMenuController'
import cancelEvent from '@helpers/dom/cancelEvent'
import { type AttachClickOptions, attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import setInnerHTML from '@helpers/dom/setInnerHTML'
import type ListenerSetter from '@helpers/listenerSetter'
import Icon from '@components/icon'
import type { IconName } from '@core/tgico-icons'
import i18nSpan from '@helpers/dom/i18nSpan'

export type ButtonMenuItemOptions = {
  /** имя глифа; хвост после первого слова уезжает в className пункта
   *  (tweb: `icon: 'delete danger-cls'` кладёт `danger-cls` на пункт) */
  icon?: string,
  iconElement?: HTMLElement,
  emptyIcon?: boolean,
  danger?: boolean,
  className?: string,
  text?: string,
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
}

export type ButtonMenuItemOptionsVerifiable = ButtonMenuItemOptions & {
  verify?: () => boolean | Promise<boolean>
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
    // tweb: `text ? i18n(text, textArgs) : document.createElement('span')`;
    // `i18n()` возвращает `span.i18n` с готовым текстом — его и собираем.
    textElement = options.textElement = text ? i18nSpan(text) : document.createElement('span')
    if(options.regularText) {
      setInnerHTML(textElement, options.regularText)
      textElement.dir = ''
    }
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
