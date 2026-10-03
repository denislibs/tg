/**
 * Порт tweb `src/components/popups/unpinMessage.ts` (`showPinMessagePopup`,
 * 812502980, 116 строк) — подтверждение «закрепить / открепить сообщение».
 * Зовут: пункты «Закрепить»/«Открепить» меню сообщения
 * (`chat/contextMenu.ts`, tweb contextMenu.ts:2220-2226).
 *
 * ВРЕМЕННО до 2C-6: попап строит наш vanilla `PopupPeer`
 * (`createPopup(PopupPeer, …)`), а не `showPeerPopup` оригинала — Solid-оболочку
 * `popups/peer.tsx` портирует задача 6 плана 2C; ей же — перевести этот вызов.
 *
 * Расхождения (у каждого — предмет):
 *  1. чекбоксы «Уведомить всех участников» (`PinNotify`, :88-91) и «Закрепить
 *     также у …» (`PinAlsoFor`, :103-107) НЕ показываются: их значения уходят
 *     параметрами `silent`/`pm_oneside` в `updatePinnedMessage` (:35), а наша
 *     ручка `POST /chats/{peer}/messages/{seq}/pin` (`chat_handler.go:907-929`)
 *     их не принимает — флажок, который ничего не меняет, был бы враньём.
 *     Бэклог Б-94;
 *  2. ветка «открепить всё / скрыть закреп» (`unpin && !mid`, :26-31, :45-56)
 *     не портирована: её зовёт плашка закрепа шапки (Б-19, сосед «закреп»), а у
 *     менеджера нет ни `unpinAllMessages`, ни `hidePinnedMessages`;
 *  3. `threadId` (закреп в теме форума, :13) не принимается: ручка закрепа
 *     темы не знает;
 *  4. `setTimeout(…, 300)` вокруг вызова (:24 — «костыль»: `elementFromPoint`
 *     у оригинала попадает в закрывающийся попап) сохранён дословно.
 */
import PopupElement from './popupElement'
import PopupPeer, { type PopupPeerButton } from './popupPeer'
import { startClient } from '@/client/bootstrap'
import type { LangPackKey } from '@lib/langPack'
import { isBroadcastPeer } from '@core/peerCache'
import { isAnyChat } from '@core/peers/peerId'

export default function showPinMessagePopup(
  peerId: PeerId,
  mid: number,
  unpin?: true,
  onConfirm?: () => void,
) {
  let title: LangPackKey, description: LangPackKey
  const buttons: PopupPeerButton[] = []

  // :18; `canUnpin` (:20) нужен только ветке «открепить всё» (расхождение 2)
  const { managers } = startClient()

  const callback = () => {
    setTimeout(() => { // * костыль, потому что document.elementFromPoint вернёт popup-peer пока он будет закрываться
      const promise = unpin ?
        managers.messages.unpin(peerId, mid) :
        managers.messages.pin(peerId, mid)

      if(onConfirm) {
        void promise.then(onConfirm)
      }
    }, 300)
  }

  if(unpin) {
    // :45-62 без ветки `!mid` (расхождение 2)
    title = 'UnpinMessageAlertTitle'
    description = 'Chat.Confirm.Unpin'

    buttons.push({
      langKey: 'UnpinMessage',
      isDanger: true,
      callback,
    })
  } else {
    title = 'PinMessageAlertTitle'
    const pinButtonText: LangPackKey = 'PinMessage'

    if(isAnyChat(peerId)) {
      buttons.push({
        langKey: pinButtonText,
        callback,
      })

      // :82-92 — чекбокс `PinNotify` не показывается (расхождение 1)
      description = isBroadcastPeer(peerId) ? 'PinMessageAlertChannel' : 'PinMessageAlert'
    } else {
      // :93-108 — «Избранное» и прочие личные чаты различаются у оригинала
      // только чекбоксом `PinAlsoFor` (расхождение 1)
      description = 'PinMessageAlertChat'
      buttons.push({
        langKey: pinButtonText,
        callback,
      })
    }
  }

  // :111 `addCancelButton(buttons)` — добавляет сам `PopupPeer`
  const popup = PopupElement.createPopup(PopupPeer, 'popup-delete-chat', { // :113
    peerId,
    managers,
    titleLangKey: title,
    descriptionLangKey: description,
    buttons,
  })
  popup.show()
  return popup
}
