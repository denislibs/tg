// Пин ПРОВОДКИ в workerCore.ts: кадры участника и заявок (Ф-3б).
//
//  • `updateChannelParticipant` — порт `appChatsManager.onUpdateChannelParticipant`
//    (tweb :1419-1422): кэш страниц участников чата сбрасывается ДО рассылки
//    `rt:chat_participant`, иначе вкладка, перечитывающая список по событию,
//    получила бы старую страницу из кэша;
//  • `updatePendingJoinRequests` — порт `appChatInvitesManager.onUpdatePendingJoinRequests`
//    (tweb :24-40): скрытие плашки заявок снимается (диск + зеркало ключа State),
//    вкладкам уходит ПЕРЕЛОЖЕННЫЙ `rt:chat_requests`;
//  • местный апдейт мутации (`groups.onChannelParticipant`) уезжает тем же событием.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => { capturedConnDeps = deps; return actual.newConnectionManager(deps) },
  }
})

const order: string[] = []
type GroupsDeps = Parameters<typeof import('./managers/groupsManager').newGroupsManager>[0]
let capturedGroupsDeps: GroupsDeps | null = null
const invalidateChannelParticipants = vi.fn((chatId: number) => { order.push('invalidate:' + chatId) })
vi.mock('./managers/groupsManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/groupsManager')>()
  return {
    ...actual,
    newGroupsManager: (deps: GroupsDeps) => {
      capturedGroupsDeps = deps
      return { ...actual.newGroupsManager(deps), invalidateChannelParticipants }
    },
  }
})

import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { loadStateAll, saveStateKey } from './store/persist'
import { STATE_VERSION } from './state/state'

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

function boot() {
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const tab = new SuperMessagePort(epTab)
  expect(capturedConnDeps).not.toBeNull()
  return { core, tab }
}

const settle = async () => {
  for (let i = 0; i < 10; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const CHAT_ID = 30

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
  capturedGroupsDeps = null
  invalidateChannelParticipants.mockClear()
  order.length = 0
})

describe('createWorkerCore(): кадры участника и заявок', () => {
  it('updateChannelParticipant → сброс кэша участников чата, ПОТОМ rt:chat_participant с кадром как есть', async () => {
    const { tab } = boot()
    const got: unknown[] = []
    tab.on('rt:chat_participant', (p) => { order.push('broadcast'); got.push(p) })

    const frame = {
      _: 'updateChannelParticipant', channel_id: CHAT_ID, date: 1, actor_id: 1, user_id: 7,
      new_participant: { _: 'channelParticipant', user_id: 7, date: 1 },
    }
    capturedConnDeps!.onFrame('chat_participant', frame)
    await settle()

    expect(invalidateChannelParticipants).toHaveBeenCalledWith(CHAT_ID)
    expect(got).toEqual([frame])
    expect(order).toEqual(['invalidate:' + CHAT_ID, 'broadcast'])
  })

  it('updatePendingJoinRequests → скрытие плашки снято на диске и зеркалом, rt:chat_requests переложен', async () => {
    await saveStateKey('version', STATE_VERSION)
    await saveStateKey('hideChatJoinRequests', { [-CHAT_ID]: 123, [-31]: 456 })
    const { tab } = boot()
    const requests: unknown[] = []
    const mirrors: unknown[] = []
    tab.on('rt:chat_requests', (p) => requests.push(p))
    tab.on('state:mirror', (p) => mirrors.push(p))

    capturedConnDeps!.onFrame('pending_join_requests', {
      _: 'updatePendingJoinRequests', peer: { _: 'peerChannel', channel_id: CHAT_ID }, requests_pending: 2, recent_requesters: [11, 12],
    })
    await settle()

    expect(requests).toEqual([{ chatId: CHAT_ID, recentRequesters: [11, 12], requestsPending: 2 }])
    expect(mirrors).toEqual([{ key: 'hideChatJoinRequests', value: { [-31]: 456 } }])
    expect((await loadStateAll()).hideChatJoinRequests).toEqual({ [-31]: 456 })
    // сырой кадр вкладкам не уходит — только переложенный
    expect(requests).toHaveLength(1)
  })

  it('местный апдейт мутации (`onChannelParticipant`) уезжает вкладкам тем же rt:chat_participant', async () => {
    const { tab } = boot()
    const got: unknown[] = []
    tab.on('rt:chat_participant', (p) => got.push(p))
    expect(capturedGroupsDeps?.onChannelParticipant).toBeTypeOf('function')

    const update = { _: 'updateChannelParticipant' as const, channel_id: CHAT_ID, date: 1, user_id: 5 }
    capturedGroupsDeps!.onChannelParticipant!(update)
    await settle()
    expect(got).toEqual([update])
  })
})
