// Ф7-З: порядок папок едет апдейтом `updateDialogFilterOrder{order}` (tweb
// `filters.ts:179-199`, событие `filter_order`). Живой кадр и строка журнала из
// getDifference идут ОДНИМ общим путём конструкторов (`UPDATE_RT` → broadcast) и
// доходят до вкладки событием `rt:dialog_filter_order` — а не исключением
// `folder_update` (`LOGGED_WITHOUT_CONSTRUCTOR`). Курсор — в конверте: у
// конструктора нет параметра pts, и воронка гейтит по нему.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => { capturedConnDeps = deps; return actual.newConnectionManager(deps) },
  }
})

import { createWorkerCore } from './workerCore'
import { idbSet } from './store/idbKv'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'

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

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 })

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
})

afterEach(() => { vi.unstubAllGlobals() })

function boot() {
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  vi.stubGlobal('self', { onconnect: null, addEventListener: () => {} })
  core.start()
  const tab = new SuperMessagePort(epTab)
  const got: unknown[] = []
  const folderUpdates: unknown[] = []
  tab.on('rt:dialog_filter_order', (p) => got.push(p))
  tab.on('rt:folder_update', (p) => folderUpdates.push(p))
  return { got, folderUpdates }
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('createWorkerCore(): порядок папок (updateDialogFilterOrder)', () => {
  it('живой кадр → rt:dialog_filter_order, исключение folder_update не задето', async () => {
    await idbSet('pts', 4)
    await idbSet('date', 1787334000)
    const { got, folderUpdates } = boot()
    await settle()
    const frame = { _: 'updateDialogFilterOrder', order: [3, 0, 1] }

    capturedConnDeps!.onFrame('updateDialogFilterOrder', frame, 5)
    await settle()

    expect(got).toEqual([frame])
    expect(folderUpdates).toEqual([])
  })

  it('строка журнала из getDifference доходит тем же событием', async () => {
    await idbSet('pts', 1)
    await idbSet('date', 1787334000)
    const row = { _: 'updateDialogFilterOrder', order: [2, 1] }
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('/updates/difference')) {
        return json({
          _: 'updates.difference', new_messages: [], new_encrypted_messages: [], other_updates: [row],
          chats: [], users: [], state: { _: 'updates.state', pts: 2, qts: 0, date: 1787334100, seq: 0, unread_count: 0 },
        })
      }
      throw new Error('unexpected fetch ' + u)
    }))
    const { got } = boot()

    capturedConnDeps!.onReady()
    await vi.waitFor(() => expect(got).toEqual([row]))
  })
})
