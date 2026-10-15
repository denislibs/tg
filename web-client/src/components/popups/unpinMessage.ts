// Порт tweb `src/components/popups/unpinMessage.ts` (812502980, 116 строк) — подтверждение
// закрепления/открепления сообщения, «Открепить все» и «Скрыть закреплённые». Пачка П-5
// волны 7 (Б-19; пункт «Закрепить» меню сообщения — Б-28 — зовёт этот же попап).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Менеджеры — `getProxiedManagers()` (роль `rootScope.managers`), закрепная часть
//     `appMessagesManager` — `core/pinnedMessages.ts` (его расхождения 1, 4).
//  2. `showPeerPopup('popup-delete-chat', …)` — `PopupElement.createPopup(PopupPeer, …)`,
//     как у `popups/deleteDialog.ts` (ВРЕМЕННО до 2C-6). Заголовок пира в «Закрепить и для
//     %1$s» — `PeerTitle` (роль `wrapPeerTitle`).
//  3. У канала чекбоксов нет — `PopupPeer` зовёт колбэк кнопки без набора отмеченных
//     (у tweb он всегда есть, пустой), поэтому `checked?.size`.
import { getProxiedManagers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import type { FormatterArguments, LangPackKey } from '@lib/langPack'
import { getMiddleware } from '@helpers/middleware'
import PeerTitle from '@components/chat/peerTitle'
import { isBroadcastPeer } from '@core/peerCache'
import { isAnyChat } from '@core/peers/peerId'
import { canPinMessage, getPinnedMessage, hidePinnedMessages, unpinAllMessages, updatePinnedMessage } from '@core/pinnedMessages'
import PopupElement from './popupElement'
import PopupPeer, { addCancelButton, type PopupPeerOptions } from './popupPeer'

export default async function showPinMessagePopup(
  peerId: PeerId,
  mid: number,
  unpin?: true,
  onConfirm?: () => void,
  /** Forum topic the action is scoped to — the pinned list there is per-topic. */
  threadId?: number,
) {
  let title: LangPackKey, description: LangPackKey, descriptionArgs: FormatterArguments | undefined
  const buttons: PopupPeerOptions['buttons'] = [], checkboxes: NonNullable<PopupPeerOptions['checkboxes']> = []

  const managers = getProxiedManagers()
  const middlewareHelper = getMiddleware()

  const canUnpin = canPinMessage(peerId)

  // tweb `callback(e, checked, oneSide, silent)` :22-39
  const callback = (oneSide?: boolean, silent?: boolean) => {
    setTimeout(() => { // * костыль, потому что document.elementFromPoint вернёт popup-peer пока он будет закрываться
      let promise: Promise<unknown>
      if(unpin && !mid) {
        if(canUnpin) {
          promise = unpinAllMessages(managers, peerId, threadId)
        } else {
          promise = hidePinnedMessages(managers, peerId, threadId)
        }
      } else {
        promise = updatePinnedMessage(managers, peerId, mid, unpin, silent, oneSide)
      }

      if(onConfirm) {
        void promise.then(onConfirm)
      }
    }, 300)
  }

  if(unpin) {
    let buttonText: LangPackKey = 'UnpinMessage'
    if(!mid) {
      if(canUnpin) {
        title = 'Popup.Unpin.AllTitle'
        description = 'Chat.UnpinAllMessagesConfirmation'
        descriptionArgs = ['' + (((await getPinnedMessage(managers, peerId, threadId)).count) || 1)]
      } else {
        title = 'Popup.Unpin.HideTitle'
        description = 'Popup.Unpin.HideDescription'
        buttonText = 'Popup.Unpin.Hide'
      }
    } else {
      title = 'UnpinMessageAlertTitle'
      description = 'Chat.Confirm.Unpin'
    }

    buttons.push({
      langKey: buttonText,
      isDanger: true,
      callback: () => callback(),
    })
  } else {
    title = 'PinMessageAlertTitle'
    const pinButtonText: LangPackKey = 'PinMessage'

    if(isAnyChat(peerId)) {
      // :70 — «Уведомить всех» снят (у канала чекбокса нет) — закрепить без звука
      buttons.push({
        langKey: pinButtonText,
        callback: (checked) => callback(false, !checked?.size),
      })

      if(isBroadcastPeer(peerId)) {
        description = 'PinMessageAlertChannel'
      } else {
        description = 'PinMessageAlert'

        checkboxes.push({
          text: 'PinNotify',
          checked: true,
        })
      }
    } else {
      description = 'PinMessageAlertChat'

      if(peerId === rootScope.myId) {
        buttons.push({
          langKey: pinButtonText,
          callback: () => callback(),
        })
      } else {
        // :94 — «Закрепить и для …» снят — закрепить только у себя (pm_oneside)
        buttons.push({
          langKey: pinButtonText,
          callback: (checked) => callback(!checked?.size),
        })

        checkboxes.push({
          text: 'PinAlsoFor',
          textArgs: [new PeerTitle({ peerId, middleware: middlewareHelper.get(), managers }).element],
          checked: true,
        })
      }
    }
  }

  addCancelButton(buttons)

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
