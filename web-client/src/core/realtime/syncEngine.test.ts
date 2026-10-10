// src/core/realtime/syncEngine.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newSyncEngine, type UpdatesDifference, type SyncDeps } from './syncEngine'
import type { Cursor } from './cursor'
import type { Update } from './events'

function fakeRest(pages: UpdatesDifference[]) {
  let i = 0
  return { get: vi.fn(async (_path: string, _q?: unknown) => pages[i++]) }
}
// In-memory cursor double: advance is monotonic, set is unconditional.
function fakeCursor(pts = 1, date = 1): Cursor {
  return {
    ready: async () => {},
    get: () => ({ pts, date }),
    advance: (p, d) => { if (p > pts) pts = p; if (typeof d === 'number' && d > date) date = d },
    set: (p, d) => { pts = p; date = d },
    reset: () => { pts = 0; date = 0 },
  }
}
const state = (pts: number, date: number) => ({ _: 'updates.state' as const, pts, date, qts: 0, seq: 0, unread_count: 0 })
const msg = (id: number) => ({ _: 'message', id, peer_id: { _: 'peerUser', user_id: 2 } })
const read = (pts: number): Update => ({ _: 'updateReadHistoryOutbox', peer: { _: 'peerUser', user_id: 2 }, max_id: 1, pts, pts_count: 1 } as unknown as Update)
interface DiffOpts { new_messages?: unknown[]; other_updates?: Update[]; users?: unknown[]; chats?: unknown[]; slice?: boolean; st: ReturnType<typeof state> }
const diff = (o: DiffOpts): UpdatesDifference => ({
  _: o.slice ? 'updates.differenceSlice' : 'updates.difference',
  new_messages: o.new_messages ?? [], other_updates: o.other_updates ?? [],
  users: o.users ?? [], chats: o.chats ?? [],
  ...(o.slice ? { intermediate_state: o.st } : { state: o.st }),
})

function engine(rest: { get: SyncDeps['rest']['get'] } | ReturnType<typeof fakeRest>, over: Partial<SyncDeps> = {}) {
  const saved: Array<{ key: string; d: unknown; pts?: number }> = []
  const channel: Update[] = []
  const deps: SyncDeps = {
    rest: rest as SyncDeps['rest'], cursor: fakeCursor(),
    saveUpdate: (key, d, meta) => { saved.push({ key, d, pts: meta.pts }) },
    processChannelUpdate: (u) => { channel.push(u) },
    onDifferenceTooLong: vi.fn(),
    ...over,
  }
  return { se: newSyncEngine(deps), deps, saved, channel }
}

describe('SyncEngine.getDifference — updates.getDifference', () => {
  it('запрашивает /updates/difference{pts,date,qts:-1} от курсора, листает срезы и ставит state', async () => {
    const rest = fakeRest([
      diff({ slice: true, new_messages: [msg(1)], st: state(5, 10) }),
      diff({ new_messages: [msg(2)], other_updates: [read(8)], st: state(9, 11) }),
    ])
    const cursor = fakeCursor(3, 7)
    const { se, saved } = engine(rest, { cursor })
    await se.getDifference()
    expect(rest.get.mock.calls).toEqual([
      ['/updates/difference', { pts: 3, date: 7, qts: -1 }],
      ['/updates/difference', { pts: 5, date: 10, qts: -1 }],
    ])
    expect(saved.map((s) => s.key)).toEqual(['updateNewMessage', 'updateReadHistoryOutbox', 'updateNewMessage'])
    expect(cursor.get()).toEqual({ pts: 9, date: 11 })
  })

  // tweb :344-376: other_updates применяются ДО new_messages («because of
  // updateMessageID»); сообщения — updateNewMessage с pts_count 0.
  it('other_updates применяются раньше new_messages, сообщения — updateNewMessage{pts_count:0}', async () => {
    const { se, saved } = engine(fakeRest([diff({ new_messages: [msg(1)], other_updates: [read(2)], st: state(2, 1) })]))
    await se.getDifference()
    expect(saved.map((s) => s.key)).toEqual(['updateReadHistoryOutbox', 'updateNewMessage'])
    expect(saved[1].d).toEqual({ _: 'updateNewMessage', message: msg(1), pts: 1, pts_count: 0 })
  })

  // A4-05: карточки страницы — ДО её апдейтов (tweb :341-342).
  it('отдаёт векторы карточек страницы раньше её апдейтов', async () => {
    const order: string[] = []
    const { se } = engine(fakeRest([diff({ new_messages: [msg(1)], users: [{ _: 'user', id: 7 }], st: state(1, 1) })]), {
      onPeers: (p) => order.push(`peers:${p.users?.length}`),
      saveUpdate: (key) => order.push(key),
    })
    await se.getDifference()
    expect(order).toEqual(['peers:1', 'updateNewMessage'])
  })

  // tweb :352-357: updateChannelTooLong и посты канала идут через состояние
  // канала (processUpdate), а не saveUpdate.
  it('updateChannelTooLong и посты канала уходят состоянию канала', async () => {
    const tooLong = { _: 'updateChannelTooLong', channel_id: 5, pts: 30 } as Update
    const { se, saved, channel } = engine(fakeRest([diff({ other_updates: [tooLong], st: state(1, 1) })]))
    await se.getDifference()
    expect(channel).toEqual([tooLong])
    expect(saved).toEqual([])
  })

  it('differenceEmpty — курсор pts не трогается, date — из ответа', async () => {
    const cursor = fakeCursor(4, 1)
    const { se, saved } = engine(fakeRest([{ _: 'updates.differenceEmpty', date: 99, seq: 0 }]), { cursor })
    await se.getDifference()
    expect(saved).toEqual([])
    expect(cursor.get()).toEqual({ pts: 4, date: 99 })
  })

  it('differenceTooLong — onDifferenceTooLong и курсор на серверный pts', async () => {
    const cursor = fakeCursor()
    const { se, deps } = engine(fakeRest([{ _: 'updates.differenceTooLong', pts: 42 }]), { cursor })
    await se.getDifference()
    expect(deps.onDifferenceTooLong).toHaveBeenCalledTimes(1)
    expect(cursor.get().pts).toBe(42)
  })

  it('isSyncing — true во время прогона и false после', async () => {
    let resolveGet: ((v: UpdatesDifference) => void) | null = null
    const { se } = engine({ get: vi.fn(() => new Promise<UpdatesDifference>((r) => { resolveGet = r })) as never })
    const p = se.getDifference()
    expect(se.isSyncing()).toBe(true)
    await vi.waitFor(() => expect(resolveGet).not.toBeNull())
    resolveGet!({ _: 'updates.differenceEmpty', date: 1, seq: 0 })
    await p
    expect(se.isSyncing()).toBe(false)
  })

  // Задача 1 (порт ConnectionStatusComponent): аналог tweb state_synchronizing/
  // state_synchronized — по разу на прогон, и «конец» приходит и на упавшем.
  it('onSyncStart/onSyncEnd — по разу, и на успехе, и на отказе', async () => {
    const onSyncStart = vi.fn(); const onSyncEnd = vi.fn()
    const ok = engine(fakeRest([{ _: 'updates.differenceEmpty', date: 1, seq: 0 }]), { onSyncStart, onSyncEnd })
    await ok.se.getDifference()
    expect([onSyncStart.mock.calls.length, onSyncEnd.mock.calls.length]).toEqual([1, 1])

    const failed = engine({ get: vi.fn(async () => { throw new Error('network down') }) as never }, { onSyncStart, onSyncEnd })
    await expect(failed.se.getDifference()).rejects.toThrow('network down')
    expect([onSyncStart.mock.calls.length, onSyncEnd.mock.calls.length]).toEqual([2, 2])
    expect(failed.se.isSyncing()).toBe(false)
  })

  it('вызов во время идущего прогона его не дублирует', async () => {
    let resolveGet: ((v: UpdatesDifference) => void) | null = null
    const get = vi.fn(() => new Promise<UpdatesDifference>((r) => { resolveGet = r }))
    const { se } = engine({ get: get as never })
    const p1 = se.getDifference()
    const p2 = se.getDifference()
    expect(p2).toBe(p1)
    await vi.waitFor(() => expect(resolveGet).not.toBeNull())
    resolveGet!({ _: 'updates.differenceEmpty', date: 1, seq: 0 })
    await p1
    expect(get).toHaveBeenCalledTimes(1)
  })
})

describe('SyncEngine.getState — updates.getState', () => {
  // tweb attach :893-905: без сохранённого состояния базой становится
  // ТЕКУЩЕЕ состояние сервера — журнал от нуля не переигрывается.
  it('ставит курсор на состояние сервера, ничего не применяя', async () => {
    const cursor = fakeCursor(0, 0)
    const get = vi.fn(async () => state(17, 1234))
    const { se, saved } = engine({ get: get as never }, { cursor })
    await se.getState()
    expect(get).toHaveBeenCalledWith('/updates/state')
    expect(cursor.get()).toEqual({ pts: 17, date: 1234 })
    expect(saved).toEqual([])
  })

  // Стартовый pull статуса видит получение состояния как догон (isSyncing):
  // без пары synchronizing/synchronized «Обновление…» в поиске залипало.
  it('получение состояния тоже парой onSyncStart/onSyncEnd', async () => {
    const onSyncStart = vi.fn(); const onSyncEnd = vi.fn()
    const { se } = engine({ get: vi.fn(async () => state(1, 1)) as never }, { cursor: fakeCursor(0, 0), onSyncStart, onSyncEnd })
    const p = se.getState()
    expect(se.isSyncing()).toBe(true)
    await p
    expect([onSyncStart.mock.calls.length, onSyncEnd.mock.calls.length]).toEqual([1, 1])
    expect(se.isSyncing()).toBe(false)
  })
})

// Разницу без состояния просить не от чего: вместо переигрывания журнала от
// нуля — состояние сервера (tweb getDifference без state не зовёт).
describe('SyncEngine.getDifference без состояния', () => {
  it('берёт updates.getState, разницу не просит', async () => {
    const cursor = fakeCursor(0, 0)
    const get = vi.fn(async () => state(17, 1234))
    const { se } = engine({ get: get as never }, { cursor })
    await se.getDifference()
    expect(get.mock.calls).toEqual([['/updates/state']])
    expect(cursor.get()).toEqual({ pts: 17, date: 1234 })
  })
})

// tweb 1dc32d889: `syncProgressTime` — признак жизни догона (старт и каждая
// страница); по нему `syncWait` решает, не замолчал ли difference.
describe('SyncEngine.syncState', () => {
  it('отдаёт идущий догон и обновляет признак жизни на каждой странице', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1000)
      const resolvers: Array<(v: UpdatesDifference) => void> = []
      const { se } = engine({ get: vi.fn(() => new Promise<UpdatesDifference>((r) => { resolvers.push(r) })) as never })
      expect(se.syncState()).toEqual({ loading: null, progressTime: 0 })

      const p = se.getDifference()
      expect(se.syncState()).toEqual({ loading: p, progressTime: 1000 })

      await vi.advanceTimersByTimeAsync(0)
      expect(resolvers).toHaveLength(1)
      vi.setSystemTime(2000)
      resolvers[0](diff({ slice: true, st: state(1, 0) }))
      await vi.advanceTimersByTimeAsync(0)
      expect(resolvers).toHaveLength(2)
      expect(se.syncState().progressTime).toBe(2000)

      resolvers[1](diff({ st: state(2, 0) }))
      await p
      expect(se.syncState().loading).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
