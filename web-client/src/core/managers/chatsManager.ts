// src/core/managers/chatsManager.ts
import { HttpError, type RestClient } from '../net/restClient'
import { clearPersistedChat } from '../store/persist'
import type { Chat, UserReal } from '../peers/peer'
import type { Peer } from '../peers/peerId'

export interface ChatsDeps { rest: RestClient }

// Результат read-date исходящего сообщения (tweb getOutboxReadDate):
//  { readAt } — прочитано, время в ISO;
//  { restricted: true } — read-time скрыт (взаимность) → 403;
//  null — недоступно (не приватный/не исходящее/ещё не прочитано) → строку прячем.
// Статус HTTP различаем здесь, в воркере: через RPC-границу он бы потерялся.
export type ReadDateResult = { readAt: string } | { restricted: true } | null

// Fix (ревью Task 6, Minor): `listDialogs()` отсюда снесён — с переноса
// владения списком диалогов в `core/managers/dialogsManager.ts` (Tasks 1-6)
// он больше нигде не звался (`dialogsManager.refresh()` бьёт в `rest.get('/chats')`
// напрямую, свой собственный офлайн-фолбэк — `loadCache()`/`persist.loadDialogs`,
// см. dialogsManager.ts). Осиротевший метод + его тест (`chatsManager.test.ts`,
// целиком про listDialogs) удалены вместе.
export function newChatsManager({ rest }: ChatsDeps) {
  return {
    // Resolve (creating if needed) the private chat with a user; returns its id.
    // Idempotent server-side — repeated calls return the same chat.
    async createPrivate(userId: number): Promise<number> {
      const r = await rest.post<{ peer_id: number }>('/chats', { user_id: userId })
      return r.peer_id
    },

    // Resolve (creating on first access) the "Saved Messages" self-chat; returns its id.
    async saved(): Promise<number> {
      const r = await rest.post<{ peer_id: number }>('/saved', {})
      return r.peer_id
    },

    // «Очистить историю» у себя (Telegram deleteHistory just_clear): сообщения
    // скрываются только для меня, у остальных участников остаются.
    async clearHistory(peerId: number): Promise<void> {
      await rest.post(`/chats/${peerId}/clear`, {})
      void clearPersistedChat(peerId) // офлайн-история чата тоже очищается
    },

    // Когда получатель прочитал исходящее сообщение в приватном чате
    // (tweb getOutboxReadDate). Ленивая подгрузка при открытии меню.
    async getReadDate(peerId: number, msgId: number): Promise<ReadDateResult> {
      try {
        // Конструктор `outboxReadDate`: дата в СЕКУНДАХ эпохи, как у всех дат схемы.
        const r = await rest.get<{ _: 'outboxReadDate'; date: number }>(`/chats/${peerId}/messages/${msgId}/read_date`)
        return { readAt: new Date(r.date * 1000).toISOString() }
      } catch (e) {
        if (e instanceof HttpError && e.status === 403) return { restricted: true }
        return null
      }
    },

    // Доступные «личности отправителя» (Telegram channels.getSendAs): сам
    // пользователь + привязанный канал (если юзер его админ) + сама супергруппа
    // (анонимный админ). Для приватных/каналов — только сам пользователь.
    async getSendAs(peerId: PeerId): Promise<ChannelsSendAsPeers> {
      const empty: ChannelsSendAsPeers = { _: 'channels.sendAsPeers', peers: [], chats: [], users: [] }
      try {
        // Маппера нет: ответ И ЕСТЬ модель — конструктор схемы в корне.
        const r = await rest.get<ChannelsSendAsPeers>(`/chats/${peerId}/send_as`)
        return { ...empty, ...r }
      } catch {
        return empty
      }
    },

    // «Избранное» → таб «Чаты»: сохранённые сообщения, сгруппированные по
    // источнику пересылки (tweb saved dialogs); 'self' — «Мои заметки».
    async savedDialogs(): Promise<SavedDialog[]> {
      const r = await rest.get<{ dialogs: RawSavedDialog[] }>('/saved/dialogs')
      return (r.dialogs ?? []).map((d) => ({
        kind: d.kind,
        peerId: d.peer_id,
        title: d.title,
        photoId: d.photo_id || undefined,
        count: d.count,
        last: {
          type: d.last_message.type,
          text: d.last_message.text,
          mediaId: d.last_message.media_id || undefined,
          at: d.last_message.at,
        },
      }))
    },
  }
}

interface RawSavedDialog {
  kind: 'self' | 'user' | 'chat'
  peer_id: PeerId
  title: string
  /** id медиа фото источника; 0 — фото нет (прежний `photo_url` был строкой,
   *  собранной из этого же числа) */
  photo_id: number
  count: number
  last_message: { type: string; text: string; media_id: number; at: string }
}

/**
 * «Личности отправителя» в композере — раскладка `channels.sendAsPeers`
 * оригинала: ССЫЛКИ на пиры отдельно (`peers`), их тела — векторами
 * `users`/`chats`. Вид личности («это канал, а это я сам») читается из
 * КОНСТРУКТОРА тела, а не из строкового `kind` рядом; имя собирает клиент,
 * аватарка — `photo.photo_id`.
 *
 * `channels.sendAsPeers#f496b0c6 peers:Vector<SendAsPeer> chats:Vector<Chat>
 *  users:Vector<User> = channels.SendAsPeers;`
 */
export interface SendAsPeer { _: 'sendAsPeer'; peer: Peer }
export interface ChannelsSendAsPeers {
  _: 'channels.sendAsPeers'
  peers: SendAsPeer[]
  chats: Chat[]
  users: UserReal[]
}

// One grouped row of Saved Messages (source peer + its newest saved message).
export interface SavedDialog {
  kind: 'self' | 'user' | 'chat'
  peerId: PeerId
  title: string
  /** id медиа фото источника; undefined — фото нет */
  photoId?: number
  count: number
  last: { type: string; text: string; mediaId?: number; at: string }
}

export type ChatsManager = ReturnType<typeof newChatsManager>
