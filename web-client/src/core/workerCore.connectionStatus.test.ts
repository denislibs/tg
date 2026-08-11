// Задача 1 (порт ConnectionStatusComponent из tweb, план
// docs/superpowers/plans/2026-08-11-connection-status-port.md): проверяет, что
// createWorkerCore() реально ПРОВОДИТ retryAt и события синхронизации в
// broadcast — не только что connectionManager/syncEngine умеют их считать
// (это отдельно покрыто connectionManager.test.ts/syncEngine.test.ts), а что
// workerCore.ts подключает эти колбэки к RT.state/RT.stateSynchronizing/
// RT.stateSynchronized и они реально доезжают до подключённой вкладки.
//
// Файл — НЕ правка workerCore.test.ts (норма CLAUDE.md «Тесты»: существующие
// тесты без правок), а отдельный набор. vi.mock здесь module-scoped на весь
// файл, поэтому держим его изолированно от workerCore.test.ts, чтобы не менять
// поведение уже существующих кейсов в том файле.
//
// Приём: мокаем newConnectionManager/newSyncEngine ЧАСТИЧНО — оборачиваем
// реальную реализацию (importOriginal), просто перехватывая переданные им deps
// (CMDeps/SyncDeps). Сам объект-менеджер, который получает workerCore.ts,
// остаётся настоящим (реальные ws/rest внутри не трогаем и не вызываем) — мы
// зовём захваченный deps.onState/onSyncStart/onSyncEnd НАПРЯМУЮ, как их
// вызвал бы настоящий connectionManager/syncEngine, и смотрим, что долетает
// до вкладки. Так тестируется именно строка проводки в workerCore.ts, а не
// повторяется логика connectionManager/syncEngine.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'
import type { SyncDeps } from './realtime/syncEngine'

let capturedConnDeps: CMDeps | null = null
let capturedSyncDeps: SyncDeps | null = null

vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => {
      capturedConnDeps = deps
      return actual.newConnectionManager(deps)
    },
  }
})

vi.mock('./realtime/syncEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/syncEngine')>()
  return {
    ...actual,
    newSyncEngine: (deps: SyncDeps) => {
      capturedSyncDeps = deps
      return actual.newSyncEngine(deps)
    },
  }
})

import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'

// Тот же приём, что и в workerCore.test.ts — синхронная пара эндпоинтов.
function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

beforeEach(() => {
  // vi.stubGlobal (не прямое присваивание indexedDB=...) — та же замена, что и в
  // workerCore.test.ts, но без нового eslint(no-global-assign)-финда: линт-ворота
  // запрещают НОВЫЕ находки (см. CLAUDE.md), а не просто «не хуже нуля».
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
  capturedSyncDeps = null
})

describe('createWorkerCore() — проводка retryAt и событий синхронизации в RT.state/RT.stateSynchronizing/RT.stateSynchronized', () => {
  it('onState(s, retryAt) из connectionManager долетает до вкладки в payload RT.state', () => {
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)
    const got: Array<{ state: string; retryAt?: number }> = []
    tab.on('rt:state', (p) => got.push(p as { state: string; retryAt?: number }))

    expect(capturedConnDeps).not.toBeNull()
    // Переход без backoff'а (как ws.onOpen → setState('ready')) — один аргумент.
    capturedConnDeps!.onState('ready')
    // Реконнект с посчитанным retryAt (как scheduleReconnect) — два аргумента.
    capturedConnDeps!.onState('reconnecting', 1_700_000_000_000)

    expect(got).toEqual([
      { state: 'ready', retryAt: undefined },
      { state: 'reconnecting', retryAt: 1_700_000_000_000 },
    ])
  })

  it('onSyncStart/onSyncEnd из syncEngine долетают до вкладки как RT.stateSynchronizing/RT.stateSynchronized', () => {
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)
    const startEvents: unknown[] = []
    const endEvents: unknown[] = []
    tab.on('rt:state_synchronizing', (p) => startEvents.push(p))
    tab.on('rt:state_synchronized', (p) => endEvents.push(p))

    expect(capturedSyncDeps).not.toBeNull()
    capturedSyncDeps!.onSyncStart?.()
    expect(startEvents).toEqual([null])
    expect(endEvents).toEqual([])

    capturedSyncDeps!.onSyncEnd?.()
    expect(endEvents).toEqual([null])
  })
})
