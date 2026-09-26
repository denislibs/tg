// Порт tweb `src/components/wrappers/wrapDuration.ts:1-30` (812502980) — подпись
// длительности формами числа langPack.
//
// Расхождения с оригиналом:
//  1. Только не-plain ветка `wrapFormattedDuration` (`:24-29`): plain-ветку
//     (`:19-22`) и `wrapCallDuration`/`wrapLeftDuration`/
//     `wrapSlowModeLeftDuration`/`wrapStoriesStealthModeDuration` (`:32-58`)
//     никто не зовёт — первый потребитель у нас «Данные и память»
//     (`storageQuota.tsx:145`).
//  2. Аргумент — `FormattedDuration` (тип результата `formatDuration`), сама
//     функция не портирована (`helpers/formatDuration.ts`).
import { i18n, join, type LangPackKey } from '@lib/langPack'
import { DurationType, type FormattedDuration } from '@helpers/formatDuration'

export const DURATION_LANG_KEYS: { [type in DurationType]: LangPackKey } = {
  [DurationType.Seconds]: 'Seconds',
  [DurationType.Minutes]: 'Minutes',
  [DurationType.Hours]: 'Hours',
  [DurationType.Days]: 'Days',
  [DurationType.Weeks]: 'Weeks',
  [DurationType.Months]: 'Months',
  [DurationType.Years]: 'Years',
}

export function wrapFormattedDuration(formatted: FormattedDuration): HTMLSpanElement {
  const elements = formatted.map((d) => i18n(DURATION_LANG_KEYS[d.type], [d.duration]))

  const fragment = document.createElement('span')
  fragment.append(...join(elements, false))

  return fragment
}
