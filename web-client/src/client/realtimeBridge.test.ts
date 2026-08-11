// src/client/realtimeBridge.test.ts
//
// Норма построчная (web-client/CLAUDE.md, «Тесты»): этот модуль — весь целиком
// проводка, а не логика (обработчиков не содержит). Из двух строк, которые он
// реально исполняет, ни одна раньше не была покрыта — удаление любой красило 0
// тестов, а приложение при этом полностью теряло realtime:
//
//   for (const ev of WORKER_EVENTS) {
//     smp.on(ev, (p, m) => { rootScope.dispatchEventSingle(ev, p, m) })  // :30 — насос
//   }
//   rootScope.setPort(smp)                                              // :35 — обратный путь
//
// Регистрация подписчиков (registerStoreProjection и т.д.) сюда не входит —
// каждая покрыта своим файлом (storeProjection.test.ts, soundSubscriber.test.ts, …).
//
// startClient()/startRealtime() держат модульные синглтоны (bootstrap.ts's `cached`,
// этот файл's `started`) — vi.resetModules() + динамический импорт в КАЖДОМ тесте
// дают свежий smp/rootScope на кейс, не завися от порядка запуска.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Endpoint } from '../rpc/superMessagePort'
import type { NewMessageEvt } from '../core/realtime/events'

// Тот же приём, что в bootstrap.lock.test.ts: happy-dom не знает ни Worker, ни
// SharedWorker — startClient() падает в ветку `new Worker(...)`, которую нужно
// застабить, чтобы дойти до реальной проводки. Здесь дополнительно нужен доступ
// к слушателю 'message', который конструктор SuperMessagePort вешает на эндпоинт
// (superMessagePort.ts:75), — через него симулируется входящий от воркера кадр
// {kind:'event', …}, не трогая внутренности SuperMessagePort напрямую.
// Единственный инстанс на setup() (startClient() создаёт ровно один Worker) —
// достаточно module-level переменной под слушателем, без отслеживания самого
// инстанса.
let lastListener: ((ev: MessageEvent) => void) | undefined
class FakeWorker implements Endpoint {
  postMessage(): void {}
  addEventListener(_type: 'message', cb: (ev: MessageEvent) => void): void { lastListener = cb }
}

async function setup() {
  vi.resetModules()
  lastListener = undefined
  vi.stubGlobal('Worker', FakeWorker)
  const { default: rootScope } = await import('@lib/rootScope')
  const { RT } = await import('../core/realtime/events')
  const { startRealtime } = await import('./realtimeBridge')
  const { startClient } = await import('./bootstrap')
  // Симулирует входящее сообщение от воркера — тем же путём, каким его
  // доставил бы настоящий Worker.postMessage на стороне вкладки.
  const deliver = (data: unknown) => lastListener?.({ data } as MessageEvent)
  return { deliver, rootScope, RT, startRealtime, startClient }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Минимальная заглушка полезной нагрузки — типизированный payload насосу не
// важен, он его не разбирает, только перекладывает (см. notificationSubscriber.test.ts
// для того же приёма).
const evt = (chat_id: number, seq: number) => ({ chat_id, seq } as unknown as NewMessageEvt)

describe('realtimeBridge.startRealtime — насос smp → rootScope', () => {
  // Удаление строки 30 (`smp.on(ev, …)`) не красит тесты подписчиков (они бьют
  // по rootScope.dispatchEventSingle напрямую, минуя насос) — только этот тест
  // симулирует реальный входящий кадр воркера и проверяет, что он вообще
  // доходит до rootScope.
  it('входящий кадр воркера {kind:"event"} доезжает до rootScope-слушателя через dispatchEventSingle', async () => {
    const { deliver, rootScope, RT, startRealtime, startClient } = await setup()
    startRealtime()
    const { smp } = startClient()
    // dispatchEventSingle НЕ шлёт обратно в порт (в отличие от dispatchEvent) —
    // если бы насос по ошибке звал dispatchEvent, это вызвало бы smp.emit и
    // закольцевало событие обратно в воркер (rootScope.ts:117-121). Проверяем
    // отсутствие этого вызова, а не только сам факт доставки, — иначе мутация
    // dispatchEventSingle → dispatchEvent прошла бы тест незамеченной.
    const emitSpy = vi.spyOn(smp, 'emit')
    const received: unknown[] = []
    rootScope.addEventListener(RT.newMessage, (p) => received.push(p))

    deliver({ kind: 'event', event: RT.newMessage, payload: evt(1, 1) })

    expect(received).toEqual([evt(1, 1)])
    expect(emitSpy).not.toHaveBeenCalled()
  })

  // Удаление строки 35 (`rootScope.setPort(smp)`) не красит тесты подписчиков —
  // они читают из rootScope, не пишут в него. Только исходящий путь (эта
  // вкладка порождает событие через rootScope.dispatchEvent) замечает пропажу:
  // без setPort порт остаётся null и локальное событие никуда, кроме локальных
  // слушателей, не уходит.
  it('rootScope.setPort(smp) реально вызывается — событие этой вкладки (dispatchEvent) уходит в порт', async () => {
    const { rootScope, RT, startRealtime, startClient } = await setup()
    startRealtime()
    const { smp } = startClient()
    const emitSpy = vi.spyOn(smp, 'emit')

    rootScope.dispatchEvent(RT.newMessage, evt(2, 2))

    expect(emitSpy).toHaveBeenCalledWith(RT.newMessage, evt(2, 2), undefined)
  })
})
