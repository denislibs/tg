import type { RestClient } from '../net/restClient'
import type { Chat, UserReal } from '../peers/peer'
import type { Peer } from '../peers/peerId'
import { mapPeerProfile, type PeerProfile, type RawPeerProfile } from './authManager'

// Конфиденциальность (tweb Privacy and Security): правила «кто видит/может»
// по ключам + чёрный список + чужой профиль с применёнными правилами.
export type PrivacyKey =
  | 'phone_number'
  | 'added_by_phone'
  | 'last_seen'
  | 'profile_photo'
  | 'about'
  | 'calls'
  | 'forwards'
  | 'chat_invite'
  | 'messages'
  | 'voice_messages'
  | 'birthday'
  | 'read_time'

export type PrivacyValue = 'everybody' | 'contacts' | 'nobody'

export interface PrivacyRule {
  key: PrivacyKey
  value: PrivacyValue
  allowUserIds: number[]
  denyUserIds: number[]
}

/**
 * Чёрный список — конструктор `contacts.blockedSlice` схемы В КОРНЕ ответа:
 * `blocked` это вектор `peerBlocked{peer_id: Peer, date}`, а сами карточки
 * лежат в `users`. Плоской четвёрки {userId, displayName, avatarUrl, phone}
 * больше нет — она была снимком пользователя рядом с настоящим.
 *
 * `contacts.blockedSlice#e1664194 count:int blocked:Vector<PeerBlocked>
 *  chats:Vector<Chat> users:Vector<User> = contacts.Blocked;`
 */
export interface PeerBlocked { _: 'peerBlocked'; peer_id: Peer; date: number }
export interface ContactsBlockedSlice {
  _: 'contacts.blockedSlice'
  count: number
  blocked: PeerBlocked[]
  chats: Chat[]
  users: UserReal[]
}

interface RuleWire {
  key: PrivacyKey
  value: PrivacyValue
  allow_user_ids: number[]
  deny_user_ids: number[]
}

const fromWire = (r: RuleWire): PrivacyRule => ({
  key: r.key,
  value: r.value,
  allowUserIds: r.allow_user_ids ?? [],
  denyUserIds: r.deny_user_ids ?? [],
})

export function newPrivacyManager({ rest }: { rest: Pick<RestClient, 'get' | 'put' | 'post' | 'del'> }) {
  return {
    async rules(): Promise<PrivacyRule[]> {
      const res = await rest.get<{ rules: RuleWire[] }>('/me/privacy')
      return (res.rules ?? []).map(fromWire)
    },
    async setRule(rule: PrivacyRule): Promise<PrivacyRule> {
      const res = await rest.put<RuleWire>(`/me/privacy/${rule.key}`, {
        value: rule.value,
        allow_user_ids: rule.allowUserIds,
        deny_user_ids: rule.denyUserIds,
      })
      return fromWire(res)
    },
    async blocked(offset = 0, limit = 50): Promise<ContactsBlockedSlice> {
      // Маппера нет: ответ И ЕСТЬ модель — конструктор схемы приходит в корне.
      const res = await rest.get<ContactsBlockedSlice>(`/me/blocked?offset=${offset}&limit=${limit}`)
      return {
        ...res,
        _: 'contacts.blockedSlice',
        count: res.count ?? 0,
        blocked: res.blocked ?? [],
        chats: res.chats ?? [],
        users: res.users ?? [],
      }
    },
    async block(userId: number): Promise<void> {
      await rest.post('/me/blocked', { user_id: userId })
    },
    async unblock(userId: number): Promise<void> {
      await rest.del(`/me/blocked/${userId}`)
    },
    // Автоудаление сообщений: глобальный период (новые чаты) и период чата.
    async autoDelete(): Promise<number> {
      return (await rest.get<{ period: number }>('/me/auto_delete')).period
    },
    async setAutoDelete(period: number): Promise<void> {
      await rest.put('/me/auto_delete', { period })
    },
    async setChatAutoDelete(peerId: number, period: number): Promise<void> {
      await rest.put(`/chats/${peerId}/auto_delete`, { period })
    },
    /**
     * Чужой профиль — ТОТ ЖЕ конструктор `users.userFull`, что отдаёт `/me`:
     * трёх разных витрин пользователя больше нет. Правила приватности при этом
     * не исчезли — они выражены САМИМИ конструкторами и отсутствием ключей:
     * скрытая аватарка это `userProfilePhotoEmpty`, скрытое «был в сети» —
     * `userStatusRecently`, скрытые `about`/`birthday`/`phone` — отсутствие
     * ключа. Прежние `last_seen_visible` рядом с обнулённым временем и
     * `is_blocked`/`calls_available` плоскими полями стали `pFlags` у
     * `userFull`; `can_message` остался полем УРОВНЯ ОТВЕТА — схемного места
     * у него нет.
     */
    async profile(userId: number): Promise<PeerProfile> {
      return mapPeerProfile(await rest.get<RawPeerProfile>(`/users/${userId}`))
    },
  }
}

export type PrivacyManager = ReturnType<typeof newPrivacyManager>
