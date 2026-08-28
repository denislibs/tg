// Подпись присутствия собеседника.
//
// Порт `components/wrappers/getUserStatusString.ts` — ветка `switch(status._)`
// целиком. Ключевое: «был(а) недавно»/«на этой неделе»/«в этом месяце» — это
// САМИ КОНСТРУКТОРЫ схемы (правило приватности выражено выбором варианта), а
// не обнулённое время рядом с флагом. Прежняя пара `{online, lastSeen}` этого
// различить не могла и сваливала все три в одну строку «был(а) недавно».
//
// Строки лежат по месту (подсистемы переводов у нас нет) — как и везде в этом
// клиенте; в оригинале это ключи `langPack`.
import type { UserStatus } from './peers/peer'
import { userStatusWasOnline } from './peers/peer'

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

/**
 * Подпись статуса — порт ветки `switch(user.status?._)` из
 * `getUserStatusString.ts`. Проверки `expires` здесь НЕТ намеренно: истёкший
 * онлайн гасит владелец статуса (`degradeExpiredPresence`, порт
 * `updateUsersStatuses`), ровно как в оригинале, — иначе срок годности
 * читался бы в двух местах по-разному.
 */
export function userStatusLabel(status: UserStatus | undefined, lang: string): string {
  const ru = lang === 'ru'
  switch (status?._) {
    case 'userStatusOnline':
      return ru ? 'в сети' : 'online'
    case 'userStatusRecently':
      return ru ? 'был(а) недавно' : 'last seen recently'
    case 'userStatusLastWeek':
      return ru ? 'был(а) на этой неделе' : 'last seen within a week'
    case 'userStatusLastMonth':
      return ru ? 'был(а) в этом месяце' : 'last seen within a month'
    case 'userStatusOffline':
      return lastSeenLabel(userStatusWasOnline(status) * 1000, lang)
    default:
      return ru ? 'был(а) давно' : 'last seen a long time ago'
  }
}
