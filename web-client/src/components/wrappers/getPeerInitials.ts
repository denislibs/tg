// Порт tweb `components/wrappers/getPeerInitials.ts` 1:1.
//
// ВАЖНО, ПОЧЕМУ ЭТО НЕ `getPeerTitle`: оригинал читает поля карточки НАПРЯМУЮ
// (`title` у чата, `first_name`+`last_name` у пользователя) и НЕ подставляет
// фолбэков имени. Инициалы удалённого аккаунта — пустые (его аватарку рисует
// отдельная ветка `_render`: `{color:'archive', icon:'deletedaccount'}`,
// avatarNew.tsx:788-791), а не «У» от «Удалённый аккаунт», как получилось бы,
// позови мы `core/peers/getPeerTitle.ts`. Поэтому второй читатель тех же полей
// здесь обоснован: вопрос другой.
import { wrapAbbreviation } from '@lib/richtext/abbreviation'
import type { Chat, User } from '@core/peers/peer'

/** Порт `getPeerInitials` (getPeerInitials.ts:4-14). */
export default function getPeerInitials(peer: Chat | User | undefined): DocumentFragment {
  let str = ''
  if (peer) {
    // `title ?? [first_name, last_name]` оригинала: у чата есть `title`, у
    // пользователя его нет — и тогда собирается имя из двух частей.
    str = 'title' in peer && peer.title !== undefined
      ? peer.title
      : [
          'first_name' in peer ? peer.first_name : undefined,
          'last_name' in peer ? peer.last_name : undefined,
        ].filter(Boolean).join(' ')
  }

  return wrapAbbreviation(str)
}
