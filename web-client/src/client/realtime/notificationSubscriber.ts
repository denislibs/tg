// Подписчик браузерных уведомлений на realtime-события. Независим от Store-проектора.
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { mapMessage } from '../../core/models'
import { notifyIncomingMessage } from '../uiNotifications'

export function registerNotificationSubscriber(): void {
  // Уведомление о входящем, гейтинг как в tweb: per-chat mute → глобальные настройки
  // типа чата → клиентские настройки (см. uiNotifications).
  rootScope.addEventListener(RT.newMessage, (evt, meta) => {
    // Кадр из catch-up (reconnect/backfill) — уже «прошлое»: звук и нотификация не
    // играют. Раньше это держалось только на дедупе funnel'а по pts.
    if (meta?.catchUp) return
    // Кадр несёт сообщение ЦЕЛИКОМ; уведомлению нужен тот же объект, что и ленте,
    // — второй выжимки из четырёх полей больше нет. `meId` здесь не нужен:
    // формулировку пилюли уведомление не строит, ему хватает лейбла вида.
    const m = mapMessage(evt.message)
    if (m._ !== 'messageEmpty') notifyIncomingMessage(m)
  })
}
