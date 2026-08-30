/**
 * Мост между новой формой словаря и старым `t('English string')`.
 *
 * ── Почему он вообще есть ───────────────────────────────────────────────────
 * Задача 3 переводит ПЯТЬ словарей на символические ключи и конструкторы схемы.
 * Вызывающих у `t()` больше тысячи, и они переедут кодмодом ЗАДАЧИ 6, а сам `t()`
 * уйдёт ЗАДАЧЕЙ 9 — до тех пор обе формы ключа обязаны работать. Совместимость
 * держится тем, что ДАННЫЕ теперь одни: старый словарь не хранится, а СЧИТАЕТСЯ
 * из нового по `LEGACY_KEY_MAP` (та же карта, по которой пойдёт кодмод). Из этого
 * следует главное свойство — расхождение между двумя формами невозможно: правка
 * перевода видна обеим, а забытая строка пропадает у обеих сразу.
 *
 * ── Почему отдельным модулем, а не в `dict.ts` ──────────────────────────────
 * Карта старых ключей — это ~40 кБ текста, нужных РОВНО на время переезда. Здесь
 * она лежит за динамическим импортом (`i18n/index.tsx` тянет её вместе с чанком
 * языка), поэтому английскому интерфейсу не достаётся вовсе: у него старый ключ
 * и есть отображаемая строка.
 *
 * ── Три ветки проекции ─────────────────────────────────────────────────────
 *  • обычная строка — берём `value` как есть;
 *  • ОБЪЯВЛЕННОЕ СЛИЯНИЕ (`LEGACY_ALIASES`): двум старым строкам соответствует
 *    один ключ, значит и перевод у них теперь один — обе получают его;
 *  • ФОРМА ЧИСЛА (`LEGACY_PLURAL_GROUPS`): старая строка — это ОДНА форма, и
 *    какая именно, сказано именем слота, а не порядком. Позиционного чтения тут
 *    быть не должно: русская «%d уведомлений» — это CLDR-`many`, а «%d уведомления»
 *    — `few`, и перепутанные местами формы дают «2 уведомлений» / «5 уведомления».
 */
import type { LangPackString } from '@layer'
import { LEGACY_KEY_MAP, LEGACY_PLURAL_GROUPS } from './legacyKeyMap'
import type { Dict } from './dict'

/** Слоты форм в порядке «от частного к общему» — так же читает их `I18n.format`. */
const SLOTS = ['one_value', 'few_value', 'many_value', 'other_value'] as const

/**
 * Какую форму значит эта старая строка. `many` и `other` в объявлении намеренно
 * смотрят на ОДНУ старую строку (у английского формы `many` нет, у русского —
 * `other`), поэтому годится первый слот, у которого перевод есть; если у языка
 * такой формы не бывает — общий `other_value`, как и в самом ядре.
 */
function pluralForm(key: string, legacy: string, str: LangPackString.langPackStringPluralized): string | undefined {
  const declared = LEGACY_PLURAL_GROUPS[key]
  if (!declared) return undefined
  for (const slot of SLOTS) {
    if (declared[slot] !== legacy) continue
    const value = str[slot]
    if (value !== undefined) return value
  }
  return str.other_value
}

/** Новый словарь (конструкторы схемы) → старый (ключ = английская строка). */
export function toLegacyDict(strings: LangPackString[]): Dict {
  const byKey = new Map<string, LangPackString>()
  for (const string of strings) byKey.set(string.key, string)

  const dict: Dict = {}
  for (const [legacy, key] of Object.entries(LEGACY_KEY_MAP)) {
    const string = byKey.get(key)
    if (!string) continue // этот язык такую строку не переводит — `t()` отдаст английскую
    if (string._ === 'langPackString') {
      dict[legacy] = string.value
    } else if (string._ === 'langPackStringPluralized') {
      const value = pluralForm(key, legacy, string)
      if (value !== undefined) dict[legacy] = value
    }
  }
  return dict
}
