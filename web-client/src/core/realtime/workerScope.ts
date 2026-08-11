// src/core/realtime/workerScope.ts
//
// Воркерный инстанс RootScope (Stage 1C.1) — вынесен из bind() (сейчас — workerCore.ts,
// исторически — тело worker.ts) в модуль с явными зависимостями, той же формы, что
// globalFunnel.ts/channelFunnel.ts: тестируется здесь напрямую фейковыми портами, без
// конструирования всего createWorkerCore() (а значит и без синхронных обращений к
// IndexedDB в newCursor()/newConnectionManager(), которые в реальности и требовали
// полифилла — не токен, как ошибочно утверждала прежняя версия этого комментария).
// workerCore.ts::bind() лишь собирает зависимости (ports) и делегирует сюда.

import { createRootScope, type RootScope, type BroadcastEventsListeners } from '../../lib/rootScope'
import type { EventMeta } from '../../rpc/superMessagePort'

export interface WorkerScopePort { emit(event: string, payload: unknown, meta?: EventMeta): void }

export interface WorkerScopeDeps {
  /** Живой список подключённых портов — тот же массив, что мутирует push'ем bind()
   *  в workerCore.ts. Веер обязан читать его на каждой отправке (не копировать при
   *  создании фабрики): подключение новой вкладки после старта воркера — обычный
   *  случай, а Задача 2 начнёт ещё и удалять из него отключившиеся вкладки. */
  ports: readonly WorkerScopePort[]
}

export function newWorkerScope(deps: WorkerScopeDeps): {
  scope: RootScope
  /** Событие, порождённое ВОРКЕРОМ (funnel/менеджеры): локальным подписчикам воркера
   *  + веером во все вкладки. Тонкая обёртка над scope.dispatchEvent — тот сам зовёт
   *  и super.dispatchEvent (локально), и port.emit (см. RootScope.constructor). */
  broadcast(event: string, payload: unknown, meta?: EventMeta): void
  /** Кадр, пришедший ОТ вкладки: локально (без обратной отправки в порт, иначе
   *  кольцо) + всем остальным вкладкам, кроме источника. */
  receiveFrom(source: WorkerScopePort, event: string, payload: unknown, meta?: EventMeta): void
} {
  const scope = createRootScope()
  // Порт-веер: рассылает во ВСЕ подключённые вкладки. Читаем deps.ports на каждый
  // emit, а не захватываем копию в замыкание при создании — массив живой (bind()
  // пушит в него по мере подключения вкладок уже ПОСЛЕ вызова newWorkerScope).
  //
  // .slice() — снимок массива ПЕРЕД обходом, порт tweb superMessagePort.ts:687-693
  // (invokeExceptSource: `const ports = this.sendPorts.slice()`, потом уже из
  // копии индексОфAndSplice источник). Мотив тот же: мутация ports[] ВО ВРЕМЯ
  // обхода (disconnectPort splice'ит элемент, пока цикл ещё бежит) пропустила бы
  // соседний элемент — splice сдвигает индексы под ногами forEach/for-of. До
  // Задачи 2 (worker-rootscope) массив вообще не сокращался — обоснованный
  // повод отступить от tweb не было; теперь сокращается (indexOfAndSplice в
  // setOnPortDisconnect), риск стал реальным. Сегодня недостижимо: p.emit()
  // это postMessage — синхронный вызов без реентрантности, disconnectPort() не
  // может сработать МЕЖДУ итерациями этого цикла (только в отдельном тике, уже
  // после его завершения) — но снимок стоит дёшево и убирает саму категорию
  // бага, а не полагается на то, что сегодняшняя асинхронность останется такой.
  scope.setPort({ emit: (event, payload, meta) => { for (const p of deps.ports.slice()) p.emit(event, payload, meta) } })

  function broadcast(event: string, payload: unknown, meta?: EventMeta): void {
    scope.dispatchEvent(event as keyof BroadcastEventsListeners, payload as never, meta as never)
  }

  // Порт tweb index.worker.ts:116-119 (invokeExceptSource). Порядок важен: локальный
  // слушатель воркера может поправить SSOT до того, как соседние вкладки увидят кадр.
  // dispatchEvent здесь НЕ звать — он ушёл бы в веер и вернулся источнику (кольцо).
  // .slice() — тот же снимок-перед-обходом, что и в веере broadcast выше (см.
  // комментарий там же, tweb superMessagePort.ts:687-693).
  function receiveFrom(source: WorkerScopePort, event: string, payload: unknown, meta?: EventMeta): void {
    scope.dispatchEventSingle(event as keyof BroadcastEventsListeners, payload as never, meta as never)
    for (const p of deps.ports.slice()) if (p !== source) p.emit(event, payload, meta)
  }

  return { scope, broadcast, receiveFrom }
}
export type WorkerScope = ReturnType<typeof newWorkerScope>
