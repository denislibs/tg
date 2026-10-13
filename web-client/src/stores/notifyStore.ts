// Глобальные настройки уведомлений (tweb: notifyUsers/notifyChats/notifyBroadcasts).
// Per-chat mute живёт в dialogs (chatsStore); здесь — только настройки по типам,
// которые перекрывают дефолт для чатов без собственного mute.
//
// Значение — конструктор `peerNotifySettings` (срок мьюта + показ превью), как у
// tweb `appNotificationsManager.peerSettings[notifyUsers|…]`; обновляется
// событием `notify_settings` (`savePeerSettings`, tweb :504-538).
import { create } from 'zustand'
import type { NotifySettings, NotifyTypeKey } from '../core/managers/notifyManager'
import type { Dialog } from '../core/models'
import type { Chat } from '../core/peers/peer'
import { isBroadcast } from '../core/peers/predicates'
import { isUser } from '../core/peers/peerId'
import { isPeerMuted, type PeerNotifySettings } from '../core/dialogs/notifySettings'

const DEFAULT_TYPE: PeerNotifySettings = { _: 'peerNotifySettings', mute_until: 0, show_previews: true }
const DEFAULTS: NotifySettings = {
  notifyUsers: DEFAULT_TYPE,
  notifyChats: DEFAULT_TYPE,
  notifyBroadcasts: DEFAULT_TYPE,
}

interface NotifyState {
  settings: NotifySettings
  loaded: boolean
  set: (s: NotifySettings) => void
  /** Событие `notify_settings`: переданные поля накладываются на текущие
   *  (сервер всегда шлёт оба, местный апдейт после PUT — только то, что отправлено). */
  apply: (key: NotifyTypeKey, s: PeerNotifySettings) => void
}

export const useNotifyStore = create<NotifyState>((set) => ({
  settings: DEFAULTS,
  loaded: false,
  set: (s) => set({ settings: s, loaded: true }),
  apply: (key, s) =>
    set((st) => {
      const prev = st.settings[key]
      const next = { ...prev, ...s }
      if (next.mute_until === prev.mute_until && next.show_previews === prev.show_previews && next.silent === prev.silent) return st
      return { settings: { ...st.settings, [key]: next } }
    }),
}))

/** Заглушён ли ТИП чатов (tweb `isMuted(settings)`: `silent || mute_until > now`). */
export function isTypeMuted(settings: NotifySettings, key: NotifyTypeKey, now = Math.floor(Date.now() / 1000)): boolean {
  return isPeerMuted(settings[key], now)
}

/** Показывать ли текст сообщения в уведомлении чатов этого типа. */
export function typeShowPreviews(settings: NotifySettings, key: NotifyTypeKey): boolean {
  return settings[key].show_previews !== false
}

/**
 * Вид пира → ключ ГЛОБАЛЬНЫХ настроек ('saved' и секретный считаются private,
 * как на бэке).
 *
 * Спрашивает конструктор, а не строку: вид чата с провода снят (решение Р8
 * разбора диалогов), и «канал это или группа» отвечает тот же предикат, что и
 * везде. Карточки чата ещё нет — вопрос решается фолбэком предиката, то есть
 * «группа»: это мягче, чем ошибочно применить настройку каналов.
 */
export function notifyTypeForChat(peerId: PeerId | undefined, chat: Chat | undefined): NotifyTypeKey {
  if (peerId === undefined || isUser(peerId)) return 'notifyUsers'
  return isBroadcast(chat) ? 'notifyBroadcasts' : 'notifyChats'
}

/**
 * Заглушён ли чат — ЕДИНСТВЕННОЕ место, где записано это правило (порт tweb
 * `isPeerLocalMuted({peerId, respectType: true})`,
 * `lib/appManagers/appNotificationsManager.ts`): свой mute диалога ИЛИ
 * глобально выключенный ТИП чатов.
 *
 * Правило читают три несвязанных потребителя: витрина списка
 * (`core/hooks/useChatList.ts` — серая иконка и бейдж), фильтр папок
 * (`components/autonomousDialogList/dialogs.ts::testDialogForFilter` — правило `excludeMuted`) и
 * foreground-уведомления (`client/uiNotifications.ts` — гейт звука и
 * Notification). Разъехавшиеся копии выражения — не косметика: у списка и у
 * СЧЁТЧИКА набора папки разошлись бы ответы, фетчер счёл бы нужное количество
 * набранным, и папка с `excludeMuted` перестала бы наполняться вовсе (этот
 * дефект уже ловили — его разбор — у `testDialogForFilter` списка папки).
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
  return isPeerMuted(dialog?.notify_settings, now) || isTypeMuted(settings, notifyTypeForChat(dialog?.peerId, chat), now)
}

export async function loadNotifySettings(managers: { notify: { getNotifyPeerTypeSettings(): Promise<NotifySettings> } }): Promise<void> {
  try {
    useNotifyStore.getState().set(await managers.notify.getNotifyPeerTypeSettings())
  } catch {
    /* оффлайн/ошибка — остаются дефолты */
  }
}
