// Дата рождения — конструктор `birthday{day, month, year?}`, а не строка.
//
// Порт `peerProfile.tsx:760-773`: день числом, месяц словом, год — ТОЛЬКО если
// он есть в конструкторе (`year: birthday$.year ? 'numeric' : undefined`).
// Отсутствие года — не «неизвестен», а осознанно скрытая часть даты, поэтому
// подставлять текущий год в вывод нельзя; он нужен лишь как заглушка `Date`.
//
// Прежде день рождения ехал ДВУМЯ формами — объектом в `/me` и строкой
// `"DD.MM.YYYY"` в `/users/{id}` (дефект 6 разбора), и вторая печаталась как
// есть. Форма теперь одна, значит и печать одна.
import I18n from '@lib/langPack'

import type { Birthday } from '../peers/peer'

/**
 * Язык берётся у ЯДРА (`I18n.getDateTimeFormat` — тот же кэш форматтеров, что у
 * `IntlDateElement`), а не приходит параметром: параметр приезжал из
 * React-стора, то есть был ВТОРЫМ ответом на вопрос «какой сейчас язык», и с
 * ответом ядра он мог разойтись (пакет мог не доехать — тогда под выбранным
 * кодом остаётся английский).
 *
 * РАСХОЖДЕНИЕ С ОРИГИНАЛОМ, оставленное сознательно: tweb строит здесь УЗЕЛ
 * (`peerProfile.tsx:766-773`, `new I18n.IntlDateElement({date, options}).element`),
 * который переписывает себя на смену языка сам. У нас подпись едет в
 * `Row label: string` (`components/settings/kit.tsx`), а это тот самый раскол
 * контракта, что уже заведён отдельной задачей #112. Пока строка: оба
 * вызывающих — React-компоненты с `useT()`, поэтому на `language_apply` они
 * перерисовываются и подпись пересобирается в новом языке. Разница с
 * оригиналом в СПОСОБЕ обновления, а не в результате.
 */
export function formatBirthday(b: Birthday): string {
  const opts: Intl.DateTimeFormatOptions = b.year
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'long' }
  return I18n.getDateTimeFormat(opts).format(new Date(b.year ?? new Date().getFullYear(), b.month - 1, b.day))
}
