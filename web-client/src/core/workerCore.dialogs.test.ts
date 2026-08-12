// Task 1 (перенос владения списком диалогов в воркер): проверяет, что
// createWorkerCore() реально ПРОВОДИТ dialogsManager в реестр и его операции —
// в broadcast(RT.dialogOp), а не только что сам менеджер умеет считать порядок
// (это отдельно покрыто dialogsManager.test.ts). По образцу
// workerCore.connectionStatus.test.ts/workerCore.test.ts (карточки пиров, ниже
// строка 420): поднимаем НАСТОЯЩИЙ createWorkerCore() через фейковые эндпоинты и
// смотрим, что до подключённой вкладки реально доезжает кадр rt:dialog_op.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'

// vi.stubGlobal (не прямое присваивание indexedDB=...) — та же замена, что и в
// workerCore.test.ts, но без нового eslint(no-global-assign)-финда: линт-ворота
// запрещают НОВЫЕ находки (см. CLAUDE.md «Тесты»), а не просто «не хуже нуля».
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })

// Тот же приём, что и в workerCore.test.ts/workerCore.connectionStatus.test.ts —
// синхронная пара эндпоинтов.
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

describe('createWorkerCore(): диалоги — воркер публикует rt:dialog_op (Task 1)', () => {
  it('fillMirror доезжает до вкладки кадром rt:dialog_op', async () => {
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)
    const frames: Array<{ event: string; payload: unknown }> = []
    tab.onAny((event, payload) => frames.push({ event, payload }))

    await tab.invoke('manager', { name: 'dialogs', method: 'fillMirror', args: [] })

    expect(frames.map((f) => f.event)).toContain('rt:dialog_op')
  })

  // Строка проводки `(key, value) => dialogs.setStateKey(key, value)` (workerCore.ts,
  // третий канал persistManager) — норма CLAUDE.md «Тесты» требует теста на КАЖДУЮ
  // такую строку, а не только на факт, что dialogsManager сам умеет считать reindex
  // (это покрыто dialogsManager.test.ts). Зовём persist.stateKey РЕАЛЬНЫМ RPC —
  // ровно так, как это делает write-through из stores/appState, — и проверяем, что
  // dialogsManager узнал об этом и опубликовал rt:dialog_op{op:'reindex'}.
  it('persist.stateKey("pinnedOrders", …) доезжает до dialogsManager.setStateKey → rt:dialog_op reindex', async () => {
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)
    const frames: Array<{ event: string; payload: unknown }> = []
    tab.onAny((event, payload) => frames.push({ event, payload }))

    await tab.invoke('manager', { name: 'persist', method: 'stateKey', args: ['pinnedOrders', { 0: [7] }] })

    const dialogOps = frames.filter((f) => f.event === 'rt:dialog_op')
    expect(dialogOps).toHaveLength(1)
    expect((dialogOps[0]!.payload as { ops: unknown[] }).ops[0]).toMatchObject({ op: 'reindex' })
  })
})
