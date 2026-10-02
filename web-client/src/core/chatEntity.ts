// Сущность чата колонки (`data.ts::Chat`) для инстанса стека и её ключ пира.
//
// Инвариант сущности — `Chat.id === String(peerId)` (докблок поля в `data.ts`):
// колонка чата и её дети (лента, профиль, шапка, меню) берут ключ как
// `Number(chat.id)`. Сущность «черновика» (пир без диалога: результат
// глобального поиска, контакт, `@username`, «Новое сообщение») раньше носила id
// `draft:<peerId>` и ломала его: лента получала NaN и слала `GET
// /chats/NaN/history` с вечным лоадером, профиль — `/users/NaN/gifts`. У
// оригинала пространства имён `draft:` нет вовсе: пир без диалога открывается
// тем же `appImManager.setInnerPeer({peerId})` (appImManager.ts:3392), и
// `chat.peerId` — всегда число. Отсутствие диалога здесь — ПРИЗНАК сущности
// (`noDialog`), а не форма её id; `draftPeer` навигации снят решением В4-2 (К-2).
import type { Chat } from '@/data'
import { gradientFor } from './dialogToChat'
import { NULL_PEER_ID, parsePeerId } from './peers/peerId'
import { cachedPeer } from './peerCache'
import { getPeerTitle } from './peers/getPeerTitle'
import { getPeerPhotoId } from './peers/peer'

/** Знаковый ключ пира сущности; не ключ — `NULL_PEER_ID`, а не NaN. */
export function chatPeerId(chat: Chat): PeerId {
  return parsePeerId(chat.id)
}

/**
 * За сущностью стоит диалог сервера: гейт путей, которым без диалога нечего
 * делать (пины, отложенные, черновик поля, звонок, поиск по чату). Пир без
 * диалога — ложь до первого сообщения.
 */
export function isDialogChat(chat: Chat): boolean {
  return !chat.noDialog && chatPeerId(chat) !== NULL_PEER_ID
}

/**
 * Сущность пира без диалога — из карточки зеркала пиров (`core/peerCache.ts`):
 * у оригинала пир без диалога открывается тем же `setInnerPeer({peerId})`
 * (appImManager.ts:3392), и шапка читает пира, а не строку списка.
 */
function noDialogChatEntity(peerId: PeerId): Chat | undefined {
  const peer = cachedPeer(peerId)
  if (!peer || peer._ !== 'user') return undefined
  const title = getPeerTitle({ peerId, peer })
  return {
    id: String(peerId),
    noDialog: true,
    name: title,
    avatar: gradientFor(peerId),
    avatarText: title.charAt(0).toUpperCase() || '?',
    // id медиа аватарки приходит готовым (`photo.photo_id`)
    photoId: getPeerPhotoId(peer.photo) || undefined,
    preview: '',
    type: 'private',
  }
}

/**
 * Резолв инстанса чата в сущность: реальный диалог из списка, иначе человек без
 * диалога (карточка зеркала), иначе синтетическая сущность треда/комментариев
 * (discussion-группа, где мы можем не состоять). Диалог, появившийся после
 * первого сообщения, выигрывает сам — инстанс и лента при этом не меняются.
 */
export function resolveChatEntity(desc: { peerId: PeerId, thread?: { title: string } }, chatList: readonly Chat[]): Chat {
  return chatList.find((c) => c.id === String(desc.peerId)) ??
    noDialogChatEntity(desc.peerId) ?? {
      id: String(desc.peerId),
      name: desc.thread?.title ?? '',
      avatar: gradientFor(desc.peerId),
      avatarText: '#',
      preview: '',
      type: 'group',
    }
}
