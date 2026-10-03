// Порт tweb `src/components/forumTab/getGroupForumMembershipAction.ts` (812502980,
// 15 строк) вместе с его `appManagers/utils/chats/getChatMembershipAction.ts`
// (25 строк; своего дома утилит чатов у нас нет — функция одна, и её читает
// только форум-таб). Флага `join_request` у канала в нашей модели нет
// (`core/peers/peer.ts`), поэтому ветки `'request'` нет.
import type { Chat } from '@core/peers/peer'

export type ChatMembershipAction = 'join' | 'leave'

/** tweb `getChatMembershipAction.ts:7-25` */
function getChatMembershipAction(chat: Chat): ChatMembershipAction | undefined {
  if(chat._ !== 'chat' && chat._ !== 'channel') {
    return
  }

  if(!chat.pFlags?.left) {
    return 'leave'
  }

  return 'join'
}

export default function getGroupForumMembershipAction(
  chat: Chat | undefined,
): ChatMembershipAction | undefined {
  if(chat?._ !== 'channel' || !chat.pFlags?.forum) {
    return
  }

  return getChatMembershipAction(chat)
}
