// Подписчик браузерных уведомлений на realtime-события. Независим от Store-проектора.
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { getMessageThreadId, mapMessage, type MyMessage } from '../../core/models'
import { isForumTopicMuted } from '../../core/dialogs/forumTopic'
import { cachedChat } from '../../core/peerCache'
import { isForum } from '../../core/peers/predicates'
import { isDialogMuted, useNotifyStore } from '../../stores/notifyStore'
import { useChatsStore } from '../../stores/chatsStore'
import { startClient } from '../bootstrap'
import { notifyIncomingMessage } from '../uiNotifications'

/**
 * Очередь уведомлений по чату — порт tweb `appMessagesManager.notificationsToHandle`
 * (1dc32d889): на чат одна запись, в ней последнее сообщение, а признак
 * «пришло первым difference после старта» снят с ПЕРВОГО кадра (у tweb запись
 * заводится `??=` вместе с ним и дальше меняет только `topMessage`).
 */
interface NotificationToHandle {
  topMessage: MyMessage
  isInitialSync: boolean
}

export function registerNotificationSubscriber(): void {
  const notificationsToHandle = new Map<PeerId, NotificationToHandle>()

  // tweb 1dc32d889 `handleNotifications` → `handleNotificationsAfterSync`:
  // уведомление ПРИДЕРЖИВАЕТСЯ, пока идёт difference, который ещё может его
  // отменить (прочтение с другого устройства, заглушение чата — следующей
  // страницей или difference'ом канала). Раньше кадр catch-up глушился целиком,
  // и бэклог при скрытой вкладке молчал — мы были жёстче оригинала.
  //
  // Отличие по месту: у tweb очередь и ожидание в одном контексте, у нас
  // уведомление строит вкладка, а догон живёт в воркере — отсюда RPC
  // `realtime.waitForSync`, который без идущего догона отпускает сразу.
  // Живые кадры с pts во время общего догона воркер отбрасывает (их переотдаст
  // difference), так что «придержать во время difference» у нас — это прежде
  // всего кадры catch-up; ждёт при этом любой кадр, как и у tweb.
  function handleNotification(peerId: PeerId): void {
    const toHandle = notificationsToHandle.get(peerId)
    notificationsToHandle.delete(peerId)
    if (!toHandle) return
    const { topMessage, isInitialSync } = toHandle

    // tweb: `!topMessage.pFlags.unread` — прочитано, пока ждали. У нас флага на
    // сообщении нет, горизонт чтения живёт в диалоге (оба номера клиентские).
    const dialog = useChatsStore.getState().dialogs.find((d) => d.peerId === peerId)
    if (dialog && topMessage.id <= dialog.read_inbox_max_id) return

    // tweb `appNotificationsManager.routeNotification`: бэклог ПЕРВОГО difference
    // после старта не уведомляет, если сидят в той самой вкладке, — непрочитанные
    // бейджи рассказывают то же без попапа на каждый чат. Вкладка простаивает
    // (у нас — скрыта, как и везде в `uiNotifications`) — уведомляет, как раньше.
    if (isInitialSync && !document.hidden) return

    void topicMuted(topMessage).then((muted) => notifyIncomingMessage(topMessage, muted))
  }

  /**
   * Мьют ТЕМЫ форума — `getNotifyPeerSettings(peerId, threadId)` оригинала
   * (`handleNotifications`, appMessagesManager.ts:9958-9963 →
   * `isPeerLocalMuted({threadId})`): своя настройка темы, иначе — форума.
   * Тема — у хранилища тем воркера; её нет (список не грузили) — решает
   * правило чата (`undefined`).
   */
  async function topicMuted(m: MyMessage): Promise<boolean | undefined> {
    if (!isForum(cachedChat(m.peerId))) return undefined
    const threadId = getMessageThreadId(m, { isForum: true })
    const topic = threadId ? await startClient().managers.forumTopics.getForumTopic(m.peerId, threadId).catch(() => undefined) : undefined
    if (!topic) return undefined
    const dialog = useChatsStore.getState().dialogs.find((d) => d.peerId === m.peerId)
    return isForumTopicMuted(topic, () => isDialogMuted(dialog, cachedChat(m.peerId), useNotifyStore.getState().settings))
  }

  rootScope.addEventListener(RT.newMessage, (evt, meta) => {
    // Кадр несёт сообщение ЦЕЛИКОМ; уведомлению нужен тот же объект, что и ленте,
    // — второй выжимки из четырёх полей больше нет. `meId` здесь не нужен:
    // формулировку пилюли уведомление не строит, ему хватает лейбла вида.
    const m = mapMessage(evt.message)
    if (m._ === 'messageEmpty') return

    const queued = notificationsToHandle.get(m.peerId)
    notificationsToHandle.set(m.peerId, {
      topMessage: m,
      isInitialSync: queued ? queued.isInitialSync : !!meta?.initialSync,
    })
    // Ожидание по этому чату уже идёт — оно и заберёт последнее сообщение.
    if (queued) return

    // Отказ воркера (метода нет, воркер умер) — не повод терять уведомление:
    // ждать нечего, показываем сразу.
    void startClient().managers.realtime.waitForSync({ peerId: m.peerId })
      .catch(() => {})
      .then(() => handleNotification(m.peerId))
  })
}
