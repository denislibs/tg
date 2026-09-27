// Можно ли отправить в пир — вопрос селектора получателей (пересылка,
// «Поделиться», история в чат).
//
// Порт `AppSelectPeers.filterByRights` (tweb `appSelectPeers.tsx:827-834`) и
// `canSendToUser` (`appManagers/utils/users/canSendToUser.ts`). Вынесено из
// класса селектора в модуль, потому что у нас им пользуются два селектора:
// Solid-порт `AppSelectPeers` и React-`ForwardPicker` (попап пересылки
// переезжает на Solid задачей 24 плана 2C).
//
// Расхождения с оригиналом:
//  1. Гранулярного `send_plain` в наших правах нет (`chatBannedRights` у нас
//     пять флагов — `backend/internal/domain/mtchat.go::bannedRightFlags`):
//     текст запрещает `send_messages`, и роль `send_plain` оригинала здесь
//     играет он. По той же причине вместо `send_photos`/`send_videos`/… —
//     один `send_media`.
//  2. `REPLIES_PEER_ID` в `canSendToUser` не проверяется — такого пира у нас
//     нет (см. `components/avatar.ts`).

import type { MyMessage } from '../models'
import type { Chat, User } from './peer'
import { isUser } from './peerId'
import { hasRights, type ChatRights } from './rights'

/** Порт `canSendToUser` (`canSendToUser.ts:4-6`). */
export function canSendToUser(user: User | undefined): boolean {
  return !!(user && user._ === 'user' && !user.pFlags?.deleted)
}

/**
 * Порт `filterByRights(peerId)` (`appSelectPeers.tsx:827-834`): пользователю
 * можно написать, если он не удалён (проверяется только для текста —
 * `chatRightsActions[0] !== 'send_plain' || canSendToUser(peer)`), чату — если
 * у зрителя есть КАЖДОЕ из прав (`hasRights`: канал — только с
 * `post_messages`, группа — без запрета писать, создатель — всегда).
 */
export function filterByRights(peerId: PeerId, peer: User | Chat | undefined, chatRightsActions: readonly ChatRights[]): boolean {
  if (isUser(peerId)) {
    return chatRightsActions[0] !== 'send_messages' || canSendToUser(peer as User | undefined)
  }

  return chatRightsActions.every((action) => hasRights(peer as Chat | undefined, action))
}

/**
 * Порт `resolveChatRightsActions` (`popups/forward.tsx:20-91`): какие права
 * нужны получателю, чтобы принять эти сообщения. У оригинала вложение
 * раскладывается на `send_photos`/`send_videos`/`send_stickers`/…, карточка
 * ссылки — `embed_links`, сообщение через бота — `send_inline`; у нас эти
 * запреты не заведены (расхождение 1 шапки), поэтому любое вложение — это
 * `send_media`, а текст, ссылка и inline — `send_messages`. Пустой набор —
 * текст (`:99-102`).
 */
export function resolveChatRightsActions(messages: readonly MyMessage[]): ChatRights[] {
  const actions = new Set<ChatRights>()
  for (const message of messages) {
    if (message._ !== 'message') continue
    const media = message.media
    actions.add(!media || media._ === 'messageMediaWebPage' ? 'send_messages' : 'send_media')
  }

  const out = [...actions]
  if (!out.length) out.push('send_messages')
  return out
}
