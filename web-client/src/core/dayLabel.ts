// Date-divider helpers shared by the chat feed: a day-bucket key and a localized
// "Today / Yesterday / 5 июня" label. Extracted from ConversationView so the feed
// component can own its per-day sectioning.

export function startOfDayMs(iso: string): number {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 0
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function dayLabel(iso: string, lang: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const ru = lang === 'ru'
  if (d.toDateString() === now.toDateString()) return ru ? 'Сегодня' : 'Today'
  const yest = new Date(now); yest.setDate(now.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return ru ? 'Вчера' : 'Yesterday'
  const months = ru ? RU_MONTHS : EN_MONTHS
  const dm = ru ? `${d.getDate()} ${months[d.getMonth()]}` : `${months[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === now.getFullYear() ? dm : `${dm} ${d.getFullYear()}`
}
