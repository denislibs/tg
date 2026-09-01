/**
 * ДАТЫ В REACT-ДЕРЕВЕ — три подписи ядра, каждая живым узлом.
 *
 * Все три — тонкие обёртки над хелперами `@helpers/date` (порт tweb
 * `src/helpers/date.ts`) и `DomNode`. Единственное, что они добавляют, —
 * `useMemo`: узел живой, он переписывает себя сам на смену языка
 * (`applyLangPack` обходит `.i18n`) и настройки 12/24 часа
 * (`I18n.setTimeFormat`), поэтому пересобирать его на каждом рендере нельзя.
 * Без обёрток эту пару пришлось бы повторять в каждом из полудюжины мест.
 */
import { useMemo } from 'react'

import { formatDate, formatFullSentTime, formatTime } from '@helpers/date'

import DomNode from './DomNode'

/**
 * «Сегодня в 14:30» / «5 сент. в 14:30» — узел `formatFullSentTime`
 * (порт tweb `helpers/date.ts:178-187`) в React-дереве.
 *
 * Обёртка нужна ровно ради `useMemo`: узел живой, он переписывает себя сам на
 * смену языка и настройки 12/24 часа, и пересобирать его на каждом рендере
 * нельзя — пересобранный узел терял бы всё, что успело навесить ядро. Без
 * обёртки эту пару (`useMemo` + `DomNode`) пришлось бы повторять в каждом из
 * шести мест, где такая подпись встречается.
 */
export function SentTime({ timestamp, capitalize, noToday, className }: {
  /** СЕКУНДЫ эпохи — те же единицы, что у `message.date`. */
  timestamp: number
  /** «Сегодня» с заглавной (умолчание оригинала) против строчного «сегодня». */
  capitalize?: boolean
  /** не подставлять «сегодня»/«вчера» — всегда дата. */
  noToday?: boolean
  className?: string
}) {
  const node = useMemo(
    () => formatFullSentTime(timestamp, capitalize, noToday),
    [timestamp, capitalize, noToday],
  )
  return <DomNode node={node} className={className} />
}

/**
 * Только «ЧЧ:ММ» — узел `formatTime` (порт tweb `helpers/date.ts:200-205`).
 * Ветка `hour+minute` ядра собирает время РУКАМИ, минуя `Intl`, и только так
 * уважается пользовательская настройка 12/24 часа.
 */
export function Time({ timestamp, className }: { timestamp: number; className?: string }) {
  const node = useMemo(() => formatTime(new Date(timestamp * 1000)), [timestamp])
  return <DomNode node={node} className={className} />
}

/**
 * «5 сентября» / «5 сен. 2024» — узел `formatDate` (порт tweb
 * `helpers/date.ts:75-105`). Год появляется, только если он не сегодняшний.
 */
export function DayDate({ date, withTime, shortMonth, className }: {
  /** СЕКУНДЫ эпохи. */
  date: number
  withTime?: boolean
  shortMonth?: boolean
  className?: string
}) {
  const node = useMemo(
    () => formatDate(new Date(date * 1000), { withTime, shortMonth }),
    [date, withTime, shortMonth],
  )
  return <DomNode node={node} className={className} />
}
