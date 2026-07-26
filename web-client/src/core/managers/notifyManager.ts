import type { RestClient } from '../net/restClient'

// Глобальные настройки уведомлений по типам чатов (tweb: notifyUsers /
// notifyChats / notifyBroadcasts): выключены ли уведомления и показывать ли
// текст сообщения (Message Preview). Per-chat mute живёт в groupsManager.setMute.
export type NotifyChatType = 'private' | 'groups' | 'channels'
export interface NotifyTypeSettings { muted: boolean; preview: boolean }
export type NotifySettings = Record<NotifyChatType, NotifyTypeSettings>

export type NotifyPatch = Partial<Record<NotifyChatType, Partial<NotifyTypeSettings>>>

export function newNotifyManager({ rest }: { rest: Pick<RestClient, 'get' | 'put'> }) {
  return {
    async settings(): Promise<NotifySettings> {
      return rest.get<NotifySettings>('/me/notify_settings')
    },
    async update(patch: NotifyPatch): Promise<NotifySettings> {
      return rest.put<NotifySettings>('/me/notify_settings', patch)
    },
  }
}

export type NotifyManager = ReturnType<typeof newNotifyManager>
