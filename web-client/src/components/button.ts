/**
 * Порт tweb `src/components/button.ts` — фабрика `<button>`/`<a>`/`<div>` с
 * риплом и опциональной иконкой. Структура и классы дословные; правки только
 * под наш стек:
 *  • `LangPackKey`/`i18n(text, textArgs)` → строка + `useI18nStore.getState().t`
 *    (у нашего словаря ключ=строка, без интерполяции аргументов — тот же приём,
 *    что уже в `checkboxField.ts` и `buttonMenu.ts::i18nSpan`; `textArgs`
 *    поэтому не портирован — предмета нет). Узел текста — `span.i18n`, как
 *    у tweb `i18n()` (см. обоснование в `buttonMenu.ts::i18nSpan`), а не голый
 *    текстовый узел;
 *  • `ripple` — `@components/ripple` (порт того же tweb-файла, довезён вместе
 *    с кнопкой как прямая зависимость).
 */
import Icon from '@components/icon'
import type { IconName } from '@core/tgico-icons'
import ripple from '@components/ripple'
import { useI18nStore } from '../i18n'

export type ButtonOptions = Partial<{
  noRipple: true
  onlyMobile: true
  icon: IconName
  rippleSquare: true
  text: string
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
    button.append(i18nSpan(useI18nStore.getState().t(options.text)))
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

// Замена tweb `i18n(key, args)` (`lib/langPack.ts:644`), пока langPack не
// портирован: тот же узел `span.i18n` с готовым переведённым текстом — как и
// в `buttonMenu.ts::i18nSpan`.
function i18nSpan(text: string) {
  const span = document.createElement('span')
  span.classList.add('i18n')
  span.textContent = text
  return span
}
