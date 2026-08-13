// Глобальные настройки уведомлений (tweb: notifyUsers/notifyChats/notifyBroadcasts).
// Per-chat mute живёт в dialogs (chatsStore); здесь — только настройки по типам,
// которые перекрывают дефолт для чатов без собственного mute.
import { create } from 'zustand'
import type { NotifySettings, NotifyChatType, NotifyTypeSettings } from '../core/managers/notifyManager'
import type { Dialog } from '../core/models'

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

/**
 * Заглушён ли чат — ЕДИНСТВЕННОЕ место, где записано это правило (порт tweb
 * `isPeerLocalMuted({peerId, respectType: true})`,
 * `lib/appManagers/appNotificationsManager.ts`): свой mute диалога ИЛИ
 * глобально выключенный ТИП чатов.
 *
 * Правило читают три несвязанных потребителя: витрина списка
 * (`core/hooks/useChatList.ts` — серая иконка и бейдж), фильтр папок
 * (`core/hooks/useDialogListSource.ts` — правило `excludeMuted`) и
 * foreground-уведомления (`client/uiNotifications.ts` — гейт звука и
 * Notification). Разъехавшиеся копии выражения — не косметика: у списка и у
 * СЧЁТЧИКА набора папки разошлись бы ответы, фетчер счёл бы нужное количество
 * набранным, и папка с `excludeMuted` перестала бы наполняться вовсе (этот
 * дефект уже ловили — см. докблок `matchesThisFolder` в useDialogListSource).
 * Пин на единственность — `stores/noDuplicateMuteRule.test.ts`.
 *
 * `dialog` опционален: уведомление приходит и по чату, которого ещё нет в
 * зеркале (`client/uiNotifications.ts`) — тогда решают только настройки типа.
 */
export function isDialogMuted(dialog: Pick<Dialog, 'muted' | 'type'> | undefined, settings: NotifySettings): boolean {
  return !!dialog?.muted || settings[notifyTypeForChat(dialog?.type)].muted
}

export async function loadNotifySettings(managers: { notify: { settings(): Promise<NotifySettings> } }): Promise<void> {
  try {
    useNotifyStore.getState().set(await managers.notify.settings())
  } catch {
    /* оффлайн/ошибка — остаются дефолты */
  }
}
