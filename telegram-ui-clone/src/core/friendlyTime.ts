// src/core/friendlyTime.ts
// "Сегодня в 08:17" / "Вчера в 08:17" / "12.06 в 08:17" — a friendly absolute time
// label (used by the now-playing subtitle, the media lightbox, and search result rows).
export function friendlyMsgTime(iso: string, lang: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  const isYest = d.toDateString() === yest.toDateString()
  const ru = lang === 'ru'
  if (sameDay) return ru ? `Сегодня в ${hhmm}` : `Today at ${hhmm}`
  if (isYest) return ru ? `Вчера в ${hhmm}` : `Yesterday at ${hhmm}`
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
  return ru ? `${date} в ${hhmm}` : `${date} at ${hhmm}`
}
