// Порт tweb `src/components/popups/sendNow.ts` (812502980): «отправить отложенное
// сейчас» — пункт `MessageScheduleSend` меню сообщения в ленте отложенных
// (`chat/contextMenu.ts`, tweb `:959-963`).
//
// Расхождения:
//  1. Заголовок и описание у оригинала — английские литералы (`Send Message Now`,
//     `Send message now?`, ветка `mids.length > 1`); у нас — ключи словаря
//     `Chat.SendNow.Title[Multiple]`/`Chat.SendNow.Text[Multiple]` (литералов в интерфейсе
//     нет — `i18n/noHardcodedStrings.test.ts`).
//  2. `showPeerPopup` (Solid `peer.tsx`) — `PopupElement.createPopup(PopupPeer, …)`,
//     как у `popups/deleteDialog.ts` (ВРЕМЕННО до 2C-6).
import PopupElement from '@components/popups/popupElement'
import PopupPeer from '@components/popups/popupPeer'

export default function showSendNowPopup(
  /** `rootScope.managers.appMessagesManager.sendScheduledMessages` оригинала —
   *  у нас менеджеры приезжают вызывающему, а не синглтоном */
  sendScheduledMessages: (peerId: PeerId, mids: number[]) => Promise<void>,
  peerId: PeerId,
  mids: number[],
  onConfirm?: () => void,
) {
  const popup = PopupElement.createPopup(PopupPeer, 'popup-delete-chat', {
    titleLangKey: mids.length > 1 ? 'Chat.SendNow.TitleMultiple' : 'Chat.SendNow.Title',
    descriptionLangKey: mids.length > 1 ? 'Chat.SendNow.TextMultiple' : 'Chat.SendNow.Text',
    descriptionLangArgs: [mids.length],
    buttons: [{
      langKey: 'Send',
      callback: () => {
        onConfirm?.()
        void sendScheduledMessages(peerId, mids)
      },
    }],
  })
  popup.show()
}
