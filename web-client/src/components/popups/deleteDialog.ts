// Порт tweb `src/components/popups/deleteDialog.ts` (238 строк, `leaveChat` `:11-15`,
// `showDeleteDialogPopup` `:17-237`) — подтверждение «удалить чат / покинуть» из
// меню диалога (`components/dialogsContextMenu.ts`, пункт `Delete`).
//
// ВРЕМЕННО до 2C-6: попап строится на vanilla `PopupPeer` (`popups/popupPeer.ts`)
// через `PopupElement.createPopup(...).show()` — `showPeerPopup` (Solid `peer.tsx`)
// портирует задача 2C-6 плана `2026-09-27-wave-2c-popups-solid.md`.
//
// Расхождения:
//  1. Действия — наши ручки, а не `appMessagesManager.flushHistory`/`appChatsManager`:
//     удалить группу/канал для всех — `groups.deleteGroup` (`DELETE /chats/{id}`),
//     выйти — `groups.removeMember(peerId, myId)` + `dialogs.applyRemoved` (тот же
//     путь, что у шапки чата, `Chat.tsx::doDeleteChat`). Удалить личку у себя на
//     бэкенде и есть выход из неё: `flushHistory({justClear: false})` у нас нет.
//  2. О-89 волна 7: «удалить и у собеседника» (`revoke`, чекбокс
//     `DeleteMessagesOptionAlso`) и удаление «Избранного» (`saved`,
//     `AreYouSureDeleteThisChatSavedMessages`) — на бэкенде нет удаления истории
//     вместе с диалогом (`POST /chats/{id}/clear` чистит только у себя). Пункт
//     `Delete` у «Избранного» меню не показывает (`dialogsContextMenu.ts`).
//  3. Ветки `monoforum`, `monoforum_thread`, `savedDialog`, `botforum_thread` и
//     тем форума (`threadId`) — О-4, О-3, задачи 1-6/1-7 (`core/peers/dialogType.ts`).
//  4. Отступление В7-1: секретный чат (наш продукт, у tweb его нет) — это личка:
//     тексты `chat`, действие — выход, как у шапки секретного чата.
//  5. `onSelect` оригинала у меню не передаётся; закрыть открытый удалённый чат у
//     tweb — дело класса `Chat` (`dialog_drop`, `chat.ts:658-668`), у нас его нет:
//     ВРЕМЕННО до Э6 это делает сам попап (`closeChatLevel({isDeleting: true})`).
//  6. Имя в тексте — `PeerTitle` с миддлварью, которую попап снимает на закрытии
//     (`wrapPeerTitle` у нас — узел, которому надо знать, когда его снять).
import type { FormatterArguments, LangPackKey } from '@lib/langPack'
import rootScope from '@lib/rootScope'
import { getMiddleware } from '@helpers/middleware'
import PeerTitle, { type PeerTitleManagers } from '@components/chat/peerTitle'
import PopupElement from './popupElement'
import PopupPeer, { type PopupPeerOptions } from './popupPeer'
import { getDialogType, type PeerType } from '@core/peers/dialogType'
import { hasRightsPeer } from '@core/peerCache'
import { closeChatLevel } from '@core/navigation/chatHistory'
import { useNavigationStore } from '@stores/navigationStore'
import type { Managers } from '@/client/bootstrap'

export type DeleteDialogManagers = PeerTitleManagers & {
  groups: Pick<Managers['groups'], 'deleteGroup' | 'removeMember'>
  dialogs: Pick<Managers['dialogs'], 'applyRemoved'>
}

/** `:11-15` — расхождение 1: выход у нас снимает диалог сам, `flush` не нужен. */
export function leaveChat(peerId: PeerId, managers: DeleteDialogManagers) {
  return managers.groups.removeMember(peerId, rootScope.myId).then(() => managers.dialogs.applyRemoved(peerId))
}

export default function showDeleteDialogPopup(
  peerId: PeerId,
  managers: DeleteDialogManagers,
  peerType?: PeerType,
  isSecret?: boolean,
) {
  const middlewareHelper = getMiddleware() // расхождение 6
  const wrapPeerTitle = () => new PeerTitle({ peerId, middleware: middlewareHelper.get(), managers }).element
  const peerTitleElement = wrapPeerTitle()

  if(peerType === undefined) {
    peerType = isSecret ? 'chat' : getDialogType(peerId) // расхождение 4
  }

  // расхождение 5
  const onSelect = (promise: Promise<unknown>) => {
    void promise.then(() => {
      if(useNavigationStore.getState().selectedId === String(peerId)) {
        closeChatLevel({ isDeleting: true }) // ВРЕМЕННО до Э6
      }
    })
  }

  const callbackLeave = () => {
    onSelect(leaveChat(peerId, managers))
  }

  const callbackDelete = (checked?: Set<LangPackKey>) => {
    let promise: Promise<unknown>

    if(peerType === 'chat') {
      promise = leaveChat(peerId, managers) // расхождение 1
    } else {
      if(checked?.size) {
        promise = managers.groups.deleteGroup(peerId)
      } else {
        return callbackLeave()
      }
    }

    onSelect(promise)
  }

  let title: LangPackKey,
    description: LangPackKey,
    descriptionArgs: FormatterArguments | undefined,
    buttons: PopupPeerOptions['buttons'],
    checkboxes: PopupPeerOptions['checkboxes']
  switch(peerType) {
    case 'channel': {
      if(hasRightsPeer(peerId, 'delete_chat')) {
        title = 'ChannelDeleteMenu'
        description = 'AreYouSureDeleteAndExitChannel'
        buttons = [{
          langKey: 'ChannelDeleteMenu',
          isDanger: true,
          callback: callbackDelete,
        }]

        checkboxes = [{
          text: 'DeleteChannelForAll',
        }]
      } else {
        title = 'LeaveChannelMenu'
        description = 'ChannelLeaveAlertWithName'
        descriptionArgs = [peerTitleElement]
        buttons = [{
          langKey: 'LeaveChannel',
          isDanger: true,
          callback: callbackLeave,
        }]
      }

      break
    }

    case 'chat': {
      title = 'DeleteChatUser'
      description = 'AreYouSureDeleteThisChatWithUser'
      descriptionArgs = [peerTitleElement]

      buttons = [{
        langKey: 'DeleteChatUser',
        isDanger: true,
        callback: callbackDelete,
      }]

      // О-89 волна 7: чекбокс `DeleteMessagesOptionAlso` (revoke) — расхождение 2

      break
    }

    case 'saved':
      // О-89 волна 7 — расхождение 2: меню пункт не показывает
      middlewareHelper.destroy()
      return

    case 'megagroup':
    case 'group': {
      if(hasRightsPeer(peerId, 'delete_chat')) {
        title = 'DeleteMegaMenu'
        description = 'AreYouSureDeleteAndExit'
        buttons = [{
          langKey: 'DeleteMegaMenu',
          isDanger: true,
          callback: callbackDelete,
        }]

        checkboxes = [{
          text: 'DeleteChat.DeleteGroupForAll',
        }]
      } else {
        title = 'LeaveMegaMenu'
        description = 'AreYouSureDeleteAndExitName'
        descriptionArgs = [peerTitleElement]
        buttons = [{
          langKey: 'DeleteChatUser',
          isDanger: true,
          callback: callbackLeave,
        }]
      }

      break
    }
  }

  // ВРЕМЕННО до 2C-6: `showPeerPopup('popup-delete-chat', …)`
  const popup = PopupElement.createPopup(PopupPeer, 'popup-delete-chat', {
    peerId,
    managers,
    titleLangKey: title,
    descriptionLangKey: description,
    descriptionLangArgs: descriptionArgs,
    buttons,
    checkboxes,
  })
  popup.addEventListener('closeAfterTimeout', () => middlewareHelper.destroy())
  popup.show()
}
