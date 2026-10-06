// Порт tweb `appMessagesManager.canMessageBeEdited` (812502980 :8312-8343) и
// `canEditMessage` (:8345-8381) — «можно ли править сообщение». Спрашивают двое, как и
// у оригинала: меню сообщения ленты (`chat/contextMenu.ts`, главный поток — карточки из
// зеркала `core/peerCache.ts`) и поиск сообщения для правки по ↑
// (`messages.getFirstMessageToEdit`, воркер — карточки из кэша `peersManager`).
// Источник карточек поэтому приходит параметром.
//
// Срок правки (`config.edit_time_limit`, :8382-8386) — константой `EDIT_TIME_LIMIT` (48 ч,
// тем же значением сервер отказывает): своего `appConfig` у нас нет.
// Не портированы (фактов нет): `via_bot_id`, `messageMediaToDo`, монофорумы и миграция
// базовой группы. Право `send_plain` оригинала — `send_messages` (гранулярных запретов новых
// слоёв в `ChatRights` нет, `core/peers/rights.ts`). `pFlags.is_outgoing` («ещё не
// отправлено») — дробный номер (`isLocalMessageId`).
import { isLocalMessageId } from '@core/history/messageId'
import type { MyDocument } from '@core/media/messageMedia'
import type { MyMessage } from '@core/models'
import type { Chat, User } from '@core/peers/peer'
import { isAnyChat } from '@core/peers/peerId'
import { isBroadcast } from '@core/peers/predicates'
import { hasRights } from '@core/peers/rights'

/** tweb `config.edit_time_limit` — 48 часов (сервер: `message_edit.go::editTimeLimit`) */
export const EDIT_TIME_LIMIT = 172800

export type CanEditMessageContext = {
  myId: PeerId,
  getPeer: (peerId: PeerId) => User | Chat | undefined,
}

/** tweb `canMessageBeEdited` (:8312-8343) */
export function canMessageBeEdited(message: MyMessage | undefined, kind: 'text' | 'poll', { getPeer }: Pick<CanEditMessageContext, 'getPeer'>): boolean {
  if(!message) return false
  if(isLocalMessageId(message.id)) return false

  const goodMedias = ['messageMediaPhoto', 'messageMediaDocument', 'messageMediaWebPage']
  if(kind === 'poll') {
    goodMedias.push('messageMediaPoll')
  }

  const from = message.fromId !== undefined ? getPeer(message.fromId) : undefined
  if(message._ !== 'message' ||
    message.fwd_from ||
    (message.media && goodMedias.indexOf(message.media._) === -1) ||
    (from?._ === 'user' && from.pFlags?.bot)) {
    return false
  }

  if(message.media?._ === 'messageMediaDocument') {
    const doc = message.media.document as MyDocument | undefined
    if(!doc || doc.type === 'sticker' || doc.type === 'round') {
      return false
    }
  }

  return true
}

/** tweb `canEditMessage` (:8345-8381) */
export default function canEditMessage(message: MyMessage | undefined, kind: 'text' | 'poll', context: CanEditMessageContext): boolean {
  if(!message || !canMessageBeEdited(message, kind, context)) {
    return false
  }

  // * second rule for saved messages, because there is no 'out' flag
  if(message.peerId === context.myId) {
    return true
  }

  const { peerId } = message
  const chat = context.getPeer(peerId) as Chat | undefined
  const canEditMessageInPeer = isBroadcast(chat) ?
    hasRights(chat, 'edit_messages') :
    (
      isAnyChat(peerId) && kind === 'text' ?
        (hasRights(chat, 'send_messages') || hasRights(chat, 'send_media')) :
        true
    ) && !!message.pFlags.out

  // tweb :8382-8386 — срок правки вне peerChannel (наши группы — megagroup, срок у лички)
  if(
    !canEditMessageInPeer || (
      !isAnyChat(peerId) &&
      message.date < (Math.floor(Date.now() / 1000) - EDIT_TIME_LIMIT) &&
      (message as { media?: { _: string } }).media?._ !== 'messageMediaPoll'
    )
  ) {
    return false
  }

  return true
}
