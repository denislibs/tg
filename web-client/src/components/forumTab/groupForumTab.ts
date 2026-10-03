// Порт tweb `src/components/forumTab/groupForumTab.ts` (812502980, 230 строк) —
// форум-таб группы: темы форума строками `DialogElement` (`AutonomousForumTopicList`
// поверх `SortedDialogList` с `itemSize: 64`, `noAvatar`), шапка с названием
// группы и подписью, меню ⋮. Задача 1-6 волны 7.
//
// Расхождения с оригиналом:
//  1. Клик по теме — `onFound` таба, а не `openChat` слушателя списка
//     (`onFound: null`, `:50`): наш `openChat` номер темы в `setPeer` не передаёт
//     (`lib/appDialogsManager.ts`, расхождение `setPeerFunc` без `threadId`). Тема
//     открывается, как у tweb, `appImManager.setPeer({peerId, threadId})`
//     (`appDialogsManager.ts:2094`, `openInner` у списка темы ложен); шапку темы
//     рисует `ChatTopbar` (Б-57).
//  2. Меню строки темы (`withContext`, ветки `threadId` в `dialogsContextMenu.ts`)
//     и выделение тем (`ForumTopicsSelection`, `attachPinnedReorder`) не
//     портированы — бэклог Б-53 и О-30.
//  3. Меню ⋮: «Создать тему» (`AppEditTopicTab`) и «Информация о группе»
//     (`AppSharedMediaTab` в левой колонке) — вкладок нет (бэклог Б-54);
//     «Добавить участника» у tweb выключен (`verify: () => false && …`) — не
//     переносится; «Вступить»/«Подать заявку» (`joinChat`) — исполнителя нет,
//     форум-таб у нас открывается только у форума из списка или по ссылке
//     (`appImManager.op` вступает сам, расхождение 8 его шапки). «Показать как
//     сообщения» — без `toggleViewForumAsMessages`: флага нет на бэкенде
//     (`domain/mtdialog.go:47`).
//  4. `chat_update` (`:156-168`) — подписка на зеркало карточек; `history_reload`
//     (`:150-154`) и `subscribeToChannelUpdates` (`:178-181`) — предмета нет:
//     темы перечитываются на каждый показ, отдельной подписки на канал нет.
//  5. Подпись шапки — `getChatMembersString` («N участников»), а не
//     `appImManager.setPeerStatus` (`:189-196`): статуса пира классом у нас ещё нет
//     (Б-29); заголовок — `PeerTitle` (`wrapPeerTitle({dialog: true})`).
import appDialogsManager from '@lib/appDialogsManager'
import appImManager, { type AppImManager } from '@lib/appImManager'
import { AutonomousForumTopicList } from '@components/autonomousDialogList/forumTopics'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import { ChatType } from '@components/chat/chatType'
import PeerTitle from '@components/chat/peerTitle'
import showDeleteDialogPopup, { type DeleteDialogManagers } from '@components/popups/deleteDialog'
import SortedDialogList from '@components/sortedDialogList'
import { ForumTab } from '@components/forumTab/forumTab'
import getGroupForumMembershipAction from '@components/forumTab/getGroupForumMembershipAction'
import { getChatMembersString } from '@components/wrappers/getChatMembersString'
import { ALL_FOLDER_ID } from '@core/folderIds'
import { cachedChat, subscribePeerMirror } from '@core/peerCache'
import { isForum } from '@core/peers/predicates'
import { useI18nStore } from '@/i18n'

export class GroupForumTab extends ForumTab {
  declare public xd: AutonomousForumTopicList

  /** tweb `:22-170` */
  protected syncInit(): void {
    super.syncInit()

    this.container.classList.add('topic-dialogs-override')

    const managers = this.managers!
    this.xd = new AutonomousForumTopicList({ peerId: this.peerId, appDialogsManager, managers })
    this.xd.scrollable = this.scrollable
    this.xd.sortedList = new SortedDialogList({
      itemSize: 64,
      noAvatar: true,
      appDialogsManager,
      scrollable: this.scrollable,
      log: this.log,
      requestItemForIdx: this.xd.requestItemForIdx,
      onListShrinked: this.xd.onListShrinked,
      // `indexKey: 'index_0'` — у нас список «Всех чатов» (расхождение 1 `sortedDialogList.ts`)
      filterId: ALL_FOLDER_ID,
      virtualFilterId: this.peerId,
      virtualDialogs: this.xd,
    })

    const list = this.xd.sortedList.list

    // расхождение 2: ни выделения тем, ни меню строки темы
    appDialogsManager.setListClickListener({ list, onFound: this.onTopicFound })
    this.scrollable.append(list)
    this.xd.bindScrollable()

    const getMembershipAction = () => {
      return getGroupForumMembershipAction(cachedChat(this.peerId))
    }

    // расхождение 3
    const btnMenu = ButtonMenuToggle({
      listenerSetter: this.listenerSetter,
      direction: 'bottom-left',
      buttons: [{
        icon: 'message',
        text: 'ForumTopic.Context.ShowAsMessages',
        onClick: this.viewAsMessages,
        verify: () => {
          const chat = appImManager.chat
          return !chat || !appImManager.isSamePeer(chat, this.getOptionsForMessages())
        },
      }, {
        icon: 'logout',
        danger: true,
        text: 'LeaveMegaMenu',
        onClick: () => {
          showDeleteDialogPopup(this.peerId, managers as unknown as DeleteDialogManagers)
        },
        separator: true,
        verify: () => getMembershipAction() === 'leave',
      }],
    })

    // `chat_update` (`:156-168`) — расхождение 4
    const unsubscribe = subscribePeerMirror(() => {
      if(!isForum(cachedChat(this.peerId))) {
        void appDialogsManager.toggleForumTab(undefined, this)
      }
    })
    this.middlewareHelper.get().onDestroy(unsubscribe)

    this.header.append(btnMenu)
  }

  /** Расхождение 1: тема — `setPeer({peerId, threadId})`. */
  private onTopicFound = (elem: HTMLElement) => {
    const threadId = +elem.dataset.threadId! || undefined
    const topic = threadId !== undefined ? this.xd.getDialog(threadId) : undefined
    if(!topic) {
      return
    }

    void appImManager.setPeer({
      peerId: this.peerId,
      threadId: topic.id,
      type: ChatType.Chat,
    })
    return false
  }

  /** tweb `:173-211` (расхождение 5) */
  protected async asyncInit(): Promise<void> {
    await super.asyncInit()

    const middleware = this.middlewareHelper.get()
    const peerId = this.peerId

    const peerTitle = new PeerTitle({ peerId, dialog: true, middleware, managers: this.managers! })
    this.title.append(peerTitle.element)
    this.subtitle.replaceChildren(getChatMembersString(cachedChat(peerId), useI18nStore.getState().tArgs))
  }

  /** tweb `:213-218` */
  public getOptionsForMessages(): Parameters<AppImManager['isSamePeer']>[0] {
    return {
      peerId: this.peerId,
      type: ChatType.Chat,
    }
  }

  /** tweb `:220-226` (расхождение 3) */
  public viewAsMessages = () => {
    const chat = appImManager.chat
    const peerId = this.peerId
    this._close()
    void appImManager[chat?.peerId === peerId ? 'setPeer' : 'setInnerPeer'](this.getOptionsForMessages())
  }
}
