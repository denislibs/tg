// Настройки конфиденциальности (tweb Privacy and Security): правила по ключам —
// роль кэша `appPrivacyManager`. Загружается один раз на старте (loadPrivacy) и
// обновляется ответами записи из вкладок правил (`privacySection.solid.tsx`).
// Счётчика чёрного списка здесь нет: хаб читает первую страницу сам и
// перечитывает её на `peer_block` (tweb `privacyAndSecurity.tsx:320-337`).
import { create } from 'zustand'
import type { PrivacyKey, PrivacyRule, PrivacyValue } from '../core/managers/privacyManager'

// Дефолты зеркалят бэкенд (domain.DefaultPrivacyValue): номер и день рождения —
// контактам, остальное — всем.
export function defaultPrivacyValue(key: PrivacyKey): PrivacyValue {
  return key === 'phone_number' || key === 'birthday' ? 'contacts' : 'everybody'
}

const KEYS: PrivacyKey[] = [
  'phone_number', 'added_by_phone', 'last_seen', 'profile_photo', 'about',
  'calls', 'forwards', 'chat_invite', 'voice_messages', 'messages', 'birthday', 'read_time',
]

function defaults(): Record<PrivacyKey, PrivacyRule> {
  const o = {} as Record<PrivacyKey, PrivacyRule>
  for (const k of KEYS) o[k] = { key: k, value: defaultPrivacyValue(k), allowUserIds: [], denyUserIds: [] }
  return o
}

interface PrivacyState {
  rules: Record<PrivacyKey, PrivacyRule>
  loaded: boolean
  set: (rules: PrivacyRule[]) => void
  setRule: (rule: PrivacyRule) => void
}

export const usePrivacyStore = create<PrivacyState>((set) => ({
  rules: defaults(),
  loaded: false,
  set: (list) =>
    set((st) => {
      const rules = { ...st.rules }
      for (const r of list) rules[r.key] = r
      return { rules, loaded: true }
    }),
  // оптимистичное обновление из экрана правила
  setRule: (rule) => set((st) => ({ rules: { ...st.rules, [rule.key]: rule } })),
}))

export async function loadPrivacy(managers: {
  privacy: { rules(): Promise<PrivacyRule[]> }
}): Promise<void> {
  try {
    usePrivacyStore.getState().set(await managers.privacy.rules())
  } catch {
    /* оффлайн/ошибка — остаются дефолты */
  }
}
