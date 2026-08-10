// src/core/realtime/workerScope.ts
//
// Воркерный инстанс RootScope (Stage 1C.1) — вынесен из worker.ts в модуль с явными
// зависимостями, той же формы, что globalFunnel.ts/channelFunnel.ts: worker.ts
// неимпортируем в тестах (грузит токен через IndexedDB на верхнем уровне модуля —
// «ReferenceError: indexedDB is not defined» в happy-dom/vitest), поэтому проводка
// события (создание RootScope, порт-веер, приём кадра от вкладки) живёт здесь и
// тестируется напрямую; worker.ts лишь собирает зависимости (ports) и делегирует.

import { createRootScope, type RootScope, type BroadcastEventsListeners } from '../../lib/rootScope'
import type { EventMeta } from '../../rpc/superMessagePort'

export interface WorkerScopePort { emit(event: string, payload: unknown, meta?: EventMeta): void }

export interface WorkerScopeDeps {
  /** Живой список подключённых портов — тот же массив, что мутирует push'ем bind()
   *  в worker.ts. Веер обязан читать его на каждой отправке (не копировать при
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
  scope.setPort({ emit: (event, payload, meta) => { for (const p of deps.ports) p.emit(event, payload, meta) } })

  function broadcast(event: string, payload: unknown, meta?: EventMeta): void {
    scope.dispatchEvent(event as keyof BroadcastEventsListeners, payload as never, meta as never)
  }

  // Порт tweb index.worker.ts:116-119 (invokeExceptSource). Порядок важен: локальный
  // слушатель воркера может поправить SSOT до того, как соседние вкладки увидят кадр.
  // dispatchEvent здесь НЕ звать — он ушёл бы в веер и вернулся источнику (кольцо).
  function receiveFrom(source: WorkerScopePort, event: string, payload: unknown, meta?: EventMeta): void {
    scope.dispatchEventSingle(event as keyof BroadcastEventsListeners, payload as never, meta as never)
    for (const p of deps.ports) if (p !== source) p.emit(event, payload, meta)
  }

  return { scope, broadcast, receiveFrom }
}
export type WorkerScope = ReturnType<typeof newWorkerScope>
