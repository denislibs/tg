// Порт tweb `src/components/dialogsContextMenu.ts` (812502980, 702 строки, класс
// `:64`) — контекстное меню строки диалога. Создаёт его `AppDialogsManager.start`
// (tweb `appDialogsManager.ts:850`), вешает на список папки `l(filter)`
// (`:1478` → `setListClickListener({withContext: true})` → `:2337-2339`).
// Меню — `createContextMenu` (`helpers/dom/createContextMenu.ts`): `ButtonMenu` +
// `positionMenu` у точки события + `contextMenuController` (запись `'menu'` в
// навигационном стеке — Esc/Back закрывают). Пункты фильтруются `verify` на
// каждом открытии: не прошедший пункт в DOM не попадает.
//
// РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//
//  1. `appDialogsManager` у tweb — синглтон, у нас экземпляр колонки
//     (расхождение 1 `lib/appDialogsManager.ts`): `filterId` и `openDialogInNewTab`
//     приходят вторым аргументом конструктора.
//  2. Диалог — из зеркала `chatsStore` синхронно (мост чтения п. 2 плана волны 7,
//     В7-3), а не `dialogsStorage.getAnyDialog`; признак «заглушен» —
//     `isDialogMuted` (`stores/notifyStore.ts`, порт `isPeerLocalMuted`).
//  3. Действия — наши ручки: закреп `groups.setPin`, архив `groups.setArchive`,
//     снятие заглушения `groups.setMute(peerId, false)`, «прочитано» —
//     `realtime.markRead` до `top_message` (то, что у tweb делает
//     `markDialogUnread({read: true})` → `readHistory`, `appMessagesManager.ts:8110-8120`;
//     ветка форума «прочитать все темы» — О-71). Применяет их владелец после
//     ответа сети, как у tweb (`toggleDialogPin` → `setDialogPin`): меню само
//     ничего не переставляет.
//  4. Попапы — `PopupMute` (vanilla, ВРЕМЕННО до 2C-7 — `showMutePopup`),
//     `popups/deleteDialog.ts` и `clearHistory.ts` (оба на vanilla `PopupPeer`,
//     ВРЕМЕННО до 2C-6).
//  5. Пункты, которых здесь нет, — предмета нет у нас:
//     • `Community.View`, `Community.ShowSeparately`, `Community.Leave`,
//       `Community.RemoveChat`, режим `communityChat` пунктов и `data-community-*`
//       строки — сообществ нет на бэкенде (О-5);
//     • `ChatList.Context.Preview` — попапа превью чата (`popups/chatPreview`) нет
//       (О-86 волна 7);
//     • `TopicViewAsTopics`, `SavedViewAsChats`, `SavedViewAsMessages` — нет флага
//       `view_forum_as_messages` (`domain/mtdialog.go:47`) и настройки
//       `savedAsForum` (О-88 волна 7);
//     • `Message.Context.Select` — выделения диалогов (`DialogsSelectionBase`,
//       60a83a6f1) нет (О-30);
//     • `MarkAsUnread` — флага `unread_mark` нет (О-72);
//     • `AddToFolder` — подменю `addToFolderDropdownMenu/` (913 строк) не
//       портировано (О-85 волна 7);
//     • `Hide`, `CloseTopic`, `RestartTopic` и всё про `threadId`/
//       `canManageTopics` — меню на списке тем форума вешает задача 1-6;
//     • `PaidMessages.ChargeFee`/`RemoveFee` и `monoforumParentPeerId` — монофорума
//       нет (О-4);
//     • `DeleteFromRecent` и опция `recentSearch` — меню на выдаче поиска вешает
//       задача 2-3 (`sidebarLeft/index.ts:1235-1244`).
//  6. Закреп в пользовательской папке (`filterId > 1` → `filter.pinnedPeerIds`,
//     `filtersStorage.toggleDialogPin`) — у папок нет закрепов (О-70): в такой
//     папке пунктов закрепа нет вовсе.
//  7. `useDialogFolder` (`:128-129`): папка диалога на проводе — 0/1, у нас
//     архив — `ARCHIVE_FOLDER_ID` (−1, `core/folderIds.ts`), значение переводится.
//  8. Отступление В7-1: строка секретного чата (наш продукт, у tweb нет) —
//     «Очистить историю» не предлагается (шапка секретного чата его тоже не
//     даёт: очистка и удаление там одно действие), удаление — как у лички
//     (`popups/deleteDialog.ts`, расхождение 4).
//  9. О-89 волна 7: `Delete` у «Избранного» (`checkIfCanDelete` → `true`) не
//     показывается — удаления истории вместе с диалогом на бэкенде нет.
import type { LangPackKey } from '@/lang'
import type { Dialog } from '@core/models'
import type { Managers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import { i18n } from '@lib/langPack'
import type { ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import createContextMenu from '@helpers/dom/createContextMenu'
import cancelEvent from '@helpers/dom/cancelEvent'
import IS_SHARED_WORKER_SUPPORTED from '@environment/sharedWorkerSupport'
import { findDialogListElement, isDialogUnread, type AppDialogsManager } from '@lib/appDialogsManager'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '@core/folderIds'
import { isDialogArchived } from '@core/models'
import { cachedChat, cachedPeer } from '@core/peerCache'
import canClearHistory from '@core/peers/canClearHistory'
import { getDeleteButtonText } from '@core/peers/dialogType'
import { useChatsStore } from '@stores/chatsStore'
import { isDialogMuted, useNotifyStore } from '@stores/notifyStore'
import PopupElement from '@components/popups/popupElement'
import PopupMute from '@components/popups/popupMute'
import showDeleteDialogPopup, { type DeleteDialogManagers } from '@components/popups/deleteDialog'
import clearHistoryWithConfirmation, { type ClearHistoryManagers } from '@components/clearHistory'
import showPinLimitReached from '@components/showPinLimitReached'

export type DialogsContextMenuManagers = DeleteDialogManagers & ClearHistoryManagers & {
  groups: Pick<Managers['groups'], 'setPin' | 'setMute' | 'setArchive'>
  realtime: Pick<Managers['realtime'], 'markRead'>
}

/** расхождение 1 */
export type DialogsContextMenuOwner = Pick<AppDialogsManager, 'filterId' | 'openDialogInNewTab'>

/** расхождение 2 — `dialogsStorage.getAnyDialog`: нет диалога — `undefined` */
function getAnyDialog(peerId: PeerId): Dialog | undefined {
  return useChatsStore.getState().dialogs.find((dialog) => dialog.peerId === peerId)
}

/** расхождение 2 — `appNotificationsManager.isPeerLocalMuted({peerId})` */
function isPeerLocalMuted(dialog: Dialog) {
  return isDialogMuted(dialog, cachedChat(dialog.peerId), useNotifyStore.getState().settings)
}

export default class DialogsContextMenu {
  private buttons: ButtonMenuItemOptionsVerifiable[] | undefined

  private peerId: PeerId | undefined
  private filterId: number | undefined
  private dialog: Dialog | undefined
  private canDelete: boolean | undefined
  private li: HTMLElement | undefined

  constructor(
    private managers: DialogsContextMenuManagers,
    private appDialogsManager: DialogsContextMenuOwner,
    private options: { useDialogFolder?: boolean } = {},
  ) {

  }

  public attach(element: HTMLElement) {
    return createContextMenu({
      listenTo: element,
      buttons: this.getButtons(),
      onOpen: (_e, li) => {
        this.li = li
        li.classList.add('menu-open')
        this.peerId = +li.dataset.peerId!

        this.dialog = getAnyDialog(this.peerId)
        this.filterId = this.options.useDialogFolder ?
          (this.dialog && isDialogArchived(this.dialog) ? ARCHIVE_FOLDER_ID : ALL_FOLDER_ID) : // расхождение 7
          this.appDialogsManager.filterId
        this.canDelete = this.checkIfCanDelete()
      },
      onOpenBefore: () => {
        this.buttons?.forEach((button) => button?.onOpen?.())
        // delete button
        const langPackKey: LangPackKey = this.dialog?.secret ?
          'ChatList.Context.DeleteChat' : // В7-1 — расхождение 8
          getDeleteButtonText(this.peerId!)
        const lastButton = this.buttons![this.buttons!.length - 1]
        if(lastButton?.element) {
          lastButton.element.lastChild!.replaceWith(i18n(langPackKey))
        }
      },
      onClose: () => {
        this.buttons?.forEach((button) => button?.onClose?.())
        this.li?.classList.remove('menu-open')

        this.li =
        this.peerId =
        this.dialog =
        this.filterId =
        this.canDelete = undefined
      },
      findElement: (e) => {
        return findDialogListElement(e.target!)
      },
    })
  }

  private getButtons(): ButtonMenuItemOptionsVerifiable[] {
    if(this.buttons) {
      return this.buttons
    }

    return this.buttons = [{
      icon: 'newtab',
      text: 'OpenInNewTab',
      onClick: (e: MouseEvent | TouchEvent) => {
        this.appDialogsManager.openDialogInNewTab(this.li!)
        cancelEvent(e)
      },
      verify: () => IS_SHARED_WORKER_SUPPORTED,
    }, {
      icon: 'readchats',
      text: 'MarkAsRead',
      onClick: this.onUnreadClick,
      verify: () => !!this.dialog && isDialogUnread(this.dialog),
    }, {
      icon: 'pin',
      text: 'ChatList.Context.Pin',
      onClick: this.onPinClick,
      verify: () => {
        if(!this.dialog) return false
        if(this.isUserFolder()) return false // О-70 волна 7 — расхождение 6

        const isPinned = !!this.dialog.pFlags?.pinned
        return !isPinned
      },
    }, {
      icon: 'unpin',
      text: 'ChatList.Context.Unpin',
      onClick: this.onPinClick,
      verify: () => {
        if(!this.dialog) return false
        if(this.isUserFolder()) return false // О-70 волна 7 — расхождение 6

        const isPinned = !!this.dialog.pFlags?.pinned
        return isPinned
      },
    }, {
      icon: 'mute',
      text: 'ChatList.Context.Mute',
      onClick: this.onMuteClick,
      verify: () => {
        return !!this.dialog &&
          this.peerId !== rootScope.myId &&
          !isPeerLocalMuted(this.dialog)
      },
    }, {
      icon: 'unmute',
      text: 'ChatList.Context.Unmute',
      onClick: this.onUnmuteClick,
      verify: () => {
        return !!this.dialog &&
          this.peerId !== rootScope.myId &&
          isPeerLocalMuted(this.dialog)
      },
    }, {
      icon: 'archive',
      text: 'Archive',
      onClick: this.onArchiveClick,
      verify: () => !!this.dialog &&
        !isDialogArchived(this.dialog) &&
        this.peerId !== rootScope.myId,
    }, {
      icon: 'unarchive',
      text: 'Unarchive',
      onClick: this.onArchiveClick,
      verify: () => !!this.dialog &&
        isDialogArchived(this.dialog) &&
        this.peerId !== rootScope.myId,
    }, {
      icon: 'message_crossed',
      text: 'ClearHistory',
      onClick: this.onClearHistoryClick,
      verify: () => !!this.dialog &&
        !this.dialog.secret && // В7-1 — расхождение 8
        canClearHistory(cachedPeer(this.peerId!)),
    }, {
      icon: 'delete',
      className: 'danger',
      text: 'Delete',
      onClick: this.onDeleteClick,
      verify: () => !!this.canDelete,
    }]
  }

  /** расхождение 6: `filterId > 1` оригинала — пользовательская папка */
  private isUserFolder() {
    return this.filterId !== undefined && this.filterId !== ALL_FOLDER_ID && this.filterId !== ARCHIVE_FOLDER_ID
  }

  private checkIfCanDelete() {
    if(!this.dialog) {
      return false
    }

    if(this.peerId === rootScope.myId) { // О-89 волна 7 — расхождение 9
      return false
    }

    return true
  }

  private onArchiveClick = () => {
    const dialog = getAnyDialog(this.peerId!)
    if(dialog) {
      void this.managers.groups.setArchive(dialog.peerId, !isDialogArchived(dialog))
    }
  }

  private onPinClick = () => {
    const { peerId, dialog } = this
    this.managers.groups.setPin(peerId!, !dialog!.pFlags?.pinned).catch((err: unknown) => {
      showPinLimitReached(err)
    })
  }

  private onUnmuteClick = () => {
    void this.managers.groups.setMute(this.peerId!, false)
  }

  private onMuteClick = () => {
    const peerId = this.peerId!
    // ВРЕМЕННО до 2C-7: `showMutePopup(peerId)` — vanilla `PopupMute`
    PopupElement.createPopup(PopupMute, peerId, this.managers, (seconds) => {
      const until = seconds ? Math.floor(Date.now() / 1000) + seconds : undefined
      void this.managers.groups.setMute(peerId, true, until)
    })
  }

  private onUnreadClick = () => {
    const { peerId, dialog } = this
    if(!dialog) return

    // ветка `else` оригинала (`markDialogUnread({peerId})` — поставить отметку) — О-72
    if(dialog.unread_count) {
      void this.managers.realtime.markRead({ peerId: peerId!, upToId: dialog.top_message }) // расхождение 3
    }
  }

  private onClearHistoryClick = () => {
    void clearHistoryWithConfirmation({
      peerId: this.peerId!,
      managers: this.managers,
    })
  }

  private onDeleteClick = () => {
    showDeleteDialogPopup(
      this.peerId!,
      this.managers,
      undefined,
      !!this.dialog?.secret, // В7-1 — расхождение 8
    )
  }
}
