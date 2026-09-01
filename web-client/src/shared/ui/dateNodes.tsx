/**
 * ДАТЫ В REACT-ДЕРЕВЕ — подписи ядра, каждая живым узлом.
 *
 * Все — тонкие обёртки над хелперами `@helpers/date` (порт tweb
 * `src/helpers/date.ts`), `core/format/dayLabel` и `DomNode`. Добавляют они
 * ровно две вещи:
 *
 *  • `useMemo` — узел живой, он переписывает себя сам на смену языка
 *    (`applyLangPack` обходит `.i18n`) и настройки 12/24 часа
 *    (`I18n.setTimeFormat`), поэтому пересобирать его на каждом рендере нельзя;
 *  • ЗАЩИТУ ОТ НЕВАЛИДНОЙ ДАТЫ, и это не перестраховка. `Intl.DateTimeFormat`
 *    на `new Date(NaN)` бросает `RangeError: Invalid time value`, а
 *    `IntlDateElement.update` (порт, tweb его не ловит) его не перехватывает —
 *    то есть битая строка с провода роняет РЕНДЕР ЭКРАНА. Раньше проверку
 *    держал каждый экран сам и по-разному (`Number.isNaN` в `PremiumManage`,
 *    `try/catch` в `Passkeys`, ничего в остальных). Сам предикат живёт у
 *    хелперов (`@helpers/date::isValidTimestamp`) — там же, где подписи, —
 *    потому что вход у него не только React: ванильные места строят подпись
 *    сами (`chat/contextMenu.ts`) и зовут тот же предикат. Невалидная дата
 *    рисует `fallback` — обычно сырое значение с провода, ровно как делали
 *    снесённые проверки, — а не пустоту и не исключение.
 */
import { useMemo, type ReactNode } from 'react'

import { dayLabel } from '@core/format/dayLabel'
import { formatDate, formatDateAccordingToTodayNew, formatFullSentTime, formatTime, isValidTimestamp } from '@helpers/date'

import DomNode from './DomNode'

/**
 * «Сегодня в 14:30» / «5 сент. в 14:30» — узел `formatFullSentTime`
 * (порт tweb `helpers/date.ts:178-187`).
 */
export function SentTime({ timestamp, capitalize, noToday, className, fallback = null }: {
  /** СЕКУНДЫ эпохи — те же единицы, что у `message.date`. */
  timestamp: number
  /** «Сегодня» с заглавной (умолчание оригинала) против строчного «сегодня». */
  capitalize?: boolean
  /** не подставлять «сегодня»/«вчера» — всегда дата. */
  noToday?: boolean
  className?: string
  /** Что рисовать, если даты нет: обычно сырое значение с провода. */
  fallback?: ReactNode
}) {
  const node = useMemo(
    () => (isValidTimestamp(timestamp) ? formatFullSentTime(timestamp, capitalize, noToday) : null),
    [timestamp, capitalize, noToday],
  )
  return node ? <DomNode node={node} className={className} /> : <>{fallback}</>
}

/**
 * Только «ЧЧ:ММ» — узел `formatTime` (порт tweb `helpers/date.ts:200-205`).
 * Ветка `hour+minute` ядра собирает время РУКАМИ, минуя `Intl`, и только так
 * уважается пользовательская настройка 12/24 часа.
 */
export function Time({ timestamp, className, fallback = null }: {
  timestamp: number
  className?: string
  fallback?: ReactNode
}) {
  const node = useMemo(
    () => (isValidTimestamp(timestamp) ? formatTime(new Date(timestamp * 1000)) : null),
    [timestamp],
  )
  return node ? <DomNode node={node} className={className} /> : <>{fallback}</>
}

/**
 * «5 сентября» / «5 сен. 2024» — узел `formatDate` (порт tweb
 * `helpers/date.ts:75-105`). Год оригинал добавляет, ТОЛЬКО если он не
 * сегодняшний, — экранам, где год нужен всегда, служит `overrideIntlOptions`
 * (то же имя и та же роль, что у опции оригинала, `date.ts:71`).
 */
export function DayDate({ date, withTime, shortMonth, overrideIntlOptions, className, fallback = null }: {
  /** СЕКУНДЫ эпохи. */
  date: number
  withTime?: boolean
  shortMonth?: boolean
  /** ВНИМАНИЕ: объект обязан быть стабильным (модульная константа) — он лежит
   *  в зависимостях `useMemo`, и литерал на каждом рендере пересобирал бы узел. */
  overrideIntlOptions?: Intl.DateTimeFormatOptions
  className?: string
  fallback?: ReactNode
}) {
  const node = useMemo(
    () => (isValidTimestamp(date) ? formatDate(new Date(date * 1000), { withTime, shortMonth, overrideIntlOptions }) : null),
    [date, withTime, shortMonth, overrideIntlOptions],
  )
  return node ? <DomNode node={node} className={className} /> : <>{fallback}</>
}

/** Год нужен всегда — см. `overrideIntlOptions`. Константа модульная, чтобы не
 *  пересобирать узел литералом на каждом рендере. */
export const ALWAYS_YEAR: Intl.DateTimeFormatOptions = { year: 'numeric' }

/**
 * «Сегодня» или дата — метка дня (`core/format/dayLabel`, порт веток tweb
 * `bubbles.ts::createDateBubble`, :4783-4798). Ею подписаны секции дня в
 * журнале звонков; в ленте тот же узел ставит ванильный дата-разделитель.
 *
 * Проверки на валидность здесь нет и не нужно: аргумент — ответ `startOfDayMs`,
 * а тот на битом входе отдаёт `0` (эпоху), то есть дату, из которой подпись
 * строится.
 */
export function DayLabel({ dayStartMs, className }: {
  /** МИЛЛИСЕКУНДЫ начала суток (`startOfDayMs`). */
  dayStartMs: number
  className?: string
}) {
  const node = useMemo(() => dayLabel(dayStartMs), [dayStartMs])
  return <DomNode node={node} className={className} />
}

/**
 * Подпись времени в СТРОКЕ СПИСКА — узел `formatDateAccordingToTodayNew`
 * (порт tweb `helpers/date.ts:107-129`): сегодня → «14:30», эта неделя → день
 * недели, тот же год → «5 сент.», другой год → с годом.
 *
 * Это ровно та подпись, что стоит у оригинала в `dom.lastTimeSpan`
 * (`appDialogsManager.ts:2242`), а строки результатов поиска — и общего
 * (`appSearchSuper.ts:853` → `setLastMessageN`), и поиска по чату
 * (`chat/topbarSearch.tsx:75` → `addDialogAndSetLastMessage`) — у tweb ЭТО И
 * ЕСТЬ строки диалога. Поэтому у них та же подпись, а не «Сегодня в 14:30».
 */
export function RowDate({ timestamp, className, fallback = null }: {
  /** СЕКУНДЫ эпохи. */
  timestamp: number
  className?: string
  fallback?: ReactNode
}) {
  const node = useMemo(
    () => (isValidTimestamp(timestamp) ? formatDateAccordingToTodayNew(new Date(timestamp * 1000)) : null),
    [timestamp],
  )
  return node ? <DomNode node={node} className={className} /> : <>{fallback}</>
}
