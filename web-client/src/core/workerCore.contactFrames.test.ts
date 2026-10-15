// Пин ПРОВОДКИ в workerCore.ts для Ф-6 f6-contacts.
//
//  • `onContactToggle` у владельца карточек (`peersManager`) → `contacts.onContactUpdated`
//    (tweb `saveApiUser` :738-754 → `onContactUpdated`): кадр `user_update` со
//    второго устройства («добавил в контакты») двигает книгу и объявляет вкладкам
//    `contacts_update` (`appUsersManager.ts:1216-1228`);
//  • `updateSavedReactionTags` (строка журнала saved_tags) — известный кадр:
//    доходит вкладкам как `rt:saved_reaction_tags`, воркер не падает. Кэша тегов
//    нет, перечитывать некому — это 1:1 с условием tweb «если кэш есть»
//    (appReactionsManager.ts:121-132).
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

type PeersDeps = Parameters<typeof import('./managers/peersManager').newPeersManager>[0]
let capturedPeersDeps: PeersDeps | null = null
vi.mock('./managers/peersManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/peersManager')>()
  return {
    ...actual,
    newPeersManager: (deps: PeersDeps) => { capturedPeersDeps = deps; return actual.newPeersManager(deps) },
  }
})

type SyncDeps = Parameters<typeof import('./realtime/syncEngine').newSyncEngine>[0]
let capturedSyncDeps: SyncDeps | null = null
vi.mock('./realtime/syncEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/syncEngine')>()
  return {
    ...actual,
    newSyncEngine: (deps: SyncDeps) => { capturedSyncDeps = deps; return actual.newSyncEngine(deps) },
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

function boot() {
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  return { core, tab: new SuperMessagePort(epTab) }
}

const settle = async () => {
  for (let i = 0; i < 10; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
  capturedPeersDeps = null
})

describe('createWorkerCore(): контакты и теги «Избранного»', () => {
  it('смена pFlags.contact у карточки → contacts_update во вкладки', async () => {
    const { tab } = boot()
    const got: unknown[] = []
    tab.on('contacts_update', (p) => got.push(p))
    expect(capturedPeersDeps?.onContactToggle).toBeTypeOf('function')

    capturedPeersDeps!.onContactToggle!(7, true, false)
    await settle()

    expect(got).toEqual([7])
  })

  it('кадр user_update про неизвестного контакта → карточка сохранена, contacts_update', async () => {
    const { tab } = boot()
    const contacts: unknown[] = []
    const ops: unknown[] = []
    tab.on('contacts_update', (p) => contacts.push(p))
    tab.on('rt:peer_op', (p) => ops.push(p))
    const user = { _: 'user', id: 7, first_name: 'Бобби', pFlags: { contact: true } }

    capturedConnDeps!.onFrame('user_update', { _: 'updateUserSnapshot', user })
    await settle()

    expect(contacts).toEqual([7])
    expect(ops).toEqual([{ ops: [{ op: 'upsert', peers: [user] }] }])
  })

  // P0 №2: статус — поле карточки (tweb appUsersManager.ts:90-102). Кадр
  // updateUserStatus правит известную карточку в кэше воркера и объявляет её
  // вкладкам; стор присутствия получает тот же кадр.
  it('updateUserStatus → статус известной карточки в кэше воркера, операция и rt:presence', async () => {
    const { tab } = boot()
    const ops: unknown[] = []
    const presence: unknown[] = []
    tab.on('rt:peer_op', (p) => ops.push(p))
    tab.on('rt:presence', (p) => presence.push(p))
    const user = { _: 'user', id: 7, first_name: 'Егор', status: { _: 'userStatusOffline', was_online: 1790500000 } }
    capturedConnDeps!.onFrame('user_update', { _: 'updateUserSnapshot', user })
    await settle()
    ops.length = 0
    presence.length = 0 // статус из самой карточки тоже уходит в присутствие — не предмет теста

    const status = { _: 'userStatusOnline', expires: 1790503807 }
    capturedConnDeps!.onFrame('presence', { _: 'updateUserStatus', user_id: 7, status })
    await settle()

    expect(ops).toEqual([{ ops: [{ op: 'upsert', peers: [{ ...user, status }] }] }])
    expect(presence).toEqual([{ _: 'updateUserStatus', user_id: 7, status }])
  })

  // tweb appUsersManager.ts:68, :70 — таймер в 60 с и state_synchronized.
  it('истёкший онлайн карточки гасится таймером 60 с', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'Date'] })
    try {
      vi.setSystemTime(new Date(1_000_000_000_000))
      const { tab } = boot()
      const ops: Array<{ ops: Array<{ peers: Array<{ status?: { _: string } }> }> }> = []
      tab.on('rt:peer_op', (p) => ops.push(p as never))
      const user = { _: 'user', id: 7, first_name: 'Егор', status: { _: 'userStatusOnline', expires: 1_000_000_010 } }
      capturedConnDeps!.onFrame('user_update', { _: 'updateUserSnapshot', user })
      await vi.advanceTimersByTimeAsync(0)
      ops.length = 0

      await vi.advanceTimersByTimeAsync(60_000)

      expect(ops.flatMap((o) => o.ops.flatMap((op) => op.peers.map((p) => p.status?._)))).toEqual(['userStatusOffline'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('конец догона (state_synchronized) гасит истёкший онлайн карточки', async () => {
    const { tab } = boot()
    const ops: Array<{ ops: Array<{ peers: Array<{ status?: { _: string } }> }> }> = []
    tab.on('rt:peer_op', (p) => ops.push(p as never))
    const user = { _: 'user', id: 7, first_name: 'Егор', status: { _: 'userStatusOnline', expires: 1 } }
    capturedConnDeps!.onFrame('user_update', { _: 'updateUserSnapshot', user })
    await settle()
    ops.length = 0

    capturedSyncDeps!.onSyncEnd!()
    await settle()

    expect(ops.flatMap((o) => o.ops.flatMap((op) => op.peers.map((p) => p.status?._)))).toEqual(['userStatusOffline'])
  })

  it('updateSavedReactionTags → rt:saved_reaction_tags, воркер не падает', async () => {
    const { tab } = boot()
    const got: unknown[] = []
    tab.on('rt:saved_reaction_tags', (p) => got.push(p))
    const frame = { _: 'updateSavedReactionTags' }

    capturedConnDeps!.onFrame('saved_tags', frame)
    await settle()

    expect(got).toEqual([frame])
  })
})
