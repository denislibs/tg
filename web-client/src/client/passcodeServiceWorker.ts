// Состояние код-пароля для service worker'а — порт tweb
// `apiManagerProxy.ts:774-781` (`sendPasscodeStateToServiceWorker`) и вызовов
// `serviceMessagePort.invoke('toggleCacheStorage' | 'toggleUsingPasscode' |
// 'saveEncryptionKey')` из `lib/passcode/actions.ts`.
//
// SW держит состояние только в памяти, а браузер перезапускает его когда хочет,
// поэтому вкладка присылает его на каждый старт SW (`sw-hello`, аналог tweb
// `hello`, eff3c59fa) — с ключом, если она разблокирована. Сам SW при старте
// без сообщения читает запись `passcode` из `msgr/kv` и, пока ключа нет, ходит
// в сеть мимо корзины (fail closed, `public/sw.js`).
//
// Расхождение: канал — `postMessage` + `MessageChannel` для подтверждения, а не
// `ServiceMessagePort` (у нас SW — обычный скрипт вне сборки).
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode'
import EncryptionKeyStore from '@lib/passcode/keyStore'

const ACK_TIMEOUT = 3000

function postToServiceWorker(message: Record<string, unknown>): Promise<void> {
  if(typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve()
  const target = navigator.serviceWorker.controller
  if(!target) return Promise.resolve() // SW не управляет страницей — медиа мимо него
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    const timeout = setTimeout(resolve, ACK_TIMEOUT)
    channel.port1.onmessage = () => {
      clearTimeout(timeout)
      resolve()
    }
    try {
      target.postMessage(message, [channel.port2])
    } catch{
      clearTimeout(timeout)
      resolve()
    }
  })
}

export function sendPasscodeStateToServiceWorker(): Promise<void> {
  const isUsingPasscode = DeferredIsUsingPasscode.isUsingPasscodeUndeferred()
  if(typeof isUsingPasscode !== 'boolean') return Promise.resolve()
  const encryptionKey = isUsingPasscode ? EncryptionKeyStore.getUndeferred() : null
  return postToServiceWorker({ type: 'passcode-state', isUsingPasscode, encryptionKey })
}

export function toggleServiceWorkerCacheStorage(enabled: boolean): Promise<void> {
  return postToServiceWorker({ type: 'passcode-toggle-cache', enabled })
}

/** SW (пере)запустился — сообщить ему состояние заново. */
export function listenServiceWorkerHello(): void {
  if(typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    if((e.data as { type?: string } | null)?.type === 'sw-hello') void sendPasscodeStateToServiceWorker()
  })
}
