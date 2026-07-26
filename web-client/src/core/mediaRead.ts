// «Прослушано/просмотрено» для голосовых и видео-кружков (tweb
// messages.readMessageContents): локально гасит точку media_unread сразу,
// серверу шлёт read_media — тот снимает флаг и рассылает media_read всем
// участникам (у отправителя точка гаснет live).
import { startClient } from '../client/bootstrap'
import { useMessagesStore } from '../stores/messagesStore'

export function markMediaPlayed(chatId: number, msgId: number): void {
  useMessagesStore.getState().applyMediaRead(chatId, msgId)
  void startClient().managers.realtime.markMediaRead({ chatId, msgId })
}
