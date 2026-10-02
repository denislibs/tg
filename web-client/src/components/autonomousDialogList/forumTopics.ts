// Порт tweb `src/components/autonomousDialogList/forumTopics.ts` (812502980, 125 строк):
// список тем ОДНОГО форума — строки `DialogElement` темы (свой пир форума + номер
// темы в `threadId`) поверх `SortedDialogList` с `virtualFilterId` форума. Его
// строит форум-таб (`components/forumTab/groupForumTab.ts`). Задача 1-6 волны 7.
//
// Расхождения с оригиналом:
//  1. Страница — ответ `messages.forumTopics` (`GET /chats/{id}/topics`,
//     `managers.groups.listTopics`), а не `dialogsStorage.getDialogs({filterId:
//     peerId})` базы: хранилища тем у нас нет, набор приезжает ЦЕЛИКОМ одним
//     ответом без курсора. Поэтому страница одна (`isEnd: true`), а догрузка с
//     курсором отдаёт пустую (тот же приём, что у `savedDialogs.ts`, его
//     расхождение 1).
//  2. Тема строки — `ForumTopic` ниже: строка модели `TopicRow`
//     (`core/managers/groupsManager.ts`) в форме tweb `forumTopic`. `id` — номер
//     корня темы (`root_msg_id`; у оригинала id темы И ЕСТЬ номер корня), им
//     адресуются тред (`threadId`) и строка (`data-thread-id`); серверный id
//     строки темы — `topicId` (ручки `groups.*Topic`). Заглушённость —
//     вычисленная `TopicRow.muted` (сырых `notify_settings` в строке модели нет),
//     поэтому «тема не настроена → как у форума» (`isPeerLocalMuted` с `threadId`,
//     `appNotificationsManager.ts:399-405`) — это «тема не заглушена → как у
//     форума» (`getForumTopicMuted`). `read_inbox_max_id` в строке модели нет —
//     метка `not-visited` у бейджа не ставится (`appDialogsManager.ts:2799-2802`).
//  3. Индекс — место в ответе (порядок сервера: закреплённые, затем свежие), а
//     не `index_0` хранилища (`getDialogIndex`) — расхождение 2 `savedDialogs.ts`.
//  4. Живых апдейтов тем (`dialogs_multiupdate` с `topics`, `dialog_unread`,
//     `dialog_drop`, `dialog_draft` темы, `peer_typings` с `threadId`, `:24-104`)
//     нет: событий тем на главном потоке нет, хранилища тем в воркере — тоже.
//     Список собирается заново на каждый показ форум-таба (бэклог Б-54). Остался
//     `dialog_notify_settings` форума (`:66-79`): мьют форума (диалог в зеркале
//     `chatsStore` или настройки по типам `notifyStore`) пересчитывает бейджи всех
//     строк.
//  5. `getDialogFromElement` — его потребитель, меню строки темы, не портирован
//     (бэклог Б-53); `placeholderOptions` (`:22-26`) — наш `DialogsPlaceholder`
//     параметров не берёт (расхождение 4 базы).
//  6. Менеджеры: база берёт менеджеры колонки у владельца, ручку тем приносит
//     вызывающий (форум-таб) — как у `savedDialogs.ts` (его расхождение 6).
import type { Managers } from '@/client/bootstrap'
import type { MyMessage } from '@core/models'
import { CAN_HIDE_TOPIC } from '@core/forumTopicConstants'
import type { TopicRow } from '@core/managers/groupsManager'
import { cachedChat } from '@core/peerCache'
import { getDialog, setUnreadMessagesN } from '@lib/appDialogsManager'
import { useChatsStore } from '@stores/chatsStore'
import { isDialogMuted, useNotifyStore } from '@stores/notifyStore'
import { AutonomousDialogListBase, type BaseConstructorArgs } from '@components/autonomousDialogList/base'

/**
 * tweb `ForumTopic.forumTopic` в объёме нашей модели (расхождение 2): то, из чего
 * рисуется строка темы.
 */
export type ForumTopic = {
  _: 'forumTopic',
  peerId: PeerId,
  /** номер корня темы — `threadId` треда и ключ строки */
  id: number,
  /** серверный id строки темы */
  topicId: number,
  title: string,
  icon_color: number,
  icon_emoji?: string,
  isGeneral: boolean,
  pFlags: { pinned?: true, closed?: true, hidden?: true },
  top_message: number,
  unread_count: number,
  unread_mentions_count: number,
  unread_reactions_count: number,
  /** `TopicRow.muted` — расхождение 2 */
  muted: boolean,
  /** место в ответе — расхождение 3 */
  index: number,
  lastMessage?: MyMessage,
}

/** tweb `utils/dialogs/isDialog.ts:13-15` */
export function isForumTopic(dialog: { _?: string }): dialog is ForumTopic {
  return dialog._ === 'forumTopic'
}

/** Строка модели → тема строки (расхождения 2, 3). */
export function toForumTopic(row: TopicRow, index: number): ForumTopic {
  const pFlags: ForumTopic['pFlags'] = {}
  if(row.pinned) pFlags.pinned = true
  if(row.closed) pFlags.closed = true
  if(row.hidden) pFlags.hidden = true

  return {
    _: 'forumTopic',
    peerId: row.peerId,
    id: row.rootMsgId,
    topicId: row.id,
    title: row.title,
    icon_color: row.iconColor,
    icon_emoji: row.iconEmoji || undefined,
    isGeneral: row.isGeneral,
    pFlags,
    top_message: row.lastMsgSeq,
    unread_count: row.unread,
    unread_mentions_count: row.unreadMentions,
    unread_reactions_count: 0,
    muted: row.muted,
    index,
    lastMessage: row.lastMessage,
  }
}

/**
 * `appNotificationsManager.isPeerLocalMuted({peerId, threadId})` (`:399-405`) в
 * объёме расхождения 2: тема заглушена сама — да, иначе — как форум.
 */
export function getForumTopicMuted(topic: ForumTopic) {
  if(topic.muted) {
    return true
  }

  return isDialogMuted(getDialog(topic.peerId), cachedChat(topic.peerId), useNotifyStore.getState().settings)
}

/** Ручка тем — расхождение 6. */
export type ForumTopicListManagers = {
  groups: Pick<Managers['groups'], 'listTopics'>,
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
  /** страница владельца по ключу-теме — расхождения 1, 3 */
  private topics = new Map<number, ForumTopic>()

  constructor({ peerId, managers, ...args }: ConstructorArgs) {
    super(args)

    this.peerId = peerId
    this.topicManagers = managers

    this.skipMigrated = !!CAN_HIDE_TOPIC

    // `dialog_notify_settings` форума (`:66-79`) — расхождение 4
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

  /** расхождение 3 */
  protected getDialogIndex(dialog: ForumTopic) {
    return dialog.index
  }

  /** Тема строки по ключу — для `SortedDialogList` (расхождение 6 его шапки). */
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
    if(offsetIndex !== undefined) {
      return { dialogs: [], count: this.topics.size, isEnd: true }
    }

    const rows = await this.topicManagers.groups.listTopics(this.peerId)
    const visible = this.skipMigrated ? rows.filter((row) => !row.hidden) : rows
    const dialogs = visible.map((row, idx) => toForumTopic(row, visible.length - idx))

    this.topics = new Map(dialogs.map((dialog) => [dialog.id, dialog]))

    return { dialogs, count: dialogs.length, isEnd: true }
  }
}
