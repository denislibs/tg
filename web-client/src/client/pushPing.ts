// Пинг «вкладка готова принять клик по пушу» — порт tweb `webPushApiManager.ts`
// `isAliveNotify` (:182-184, `PING_PUSH_INTERVAL = 10000`) вместе с приёмом в SW
// `serviceWorker/push.ts::onPing` (:482-487): SW держит `pendingNotification`
// (клик по пушу, когда окна не было или приложение заперто) и отдаёт его вкладке по
// этому сообщению (`public/sw.js::onPushReady`). Слать его нужно без условия на DNP:
// мост `dnp-ping` в проде выключен.
//
// Расхождение с tweb: пинг не шлётся, пока приложение заперто код-паролем (у tweb
// запертое приложение молчит само, потому что адрес ждёт `topMessagesDeferred`, а
// диалоги под замком не грузятся) — первый пинг уходит сразу после разблокировки.
import { useLockStore } from '@stores/lockStore'

/** tweb `webPushApiManager.ts:35`, миллисекунды. */
export const PING_PUSH_INTERVAL = 10000

function ping() {
  if(useLockStore.getState().locked) return
  navigator.serviceWorker.controller?.postMessage({ type: 'push-ready' })
}

/** Первый пинг — сразу, дальше раз в `PING_PUSH_INTERVAL`; разблокировка — внеочередной. */
export function startPushPing(): () => void {
  ping()
  const timer = setInterval(ping, PING_PUSH_INTERVAL)
  const unsubscribe = useLockStore.subscribe((state, prev) => {
    if(prev.locked && !state.locked) ping()
  })
  return () => {
    clearInterval(timer)
    unsubscribe()
  }
}
