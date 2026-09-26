// Текст пира для `lib/searchIndex.ts` — порт tweb
// `appUsersManager.getUserSearchText` (`appUsersManager.ts:399-415`),
// `appChatsManager.getChatSearchText` (`appChatsManager.ts:419-431`) и
// `appPeersManager.getPeerSearchText` (`appPeersManager.ts:302-311`).
//
// Расхождения с оригиналом:
//  1. Функции берут КАРТОЧКУ, а не id: у tweb каждая достаёт её из своего
//     менеджера (`this.users[id]`/`this.chats[id]`), у нас хранилище карточек
//     одно (`peersManager`), и вызывающий-владелец индекса уже держит к нему
//     ручку (`cachedPeer`).
//  2. `getPeerActiveUsernames(peer)` → одно поле `username`: коллекции
//     `usernames` у нас нет (см. докблок `isPublic`, `core/peers/predicates.ts`).
import type { Chat, User } from './peer'
import { isUser } from './peerId'

export function getUserSearchText(user: User | undefined): string {
  if(!user || user._ !== 'user') return ''
  const arr: (string | undefined)[] = [
    user.first_name,
    user.last_name,
    user.phone,
    user.username,
    // у оригинала так же захардкожено по-английски (`appUsersManager.ts:410-411`)
    user.pFlags?.self ? 'Saved Messages' : '',
  ]

  return arr.filter(Boolean).join(' ')
}

export function getChatSearchText(chat: Chat | undefined): string {
  if(!chat || chat._ === 'chatEmpty') return ''
  const arr: (string | undefined)[] = [
    chat.title,
    'username' in chat ? chat.username : undefined,
  ]

  return arr.filter(Boolean).join(' ')
}

/** Тег `%pu`/`%pg` позволяет фильтровать выдачу по виду пира (`includeTag`). */
export function getPeerSearchText(peerId: PeerId, peer: User | Chat | undefined): string {
  if(isUser(peerId)) {
    return '%pu ' + getUserSearchText(peer?._ === 'user' ? peer : undefined)
  }

  return '%pg ' + getChatSearchText(peer && peer._ !== 'user' && peer._ !== 'userEmpty' ? peer : undefined)
}
