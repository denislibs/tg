// Настройки конфиденциальности (tweb Privacy and Security): правила по ключам
// + счётчик чёрного списка. Загружается один раз на старте (loadPrivacy) и
// обновляется оптимистично из экранов настроек.
import { create } from 'zustand'
import type { PrivacyKey, PrivacyRule, PrivacyValue } from '../core/managers/privacyManager'

// Дефолты зеркалят бэкенд (domain.DefaultPrivacyValue): номер и день рождения —
// контактам, остальное — всем.
export function defaultPrivacyValue(key: PrivacyKey): PrivacyValue {
  return key === 'phone_number' || key === 'birthday' ? 'contacts' : 'everybody'
}

const KEYS: PrivacyKey[] = [
  'phone_number', 'added_by_phone', 'last_seen', 'profile_photo', 'about',
  'calls', 'forwards', 'chat_invite', 'voice_messages', 'messages', 'birthday',
]

function defaults(): Record<PrivacyKey, PrivacyRule> {
  const o = {} as Record<PrivacyKey, PrivacyRule>
  for (const k of KEYS) o[k] = { key: k, value: defaultPrivacyValue(k), allowUserIds: [], denyUserIds: [] }
  return o
}

interface PrivacyState {
  rules: Record<PrivacyKey, PrivacyRule>
  blockedTotal: number
  loaded: boolean
  set: (rules: PrivacyRule[]) => void
  setRule: (rule: PrivacyRule) => void
  setBlockedTotal: (n: number) => void
}

export const usePrivacyStore = create<PrivacyState>((set) => ({
  rules: defaults(),
  blockedTotal: 0,
  loaded: false,
  set: (list) =>
    set((st) => {
      const rules = { ...st.rules }
      for (const r of list) rules[r.key] = r
      return { rules, loaded: true }
    }),
  // оптимистичное обновление из экрана правила
  setRule: (rule) => set((st) => ({ rules: { ...st.rules, [rule.key]: rule } })),
  setBlockedTotal: (n) => set({ blockedTotal: n }),
}))

export async function loadPrivacy(managers: {
  privacy: { rules(): Promise<PrivacyRule[]>; blocked(offset?: number, limit?: number): Promise<{ total: number }> }
}): Promise<void> {
  try {
    usePrivacyStore.getState().set(await managers.privacy.rules())
    usePrivacyStore.getState().setBlockedTotal((await managers.privacy.blocked(0, 1)).total)
  } catch {
    /* оффлайн/ошибка — остаются дефолты */
  }
}
