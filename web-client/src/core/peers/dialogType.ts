// Порт tweb `appPeersManager.getDialogType` (`lib/appManagers/appPeersManager.ts:348-366`)
// и `getDeleteButtonText` (`:368-383`) — вид диалога, по которому меню диалога
// (`components/dialogsContextMenu.ts`) подписывает пункт удаления, а попап
// удаления (`components/popups/deleteDialog.ts`) выбирает тексты и действие.
//
// Расхождения:
//  1. `community`, `monoforum`, `monoforum_thread`, `botforum_thread` — предметов
//     нет на бэкенде (О-5, О-4, О-3 волны 7): ветки не портированы.
//  2. `savedDialog` (`threadId` у «Избранного») — сохранённые диалоги строкой
//     приходят с задачей 1-7, здесь `threadId` не передаётся.
//  3. Чат у оригинала читается у `appChatsManager`, у нас — зеркало пиров
//     главного потока (`core/peerCache.ts`, мост чтения п. 2 плана волны 7).
import type { LangPackKey } from '@/lang'
import rootScope from '@lib/rootScope'
import { cachedChat, hasRightsPeer } from '@core/peerCache'
import { isUser } from './peerId'
import { isChannel, isMegagroup } from './predicates'

export type PeerType = 'saved' | 'chat' | 'group' | 'megagroup' | 'channel'

export function getDialogType(peerId: PeerId): PeerType {
  const chat = cachedChat(peerId)
  if(isMegagroup(chat)) {
    return 'megagroup'
  } else if(isChannel(chat)) {
    return 'channel'
  } else if(!isUser(peerId)) {
    return 'group'
  } else {
    return peerId === rootScope.myId ? 'saved' : 'chat'
  }
}

export function getDeleteButtonText(peerId: PeerId): LangPackKey {
  switch(getDialogType(peerId)) {
    case 'channel':
      return hasRightsPeer(peerId, 'delete_chat') ? 'ChannelDelete' : 'ChatList.Context.LeaveChannel'

    case 'megagroup':
    case 'group':
      return hasRightsPeer(peerId, 'delete_chat') ? 'DeleteMega' : 'ChatList.Context.LeaveGroup'

    default:
      return 'ChatList.Context.DeleteChat'
  }
}
