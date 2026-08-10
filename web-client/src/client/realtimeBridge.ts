// src/client/realtimeBridge.ts
// Точка сборки realtime: поднимает «насос» smp → eventBus и регистрирует подписчиков
// шины. Сам мост больше не содержит обработчиков событий — они живут в модулях-
// подписчиках (storeProjection / soundSubscriber / notificationSubscriber).
import { startClient } from './bootstrap'
import { RT } from '../core/realtime/events'
import { eventBus } from '../core/realtime/eventBus'
import { registerStoreProjection } from './realtime/storeProjection'
import { registerSoundSubscriber } from './realtime/soundSubscriber'
import { registerNotificationSubscriber } from './realtime/notificationSubscriber'
import { registerCallSubscriber } from './realtime/callSubscriber'
import { registerRefetchSubscriber } from './realtime/refetchSubscriber'

let started = false

// Полный каталог событий, которые может прислать воркер. Насос перекачивает каждое
// в eventBus; новое событие достаточно добавить в RT — оно будет транслироваться.
const WORKER_EVENTS: string[] = [...Object.values(RT), 'rt:resync', 'media:upload_progress', 'state:mirror']

// Subscribe to worker realtime events exactly once per page.
export function startRealtime(): void {
  if (started) return
  started = true
  const { smp, managers } = startClient()

  // Единственный потребитель smp: перекачивает все события воркера в eventBus.
  // Дальше всё подписывается на шину, а не на smp напрямую.
  for (const ev of WORKER_EVENTS) smp.on(ev, (p) => eventBus.publish(ev, p))

  // Подписчики шины (порядок не важен — события независимы).
  registerStoreProjection(managers)
  registerSoundSubscriber()
  registerNotificationSubscriber()
  registerCallSubscriber()
  registerRefetchSubscriber(managers)

  void managers.realtime.start()
}
