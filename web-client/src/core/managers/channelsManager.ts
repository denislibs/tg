import type { RestClient } from '../net/restClient'
import type { PendingNewEvt } from '../realtime/events'
import { mapMyMessage, mapSuggestedPost, type MyMessage, type RawMyMessage, type MessageEntity, type SuggestedPost, type RawSuggestedPost } from '../models'
import type { Chat, UserReal } from '../peers/peer'
import type { Peer } from '../peers/peerId'
import type { PeersManager } from './peersManager'

// Аргументы «предложить пост в канал» (Telegram suggested posts). publishAt —
// желаемое время публикации в unix-секундах (0/undefined — как можно скорее).
export interface SuggestPostArgs { text: string; entities?: MessageEntity[]; mediaId?: number | null; publishAt?: number }

/**
 * Ответ поиска — конструктор `contacts.found` схемы В КОРНЕ ответа (без нашей
 * обёртки): `results` это вектор `Peer`, а сами карточки лежат в `chats`/
 * `users`. Прежние плоские снимки ({id, display_name, avatar_url} у юзеров,
 * {id, type, title} у чатов) исчезли: вид чата теперь выбор конструктора, имя
 * собирает клиент, аватарка это `photo.photo_id`.
 *
 * `contacts.found#b3134d9d my_results:Vector<Peer> results:Vector<Peer>
 *  chats:Vector<Chat> users:Vector<User> = contacts.Found;`
 */
export interface ContactsFound {
  _: 'contacts.found'
  my_results: Peer[]
  results: Peer[]
  chats: Chat[]
  users: UserReal[]
}

// Кандидат в группу-обсуждение канала (Telegram getGroupsForDiscussion).
export interface DiscussionCandidate { peerId: PeerId; title: string; username: string; memberCount: number }

// Последний комментатор поста — КОНСТРУКТОР `user` под стек аватаров в футере
// «N комментариев» (бэкенд отдаёт их вместе со счётчиками). Прежняя плоская
// тройка {id, display_name, avatar_url} была снимком пользователя рядом с
// настоящим — вторым источником имени и аватарки.
export type CommentReplier = UserReal

export function newChannelsManager({ rest, beforeSending, peers }: {
  rest: Pick<RestClient, 'post' | 'get' | 'put' | 'del'>
  /** Временный бабл поста — та же механика, что у обычной отправки
   *  (messages.beforeMessageSending + веер операций), см. workerCore.ts. */
  beforeSending: (p: PendingNewEvt) => void
  /** Владелец карточек пиров: авторы последних комментариев приезжают попутно
   *  с ответом и обязаны попасть в зеркало — иначе стек аватаров рисует их
   *  фолбэком и ходит за теми же карточками вторым запросом. Порт правила
   *  оригинала «каждый ответ прогоняется через saveApiPeers». */
  peers: Pick<PeersManager, 'saveApiPeers'>
}) {
  return {
    async createChannel(args: { title: string; about?: string; username?: string; isPublic?: boolean }): Promise<number> {
      const r = await rest.post<{ peer_id: number }>('/channels', {
        title: args.title, about: args.about ?? '', username: args.username ?? '', is_public: args.isPublic ?? false,
      })
      return r.peer_id
    },
    // entities — разметка поста (bold/text_link/mention/hashtag…): тот же формат,
    // что у обычной отправки; на бэке проходит sanitizeEntities.
    // optimistic — временный бабл поста (тот же владелец, что у обычной отправки:
    // messages.beforeMessageSending, см. workerCore.ts). Пост канала уходит по
    // REST, а не по WS, поэтому messages.sendText тут не участвует — бабл
    // заводится здесь, живое эхо приезжает кадром new_message и сливается по
    // clientMsgId, как у всех остальных путей. Транспорт другой, владелец бабла
    // тот же — это и есть граница tweb.
    async post(peerId: number, text: string, clientMsgId: string, entities?: MessageEntity[], optimistic?: { senderId: number; threadRootId?: number | null }): Promise<MyMessage> {
      if (optimistic) {
        beforeSending({
          peer_id: peerId, thread_root_id: optimistic.threadRootId ?? null, client_msg_id: clientMsgId,
          sender_id: optimistic.senderId, text, type: 'text', entities,
          // Тот же класс, что `messages.sendText` в tweb: между баблом и уходом
          // запроса ничего не ждём, поэтому позиция бабла внизу окна переживёт
          // финализацию (см. докблок `PendingNewEvt.sequential`).
          sequential: true,
        })
      }
      const r = await rest.post<RawMyMessage>(`/channels/${peerId}/messages`, { text, entities, client_msg_id: clientMsgId })
      return mapMyMessage(r)
    },
    // catch-up канала (GET /channels/{id}/difference) ведёт per-channel funnel в
    // воркере (channelFunnel), а не менеджер — курсор и гейтинг живут там же, где
    // funnel обычных апдейтов. Здесь только команды/запросы к бэку.
    async join(username: string): Promise<void> { await rest.post('/channels/join', { username }) },
    async enableDiscussion(channelPeerId: PeerId): Promise<PeerId> {
      const r = await rest.post<{ discussion_peer_id: PeerId }>(`/channels/${channelPeerId}/discussion`, {})
      return r.discussion_peer_id
    },
    // Привязать существующую группу как обсуждение (Telegram setDiscussionGroup).
    async linkDiscussion(channelPeerId: PeerId, groupPeerId: PeerId): Promise<PeerId> {
      const r = await rest.put<{ discussion_peer_id: PeerId }>(`/channels/${channelPeerId}/discussion`, { group_peer_id: groupPeerId })
      return r.discussion_peer_id
    },
    // Отвязать обсуждение (Telegram setDiscussionGroup с пустой группой).
    async unlinkDiscussion(channelPeerId: PeerId): Promise<void> {
      await rest.del(`/channels/${channelPeerId}/discussion`)
    },
    // Группы, доступные для привязки как обсуждение (Telegram getGroupsForDiscussion).
    async discussionCandidates(channelPeerId: PeerId): Promise<DiscussionCandidate[]> {
      const r = await rest.get<{ chats: { peer_id: PeerId; title: string; username: string; member_count: number }[] }>(`/channels/${channelPeerId}/discussion_candidates`)
      return (r.chats ?? []).map((c) => ({ peerId: c.peer_id, title: c.title, username: c.username, memberCount: c.member_count }))
    },
    // Подпись постов автором (Telegram toggleSignatures). profiles — показывать профиль.
    async setSignatures(channelId: number, signatures: boolean, profiles: boolean): Promise<void> {
      await rest.put(`/channels/${channelId}/sign_messages`, { signatures, profiles })
    },
    async postComment(channelId: number, postId: number, text: string, clientMsgId: string): Promise<MyMessage> {
      const r = await rest.post<RawMyMessage>(`/channels/${channelId}/posts/${postId}/comments`, { text, client_msg_id: clientMsgId })
      return mapMyMessage(r)
    },
    async listComments(channelId: number, postId: number, offset = 0, limit = 50): Promise<{ messages: MyMessage[]; count: number }> {
      const r = await rest.get<{ messages: RawMyMessage[]; count: number }>(`/channels/${channelId}/posts/${postId}/comments`, { offset, limit })
      return { messages: (r.messages ?? []).map((m) => mapMyMessage(m)), count: r.count }
    },
    // Счётчики комментариев + авторы последних комментариев по каждому посту
    // (стек аватаров в футере «N комментариев», как в Telegram).
    async commentCounts(channelId: number, postIds: number[]): Promise<{ counts: Record<number, number>; recent: Record<number, CommentReplier[]> }> {
      if (!postIds.length) return { counts: {}, recent: {} }
      const r = await rest.get<{ counts: Record<string, number>; recent_repliers?: Record<string, UserReal[]> }>(
        `/channels/${channelId}/comment_counts`, { ids: postIds.join(',') })
      const counts: Record<number, number> = {}
      for (const k in r.counts) counts[+k] = r.counts[k]
      // Пиры ответа — владельцу (порт `saveApiPeers`): футер рисует их по
      // КЛЮЧУ, а имя и фото берёт из зеркала.
      for (const k in r.recent_repliers ?? {}) peers.saveApiPeers({ users: r.recent_repliers![k] })
      const recent: Record<number, CommentReplier[]> = {}
      // Маппера нет: карточки кладутся вербатим — форма провода и форма модели
      // совпали.
      for (const k in r.recent_repliers ?? {}) recent[+k] = r.recent_repliers![k] ?? []
      return { counts, recent }
    },
    // Current view counts per channel post ("9.2K 👁"), fetched per open to stay
    // fresh (mirrors commentCounts — channel posts are cached by pts, so a snapshot
    // field would go stale).
    async viewCounts(channelId: number, postIds: number[]): Promise<Record<number, number>> {
      if (!postIds.length) return {}
      const r = await rest.get<{ counts: Record<string, number> }>(`/channels/${channelId}/view_counts`, { ids: postIds.join(',') })
      const out: Record<number, number> = {}
      for (const k in r.counts) out[+k] = r.counts[k]
      return out
    },
    // Предложка постов (Telegram suggested posts).
    async suggestPost(peerId: number, args: SuggestPostArgs): Promise<SuggestedPost> {
      const r = await rest.post<RawSuggestedPost>(`/channels/${peerId}/suggested_posts`, {
        text: args.text, entities: args.entities ?? undefined,
        media_id: args.mediaId ?? null, publish_at: args.publishAt ?? 0,
      })
      return mapSuggestedPost(r)
    },
    async listSuggestedPosts(peerId: number): Promise<SuggestedPost[]> {
      const r = await rest.get<{ posts: RawSuggestedPost[] }>(`/channels/${peerId}/suggested_posts`)
      return (r.posts ?? []).map(mapSuggestedPost)
    },
    async approveSuggestedPost(id: number, publishAt?: number): Promise<SuggestedPost> {
      const r = await rest.post<RawSuggestedPost>(`/suggested_posts/${id}/approve`, { publish_at: publishAt ?? 0 })
      return mapSuggestedPost(r)
    },
    async rejectSuggestedPost(id: number): Promise<SuggestedPost> {
      const r = await rest.post<RawSuggestedPost>(`/suggested_posts/${id}/reject`, {})
      return mapSuggestedPost(r)
    },
    // Похожие каналы (по пересечению аудитории). count — общее число найденных
    // (может превышать длину chats: хвост открывается по Premium).
    // Похожие каналы (Telegram getChannelRecommendations) — вектор
    // конструкторов `channel`, а не плоские снимки.
    async similar(peerId: PeerId): Promise<{ chats: Chat[]; count: number }> {
      const r = await rest.get<{ chats: Chat[]; count: number }>(`/channels/${peerId}/similar`)
      return { chats: r.chats ?? [], count: r.count ?? 0 }
    },
    async search(q: string): Promise<ContactsFound> {
      // Allow "@username" queries: usernames are stored without the @, so strip
      // a leading one before hitting the directory search.
      const query = q.trim().replace(/^@+/, '')
      const empty: ContactsFound = { _: 'contacts.found', my_results: [], results: [], chats: [], users: [] }
      if (!query) return empty
      // Маппера нет: ответ И ЕСТЬ модель — конструктор схемы приходит в корне.
      const r = await rest.get<ContactsFound>('/search', { q: query })
      return { ...empty, ...r }
    },
  }
}
export type ChannelsManager = ReturnType<typeof newChannelsManager>
