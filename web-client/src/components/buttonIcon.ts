/**
 * Порт tweb `src/components/buttonIcon.ts` — 1:1. Тонкая обёртка над `Button`:
 * первое слово `className` (до пробела) — имя глифа, хвост — доп. классы на
 * саму кнопку (`.btn-icon` + хвост). Прямая зависимость `sliderTab.ts`
 * (кнопка закрытия сайдбара, `left sidebar-close-button`), маленькая — портирую
 * вместе с вкладкой, а не отдельным шагом (см. разрешение неоднозначности
 * ведущего в брифе шага 4 плана волны 2, п.1).
 *
 * ── ОСТАТОК ВОЛНЫ (#112) ───────────────────────────────────────────────────
 * Живой React-двойник той же кнопки — `shared/ui/IconButton` (66 файлов-
 * потребителей против ОДНОГО у этого порта: `sliderTab.ts`). Пара
 * «портированный примитив + его React-двойник» — не удвоение по недосмотру,
 * а неизбежное состояние переезда: двойник умрёт вместе с последним
 * React-экраном, который его рисует, и снимать его раньше нечем. Названо
 * здесь, чтобы следующий читатель не считал это ни нормой, ни забытым долгом.
 *
 * `Icon`/`IconName` — уже портированный `@components/icon`/`@core/tgico-icons`,
 * тип аргумента сужен под наш `ButtonOptions['icon']` (в tweb — `Icon`, у нас —
 * `IconName`, тот же тип по факту, другое имя).
 */
import Button, { type ButtonOptions } from '@components/button'
import type { IconName } from '@core/tgico-icons'

export default function ButtonIcon(
  className?: string,
  // `ButtonOptions` уже `Partial<{...}>` — `Pick` из него сохраняет
  // опциональность выбранных полей, второй `Partial` был избыточен.
  options: Pick<ButtonOptions, 'noRipple' | 'onlyMobile' | 'asDiv'> = {},
) {
  const splitted = className?.split(' ')
  return Button('btn-icon' + (splitted && splitted.length > 1 ? ' ' + splitted.slice(1).join(' ') : ''), {
    icon: (splitted?.[0] as IconName) || undefined,
    ...options,
  })
}
