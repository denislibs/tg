// src/core/managers/chatsManager.ts
import { HttpError, type RestClient } from '../net/restClient'
import { clearPersistedChat } from '../store/persist'
import type { Chat, UserReal } from '../peers/peer'
import { getPeerId, type Peer } from '../peers/peerId'
import { generateMessageId } from '../history/messageId'
import type { MyMessage, RawMyMessage } from '../models'
import type { MessagesManager } from './messagesManager'
import type { PeersManager } from './peersManager'

export interface ChatsDeps {
  rest: RestClient
  // Владельцы карточек и сообщений: контейнер «Избранного» несёт векторы
  // `chats`/`users`/`messages`, и они обязаны доехать до своих хранилищ —
  // строка списка держит только ССЫЛКИ. Оба опциональны по той же причине,
  // что у диалогов: тесты, которых контейнер не касается, их не задают.
  peers?: Pick<PeersManager, 'saveApiPeers'>
  messages?: Pick<MessagesManager, 'saveApiMessages' | 'getMessageByPeer'>
}

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
export function newChatsManager({ rest, peers, messages }: ChatsDeps) {
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

    /**
     * «Избранное» → таб «Чаты»: сохранённые сообщения, сгруппированные по
     * источнику пересылки — контейнер `messages.savedDialogs`.
     *
     * Порядок обязателен и он же — порядок оригинала: сначала в хранилища
     * втекают ПИРЫ и СООБЩЕНИЯ, и только потом разрешаются ссылки на них.
     * Прежде строка везла снимок источника (`title`, `photo_id`) и выжимку
     * последнего сообщения; теперь имя и аватарку даёт карточка пира, а превью
     * — само сообщение.
     */
    async savedDialogs(): Promise<SavedDialog[]> {
      const r = await rest.get<MessagesSavedDialogs>('/saved/dialogs')
      peers?.saveApiPeers({ chats: r.chats, users: r.users })
      await messages?.saveApiMessages(r.messages)
      return (r.dialogs ?? []).map((d) => {
        const peerId = getPeerId(d.peer)
        const topMessage = generateMessageId(d.top_message)
        return { peerId, lastMessage: messages?.getMessageByPeer(peerId, topMessage) }
      })
    },
  }
}

/**
 * `messages.savedDialogs` — контейнер «Избранного».
 *
 * СТРОКА несёт только ссылки (`savedDialog{peer, top_message}`): вида
 * источника строкой (`kind`), его заголовка с аватаркой и счётчика сообщений
 * на проводе больше нет. Вид отвечает знак ключа, «мои заметки» — совпадение
 * ключа с собой, имя и фото — карточка пира, превью — само сообщение.
 */
export interface MessagesSavedDialogs {
  _: 'messages.savedDialogs'
  dialogs: { _: 'savedDialog'; peer: Peer; top_message: number }[]
  messages: RawMyMessage[]
  chats: Chat[]
  users: UserReal[]
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

/**
 * Строка «Избранного»: ИСТОЧНИК плюс его последнее сохранённое сообщение.
 *
 * Ни заголовка, ни аватарки, ни счётчика здесь нет — имя и фото берутся из
 * карточки пира (зеркало `core/peerCache.ts`), превью и время из самого
 * сообщения. «Мои заметки» — строка, чей источник совпадает со зрителем.
 */
export interface SavedDialog {
  peerId: PeerId
  lastMessage?: MyMessage
}

export type ChatsManager = ReturnType<typeof newChatsManager>
