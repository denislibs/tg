// ВРЕМЕННО до порта popups/sendGift — мост вместо `showSendGiftPopup` из tweb
// `src/components/popups/sendGift.tsx:1093` (812502980). До порта Solid-попапа
// подарок выбирает текущий React `stars/SendGiftPopup.tsx`, открытый ФУНКЦИЕЙ
// через `popupStore` (остров оверлеев) — тот же приём, что у
// `popups/datePicker.bridge.ts`. Зовут его кнопки строки ввода: `btnSendGift`
// и правый слот плашки `giftControlBtn` (tweb `input.ts:1079-1085`,
// `:1653-1656`). Порт заменяет импорт у вызывающих и удаляет этот файл:
// `git grep -n "ВРЕМЕННО до порта popups/sendGift"` → пусто.
//
// Сигнатура — оригинала в объёме `{peerId}`: `birthday` и `resaleParams`
// React-попап не умеет. Получатель у React-попапа — пользователь
// (`stars.send(toUserId, …)`); подарок каналу (плашка канала, tweb
// `giftControlBtn` при `isBroadcast`) ручкой `stars.send` не поддержан — у
// канала кнопка не открывает ничего.
import { createElement } from 'react'
import SendGiftPopup from '@components/stars/SendGiftPopup'
import { openPopup } from '@stores/popupStore'
import { peerTitle } from '@core/peerCache'
import { isUser } from '@core/peers/peerId'

export default function showSendGiftPopup(options: { peerId: PeerId }) {
  const { peerId } = options
  if(!isUser(peerId)) return

  openPopup((p) => createElement(SendGiftPopup, {
    open: p.open,
    onClose: p.requestClose,
    onExitComplete: p.onExitComplete,
    toUserId: +peerId,
    toName: peerTitle(peerId),
  }))
}
