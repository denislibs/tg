import type { RestClient } from '../net/restClient'
import type { PendingNewEvt } from '../realtime/events'
import { mapMyMessage, mapSuggestedPost, type MyMessage, type RawMyMessage, type MessageEntity, type SuggestedPost, type RawSuggestedPost } from '../models'
import type { Chat, MessagesChatFull, UserReal } from '../peers/peer'
import type { Peer } from '../peers/peerId'
import { getPeerId } from '../peers/peerId'
import { getServerMessageId } from '../history/messageId'
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

// ОПРОСА счётчиков поста (просмотры, тред комментариев) здесь больше нет, и это
// не перенос кода, а исчезновение предмета: оба — параметры самого сообщения
// (`views`, `replies`) и приезжают внутри пачки истории. Ручки
// `/channels/{id}/view_counts` и `/channels/{id}/comment_counts` читали ТЕ ЖЕ
// данные вторым запросом (docs/contracts.md:473, docs/readiness/
// tl-message-analysis.md:473); обновление уже показанной ленты идёт кадрами.
//
// Осталась РЕГИСТРАЦИЯ просмотра — `registerViews` ниже. Это другое действие:
// оригинал делает его тем же методом с флагом (`messages.getMessagesViews` с
// `increment: true`, tweb appMessagesManager.ts:9136-9156), у нас читающая
// половина уже была ручкой, поэтому пишущая стала соседней.

/**
 * `messages.messageViews` — контейнер ответа на регистрацию просмотра.
 *
 * Вектор ПОЗИЦИОННЫЙ (i-й элемент отвечает i-му номеру запроса) и несёт уже
 * НОВЫЕ значения; номеру, которому не отвечает пост канала, приезжает
 * `messageViews` без параметров — отсюда `views?`.
 */
interface MessagesMessageViews {
  _: 'messages.messageViews'
  views: { _: 'messageViews'; views?: number }[]
  chats: Chat[]
  users: UserReal[]
}

export function newChannelsManager({ rest, beforeSending, peers, cacheViews }: {
  rest: Pick<RestClient, 'post' | 'get' | 'put' | 'del'>
  /** Временный бабл поста — та же механика, что у обычной отправки
   *  (messages.beforeMessageSending + веер операций), см. workerCore.ts. */
  beforeSending: (p: PendingNewEvt) => void
  /** Владелец карточек пиров: авторы последних комментариев приезжают попутно
   *  с ответом и обязаны попасть в зеркало — иначе стек аватаров рисует их
   *  фолбэком и ходит за теми же карточками вторым запросом. Порт правила
   *  оригинала «каждый ответ прогоняется через saveApiPeers». */
  peers: Pick<PeersManager, 'saveApiPeers'>
  /** Владелец счётчика просмотров — окно (`messages.cacheViews`): число живёт
   *  ВНУТРИ сообщения. Ответ на регистрацию несёт уже новые значения, и
   *  оригинал применяет их у себя тем же путём, что и кадр, —
   *  `processLocalUpdate({_: 'updateChannelMessageViews', …})` на каждый номер
   *  (tweb appMessagesManager.ts:9148-9155). Инъекцией, а не импортом: тем же
   *  приёмом сюда приходит `beforeSending`. */
  cacheViews: (peerId: number, views: Map<number, number>) => void
}) {
  return {
    /**
     * Создать канал. Ответ — СОЗДАННЫЙ объект (`messages.chatFull`), тем же
     * конструктором, что у карточки чата; адреса в безымянной обёртке больше
     * нет. Карточка сразу уезжает в зеркало пиров.
     */
    async createChannel(args: { title: string; about?: string; username?: string; isPublic?: boolean }): Promise<number> {
      const r = await rest.post<MessagesChatFull>('/channels', {
        title: args.title, about: args.about ?? '', username: args.username ?? '', is_public: args.isPublic ?? false,
      })
      peers.saveApiPeers(r)
      const chat = r?.chats?.[0]
      return chat ? getPeerId({ _: 'peerChannel', channel_id: chat.id }) : 0
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
      // Кандидаты — КАРТОЧКИ чатов (`messages.chats`), а не выжимка из
      // четырёх полей: имя, username и число участников живут в самом
      // конструкторе `channel`, а ключ выводится из него же.
      const r = await rest.get<{ _: 'messages.chats'; chats: Chat[] }>(`/channels/${channelPeerId}/discussion_candidates`)
      peers.saveApiPeers({ chats: r.chats })
      return (r.chats ?? []).map((c) => ({
        peerId: getPeerId({ _: 'peerChannel', channel_id: c.id }),
        title: 'title' in c ? c.title : '',
        username: ('username' in c ? c.username : '') ?? '',
        memberCount: ('participants_count' in c ? c.participants_count : 0) ?? 0,
      }))
    },
    /**
     * РЕГИСТРАЦИЯ просмотра постов, доехавших до экрана, — порт
     * `appMessagesManager.incrementMessageViews` (tweb :9136-9156).
     *
     * Не опрос: счётчик поста растёт ровно один раз на пару «пост + зритель»,
     * повторный показ ничего не меняет. Кого регистрировать, решает интерсектор
     * ленты с дебаунсом в секунду (`chat/bubbles.ts`, порт tweb :2129-2147 и
     * :2305-2328) — здесь только запрос.
     *
     * Ответ применяется У СЕБЯ, как в оригинале: он несёт уже новые значения, а
     * кадр `views_update`, который сервер шлёт в топик канала, — доставка
     * best-effort. Владелец числа при этом один и тот же (`messages.cacheViews`),
     * поэтому второй записи в окно не возникает, а повтор идемпотентен —
     * одинаковое значение `cacheViews` не патчит.
     *
     * Пустой список отсекается здесь же (tweb :9137-9139): дебаунс срабатывает и
     * на уже опустошённом наборе.
     */
    async registerViews(peerId: number, msgIds: number[]): Promise<void> {
      if (!msgIds.length) return
      const r = await rest.post<MessagesMessageViews>(`/channels/${peerId}/views`, {
        ids: msgIds.map(getServerMessageId),
      })
      // tweb :9146 — карточки, приехавшие с ответом, в зеркало ПЕРЕД применением.
      peers.saveApiPeers(r)
      const views = new Map<number, number>()
      msgIds.forEach((msgId, i) => {
        const n = r.views?.[i]?.views
        if (typeof n === 'number') views.set(msgId, n)
      })
      cacheViews(peerId, views)
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
