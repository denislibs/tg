// Ф-2 «Каналы»: правка, удаление и закреп поста broadcast-канала едут
// ЖУРНАЛОМ КАНАЛА своими конструкторами схемы (updateEditChannelMessage,
// updateDeleteChannelMessages, updatePinnedChannelMessages) с пер-канальным
// pts. Воркер обязан провести их через канальную воронку, а дальше — путём
// пер-юзерной пары (tweb разбирает обе одним обработчиком), так что витрина
// получает привычные rt:edit_message / rt:delete_message / rt:pin_message.
//
// Вступившему в канал сервер шлёт updateChannel — владелец списка заводит
// строку перечитыванием (tweb onUpdateChannel → reloadConversation).
//
// Приём — тот же, что в workerCore.dialogFrames.test.ts: перехватываем onFrame
// соединения и зовём его напрямую.
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

const fetchCalls: string[] = []

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  fetchCalls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    fetchCalls.push(u)
    if (u.includes('/peer_dialogs')) {
      return new Response(JSON.stringify({ _: 'messages.peerDialogs', dialogs: [], messages: [], chats: [], users: [] }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u)
  }))
  capturedConnDeps = null
})

afterEach(() => { vi.unstubAllGlobals() })

function boot() {
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const tab = new SuperMessagePort(epTab)
  const got: Record<string, unknown[]> = {}
  for (const rt of ['rt:edit_message', 'rt:delete_message', 'rt:pin_message']) {
    got[rt] = []
    tab.on(rt, (p) => { got[rt].push(p) })
  }
  expect(capturedConnDeps).not.toBeNull()
  return got
}

const channel = { _: 'peerChannel', channel_id: 42 }

describe('createWorkerCore(): журнал broadcast-канала', () => {
  it('удаление поста канала → путь пары (rt:delete_message с пиром канала)', () => {
    const got = boot()
    capturedConnDeps!.onFrame('delete_message', {
      _: 'updateDeleteChannelMessages', channel_id: 42, messages: [3], pts: 5, pts_count: 1,
    })
    expect(got['rt:delete_message']).toEqual([
      { _: 'updateDeletePeerMessages', peer: channel, messages: [3], pts: 5 },
    ])
    // Курсор канальный: пер-юзерный догон (/sync) этот кадр не будит.
    expect(fetchCalls.some((u) => u.includes('/sync'))).toBe(false)
  })

  it('закреп в канале → rt:pin_message с битом', () => {
    const got = boot()
    capturedConnDeps!.onFrame('pin_message', {
      _: 'updatePinnedChannelMessages', pFlags: { pinned: true }, channel_id: 42, messages: [3], pts: 5, pts_count: 1,
    })
    expect(got['rt:pin_message']).toEqual([
      { _: 'updatePinnedMessages', pFlags: { pinned: true }, peer: channel, messages: [3], pts: 5 },
    ])
  })

  it('правка поста канала → rt:edit_message конструктором пары', () => {
    const got = boot()
    capturedConnDeps!.onFrame('edit_message', {
      _: 'updateEditChannelMessage', pts: 5, pts_count: 1,
      message: { _: 'message', id: 3, date: 1787334148, edit_date: 1787334200, message: 'правка', peer_id: channel, pFlags: { post: true } },
    })
    expect(got['rt:edit_message']).toHaveLength(1)
    expect((got['rt:edit_message'][0] as { _: string })._).toBe('updateEditMessage')
  })

  it('updateChannel: строки канала нет — перечитать у сервера', async () => {
    boot()
    capturedConnDeps!.onFrame('channel', { _: 'updateChannel', channel_id: 42 })
    await vi.waitFor(() => expect(fetchCalls.some((u) => u.includes('/peer_dialogs') && u.includes('peers=-42'))).toBe(true))
  })
})

// Ревью #407: кадр channel_state (после подписки на топики) заводит курсоры
// каналов — следующий кадр с дырой придерживается до догона, а не принимается
// базой «с середины».
describe('createWorkerCore(): channel_state', () => {
  it('курсор канала из channel_state: кадр через дыру не применяется сразу', () => {
    const got = boot()
    capturedConnDeps!.onFrame('channel_state', { channels: [[-42, 5]] })
    capturedConnDeps!.onFrame('delete_message', {
      _: 'updateDeleteChannelMessages', channel_id: 42, messages: [3], pts: 7, pts_count: 1,
    })
    expect(got['rt:delete_message']).toEqual([])
    capturedConnDeps!.onFrame('delete_message', {
      _: 'updateDeleteChannelMessages', channel_id: 42, messages: [2], pts: 6, pts_count: 1,
    })
    expect(got['rt:delete_message']).toHaveLength(2)
  })
})
