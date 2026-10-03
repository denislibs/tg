// Порт tweb `src/components/wrappers/wrapDuration.ts:1-44` (812502980) — подпись
// длительности формами числа langPack.
//
// Расхождение с оригиналом: `wrapSlowModeLeftDuration` и
// `wrapStoriesStealthModeDuration` (`:46-57`) никто не зовёт и они не портированы.
// Потребители — «Данные и память» (`storageQuota.tsx:145`), «Автоудаление»
// (`autoDeleteMessages/options.ts`), бабл звонка (`wrappers/callBubble.ts`),
// превью лога звонка строкой (`core/serviceMsg.ts`, plain-ветка — порт
// `messageActionTextNewUnsafe.ts:248-253`) и ссылки-приглашения правой колонки
// (`sidebarRight/tabs/chatInviteLinks.solid.tsx`, `editChatInviteLink.solid.tsx` —
// там `wrapFormattedDuration(formatted, false)` оригинала зовётся без второго
// аргумента: он и есть не-plain).
import I18n, { i18n, join, type LangPackKey } from '@lib/langPack'
import formatDuration, { DurationType, type FormattedDuration } from '@helpers/formatDuration'
import toHHMMSS from '@helpers/string/toHHMMSS'

export const DURATION_LANG_KEYS: { [type in DurationType]: LangPackKey } = {
  [DurationType.Seconds]: 'Seconds',
  [DurationType.Minutes]: 'Minutes',
  [DurationType.Hours]: 'Hours',
  [DurationType.Days]: 'Days',
  [DurationType.Weeks]: 'Weeks',
  [DurationType.Months]: 'Months',
  [DurationType.Years]: 'Years',
}

export function wrapFormattedDuration(formatted: FormattedDuration, plain: true): string
export function wrapFormattedDuration(formatted: FormattedDuration, plain?: false): HTMLSpanElement
export function wrapFormattedDuration(formatted: FormattedDuration, plain?: boolean): string | HTMLSpanElement {
  // tweb :19-22
  if(plain) {
    const strings = formatted.map((d) => I18n.format(DURATION_LANG_KEYS[d.type], true, [d.duration]))
    return join(strings, false, plain)
  }

  const elements = formatted.map((d) => i18n(DURATION_LANG_KEYS[d.type], [d.duration]))

  const fragment = document.createElement('span')
  fragment.append(...join(elements, false))

  return fragment
}

/** tweb :32-34 — длительность звонка: два старших разряда («1 минута, 5 секунд»). */
export function wrapCallDuration(duration: number, plain: true): string
export function wrapCallDuration(duration: number, plain?: false): HTMLSpanElement
export function wrapCallDuration(duration: number, plain?: boolean): string | HTMLSpanElement {
  return plain ? wrapFormattedDuration(formatDuration(duration, 2), true) : wrapFormattedDuration(formatDuration(duration, 2))
}

/** tweb :36-44 — остаток срока: до суток — `ч:мм:сс`, дольше — один старший разряд. */
export function wrapLeftDuration(timeLeft: number) {
  const formatted = formatDuration(timeLeft, 3)
  if(formatted[0].type <= DurationType.Hours) {
    return toHHMMSS(timeLeft, true)
  } else {
    formatted.splice(1, Infinity)
    return wrapFormattedDuration(formatted)
  }
}
