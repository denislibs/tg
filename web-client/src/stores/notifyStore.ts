// Глобальные настройки уведомлений (tweb: notifyUsers/notifyChats/notifyBroadcasts).
// Per-chat mute живёт в dialogs (chatsStore); здесь — только настройки по типам,
// которые перекрывают дефолт для чатов без собственного mute.
import { create } from 'zustand'
import type { NotifySettings, NotifyChatType, NotifyTypeSettings } from '../core/managers/notifyManager'
import type { Dialog } from '../core/models'
import type { Chat } from '../core/peers/peer'
import { isBroadcast } from '../core/peers/predicates'
import { isUser } from '../core/peers/peerId'
import { isPeerMuted } from '../core/dialogs/notifySettings'

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

/**
 * Вид пира → ключ ГЛОБАЛЬНЫХ настроек ('saved' и секретный считаются private,
 * как на бэке).
 *
 * Спрашивает конструктор, а не строку: вид чата с провода снят (решение Р8
 * разбора диалогов), и «канал это или группа» отвечает тот же предикат, что и
 * везде. Карточки чата ещё нет — вопрос решается фолбэком предиката, то есть
 * «группа»: это мягче, чем ошибочно применить настройку каналов.
 */
export function notifyTypeForChat(peerId: PeerId | undefined, chat: Chat | undefined): NotifyChatType {
  if (peerId === undefined || isUser(peerId)) return 'private'
  return isBroadcast(chat) ? 'channels' : 'groups'
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
 * `chat` — карточка пира из зеркала (`core/peerCache.ts`); нужна ровно за тем,
 * чтобы отличить канал от группы, потому что строки `type` у диалога больше нет.
 */
export function isDialogMuted(
  dialog: Pick<Dialog, 'peerId' | 'notify_settings'> | undefined,
  chat: Chat | undefined,
  settings: NotifySettings,
  now = Math.floor(Date.now() / 1000),
): boolean {
  // Свой мьют диалога — теперь СРОК, а не признак: `isPeerMuted` порт
  // `appNotificationsManager.isMuted` (`:255`). Ниже — то же, что и было:
  // глобально выключенный ТИП чатов.
  return isPeerMuted(dialog?.notify_settings, now) || settings[notifyTypeForChat(dialog?.peerId, chat)].muted
}

export async function loadNotifySettings(managers: { notify: { settings(): Promise<NotifySettings> } }): Promise<void> {
  try {
    useNotifyStore.getState().set(await managers.notify.settings())
  } catch {
    /* оффлайн/ошибка — остаются дефолты */
  }
}
