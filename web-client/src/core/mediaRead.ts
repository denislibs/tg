// «Прослушано/просмотрено» для голосовых и видео-кружков (tweb
// messages.readMessageContents): шлёт read_media воркеру — тот гасит точку в SSOT
// и бродкастит media_read всем вкладкам (storeProjection единственный писатель),
// а серверу отправляет read_media (у отправителя точка гаснет по его live-кадру).
import { startClient } from '../client/bootstrap'

export function markMediaPlayed(chatId: number, msgId: number): void {
  void startClient().managers.realtime.markMediaRead({ chatId, msgId })
}
