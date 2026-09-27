// src/components/conversation/goDownUnreadCount.ts
// Бейдж кнопки «вниз» — порт tweb `chat/input.ts::setUnreadCount` (:2220-2243):
// число — это `dialog.unread_count`, и только оно.
//
// Прежде бейдж ВЫВОДИЛСЯ разностью «номер последнего сообщения минус горизонт
// прочтения» (`lastMessage.id - read_inbox_max_id`). Номер сообщения — не
// счётчик непрочитанного: в разность попадают СВОИ исходящие (их не
// «читают», горизонт входящих их не покрывает) и дыры от удалённых
// сообщений. Отправил три сообщения подряд — на кнопке «3», хотя читать
// нечего. Счётчик непрочитанного ведёт владелец диалогов
// (`dialogsManager.applyNewMessage` бампит только входящие, авторитет
// приезжает строкой диалога и кадром прочтения) — его и показываем.
import type { Dialog } from '@core/models'

export function goDownUnreadCount(dialog: Pick<Dialog, 'unread_count'> | undefined): number {
  return dialog?.unread_count || 0
}
