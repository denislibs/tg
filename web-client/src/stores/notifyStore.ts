// Глобальные настройки уведомлений (tweb: notifyUsers/notifyChats/notifyBroadcasts).
// Per-chat mute живёт в dialogs (chatsStore); здесь — только настройки по типам,
// которые перекрывают дефолт для чатов без собственного mute.
import { create } from 'zustand'
import type { NotifySettings, NotifyChatType, NotifyTypeSettings } from '../core/managers/notifyManager'

const DEFAULTS: NotifySettings = {
  private: { muted: false, preview: true },
  groups: { muted: false, preview: true },
  channels: { muted: false, preview: true },
}

interface NotifyState {
  settings: NotifySettings
  loaded: boolean
  set: (s: NotifySettings) => void
  setType: (t: NotifyChatType, patch: Partial<NotifyTypeSettings>) => void
}

export const useNotifyStore = create<NotifyState>((set) => ({
  settings: DEFAULTS,
  loaded: false,
  set: (s) => set({ settings: s, loaded: true }),
  // оптимистичное обновление из экрана настроек
  setType: (t, patch) =>
    set((st) => ({ settings: { ...st.settings, [t]: { ...st.settings[t], ...patch } } })),
}))

// Тип чата → ключ настроек ('saved' считаем private, как на бэке).
export function notifyTypeForChat(chatType: string | undefined): NotifyChatType {
  if (chatType === 'group') return 'groups'
  if (chatType === 'channel') return 'channels'
  return 'private'
}

export async function loadNotifySettings(managers: { notify: { settings(): Promise<NotifySettings> } }): Promise<void> {
  try {
    useNotifyStore.getState().set(await managers.notify.settings())
  } catch {
    /* оффлайн/ошибка — остаются дефолты */
  }
}
