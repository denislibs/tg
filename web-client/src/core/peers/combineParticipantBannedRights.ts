// Порт tweb `src/lib/appManagers/utils/chats/combineParticipantBannedRights.ts:1-16`
// (812502980) — запреты участника поверх запретов чата по умолчанию: что
// запрещено всем, запрещено и ему. Потребитель — `ChatPermissions` с
// `participant` (права участника, `sidebarRight/tabs/groupPermissions/sharedPermissions.ts`).
//
// Отличий от оригинала нет.
import copy from '@helpers/object/copy'
import type { Channel, ChatBannedRights } from './peer'

export default function combineParticipantBannedRights(chat: Channel, rights: ChatBannedRights) {
  if(chat.default_banned_rights) {
    rights = copy(rights)
    const defaultRights = chat.default_banned_rights.pFlags ?? {}
    rights.pFlags ??= {}
    for(const i in defaultRights) {
      const flag = i as keyof typeof defaultRights
      rights.pFlags[flag] = defaultRights[flag]
    }
  }

  return rights
}
