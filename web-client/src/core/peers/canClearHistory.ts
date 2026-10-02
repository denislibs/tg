// Порт tweb `lib/appManagers/utils/chats/canClearHistory.ts` (29 строк) — вопрос
// tdesktop `Filler::addClearHistory`: личка — всегда; канал — пока мы в нём и либо
// можем удалять его сообщения, либо это частная группа без тем.
//
// Расхождение: `pFlags.monoforum` — монофорума на бэкенде нет (О-4 волны 7);
// `getPeerActiveUsernames(peer)[0]` → `isPublic` (одно поле `username`,
// коллекции `usernames` нет — О-17).
import type { Chat, User } from './peer'
import { hasRights } from './rights'
import { isPublic } from './predicates'

export default function canClearHistory(peer: Chat | User | undefined) {
  if(peer?._ === 'user') {
    return true
  }

  if(peer?._ === 'chat') {
    return !peer.pFlags?.deactivated
  }

  if(peer?._ !== 'channel' || peer.pFlags?.left) {
    return false
  }

  return hasRights(peer, 'delete_messages') || (
    !!peer.pFlags?.megagroup &&
    !peer.pFlags?.forum &&
    !isPublic(peer)
  )
}
