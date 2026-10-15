// Пин ПРОВОДКИ в workerCore.ts для Ф-6 f6-ttl (срок автоудаления чата).
//
//  • `updatePeerHistoryTTL` (строка журнала `peer_history_ttl`) — tweb
//    `onUpdatePeerHistoryTTL` (appProfileManager.ts:1541-1558): `ttl_period`
//    строки диалога + событие `auto_delete_period_update {peerId, period}`.
//    Нуль/отсутствие ключа — «выключено».
//  • Broadcast-канал (В-3 Ф-6): отдельного кадра нет, срок едет снимком
//    карточки (`updateChannelFullSnapshot`, `chat_full.full_chat.ttl_period`).
//    Воркер сравнивает его со строкой диалога: отличается — то же событие,
//    совпало — тишина; диалога нет — тоже тишина.
//
// Приём — как в workerCore.dialogFrames.test.ts: перехват onFrame у
// connectionManager, кадр подаётся напрямую.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'
import { saveDialogs } from './store/persist'
import type { Dialog } from './models'
import type { DialogOp } from './dialogs/dialogOps'

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
import { makeDialog, makeLastMessage } from './dialogs/testDialog'

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

const CHANNEL = -5

const dialog = (peerId: number, ttlPeriod?: number): Dialog => makeDialog({
  peerId, ttlPeriod,
  lastMessage: makeLastMessage({ peerId, id: 1, fromId: 1, text: 'x', createdAt: '2026-08-01T00:00:00Z' }),
})

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
})

async function boot(dialogs: Dialog[]) {
  await saveDialogs(dialogs)
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const tab = new SuperMessagePort(epTab)
  const dialogOps: DialogOp[] = []
  const events: { peerId: number; period: number }[] = []
  tab.on('rt:dialog_op', (p) => dialogOps.push(...(p as { ops: DialogOp[] }).ops))
  tab.on('auto_delete_period_update', (p) => events.push(p as { peerId: number; period: number }))
  await tab.invoke('manager', { name: 'dialogs', method: 'fillMirror', args: [] })
  dialogOps.length = 0
  expect(capturedConnDeps).not.toBeNull()
  return { dialogOps, events }
}

const snapshot = (ttl?: number) => ({
  _: 'updateChannelFullSnapshot',
  peer: { _: 'peerChannel', channel_id: 5 },
  chat_full: {
    _: 'messages.chatFull',
    full_chat: {
      _: 'channelFull', id: 5, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null,
      ...(ttl ? { ttl_period: ttl } : {}),
    },
    chats: [{ _: 'channel', id: 5, title: 'Канал', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true } }],
    users: [],
  },
})

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('createWorkerCore(): срок автоудаления чата (f6-ttl)', () => {
  it('updatePeerHistoryTTL → ttl_period строки диалога + auto_delete_period_update', async () => {
    const { dialogOps, events } = await boot([dialog(5)])

    capturedConnDeps!.onFrame('peer_history_ttl', { _: 'updatePeerHistoryTTL', peer: { _: 'peerUser', user_id: 5 }, ttl_period: 86400 })
    await settle()

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 5, fields: { ttl_period: 86400 } }])
    expect(events).toEqual([{ peerId: 5, period: 86400 }])
  })

  it('updatePeerHistoryTTL без ttl_period — «выключено»: поле снято, period 0', async () => {
    const { dialogOps, events } = await boot([dialog(5, 86400)])

    capturedConnDeps!.onFrame('peer_history_ttl', { _: 'updatePeerHistoryTTL', peer: { _: 'peerUser', user_id: 5 } })
    await settle()

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 5, fields: { ttl_period: undefined } }])
    expect(events).toEqual([{ peerId: 5, period: 0 }])
  })

  it('диалога нет в памяти — событие всё равно уходит (tweb :1557 шлёт его безусловно)', async () => {
    const { dialogOps, events } = await boot([dialog(5)])

    capturedConnDeps!.onFrame('peer_history_ttl', { _: 'updatePeerHistoryTTL', peer: { _: 'peerUser', user_id: 9 }, ttl_period: 604800 })
    await settle()

    expect(dialogOps).toEqual([])
    expect(events).toEqual([{ peerId: 9, period: 604800 }])
  })

  it('снимок канала с другим ttl_period → строка диалога и то же событие', async () => {
    const { dialogOps, events } = await boot([dialog(CHANNEL)])

    capturedConnDeps!.onFrame('chat_update', snapshot(86400))
    await settle()

    expect(dialogOps).toContainEqual({ op: 'patch', peerId: CHANNEL, fields: { ttl_period: 86400 } })
    expect(events).toEqual([{ peerId: CHANNEL, period: 86400 }])
  })

  it('снимок канала без ttl_period при включённом сроке → period 0', async () => {
    const { events } = await boot([dialog(CHANNEL, 86400)])

    capturedConnDeps!.onFrame('chat_update', snapshot())
    await settle()

    expect(events).toEqual([{ peerId: CHANNEL, period: 0 }])
  })

  it('снимок канала с тем же ttl_period — тишина (иначе каждая правка карточки шумела бы)', async () => {
    const { dialogOps, events } = await boot([dialog(CHANNEL, 86400)])

    capturedConnDeps!.onFrame('chat_update', snapshot(86400))
    await settle()

    expect(events).toEqual([])
    expect(dialogOps.filter((o) => o.op === 'patch')).toEqual([])
  })

  it('снимок канала, диалога которого нет, — события нет', async () => {
    const { events } = await boot([dialog(7)])

    capturedConnDeps!.onFrame('chat_update', snapshot(86400))
    await settle()

    expect(events).toEqual([])
  })
})
