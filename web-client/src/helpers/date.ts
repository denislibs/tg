/**
 * Порт tweb `src/helpers/date.ts` в объёме ОДНОГО потребителя — метки
 * последней активности сессии во вкладке «Устройства»
 * (`sidebarLeft/tabs/activeSessions.tsx:35`). Портированы ровно три вещи:
 * `ONE_DAY` (:9), `getWeekNumber` (:59-67) и `formatDateAccordingToTodayNew`
 * (:107-129). Остальные ~20 функций файла оригинала не переносятся: у них в
 * этом репозитории нет ни одного вызывающего, а тянут они за собой langPack
 * (`monthsLocalized`/`daysLocalized`, `formatDaysDuration` и т.д.), который
 * не портирован.
 *
 * Смысл функции: ОДНА метка времени, чья ПОДРОБНОСТЬ зависит от того, как
 * давно было событие, — сегодня достаточно часов, на этой неделе хватает дня
 * недели, в прошлом году без года не обойтись.
 *
 * ── Адаптации под наш стек ─────────────────────────────────────────────────
 *  • `new I18n.IntlDateElement({date, options}).element` (:125-128) →
 *    `i18nSpan(...)`: `IntlDateElement` строит `span.i18n` и кладёт готовую
 *    строку в `textContent` (langPack.ts:521-522, :612, :640) — ровно то, что
 *    делает наш `i18nSpan`. Локаль берётся из `useI18nStore` (у оригинала —
 *    из langPack), тем же приёмом, что в `row.ts`/`button.ts`.
 *  • ДЕФЕКТ, ЗАДАЧА 7. Ветка `hour+minute` оригинала (langPack.ts:624-633)
 *    собирает «ЧЧ:ММ» РУКАМИ, минуя `Intl`, — только чтобы уважить
 *    пользовательскую настройку 12/24 часа. Здесь этой ветки нет: все четыре
 *    случая идут через `Intl.DateTimeFormat`, который выбирает часовой цикл по
 *    ЛОКАЛИ. Прежняя редакция этого блока объясняла пропуск тем, что «такой
 *    настройки у нас нет вовсе», — это неверно: настройка есть
 *    (`settings.tsx:15`, `:103`), у неё живой переключатель
 *    (`settings/GeneralSettings.tsx:137-144`) и он уже применяется в
 *    `settings.tsx:271-272`. Значит, метки времени во вкладке «Устройства»
 *    ВЫБОР ПОЛЬЗОВАТЕЛЯ ИГНОРИРУЮТ. Чинится вместе с переводом файла на
 *    `I18n.IntlDateElement` (задача 7 волны i18n): ветка и её арифметика уже
 *    портированы в `lib/langPack.ts` и покрыты тестами, не хватает связи
 *    настройки с `I18n.setTimeFormat`.
 */
import i18nSpan from '@helpers/dom/i18nSpan'
import { useI18nStore } from '../i18n'

export const ONE_DAY = 86400

// tweb :58-67 — https://stackoverflow.com/a/6117889
export const getWeekNumber = (date: Date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  // getTime() в миллисекундах, ONE_DAY — в секундах
  return Math.ceil((((d.getTime() - yearStart.getTime()) / (ONE_DAY * 1000)) + 1) / 7)
}

// tweb :107-129
export function formatDateAccordingToTodayNew(time: Date) {
  const today = new Date()
  const now = today.getTime() / 1000 | 0
  const timestamp = time.getTime() / 1000 | 0

  const options: Intl.DateTimeFormatOptions = {}
  if((now - timestamp) < ONE_DAY && today.getDate() === time.getDate()) { // тот же день
    options.hour = options.minute = '2-digit'
  } else if(today.getFullYear() !== time.getFullYear()) { // другой год
    options.year = options.day = 'numeric'
    options.month = '2-digit'
  } else if((now - timestamp) < (ONE_DAY * 7) && getWeekNumber(today) === getWeekNumber(time)) { // текущая неделя
    options.weekday = 'short'
  } else { // тот же год
    options.month = 'short'
    options.day = 'numeric'
  }

  // langPack.ts:637 — `capitalizeFirstLetter(dateTimeFormat.format(...))`:
  // в ряде локалей (ru: «пн», «авг.») Intl отдаёт строчную букву, а метка
  // стоит первой в своей ячейке.
  const text = new Intl.DateTimeFormat(useI18nStore.getState().lang, options).format(time)
  return i18nSpan(text.charAt(0).toUpperCase() + text.slice(1))
}
