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
// (`noDialog`), а не форма её id. `draft:<peerId>` остаётся только ключом
// выбора в `navigationStore.selectedId` (хэш, хоткеи) и сущности не касается.
import type { Chat, OpenPeer } from '@/data'
import type { ChatInstanceDesc } from '@stores/chatStackStore'
import { gradientFor } from './dialogToChat'
import { NULL_PEER_ID, parsePeerId } from './peers/peerId'

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

/** Сущность пира без диалога — из личности, по которой его открыли. */
export function draftChatEntity(peer: OpenPeer): Chat {
  return {
    id: String(peer.id),
    noDialog: true,
    name: peer.title,
    avatar: gradientFor(peer.id),
    avatarText: peer.title.charAt(0).toUpperCase() || '?',
    // id медиа аватарки приходит готовым (`photo.photo_id`)
    photoId: peer.photoId,
    preview: '',
    type: 'private',
  }
}

/**
 * Резолв дескриптора стека в сущность: реальный диалог из списка, иначе пир
 * без диалога (открытый `draftPeer` того же ключа), иначе синтетическая
 * сущность треда/комментариев (discussion-группа, где мы можем не состоять).
 * Диалог, появившийся после первого сообщения, выигрывает у черновика того же
 * ключа сам — инстанс и лента при этом не меняются (ключ тот же).
 */
export function resolveChatEntity(desc: ChatInstanceDesc, chatList: readonly Chat[], draftPeer: OpenPeer | null): Chat {
  return chatList.find((c) => c.id === String(desc.peerId)) ??
    (draftPeer && draftPeer.id === desc.peerId ? draftChatEntity(draftPeer) : null) ?? {
      id: String(desc.peerId),
      name: desc.thread?.title ?? '',
      avatar: gradientFor(desc.peerId),
      avatarText: '#',
      preview: '',
      type: 'group',
    }
}
