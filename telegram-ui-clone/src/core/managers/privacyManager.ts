import type { RestClient } from '../net/restClient'

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

export type PrivacyValue = 'everybody' | 'contacts' | 'nobody'

export interface PrivacyRule {
  key: PrivacyKey
  value: PrivacyValue
  allowUserIds: number[]
  denyUserIds: number[]
}

export interface BlockedUser {
  userId: number
  username: string
  displayName: string
  avatarUrl: string
  phone: string
}

// Чужой профиль после применения privacy на бэке: скрытые поля пустые/null.
export interface UserProfile {
  id: number
  username: string | null
  firstName: string
  lastName: string
  displayName: string
  bio: string
  birthday: string | null
  avatarUrl: string
  phone: string
  verified: boolean
  isBlocked: boolean
  callsAvailable: boolean
  canMessage: boolean
  lastSeenVisible: boolean
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
    async blocked(offset = 0, limit = 50): Promise<{ users: BlockedUser[]; total: number }> {
      const res = await rest.get<{
        users: { user_id: number; username: string; display_name: string; avatar_url: string; phone: string }[]
        total: number
      }>(`/me/blocked?offset=${offset}&limit=${limit}`)
      return {
        total: res.total,
        users: (res.users ?? []).map((u) => ({
          userId: u.user_id,
          username: u.username,
          displayName: u.display_name,
          avatarUrl: u.avatar_url,
          phone: u.phone,
        })),
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
    async setChatAutoDelete(chatId: number, period: number): Promise<void> {
      await rest.put(`/chats/${chatId}/auto_delete`, { period })
    },
    async profile(userId: number): Promise<UserProfile> {
      const res = await rest.get<{
        id: number
        username: string | null
        first_name: string
        last_name: string
        display_name: string
        bio: string
        birthday: string | null
        avatar_url: string
        phone: string
        verified: boolean
        is_blocked: boolean
        calls_available: boolean
        can_message: boolean
        last_seen_visible: boolean
      }>(`/users/${userId}`)
      return {
        id: res.id,
        username: res.username,
        firstName: res.first_name,
        lastName: res.last_name,
        displayName: res.display_name,
        bio: res.bio,
        birthday: res.birthday,
        avatarUrl: res.avatar_url,
        phone: res.phone,
        verified: res.verified,
        isBlocked: res.is_blocked,
        callsAvailable: res.calls_available,
        canMessage: res.can_message,
        lastSeenVisible: res.last_seen_visible,
      }
    },
  }
}

export type PrivacyManager = ReturnType<typeof newPrivacyManager>
