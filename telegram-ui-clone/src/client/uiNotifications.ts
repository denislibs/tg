// Foreground-уведомления — порт tweb uiNotificationsManager.notify() (упрощённый):
// входящее сообщение играет звук уведомления (настройки Sound) и, когда вкладка
// скрыта, показывает браузерную Notification через service worker — клик по ней
// обрабатывает sw.js (postMessage open-chat → App открывает чат). Гейтинг:
// per-chat mute → глобальные настройки типа чата → клиентские настройки.
import { startClient } from './bootstrap'
import { useSettingsStore } from '../settings'
import { useNotifyStore, notifyTypeForChat } from '../stores/notifyStore'
import { useChatsStore } from '../stores/chatsStore'
import { useI18nStore } from '../i18n'
import { mediaLabel } from '../core/dialogToChat'
import { playIncoming } from '../core/audio/sounds'

export interface IncomingMsg {
  chat_id: number
  sender_id: number
  type?: string
  text: string
}

export function notifyIncomingMessage(evt: IncomingMsg): void {
  const s = useChatsStore.getState()
  if (evt.sender_id === s.meId) return
  const dialog = s.dialogs.find((d) => d.chatId === evt.chat_id)
  const typeSettings = useNotifyStore.getState().settings[notifyTypeForChat(dialog?.type)]
  if (dialog?.muted || typeSettings.muted) return

  // Открытый чат в видимой вкладке — ни звука, ни уведомления (читается на экране).
  if (s.activeChatId === evt.chat_id && !document.hidden) return

  const cfg = useSettingsStore.getState()
  if (cfg.notifySound && cfg.notifyVolume > 0) playIncoming(cfg.notifyVolume)

  // Визуальное уведомление — только когда вкладка скрыта (tweb: idle).
  if (!document.hidden || !cfg.notifyDesktop) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

  const t = useI18nStore.getState().t
  const chatTitle = dialog?.peer?.displayName || dialog?.title || 'Telegram'
  const body = typeSettings.preview ? evt.text || t(mediaLabel(evt.type) || 'New notification') : t('New notification')
  void show(chatTitle, body, evt)
}

async function show(chatTitle: string, body: string, evt: IncomingMsg): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return
    // tweb в группах пишет отправителя в заголовок: «Sender @ Chat»
    let title = chatTitle
    const dialog = useChatsStore.getState().dialogs.find((d) => d.chatId === evt.chat_id)
    if (dialog?.type === 'group') {
      const { managers } = startClient()
      const [u] = await managers.peers.getUsers([evt.sender_id]).catch(() => [])
      if (u?.displayName) title = `${u.displayName} @ ${chatTitle}`
    }
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, { body, tag: `chat-${evt.chat_id}`, data: { chatId: evt.chat_id } })
  } catch {
    /* нет SW / показ запрещён — молча пропускаем */
  }
}
