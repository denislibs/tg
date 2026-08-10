// Подписчик браузерных уведомлений на realtime-события. Независим от Store-проектора.
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { notifyIncomingMessage } from '../uiNotifications'

export function registerNotificationSubscriber(): void {
  // Уведомление о входящем, гейтинг как в tweb: per-chat mute → глобальные настройки
  // типа чата → клиентские настройки (см. uiNotifications).
  rootScope.addEventListener(RT.newMessage, (evt) => {
    notifyIncomingMessage(evt)
  })
}
