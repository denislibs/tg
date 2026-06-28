import { startClient } from './bootstrap'

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
    if (perm !== 'granted') return
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
