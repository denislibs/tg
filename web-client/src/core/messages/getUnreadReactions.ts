// Порт tweb `appManagers/utils/messages/getUnreadReactions.ts` (tweb 812502980) — 1:1.
//
// Непрочитанные реакции на сообщении — записи `recent_reactions` с
// `pFlags.unread`. Флаг сервер ставит только глазами АВТОРА сообщения: чужая
// реакция на его сообщение, которую он ещё не видел.
import type { MyMessage } from '../models'

export default function getUnreadReactions(message: MyMessage) {
  const reactions = message?._ === 'message' ? message.reactions : undefined
  const recentReactions = reactions?.recent_reactions
  if (!recentReactions) {
    return
  }

  const arr = recentReactions.filter((reaction) => reaction.pFlags?.unread)
  if (!arr.length) {
    return
  }

  return arr
}
