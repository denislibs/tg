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

/**
 * Правило аудитории — КОНСТРУКТОР объединения `PrivacyRule` схемы.
 *
 * Настройка одного ключа это ВЕКТОР таких правил: базовое значение
 * (`privacyValueAllowAll` / `AllowContacts` / `DisallowAll`) плюс исключения
 * (`privacyValueAllowUsers`, `privacyValueDisallowUsers`) — равноправные
 * элементы одного вектора, а не «значение строкой и два списка рядом».
 */
export type PrivacyRuleWire =
  | { _: 'privacyValueAllowAll' }
  | { _: 'privacyValueAllowContacts' }
  | { _: 'privacyValueAllowCloseFriends' }
  | { _: 'privacyValueDisallowAll' }
  | { _: 'privacyValueDisallowContacts' }
  | { _: 'privacyValueAllowUsers'; users: number[] }
  | { _: 'privacyValueDisallowUsers'; users: number[] }

/** account.privacyRules — витрина ОДНОГО ключа. Ключа в ответе нет: его знает
 *  спросивший (порт `account.getPrivacy`). */
export interface AccountPrivacyRules {
  _: 'account.privacyRules'
  rules: PrivacyRuleWire[]
  chats: unknown[]
  users: UserReal[]
}

/**
 * Правило в форме ЭКРАНА: тройной выбор плюс два списка исключений.
 *
 * Это не проводная форма и не второй её экземпляр, а то, чем оперирует
 * интерфейс: три радиокнопки и два списка. Перевод в вектор конструкторов и
 * обратно — ниже, в одном месте, обеими половинами рядом.
 */
export interface PrivacyRule {
  key: PrivacyKey
  value: PrivacyValue
  allowUserIds: number[]
  denyUserIds: number[]
}

/** Порядок ключей раздела настроек (порядок секции Privacy в tweb). */
export const PRIVACY_KEYS: PrivacyKey[] = [
  'phone_number', 'added_by_phone', 'last_seen', 'profile_photo',
  'about', 'calls', 'forwards', 'chat_invite',
  'voice_messages', 'messages', 'birthday', 'read_time',
]

/** Ключ настройки на проводе — конструктор `PrivacyKey`, а не наша строка. */
const KEY_TAGS: Record<PrivacyKey, string> = {
  phone_number: 'privacyKeyPhoneNumber',
  added_by_phone: 'privacyKeyAddedByPhone',
  last_seen: 'privacyKeyStatusTimestamp',
  profile_photo: 'privacyKeyProfilePhoto',
  about: 'privacyKeyAbout',
  birthday: 'privacyKeyBirthday',
  calls: 'privacyKeyPhoneCall',
  forwards: 'privacyKeyForwards',
  chat_invite: 'privacyKeyChatInvite',
  voice_messages: 'privacyKeyVoiceMessages',
  // Два НАШИХ конструктора: у оригинала предмет есть, но двузначный (флаги
  // globalPrivacySettings), а экран предлагает им тот же выбор из трёх.
  messages: 'privacyKeyMessages',
  read_time: 'privacyKeyReadTime',
}

/** Экранная форма → вектор конструкторов. Исключения идут ПЕРЕД базовым
 *  значением: правило, поставленное после «всем», уже ничего не изменит. */
export function toPrivacyRules(rule: PrivacyRule): PrivacyRuleWire[] {
  const out: PrivacyRuleWire[] = []
  if (rule.allowUserIds.length) out.push({ _: 'privacyValueAllowUsers', users: rule.allowUserIds })
  if (rule.denyUserIds.length) out.push({ _: 'privacyValueDisallowUsers', users: rule.denyUserIds })
  if (rule.value === 'everybody') out.push({ _: 'privacyValueAllowAll' })
  else if (rule.value === 'contacts') out.push({ _: 'privacyValueAllowContacts' })
  else out.push({ _: 'privacyValueDisallowAll' })
  return out
}

/** Вектор конструкторов → экранная форма. */
export function fromPrivacyRules(key: PrivacyKey, rules: PrivacyRuleWire[]): PrivacyRule {
  const out: PrivacyRule = { key, value: 'everybody', allowUserIds: [], denyUserIds: [] }
  for (const r of rules ?? []) {
    switch (r._) {
      case 'privacyValueAllowAll': out.value = 'everybody'; break
      case 'privacyValueAllowContacts': out.value = 'contacts'; break
      case 'privacyValueDisallowAll': out.value = 'nobody'; break
      case 'privacyValueAllowUsers': out.allowUserIds = r.users ?? []; break
      case 'privacyValueDisallowUsers': out.denyUserIds = r.users ?? []; break
    }
  }
  return out
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

export function newPrivacyManager({ rest }: { rest: Pick<RestClient, 'get' | 'put' | 'post' | 'del'> }) {
  return {
    /**
     * Правила ВСЕХ ключей.
     *
     * Спрашиваются по одному — как у оригинала (`account.getPrivacy` берёт один
     * ключ, а раздел настроек обходит их по очереди,
     * privacyAndSecurity.tsx:574). Ручки «все разом» на проводе нет: у ответа
     * `account.privacyRules` параметра ключа не бывает, его знает спросивший.
     */
    async rules(): Promise<PrivacyRule[]> {
      return Promise.all(PRIVACY_KEYS.map((key) => this.rule(key)))
    },
    async rule(key: PrivacyKey): Promise<PrivacyRule> {
      const res = await rest.get<AccountPrivacyRules>(`/me/privacy/${KEY_TAGS[key]}`)
      return fromPrivacyRules(key, res.rules)
    },
    async setRule(rule: PrivacyRule): Promise<PrivacyRule> {
      const res = await rest.put<AccountPrivacyRules>(`/me/privacy/${KEY_TAGS[rule.key]}`, {
        rules: toPrivacyRules(rule),
      })
      return fromPrivacyRules(rule.key, res.rules)
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
