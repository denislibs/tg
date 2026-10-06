// Порт tweb `src/components/chat/mentionsHelper.ts` (812502980) — подсказка
// участников по `@` в строке ввода. Выбор зовёт `ChatInput.mentionUser`, который
// вставляет `@username` или имя с сущностью `messageEntityMentionName`.
// Пачка П-6, Б-34.
//
// Расхождения с оригиналом:
//  1. Кандидатов собирает `getMentions` ниже — порт `appProfileManager.getMentions`
//     (tweb `appProfileManager.ts:835-915`) на главном потоке: у нашего
//     `profileManager` воркера нет ни участников, ни зеркала карточек. Участники —
//     `groups.getParticipants` с фильтром `channelParticipantsMentions` (`q`,
//     `top_msg_id` темы) — ветка канала; базовых групп нет.
//  2. Лучших инлайн-ботов (`getTopPeers('bots_inline')`), гостевых ботов
//     (`bots_guestchat`) и глобального поиска (`global`, `getContactsPeerIds`) нет:
//     у бэкенда нет топ-пиров и гостевых ботов — Б-136. Поэтому в личном чате
//     подсказка пуста, как у tweb без топ-ботов.
//  3. Фильтр `q` ручке уходит без ведущего `@` (у tweb — как набрано: сервер
//     Telegram `@` сам отбрасывает, наш `ILIKE` — нет).
//  4. `getPeerActiveUsernames(user)[0]` — одно поле `username` (коллекции
//     `usernames` у нас нет, см. `core/peers/peerSearchText.ts`).
import type { Managers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import SearchIndex from '@lib/searchIndex'
import { cachedUser } from '@core/peerCache'
import { isUser, toChatId, toPeerId } from '@core/peers/peerId'
import { getServerMessageId } from '@core/history/messageId'
import type { User } from '@core/peers/peer'
import { getParticipantPeerId } from '@core/peers/participant'
import { getUserSearchText } from '@core/peers/peerSearchText'
import AutocompletePeerHelper from './autocompletePeerHelper'
import type AutocompleteHelperController from './autocompleteHelperController'
import type ChatInput from './input'

type MyTopPeer = { id: PeerId, rating: number }

/** tweb `appProfileManager.getMentions` (`:835-915`) — расхождения 1–3 шапки. */
export async function getMentions(
  managers: Pick<Managers, 'groups'>,
  peerId: PeerId | undefined,
  query: string,
  threadId?: number,
): Promise<PeerId[]> {
  // * карточки ответа — на случай, если зеркало их ещё не получило (`saveApiPeers`
  // * воркера едет событием рядом с ответом)
  const users: Map<PeerId, User> = new Map()
  const processUserIds = (topPeers: MyTopPeer[]) => {
    const startsWithAt = query.charAt(0) === '@'
    if(startsWithAt) query = query.slice(1)

    const hasQuery = !!query.trim()
    if(!hasQuery) {
      return Array.from(new Set(topPeers.map((peer) => peer.id)))
    }

    const index = new SearchIndex<PeerId>({
      ignoreCase: true,
    })

    const ratingMap: Map<PeerId, number> = new Map()
    topPeers.forEach((peer) => {
      index.indexObject(peer.id, getUserSearchText(cachedUser(peer.id) ?? users.get(peer.id)))
      ratingMap.set(peer.id, peer.rating)
    })

    const peerIds = Array.from(index.search(query))
    peerIds.sort((a, b) => ratingMap.get(b)! - ratingMap.get(a)!)
    return peerIds
  }

  let promise: Promise<PeerId[]> | undefined
  if(peerId && !isUser(peerId)) {
    const q = query.replace(/^@/, '') // * расхождение 3
    promise = managers.groups.getParticipants({
      id: toChatId(peerId),
      filter: {
        _: 'channelParticipantsMentions',
        q,
        top_msg_id: threadId ? getServerMessageId(threadId) : undefined,
      },
      limit: 50,
      offset: 0,
    }).then((cP) => {
      cP.users?.forEach((user) => users.set(toPeerId(user.id, false), user))
      return (cP.participants ?? []).map((p) => getParticipantPeerId(p))
    })
  }

  const chatMembers = await promise
  const convertPeerIds = (peerIds: PeerId[] | undefined) => peerIds ? peerIds.map((peerId) => ({ id: peerId, rating: 0 })) : []
  return processUserIds(convertPeerIds(chatMembers))
}

export default class MentionsHelper extends AutocompletePeerHelper {
  constructor(
    appendTo: HTMLElement,
    controller: AutocompleteHelperController,
    chatInput: ChatInput,
    private managers: Managers,
  ) {
    super(
      appendTo,
      controller,
      'mentions-helper',
      (target) => {
        const peerId = +(target as HTMLElement).dataset.peerId! as PeerId
        chatInput.mentionUser(peerId, true)
      },
      'Mention',
      managers,
    )
  }

  /** tweb `:27-70` — без `global`, `includeGuestBots` (расхождение 2). */
  public checkQuery(query: string, peerId: PeerId | undefined, topMsgId?: number) {
    const trimmed = query.trim() // check that there is no whitespace
    if(query.length !== trimmed.length) return false

    const middleware = this.controller!.getMiddleware()
    void getMentions(this.managers, peerId, trimmed, topMsgId).then(async(peerIds) => {
      if(!middleware()) return

      peerIds = peerIds.filter((peerId) => peerId !== rootScope.myId)

      const out = peerIds.map((peerId) => {
        const user = cachedUser(peerId)
        const username = user?._ === 'user' ? user.username : undefined
        return {
          peerId,
          description: username ? '@' + username : undefined,
        }
      })

      if(!middleware()) return
      this.render(out, middleware)
    }).catch(() => {})

    return true
  }
}
