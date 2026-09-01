/**
 * ДАТЫ В REACT-ДЕРЕВЕ — три подписи ядра, каждая живым узлом.
 *
 * Все три — тонкие обёртки над хелперами `@helpers/date` (порт tweb
 * `src/helpers/date.ts`) и `DomNode`. Добавляют они ровно две вещи:
 *
 *  • `useMemo` — узел живой, он переписывает себя сам на смену языка
 *    (`applyLangPack` обходит `.i18n`) и настройки 12/24 часа
 *    (`I18n.setTimeFormat`), поэтому пересобирать его на каждом рендере нельзя;
 *  • ЗАЩИТУ ОТ НЕВАЛИДНОЙ ДАТЫ, и это не перестраховка. `Intl.DateTimeFormat`
 *    на `new Date(NaN)` бросает `RangeError: Invalid time value`, а
 *    `IntlDateElement.update` (порт, tweb его не ловит) его не перехватывает —
 *    то есть битая строка с провода роняет РЕНДЕР ЭКРАНА. Раньше проверку
 *    держал каждый экран сам и по-разному (`Number.isNaN` в `PremiumManage`,
 *    `try/catch` в `Passkeys`, ничего в остальных); теперь она одна и здесь.
 *    Невалидная дата рисует `fallback` — обычно сырое значение с провода,
 *    ровно как делали снесённые проверки, — а не пустоту и не исключение.
 */
import { useMemo, type ReactNode } from 'react'

import { formatDate, formatFullSentTime, formatTime } from '@helpers/date'

import DomNode from './DomNode'

/** Секунды эпохи, из которых можно построить дату. `Date.parse` битой строки
 *  даёт `NaN`, а `Math.floor(NaN / 1000)` — тоже `NaN`, поэтому проверка одна. */
const isValid = (timestamp: number) => Number.isFinite(timestamp)

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
    () => (isValid(timestamp) ? formatFullSentTime(timestamp, capitalize, noToday) : null),
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
    () => (isValid(timestamp) ? formatTime(new Date(timestamp * 1000)) : null),
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
    () => (isValid(date) ? formatDate(new Date(date * 1000), { withTime, shortMonth, overrideIntlOptions }) : null),
    [date, withTime, shortMonth, overrideIntlOptions],
  )
  return node ? <DomNode node={node} className={className} /> : <>{fallback}</>
}

/** Год нужен всегда — см. `overrideIntlOptions`. Константа модульная, чтобы не
 *  пересобирать узел литералом на каждом рендере. */
export const ALWAYS_YEAR: Intl.DateTimeFormatOptions = { year: 'numeric' }
