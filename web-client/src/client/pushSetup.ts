import { startClient } from './bootstrap'
import { useSettingsStore } from '../settings'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function keyB64(sub: PushSubscription, name: 'p256dh' | 'auth'): string {
  const buf = sub.getKey(name)
  if (!buf) return ''
  let s = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

let done = false

// Register the browser push subscription with the backend (best-effort, idempotent).
export async function setupPush(): Promise<void> {
  if (done) return
  done = true
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return
    const reg = await navigator.serviceWorker.ready
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    if (perm !== 'granted') {
      done = false // разрешение могут выдать позже (экран настроек) — не блокировать retry
      return
    }
    const { managers } = startClient()
    const vapid = await managers.push.vapidKey()
    if (!vapid) return
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapid) })
    }
    await managers.push.subscribe({ endpoint: sub.endpoint, p256dh: keyB64(sub, 'p256dh'), auth: keyB64(sub, 'auth') })
  } catch {
    done = false // allow a later retry (e.g. permission granted afterwards)
  }
}

// «Show offline notifications» (tweb onPushConditionsChange): off — снимаем
// браузерную push-подписку (серверу некуда слать), on — подписываемся заново.
export async function setPushEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    done = false
    return setupPush()
  }
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) await sub.unsubscribe()
    done = false
  } catch {
    /* best-effort */
  }
}

/**
 * Порт tweb `uiNotificationsManager.onPushConditionsChange`
 * (`lib/uiNotificationsManager.ts:405-420`): push нужен, когда включён
 * «Show offline notifications» (и есть разрешение — его проверяет `setupPush`);
 * иначе подписка снимается. Зовут подписчик настройки ниже и экран
 * «Уведомления» — сразу после выданного разрешения (`notifications.tsx:397-399`).
 */
export function onPushConditionsChange(): Promise<void> {
  return setPushEnabled(useSettingsStore.getState().notifyPush)
}

/**
 * Подписчик настройки `notifyPush` — порт
 * `createEffect(on(() => this.settings.push, this.onPushConditionsChange))`
 * (`uiNotificationsManager.ts:320-322`): побочка переключателя живёт не в
 * обработчике строки экрана, а у самой настройки, поэтому срабатывает, кто бы
 * её ни поменял. Как и `on` без `defer`, отрабатывает сразу при заводе.
 */
export function watchPushConditions(): () => void {
  void onPushConditionsChange()
  return useSettingsStore.subscribe((state, prev) => {
    if (state.notifyPush !== prev.notifyPush) void onPushConditionsChange()
  })
}
