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

export function newNotifyManager({ rest, onLocalUpdate, frameVersion }: {
  rest: Pick<RestClient, 'get' | 'put'>
  /** Местный апдейт после ответа сервера (tweb `generateLocalNotifySettingsUpdate`
   *  → `processLocalUpdate`): воркер рассылает событие `notify_settings` вкладкам. */
  onLocalUpdate: (update: NotifyTypeUpdate) => void
  /** Сколько кадров `updateNotifySettings` этого ключа уже пришло с сервера.
   *  Наш сервер шлёт кадр и инициатору (TG — нет), поэтому ответ на PUT может
   *  опоздать за более новым кадром другого устройства: тогда местный апдейт
   *  затёр бы свежее состояние старым. */
  frameVersion: (key: NotifyTypeKey) => number
}) {
  // Методы не опираются на `this`: реестр RPC зовёт их отвязанными.
  // Пока шёл GET, мог прийти кадр этого ключа (переподключение: ответ запрошен до
  // кадра, а доставлен после): такой ответ старее состояния, которое вкладки
  // уже применили, и затёр бы его. Читаем заново (tweb применяет ответ только
  // если апдейт его не опередил — notifications.tsx:79-83).
  const getNotifySettings = async (key: NotifyTypeKey): Promise<PeerNotifySettings> => {
    for (let attempt = 0; ; attempt++) {
      const before = frameVersion(key)
      const settings = await rest.get<PeerNotifySettings>('/me/notify_settings', { peer: key })
      if (frameVersion(key) === before || attempt === 2) return settings
    }
  }

  // Один запрос на всех вызывающих (tweb кэширует `getNotifyPeerTypePromise`,
  // :114-127): старт, открытие вкладки и rt:resync всех вкладок не множат GET.
  let typeSettings: Promise<NotifySettings> | undefined

  return {
    getNotifySettings,
    getNotifyPeerTypeSettings(): Promise<NotifySettings> {
      typeSettings ??= Promise.all(NOTIFY_TYPE_KEYS.map(getNotifySettings))
        .then(([notifyUsers, notifyChats, notifyBroadcasts]) => ({ notifyUsers, notifyChats, notifyBroadcasts }))
        .finally(() => { typeSettings = undefined })
      return typeSettings
    },
    async updateNotifySettings(key: NotifyTypeKey, settings: InputNotifySettings): Promise<void> {
      const sent = frameVersion(key)
      await rest.put(`/me/notify_settings?peer=${key}`, { _: 'inputPeerNotifySettings', ...settings })
      // Пока шёл PUT, пришёл кадр этого ключа — он новее нашего ответа (его и
      // подтверждение нашей же правки несёт серверный снимок): местный апдейт лишний.
      if (frameVersion(key) !== sent) return
      onLocalUpdate({
        _: 'updateNotifySettings',
        peer: { _: key },
        notify_settings: { ...settings, _: 'peerNotifySettings' },
      })
    },
  }
}

export type NotifyManager = ReturnType<typeof newNotifyManager>
