// Ф7-Ж: проводка сверки `state.pts` ответа `messages.getPeerDialogs` в
// `createWorkerCore()` (tweb reloadConversation, appMessagesManager.ts:6313-6319).
// Логика цикла проверена в dialogsManager.test.ts на фейковых зависимостях; здесь —
// что воркер передаёт владельцу диалогов НАСТОЯЩИЕ курсор апдейтов, состояние
// сокета и признак догонки, а не заглушки.
//
// Приём — как в workerCore.connectionStatus.test.ts: оборачиваем реальные
// фабрики, перехватывая deps/инстансы, которые получает workerCore.ts.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { DialogsDeps } from './managers/dialogsManager'
import type { ConnectionManager } from './realtime/connectionManager'
import type { SyncDeps, SyncEngine } from './realtime/syncEngine'

let capturedDialogsDeps: DialogsDeps | null = null
let capturedSyncDeps: SyncDeps | null = null
let capturedSync: SyncEngine | null = null
let capturedConn: ConnectionManager | null = null

vi.mock('./managers/dialogsManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/dialogsManager')>()
  return {
    ...actual,
    newDialogsManager: (deps: DialogsDeps) => {
      capturedDialogsDeps = deps
      return actual.newDialogsManager(deps)
    },
  }
})

vi.mock('./realtime/syncEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/syncEngine')>()
  return {
    ...actual,
    newSyncEngine: (deps: SyncDeps) => {
      capturedSyncDeps = deps
      capturedSync = actual.newSyncEngine(deps)
      return capturedSync
    },
  }
})

vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: Parameters<typeof actual.newConnectionManager>[0]) => {
      capturedConn = actual.newConnectionManager(deps)
      return capturedConn
    },
  }
})

import { createWorkerCore } from './workerCore'

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedDialogsDeps = null
  capturedSyncDeps = null
  capturedSync = null
  capturedConn = null
})

describe('createWorkerCore() — проводка сверки pts для messages.getPeerDialogs (Ф7-Ж)', () => {
  it('getUpdatesPts читает pts НАСТОЯЩЕГО курсора апдейтов', () => {
    createWorkerCore()
    expect(capturedDialogsDeps?.getUpdatesPts).toBeTypeOf('function')
    expect(capturedDialogsDeps!.getUpdatesPts!()).toBe(0)
    capturedSyncDeps!.cursor.set(12, 100)
    expect(capturedDialogsDeps!.getUpdatesPts!()).toBe(12)
  })

  it('isLiveSynced = сокет в состоянии ready И догонка не идёт', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('нет сети в тесте'))))
    createWorkerCore()
    expect(capturedDialogsDeps?.isLiveSynced).toBeTypeOf('function')
    const live = capturedDialogsDeps!.isLiveSynced!
    const setState = (s: string) => { (capturedConn as unknown as { state: () => string }).state = () => s }

    setState('offline')
    expect(live()).toBe(false)
    setState('reconnecting')
    expect(live()).toBe(false)

    setState('ready')
    expect(live()).toBe(true)

    // Догонка идёт: isSyncing() выставляется синхронно, до ответа сети.
    const p = capturedSync!.getDifference().catch(() => {})
    expect(capturedSync!.isSyncing()).toBe(true)
    expect(live()).toBe(false)
    await p
    expect(live()).toBe(true)
  })
})
