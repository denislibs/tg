// Telegram-style "last seen" label from a last-seen timestamp (ms). Kept
// language-aware locally (ru/en) — fuller localization can come later.
export function lastSeenLabel(lastSeenMs: number, lang: string): string {
  const ru = lang === 'ru'
  if (!lastSeenMs) return ru ? 'был(а) недавно' : 'last seen recently'
  const diffMin = Math.floor((Date.now() - lastSeenMs) / 60000)
  if (diffMin < 1) return ru ? 'был(а) в сети только что' : 'last seen just now'
  if (diffMin < 60) return ru ? `был(а) в сети ${diffMin} мин назад` : `last seen ${diffMin} min ago`
  const hrs = Math.floor(diffMin / 60)
  if (hrs < 24) return ru ? `был(а) в сети ${hrs} ч назад` : `last seen ${hrs} h ago`
  const days = Math.floor(hrs / 24)
  return ru ? `был(а) в сети ${days} дн назад` : `last seen ${days} d ago`
}
