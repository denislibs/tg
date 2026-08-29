/**
 * Порт tweb `src/components/buttonIcon.ts` — 1:1. Тонкая обёртка над `Button`:
 * первое слово `className` (до пробела) — имя глифа, хвост — доп. классы на
 * саму кнопку (`.btn-icon` + хвост). Прямая зависимость `sliderTab.ts`
 * (кнопка закрытия сайдбара, `left sidebar-close-button`), маленькая — портирую
 * вместе с вкладкой, а не отдельной задачей (см. разрешение неоднозначности
 * ведущего в брифе задачи 4, п.1).
 *
 * `Icon`/`IconName` — уже портированный `@components/icon`/`@core/tgico-icons`,
 * тип аргумента сужен под наш `ButtonOptions['icon']` (в tweb — `Icon`, у нас —
 * `IconName`, тот же тип по факту, другое имя).
 */
import Button, { type ButtonOptions } from '@components/button'
import type { IconName } from '@core/tgico-icons'

export default function ButtonIcon(
  className?: string,
  options: Partial<Pick<ButtonOptions, 'noRipple' | 'onlyMobile' | 'asDiv'>> = {},
) {
  const splitted = className?.split(' ')
  return Button('btn-icon' + (splitted && splitted.length > 1 ? ' ' + splitted.slice(1).join(' ') : ''), {
    icon: (splitted?.[0] as IconName) || undefined,
    ...options,
  })
}
