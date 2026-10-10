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
// Состояние канала заводит история канала (messages.channelMessages{pts},
// tweb appMessagesManager.ts:13503-13505); пропущенное добирается
// updates.getChannelDifference — по маркеру updateChannelTooLong из
// getDifference, по дыре в pts живого кадра и опросом открытого канала, где
// пользователь не участник.
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

const fetchCalls: string[] = []
/** Ответы сети по пути — кейс кладёт свои до действия. */
let routes: Record<string, unknown[]> = {}

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 })

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  fetchCalls.length = 0
  routes = {}
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    fetchCalls.push(u)
    for (const [path, queue] of Object.entries(routes)) {
      if (u.includes(path) && queue.length) return json(queue.shift())
    }
    if (u.includes('/peer_dialogs')) return json({ _: 'messages.peerDialogs', dialogs: [], messages: [], chats: [], users: [] })
    if (u.includes('/updates/channel_difference')) {
      const pts = Number(new URL(u, 'http://x').searchParams.get('pts'))
      return json({ _: 'updates.channelDifferenceEmpty', pFlags: { final: true }, pts })
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
  // start(): гидрация личности снимает гейт истории (meReady), курсор — из IDB.
  // `self` с onconnect — ветка SharedWorker: иначе start() привязал бы вторым
  // портом сам `self` happy-dom, и тот эхом ретранслировал бы веер.
  vi.stubGlobal('self', { onconnect: null, addEventListener: () => {} })
  core.start()
  const tab = new SuperMessagePort(epTab)
  const got: Record<string, unknown[]> = {}
  for (const rt of ['rt:edit_message', 'rt:delete_message', 'rt:pin_message', 'rt:new_message']) {
    got[rt] = []
    tab.on(rt, (p) => { got[rt].push(p) })
  }
  expect(capturedConnDeps).not.toBeNull()
  return { got, tab }
}

/** Открыть канал: история — messages.channelMessages{pts} заводит его состояние. */
async function openChannel(tab: SuperMessagePort, pts: number) {
  routes['/chats/-42/history'] = [{ _: 'messages.channelMessages', pts, count: 0, messages: [], topics: [], chats: [], users: [] }]
  await tab.invoke('manager', { name: 'messages', method: 'getHistory', args: [{ peerId: -42 }] })
}

const post = (id: number) => ({ _: 'message', id, date: 1787334148, message: 'пост ' + id, peer_id: { _: 'peerChannel', channel_id: 42 }, pFlags: { post: true } })
const newPosts = (got: Record<string, unknown[]>) =>
  (got['rt:new_message'] as Array<{ message: { id: number } }>).map((e) => e.message.id)

const channel = { _: 'peerChannel', channel_id: 42 }

describe('createWorkerCore(): журнал broadcast-канала', () => {
  it('удаление поста канала → путь пары (rt:delete_message с пиром канала)', async () => {
    const { got, tab } = boot()
    await openChannel(tab, 4)
    capturedConnDeps!.onFrame('delete_message', {
      _: 'updateDeleteChannelMessages', channel_id: 42, messages: [3], pts: 5, pts_count: 1,
    })
    expect(got['rt:delete_message']).toEqual([
      { _: 'updateDeletePeerMessages', peer: channel, messages: [3], pts: 5 },
    ])
    // Курсор канальный: пер-юзерный догон (getDifference) этот кадр не будит.
    expect(fetchCalls.some((u) => u.includes('/updates/difference'))).toBe(false)
  })

  it('закреп в канале → rt:pin_message с битом', async () => {
    const { got, tab } = boot()
    await openChannel(tab, 4)
    capturedConnDeps!.onFrame('pin_message', {
      _: 'updatePinnedChannelMessages', pFlags: { pinned: true }, channel_id: 42, messages: [3], pts: 5, pts_count: 1,
    })
    expect(got['rt:pin_message']).toEqual([
      { _: 'updatePinnedMessages', pFlags: { pinned: true }, peer: channel, messages: [3], pts: 5 },
    ])
  })

  it('правка поста канала → rt:edit_message конструктором пары', async () => {
    const { got, tab } = boot()
    await openChannel(tab, 4)
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

describe('createWorkerCore(): состояние канала и его разница', () => {
  // tweb getChannelState(channelId, pts) → «duplicate update»: кадр канала без
  // состояния заводит его и сам не применяется.
  it('живой кадр канала без состояния не применяется', () => {
    const { got } = boot()
    capturedConnDeps!.onFrame('delete_message', {
      _: 'updateDeleteChannelMessages', channel_id: 42, messages: [3], pts: 5, pts_count: 1,
    })
    expect(got['rt:delete_message']).toEqual([])
  })

  // Офлайн → в канале посты → реконнект: getDifference отдаёт
  // updateChannelTooLong, канал догоняется getChannelDifference без перезагрузки.
  it('офлайн: updateChannelTooLong из getDifference → посты канала догоняются', async () => {
    await idbSet('pts', 10)
    await idbSet('date', 1787334000)
    const { got, tab } = boot()
    await openChannel(tab, 4)
    routes['/updates/difference'] = [{
      _: 'updates.difference', new_messages: [], new_encrypted_messages: [],
      other_updates: [{ _: 'updateChannelTooLong', channel_id: 42, pts: 6 }],
      chats: [], users: [], state: { _: 'updates.state', pts: 10, qts: 0, date: 1787334100, seq: 0, unread_count: 0 },
    }]
    routes['/updates/channel_difference'] = [{
      _: 'updates.channelDifference', pFlags: { final: true }, pts: 6,
      new_messages: [post(5), post(6)], other_updates: [], chats: [], users: [],
    }]
    capturedConnDeps!.onReady()
    await vi.waitFor(() => expect(newPosts(got)).toEqual([5, 6]))
    expect(fetchCalls.find((u) => u.includes('/updates/difference'))).toContain('pts=10')
    expect(fetchCalls.find((u) => u.includes('/updates/channel_difference'))).toMatch(/channel=-42.*pts=4|pts=4.*channel=-42/)
  })

  // Дыра в pts живого кадра канала, не закрытая следующими кадрами, —
  // getChannelDifference от состояния (tweb processUpdate :682-704).
  it('дыра в pts живого кадра канала → getChannelDifference', async () => {
    const { got, tab } = boot()
    await openChannel(tab, 4)
    routes['/updates/channel_difference'] = [{
      _: 'updates.channelDifference', pFlags: { final: true }, pts: 6,
      new_messages: [post(5), post(6)], other_updates: [], chats: [], users: [],
    }]
    capturedConnDeps!.onFrame('new_message', { _: 'updateNewChannelMessage', message: post(6), pts: 6, pts_count: 1 })
    expect(newPosts(got)).toEqual([])
    await vi.waitFor(() => expect(newPosts(got)).toEqual([5, 6]))
    expect(fetchCalls.find((u) => u.includes('/updates/channel_difference'))).toContain('pts=4')
  })

  // Открыт чужой публичный канал: живых кадров ему нет — лента опрашивает
  // разницу (tweb subscribeToChannelUpdates), пока окно открыто.
  it('открытый канал не участника получает посты опросом разницы', async () => {
    const { got, tab } = boot()
    await openChannel(tab, 4)
    routes['/updates/channel_difference'] = [{
      _: 'updates.channelDifference', pFlags: { final: true }, pts: 5,
      new_messages: [post(5)], other_updates: [], chats: [], users: [],
    }]
    await tab.invoke('manager', { name: 'realtime', method: 'subscribeToChannelUpdates', args: [{ peerId: -42 }] })
    await vi.waitFor(() => expect(newPosts(got)).toEqual([5]))
    await tab.invoke('manager', { name: 'realtime', method: 'unsubscribeFromChannelUpdates', args: [{ peerId: -42 }] })
  })
})
