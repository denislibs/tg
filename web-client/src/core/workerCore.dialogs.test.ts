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
import { saveDialogs, saveStateKey } from './store/persist'
import { STATE_VERSION } from './state/state'
import type { Dialog } from './models'
import { makeDialog, makeLastMessage } from './dialogs/testDialog'

const dialog = (peerId: number, at: string, pinned = false): Dialog => makeDialog({ peerId, pinned, lastMessage: makeLastMessage({ peerId, seq: 1, senderId: 1, text: 'x', createdAt: at }) })

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

  // Ревью (Important #2): строки `loadCache: () => loadDialogs()` и `loadState: async
  // () => {...loadStateAll()...}` (workerCore.ts) не были покрыты — предыдущий тест
  // видел пустой fake-indexeddb, поэтому подмена обеих на заглушки-пустышки
  // (`() => Promise.resolve([])`, `async () => ({pinnedOrders:{}, drafts:[]})`)
  // проходила зелёной: содержимое кадра нигде не сверялось с ПЕРСИСТОМ. Сеем
  // РЕАЛЬНЫЙ офлайн-кэш (saveDialogs) и pinnedOrders (saveStateKey) — тем же
  // приёмом, что peersManager.persist.test.ts проверяет офлайн-фолбэк, — и
  // проверяем, что fillMirror принёс ИМЕННО посеянные диалоги в правильном
  // порядке (закреплённый peerId=3 выше остальных несмотря на самую старую дату).
  it('fillMirror приносит диалоги/pinnedOrders РЕАЛЬНО из персиста (не заглушку)', async () => {
    // Один незакреплённый (peerId=1) — ловит подмену loadCache на пустышку: без
    // персистнутого диалога он не появится в items вовсе. Три закреплённых с
    // РАЗЛИЧНЫМИ датами (4/5/6) в pinnedOrders=[6,5,4] — ловит ИМЕННО подмену
    // loadState: у закреплённых index зависит только от позиции в pinnedOrders
    // (dialogIndex.ts:pinnedDate), а не от даты. Если pinnedOrders потерялись
    // (мутация `loadState: async () => ({pinnedOrders:{}, drafts:[]})`), у всех
    // трёх chatIndex ИДЕНТИЧЕН (order.indexOf возвращает -1 для каждого) — стабильная
    // сортировка развалит их к порядку из IDB (по возрастанию peerId: 4,5,6),
    // что отличимо от ожидаемого [6,5,4].
    await saveDialogs([
      dialog(1, '2026-08-01T00:00:00Z'),
      dialog(4, '2019-01-01T00:00:00Z', true),
      dialog(5, '2019-06-01T00:00:00Z', true),
      dialog(6, '2019-12-01T00:00:00Z', true),
    ])
    await saveStateKey('pinnedOrders', { 0: [6, 5, 4] })
    // Версия схемы на диске обязательна (Fix финального ревью, Minor #2):
    // владелец читает State через тот же версионный гейт, что и main
    // (loadStateOnce → дефолты при несовпадении STATE_VERSION), а в проде main
    // этот ключ всегда пишет — `boot.ts`, `stateWasResetToDefaults()`. Без него
    // стенд моделировал бы State чужой схемы, где игнорировать pinnedOrders —
    // правильное поведение (см. workerCore.dialogsState.test.ts).
    await saveStateKey('version', STATE_VERSION)

    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)
    const frames: Array<{ event: string; payload: unknown }> = []
    tab.onAny((event, payload) => frames.push({ event, payload }))

    await tab.invoke('manager', { name: 'dialogs', method: 'fillMirror', args: [] })

    const dialogOp = frames.find((f) => f.event === 'rt:dialog_op')
    expect(dialogOp).toBeDefined()
    const items = (dialogOp!.payload as { ops: { op: string; items: { dialog: Dialog }[] }[] }).ops[0]!.items
    expect(items.map((i) => i.dialog.peerId)).toEqual([6, 5, 4, 1])
  })
})
