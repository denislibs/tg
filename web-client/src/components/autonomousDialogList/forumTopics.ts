// Порт tweb `src/components/autonomousDialogList/forumTopics.ts` (812502980, 125 строк):
// список тем ОДНОГО форума — строки `DialogElement` темы (свой пир форума + номер
// темы в `threadId`) поверх `SortedDialogList` с `virtualFilterId` форума. Его
// строит форум-таб (`components/forumTab/groupForumTab.ts`). Задача 1-6 волны 7.
//
// Источник данных — хранилище тем воркера (`core/managers/forumTopicsStorage.ts`,
// порт `dialogsStorage.forumTopics`, Б-54): страница — `forumTopics.getForumTopics`
// (`dialogsStorage.getDialogs({filterId: peerId})`), живые изменения — операции
// `rt:forum_topic_op` владельца, те же события, что слушает оригинал (`:24-104`):
// `update` — `dialogs_multiupdate` с `topics`, `unread` — `dialog_unread`,
// `notify` — `dialog_notify_settings` темы, `drop` — `dialog_drop`.
//
// Расхождения с оригиналом:
//  1. Страница одна (расхождение 1 хранилища тем): сервер отдаёт темы целиком,
//     догрузка с курсором отдаёт пустую.
//  2. Тему по ключу список держит у себя (`topics`): строку `SortedDialogList`
//     строит синхронно из `getDialog(key)` (расхождение 6 его шапки), а
//     `getForumTopic` у нас — RPC. Значения приезжают от владельца и только им
//     заменяются.
//  3. `dialog_notify_settings` САМОГО форума (`:66-79`) — подписка на зеркала:
//     мьют форума (диалог в `chatsStore`) или настройки по типам (`notifyStore`)
//     пересчитывают бейджи всех строк.
//  4. `peer_typings` с `threadId` (`:24-38`) — «печатает» в теме у нас не едет
//     номером темы; `dialog_draft` темы (`:93-104`) — черновиков тредов нет
//     (волна 2 Ф-5, КЛ-2).
//  5. `getDialogFromElement` — его потребитель, меню строки темы, не портирован
//     (бэклог Б-53); `placeholderOptions` (`:22-26`) — наш `DialogsPlaceholder`
//     параметров не берёт (расхождение 4 базы).
//  6. Менеджеры: база берёт менеджеры колонки у владельца, хранилище тем
//     приносит вызывающий (форум-таб) — как у `savedDialogs.ts` (его расхождение 6).
import type { Managers } from '@/client/bootstrap'
import { CAN_HIDE_TOPIC } from '@core/forumTopicConstants'
import { isForumTopic, isForumTopicMuted, type ForumTopic, type ForumTopicOp } from '@core/dialogs/forumTopic'
import { cachedChat } from '@core/peerCache'
import { RT } from '@core/realtime/events'
import rootScope from '@lib/rootScope'
import { getDialog, setUnreadMessagesN } from '@lib/appDialogsManager'
import { useChatsStore } from '@stores/chatsStore'
import { isDialogMuted, useNotifyStore } from '@stores/notifyStore'
import { AutonomousDialogListBase, type BaseConstructorArgs } from '@components/autonomousDialogList/base'

export { isForumTopic, type ForumTopic }

/**
 * `appNotificationsManager.isPeerLocalMuted({peerId, threadId})` (`:396-410`):
 * своя настройка темы, иначе — как форум (мьют диалога и типа чатов).
 */
export function getForumTopicMuted(topic: ForumTopic) {
  return isForumTopicMuted(topic, () => isDialogMuted(getDialog(topic.peerId), cachedChat(topic.peerId), useNotifyStore.getState().settings))
}

/** Хранилище тем — расхождение 6. */
export type ForumTopicListManagers = {
  forumTopics: Pick<Managers['forumTopics'], 'getForumTopics'>,
}

type ConstructorArgs = BaseConstructorArgs & {
  peerId: PeerId,
  managers: ForumTopicListManagers,
}

export class AutonomousForumTopicList extends AutonomousDialogListBase<ForumTopic> {
  public peerId: PeerId

  /** tweb `base.ts:90`, `:20` — скрытые темы не отсеиваются, пока `CAN_HIDE_TOPIC` выключен */
  protected skipMigrated: boolean

  private topicManagers: ForumTopicListManagers
  /** расхождение 2 */
  private topics = new Map<number, ForumTopic>()

  constructor({ peerId, managers, ...args }: ConstructorArgs) {
    super(args)

    this.peerId = peerId
    this.topicManagers = managers

    this.skipMigrated = !!CAN_HIDE_TOPIC

    this.listenerSetter.add(rootScope)(RT.forumTopicOp, ({ ops }) => {
      for(const op of ops) this.onTopicOp(op)
    })

    // `dialog_notify_settings` форума (`:66-79`) — расхождение 3
    const notifyUnsubscribe = useNotifyStore.subscribe((state, prev) => {
      if(state.settings !== prev.settings) this.updateAllUnread()
    })
    const chatsUnsubscribe = useChatsStore.subscribe((state, prev) => {
      if(state.dialogs === prev.dialogs) return
      const dialog = state.dialogs.find((d) => d.peerId === this.peerId)
      const prevDialog = prev.dialogs.find((d) => d.peerId === this.peerId)
      if(dialog?.notify_settings !== prevDialog?.notify_settings) this.updateAllUnread()
    })
    this.middlewareHelper.get().onDestroy(() => {
      notifyUnsubscribe()
      chatsUnsubscribe()
    })
  }

  /** События хранилища тем (`:40-104`). */
  private onTopicOp(op: ForumTopicOp) {
    switch(op.op) {
      case 'update': {
        if(op.peerId !== this.peerId) return
        for(const topic of op.topics) {
          this.topics.set(topic.id, topic)
          this.updateDialog(topic)
        }
        return
      }
      case 'unread':
      case 'notify': {
        const topic = op.topic
        if(topic.peerId !== this.peerId) return
        this.topics.set(topic.id, topic)
        const dialogElement = this.getDialogElement(this.getDialogKey(topic))
        if(dialogElement) void setUnreadMessagesN({ dialog: topic, dialogElement })
        return
      }
      case 'drop': {
        if(op.peerId !== this.peerId) return
        this.topics.delete(op.id)
        this.deleteDialogByKey(op.id)
        return
      }
      default:
    }
  }

  /** tweb `:68-76` — все строки форума заново (возможно, менялся только `is-muted`) */
  private updateAllUnread() {
    this.sortedList.getAllDialogElementsMap().forEach((dialogElement, key) => {
      const topic = this.topics.get(key)
      if(topic) void setUnreadMessagesN({ dialog: topic, dialogElement })
    })
  }

  /** tweb `:106-108` */
  public getDialogKey(dialog: ForumTopic) {
    return dialog.id
  }

  /** tweb `:110-112` */
  public getDialogKeyFromElement(element: HTMLElement) {
    return +element.dataset.threadId!
  }

  /** tweb `:118-120` */
  protected getFilterId() {
    return this.peerId
  }

  protected getDialogIndex(dialog: ForumTopic) {
    return dialog.index
  }

  /** Тема строки по ключу — расхождение 2. */
  public getDialog(key: number) {
    return this.topics.get(key)
  }

  /** tweb `:122-125` */
  protected canUpdateDialog(dialog: ForumTopic): boolean {
    if(dialog.pFlags.hidden) return false
    return super.canUpdateDialog(dialog)
  }

  /** расхождение 1; `skipMigrated` — `dialogsStorage.getFolderDialogs` (`dialogs.ts:517-519`) */
  protected async dialogsFetcher(offsetIndex: number | undefined) {
    const page = await this.topicManagers.forumTopics.getForumTopics(this.peerId, offsetIndex)
    if(offsetIndex !== undefined) return page
    const dialogs = this.skipMigrated ? page.dialogs.filter((topic) => !topic.pFlags.hidden) : page.dialogs
    for(const topic of dialogs) this.topics.set(topic.id, topic)
    return { dialogs, count: dialogs.length, isEnd: true }
  }
}
