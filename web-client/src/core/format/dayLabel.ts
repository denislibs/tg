// Метка дня и ключ суток — общие для дата-разделителя ленты и журнала звонков.

import { formatDate } from '@helpers/date'
import { i18n } from '@lib/langPack'

export function startOfDayMs(iso: string): number {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 0
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Подпись дня — порт tweb `ChatBubbles.createDateBubble` (`bubbles.ts:4783-4798`),
 * ровно его две ветки: сегодняшний день → `i18n('Date.Today')`, любой другой →
 * `formatDate(date, {today})`.
 *
 * ВЕТКИ «ВЧЕРА» У ОРИГИНАЛА НЕТ, и её здесь тоже больше нет. Прежняя редакция
 * рисовала «Вчера» — это была наша добавка, а не перевод: у tweb вчерашний
 * разделитель говорит «5 сентября». «Вчера» в оригинале живёт у ДРУГОЙ подписи
 * — `formatFullSentTimeRaw` (`helpers/date.ts:157-162`, ключи `Yesterday` и
 * `Peer.Status.Yesterday`), которая отвечает на другой вопрос («когда
 * отправлено») и стоит в других местах.
 *
 * Возвращает УЗЕЛ, а не строку. До этого подпись собиралась здесь руками:
 * «Сегодня»/«Today» тернарником `lang === 'ru'` и месяц из зашитых массивов
 * `RU_MONTHS`/`EN_MONTHS`. Языков у нас пять (плюс любой, приехавший с сервера),
 * то есть украинский, испанский, немецкий и французский читали английские
 * месяцы; и даже на этих двух подпись застывала в языке, который был в момент
 * постройки. Узел `formatDate`/`i18n` ядро переписывает само — `applyLangPack`
 * обходит `.i18n` (`lib/langPack.ts:568-572`).
 *
 * Аргумент — МИЛЛИСЕКУНДЫ начала суток (`startOfDayMs` либо
 * `bubbles.ts::getDateForDateContainer`): оригиналу сюда тоже приходит уже
 * нормализованная дата, и сравнение с `today` идёт по началам суток.
 *
 * Ветка «запланировано» оригинала (`:4790-4796`: `Chat.Date.ScheduledForToday`,
 * `MessageScheduledUntilOnline`, `Chat.Date.ScheduledFor`) сюда не переносится:
 * у нас запланированные живут не типом чата, а отдельным оверлеем, и подпись им
 * строит он сам (`components/ScheduledView.tsx::ScheduledLabel`) — теми же тремя
 * ключами оригинала.
 */
export function dayLabel(dayStartMs: number): HTMLElement {
  const date = new Date(dayStartMs)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return today.getTime() === date.getTime() ? i18n('Date.Today') : formatDate(date, { today })
}
