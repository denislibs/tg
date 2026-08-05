import { AppConfig } from '../config/app'

// Минимальная форма поста с transferables (MessagePort/Worker/ServiceWorker).
type Poster = { postMessage(message: unknown, transfer?: Transferable[]): void }

// handoffBridgePort — минтит MessageChannel и раздаёт концы: port1 → SW (controller),
// port2 → SharedWorker (ep). После этого окно вне пути данных; канал живёт в SW/
// SharedWorker и переживает закрытие вкладки-брокера (§ PR-2a).
//
// ВАЖНО: у приёмников РАЗНЫЕ ключи control-кадра — sw.js (message-хэндлер) читает
// event.data.type, а worker.ts (bind, сырой слушатель) читает ev.data.t. Поэтому
// SW и SharedWorker получают структурно разные сообщения (проверено по исходникам).
export function handoffBridgePort(controller: Poster, ep: Poster): void {
  const ch = new MessageChannel()
  controller.postMessage({ type: 'dnp-bridge-port' }, [ch.port1])
  ep.postMessage({ t: 'dnp-bridge-port' }, [ch.port2])
}

// installBridgeHandoff — connect-based (эталон tweb serviceWorker/index.service.ts):
// окно пингует SW, SW просит порт ТОЛЬКО если его нет; SW сам инициирует то же на своём
// старте (clients.matchAll) → рестарт SW самозалечивается без reload. Окно тут — курьер:
// пингует + по запросу SW делает handoffBridgePort.
export function installBridgeHandoff(ep: Poster): void {
  if (!AppConfig.dnp.enabled || !('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker
  const ping = () => {
    sw.controller?.postMessage({ type: 'dnp-ping' })
  }
  sw.addEventListener('message', (ev: MessageEvent) => {
    const d = ev.data as { type?: string } | null
    if (d && d.type === 'dnp-request-port' && sw.controller) handoffBridgePort(sw.controller, ep)
  })
  void sw.ready.then(() => {
    ping()
    sw.addEventListener('controllerchange', ping)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') ping()
      })
    }
  })
}
