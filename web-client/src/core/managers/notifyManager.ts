import type { RestClient } from '../net/restClient'
import type { PeerNotifySettings } from '../dialogs/notifySettings'

// Глобальные настройки уведомлений по ТИПУ чатов — порт tweb
// `appNotificationsManager` (`getNotifySettings` :78-112, `getNotifyPeerTypeSettings`
// :114-127, `updateNotifySettings` :148-160 + местный апдейт :129-146): адрес —
// конструктор `notifyUsers` / `notifyChats` / `notifyBroadcasts`, значение —
// `peerNotifySettings` (срок мьюта + показ превью). Кэша здесь нет: кэш — это
// `stores/notifyStore.ts`, который держит события `notify_settings`.
// Per-chat mute живёт в groupsManager.setMute.
export type NotifyTypeKey = 'notifyUsers' | 'notifyChats' | 'notifyBroadcasts'
export const NOTIFY_TYPE_KEYS: readonly NotifyTypeKey[] = ['notifyUsers', 'notifyChats', 'notifyBroadcasts']
export type NotifySettings = Record<NotifyTypeKey, PeerNotifySettings>

/** inputPeerNotifySettings (подмножество, которое у нас хранится): поле, которого нет, не меняется. */
export interface InputNotifySettings { mute_until?: number; show_previews?: boolean }

/** updateNotifySettings{notifyUsers|notifyChats|notifyBroadcasts} — тело события `notify_settings`. */
export interface NotifyTypeUpdate {
  _: 'updateNotifySettings'
  peer: { _: NotifyTypeKey }
  notify_settings: PeerNotifySettings
}

export function newNotifyManager({ rest, onLocalUpdate }: {
  rest: Pick<RestClient, 'get' | 'put'>
  /** Местный апдейт после ответа сервера (tweb `generateLocalNotifySettingsUpdate`
   *  → `processLocalUpdate`): воркер рассылает событие `notify_settings` вкладкам. */
  onLocalUpdate: (update: NotifyTypeUpdate) => void
}) {
  // Методы не опираются на `this`: реестр RPC зовёт их отвязанными.
  const getNotifySettings = (key: NotifyTypeKey): Promise<PeerNotifySettings> =>
    rest.get<PeerNotifySettings>('/me/notify_settings', { peer: key })

  return {
    getNotifySettings,
    async getNotifyPeerTypeSettings(): Promise<NotifySettings> {
      const [notifyUsers, notifyChats, notifyBroadcasts] = await Promise.all(NOTIFY_TYPE_KEYS.map(getNotifySettings))
      return { notifyUsers, notifyChats, notifyBroadcasts }
    },
    async updateNotifySettings(key: NotifyTypeKey, settings: InputNotifySettings): Promise<void> {
      await rest.put(`/me/notify_settings?peer=${key}`, { _: 'inputPeerNotifySettings', ...settings })
      onLocalUpdate({
        _: 'updateNotifySettings',
        peer: { _: key },
        notify_settings: { ...settings, _: 'peerNotifySettings' },
      })
    },
  }
}

export type NotifyManager = ReturnType<typeof newNotifyManager>
