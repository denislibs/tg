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
import type { Birthday } from '../peers/peer'

export function formatBirthday(b: Birthday, lang: string): string {
  const opts: Intl.DateTimeFormatOptions = b.year
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'long' }
  return new Date(b.year ?? new Date().getFullYear(), b.month - 1, b.day).toLocaleDateString(lang, opts)
}
