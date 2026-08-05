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

// installBridgeHandoff — при DNP-ON ждёт готовности SW-контроллера и делает handoff;
// пере-handoff при смене контроллера (обновление SW → новый порт к SW). На первом
// визите контроллер появляется после clients.claim → ловим controllerchange.
export function installBridgeHandoff(ep: Poster): void {
  if (!AppConfig.dnp.enabled || !('serviceWorker' in navigator)) return
  const trySend = () => {
    const c = navigator.serviceWorker.controller
    if (c) handoffBridgePort(c, ep)
  }
  void navigator.serviceWorker.ready.then(() => {
    trySend()
    navigator.serviceWorker.addEventListener('controllerchange', trySend)
  })
}
