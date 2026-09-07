/**
 * Порт tweb `src/components/wrappers/senderToPeer.ts` (`wrapSenderToPeer`) —
 * подпись «кто ➝ куда» у документа в режиме поиска/shared-media: имя
 * отправителя, а в группе (и у своего сообщения) — ещё и имя чата после « ➝ ».
 *
 * Возврат СИНХРОННЫЙ (в tweb — `Promise<HTMLElement>`): оба `await` оригинала —
 * `wrapPeerTitle` и `appPeersManager.isAnyGroup` — у нас отвечают из зеркала
 * карточек синхронно (`PeerTitle`, `isAnyGroupPeer`).
 *
 * ЧТО НЕ ПОРТИРОВАНО (и почему):
 *   • `dialog: message.peerId === rootScope.myId` у `wrapPeerTitle` — в
 *     «Избранном» tweb подписывает отправителя как «Saved Messages», а не своим
 *     именем. У нашего `PeerTitle` опции `dialog` нет (порт в объёме ленты), и
 *     отправитель в «Избранном» подписывается своим именем;
 *   • `getFwdFromName(fwd_from)` — отдельного хелпера у нас нет, поле
 *     `fwd_from.from_name` читается на месте: это и есть всё тело оригинала.
 */
import PeerTitle, { type PeerTitleManagers } from '@components/chat/peerTitle'
import { isAnyGroupPeer } from '@core/peerCache'
import type { MessageFwdHeader } from '@core/models'
import type { Middleware } from '@helpers/middleware'
import { i18n } from '@lib/langPack'
import rootScope from '@lib/rootScope'

/** То, что подписи нужно от сообщения (tweb передаёт весь `MyMessage`). */
export interface SenderToPeerMessage {
  peerId?: PeerId
  fromId?: PeerId
  fwd_from?: MessageFwdHeader
}

export default function wrapSenderToPeer(
  message: SenderToPeerMessage,
  middleware: Middleware,
  managers: PeerTitleManagers,
): HTMLElement {
  const senderTitle = document.createElement('span')
  senderTitle.classList.add('sender-title')

  const fromMe = message.fromId === rootScope.myId && message.peerId !== rootScope.myId
  senderTitle.append(
    fromMe ?
      i18n('FromYou') :
      // tweb `getMessageSenderPeerIdOrName`: есть `fromId` — пир, иначе имя
      // скрытой пересылки.
      new PeerTitle({
        ...(message.fromId !== undefined ? { peerId: message.fromId } : { fromName: message.fwd_from?.from_name }),
        middleware,
        managers,
      }).element,
  )

  if(message.peerId !== undefined && (isAnyGroupPeer(message.peerId) || fromMe)) {
    const peerTitle = new PeerTitle({ peerId: message.peerId, middleware, managers })
    senderTitle.append(' ➝ ', peerTitle.element)
  }

  return senderTitle
}
