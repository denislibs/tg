// Foreground-уведомления — порт tweb uiNotificationsManager.notify() (упрощённый):
// входящее сообщение играет звук уведомления (настройки Sound) и, когда вкладка
// скрыта, показывает браузерную Notification через service worker — клик по ней
// обрабатывает sw.js (postMessage open-chat → App открывает чат). Гейтинг:
// per-chat mute → глобальные настройки типа чата → клиентские настройки.
import { startClient } from './bootstrap'
import { useSettingsStore } from '../settings'
import { useNotifyStore, notifyTypeForChat, isDialogMuted } from '../stores/notifyStore'
import { useChatsStore } from '../stores/chatsStore'
import { useI18nStore } from '../i18n'
import { mediaLabel } from '../core/dialogToChat'
import { getMessageText, type MyMessage } from '../core/models'
import { getMessageKind } from '../core/messages/messageKind'
import { cachedChat, isAnyGroupPeer, peerTitle } from '../core/peerCache'
import { getUserTitle } from '../core/peers/getPeerTitle'
import { playIncoming } from '../core/audio/sounds'
import { incNotificationsCount } from './appBadge'

/** Входящее сообщение для уведомления — ЦЕЛЫЙ конструктор, а не выжимка из
 *  четырёх полей: кадр `new_message` несёт сообщение под ключом `message`
 *  (форма `updateNewMessage`), и второй формы у него больше нет. */
export type IncomingMsg = MyMessage

export function notifyIncomingMessage(evt: IncomingMsg): void {
  const s = useChatsStore.getState()
  if (evt.fromId === s.meId) return
  const dialog = s.dialogs.find((d) => d.peerId === evt.peerId)
  const notifySettings = useNotifyStore.getState().settings
  // Правило «заглушён» — одно на всё приложение (stores/notifyStore.ts::isDialogMuted,
  // пин stores/noDuplicateMuteRule.test.ts). `preview` ниже — другая настройка,
  // её по-прежнему берём по типу чата напрямую.
  const chat = cachedChat(evt.peerId)
  if (isDialogMuted(dialog, chat, notifySettings)) return
  const typeSettings = notifySettings[notifyTypeForChat(evt.peerId, chat)]

  // Открытый чат в видимой вкладке — ни звука, ни уведомления (читается на экране).
  if (s.activePeerId === evt.peerId && !document.hidden) return

  // Счётчик для мигающего заголовка вкладки — до проверок звука/разрешения, как в
  // tweb (notify() инкрементит до `settings.desktop`/Notification.permission).
  incNotificationsCount()

  const cfg = useSettingsStore.getState()
  if (cfg.notifySound && cfg.notifyVolume > 0) playIncoming(cfg.notifyVolume)

  // Визуальное уведомление — только когда вкладка скрыта (tweb: idle).
  if (!document.hidden || !cfg.notifyDesktop) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

  const t = useI18nStore.getState().t
  // Имя собирает клиент по карточке пира — ни `display_name`, ни `title` строки
  // диалога на проводе больше нет (шаг C диалогов: тело чата едет вектором
  // `chats` контейнера и живёт в зеркале пиров).
  const chatTitle = peerTitle(evt.peerId) || 'Telegram'
  const body = typeSettings.preview ? getMessageText(evt) || mediaLabel(getMessageKind(evt)) || t('Notifications.New') : t('Notifications.New')
  void show(chatTitle, body, evt)
}

async function show(chatTitle: string, body: string, evt: IncomingMsg): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return
    // tweb в группах пишет отправителя в заголовок: «Sender @ Chat».
    // «Любая группа» — предикат над конструктором чата (решение Р8), а не
    // снятая с провода строка `type`.
    let title = chatTitle
    if (isAnyGroupPeer(evt.peerId)) {
      const { managers } = startClient()
      const [u] = await managers.peers.getUsers([evt.fromId ?? 0]).catch(() => [])
      const senderTitle = u ? getUserTitle(u) : ''
      if (senderTitle) title = `${senderTitle} @ ${chatTitle}`
    }
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, { body, tag: `chat-${evt.peerId}`, data: { peerId: evt.peerId } })
  } catch {
    /* нет SW / показ запрещён — молча пропускаем */
  }
}
