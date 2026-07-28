// Подписчик браузерных уведомлений на realtime-события. Независим от Store-проектора.
import { eventBus } from '../../core/realtime/eventBus'
import { RT } from '../../core/realtime/events'
import { notifyIncomingMessage } from '../uiNotifications'

export function registerNotificationSubscriber(): void {
  // Уведомление о входящем, гейтинг как в tweb: per-chat mute → глобальные настройки
  // типа чата → клиентские настройки (см. uiNotifications).
  eventBus.subscribe(RT.newMessage, (evt) => {
    if (evt.backfill) return // catch-up после reconnect — уже уведомляли вживую
    notifyIncomingMessage(evt)
  })
}
