// Порт tweb `appMessagesManager.canDeleteMessage` (812502980 :8398-8409) —
// «можно ли удалить сообщение». Спрашивают двое, как и у оригинала: меню
// сообщения ленты (`chat/contextMenu.ts`) и меню элемента shared media
// (`SearchContextMenu`, `components/appSearchSuper.ts`).
//
// Из слагаемых оригинала выпали три — у каждого нет факта:
//  • `pFlags.welcome_template` → `canManageWelcomeMessages` (шаблоны
//    приветствий) и `isEphemeralMessage` (эфемерные сообщения) — таких
//    сообщений наша модель не знает;
//  • базовая группа (`chat._ === 'chat'`) — такого конструктора бэкенд не
//    производит вовсе (`core/peers/peerId.ts`).
// `pFlags.is_outgoing` («ещё не отправлено») у нас — дробный номер
// (`isLocalMessageId`), `message.error` — флаг `failed`.
import { isLocalMessageId } from '@core/history/messageId'
import type { MessageReal, MyMessage } from '@core/models'
import { hasRightsPeer } from '@core/peerCache'
import { isUser } from '@core/peers/peerId'

export default function canDeleteMessage(message: MyMessage | undefined): boolean {
  return !!message && (
    isUser(message.peerId) ||
    !!message.pFlags.out ||
    hasRightsPeer(message.peerId, 'delete_messages')
  ) && (!isLocalMessageId(message.id) || !!(message as MessageReal).failed)
}
