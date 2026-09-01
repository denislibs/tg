/**
 * Порт tweb `src/components/button.ts` — фабрика `<button>`/`<a>`/`<div>` с
 * риплом и опциональной иконкой. Структура и классы дословные; правка одна:
 *  • `ripple` — `@components/ripple` (порт того же tweb-файла, довезён вместе
 *    с кнопкой как прямая зависимость).
 *
 * Подпись строит `i18n(text, textArgs)` ядра — дословно как оригинал (:42). Узел
 * ядра ЖИВОЙ (записан в `weakMap`, перерисовывается сменой языка), а аргументом
 * подстановки может быть УЗЕЛ; готовую строку сюда класть незачем и нечем.
 *
 * ── ОСТАТОК ВОЛНЫ (#112) ───────────────────────────────────────────────────
 * Живой React-двойник — `shared/ui/Button` (4 потребителя против 3 у этого
 * порта). Как и у `buttonIcon.ts`: двойник уйдёт вместе с последним
 * React-экраном, который его рисует, а не отдельным сносом.
 */
import Icon from '@components/icon'
import type { IconName } from '@core/tgico-icons'
import ripple from '@components/ripple'
import { i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'

export type ButtonOptions = Partial<{
  noRipple: true
  onlyMobile: true
  icon: IconName
  rippleSquare: true
  text: LangPackKey
  textArgs: FormatterArguments
  disabled: boolean
  asDiv: boolean
  asLink: boolean
}>

export default function Button<T extends ButtonOptions>(
  className: string,
  options: T = {} as T,
): T['asLink'] extends true ? HTMLAnchorElement : HTMLButtonElement {
  const button = document.createElement(options.asLink ? 'a' : (options.asDiv ? 'div' : 'button'))
  button.className = className

  if (!options.noRipple) {
    if (options.rippleSquare) {
      button.classList.add('rp-square')
    }

    ripple(button)
  }

  if (options.icon) {
    replaceButtonIcon(button, options.icon, false)
  }

  if (options.onlyMobile) {
    button.classList.add('only-handhelds')
  }

  if (options.disabled) {
    button.setAttribute('disabled', 'true')
  }

  if (options.text) {
    button.append(i18n(options.text, options.textArgs))
  }

  return button as any
}

export function replaceButtonIcon(
  element: HTMLElement,
  icon: IconName,
  oldIcon: Element | false | null = element.querySelector('.button-icon'),
) {
  const newIcon = Icon(icon, 'button-icon')
  if (oldIcon) oldIcon.replaceWith(newIcon)
  else element.append(newIcon)
  return newIcon
}
