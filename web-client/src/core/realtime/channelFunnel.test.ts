// src/core/realtime/channelFunnel.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { newChannelFunnel, type ChannelDifference } from './channelFunnel'
import type { Update } from './events'

// Жгут: dispatch записывается, разница — программируемая очередь ответов.
function harness(diffs: ChannelDifference[] = [], opts: { syncDelay?: number } = {}) {
  const dispatched: { t: string; d: unknown; pts?: number; catchUp?: boolean }[] = []
  let i = 0
  const getChannelDifference = vi.fn(async (_peerId: number, pts: number): Promise<ChannelDifference> =>
    diffs[i++] ?? { _: 'updates.channelDifferenceEmpty', pFlags: { final: true }, pts })
  const savePeers = vi.fn()
  const onChannelReload = vi.fn()
  const funnel = newChannelFunnel({
    dispatch: (t, d, meta) => dispatched.push({ t, d, pts: meta?.pts, catchUp: meta?.catchUp }),
    getChannelDifference, savePeers, onChannelReload, syncDelay: opts.syncDelay ?? 0,
  })
  return { funnel, dispatched, getChannelDifference, savePeers, onChannelReload }
}

const PEER = -5
const post = (id: number) => ({ _: 'message', id, peer_id: { _: 'peerChannel', channel_id: 5 } })
const difference = (pts: number, msgs: number[], final = true, other: Update[] = []): ChannelDifference => ({
  _: 'updates.channelDifference', pFlags: final ? { final: true } : {}, pts,
  new_messages: msgs.map(post), other_updates: other, users: [], chats: [],
})

afterEach(() => { vi.useRealTimers() })

describe('channelFunnel — состояние канала (tweb addChannelState/getChannelState)', () => {
  it('без pts состояния не бывает', () => {
    const h = harness()
    expect(() => h.funnel.addChannelState(PEER, 0)).toThrow()
  })

  it('состояние заводится один раз и живым не откатывается (`??=`)', () => {
    const h = harness()
    h.funnel.addChannelState(PEER, 10)
    h.funnel.addChannelState(PEER, 3)
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 11, {})   // next от 10
    expect(h.dispatched).toHaveLength(1)
  })

  // tweb getChannelState(channelId, pts) → «duplicate update»: живой кадр
  // канала без состояния заводит его своим pts и сам не применяется.
  it('живой кадр без состояния заводит его и отбрасывается как учтённый', () => {
    const h = harness()
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 7, {})
    expect(h.dispatched).toHaveLength(0)
    expect(h.funnel.has(PEER)).toBe(true)
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 8, {})
    expect(h.dispatched).toHaveLength(1)
  })
})

describe('channelFunnel.processUpdate — живой кадр', () => {
  it('next применяется, dup отбрасывается', () => {
    const h = harness()
    h.funnel.addChannelState(PEER, 5)
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 6, {})
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 6, {})
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 4, {})
    expect(h.dispatched).toEqual([{ t: 'updateNewChannelMessage', d: {}, pts: 6, catchUp: false }])
  })

  it('дыру, закрытую следующим кадром, сливает по порядку без разницы', () => {
    const h = harness()
    h.funnel.addChannelState(PEER, 5)
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 7, { n: 7 })
    expect(h.dispatched).toHaveLength(0)
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 6, { n: 6 })
    expect(h.dispatched.map((d) => d.pts)).toEqual([6, 7])
    expect(h.getChannelDifference).not.toHaveBeenCalled()
  })

  // Дыра в pts живого кадра канала, не закрытая за SYNC_DELAY, —
  // updates.getChannelDifference от состояния (tweb :682-704).
  it('незакрытая дыра — getChannelDifference от pts состояния', async () => {
    vi.useFakeTimers()
    const h = harness([difference(7, [6, 7])])
    h.funnel.addChannelState(PEER, 5)
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 7, { n: 7 })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.getChannelDifference).toHaveBeenCalledWith(PEER, 5)
    expect(h.dispatched.map((d) => [d.t, (d.d as { message: { id: number } }).message.id, d.catchUp]))
      .toEqual([['updateNewChannelMessage', 6, true], ['updateNewChannelMessage', 7, true]])
    // придержанный 7 не всплыл повторно, а следующий живой — next от 7
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 8, {})
    expect(h.dispatched.map((d) => d.pts)).toEqual([7, 7, 8])
  })

  it('пока идёт разница, живые кадры отбрасываются', async () => {
    let resolve: ((d: ChannelDifference) => void) | null = null
    const h = harness()
    h.getChannelDifference.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    h.funnel.addChannelState(PEER, 5)
    const p = h.funnel.getChannelDifference(PEER)
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 6, {})
    expect(h.dispatched).toHaveLength(0)
    resolve!(difference(6, [6]))
    await p
    expect(h.dispatched).toHaveLength(1)
  })
})

describe('channelFunnel.getChannelDifference — updates.getChannelDifference', () => {
  it('карточки — до апдейтов; other_updates — до new_messages; не final — следующая страница', async () => {
    const edit = { _: 'updateEditChannelMessage', message: post(1), pts: 6, pts_count: 1 } as unknown as Update
    const h = harness([difference(6, [], false, [edit]), difference(8, [7, 8])])
    const order: string[] = []
    h.savePeers.mockImplementation(() => order.push('peers'))
    h.funnel.addChannelState(PEER, 5)
    await h.funnel.getChannelDifference(PEER)
    expect(h.getChannelDifference.mock.calls).toEqual([[PEER, 5], [PEER, 6]])
    expect(h.dispatched.map((d) => d.t)).toEqual(['updateEditChannelMessage', 'updateNewChannelMessage', 'updateNewChannelMessage'])
    expect(order[0]).toBe('peers')
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 9, {})
    expect(h.dispatched[h.dispatched.length - 1]?.pts).toBe(9)
  })

  it('channelDifferenceEmpty — только pts', async () => {
    const h = harness([{ _: 'updates.channelDifferenceEmpty', pFlags: { final: true }, pts: 12 }])
    h.funnel.addChannelState(PEER, 5)
    await h.funnel.getChannelDifference(PEER)
    expect(h.dispatched).toEqual([])
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 13, {})
    expect(h.dispatched).toHaveLength(1)
  })

  // tweb :451-458: состояние удаляется, канал перечитывается (updateChannelReload).
  it('channelDifferenceTooLong — состояние забыто, канал перечитывается', async () => {
    const h = harness([{ _: 'updates.channelDifferenceTooLong', pFlags: { final: true }, dialog: {}, messages: [], users: [], chats: [] }])
    h.funnel.addChannelState(PEER, 5)
    await h.funnel.getChannelDifference(PEER)
    expect(h.onChannelReload).toHaveBeenCalledWith(PEER)
    expect(h.funnel.has(PEER)).toBe(false)
  })
})

// Офлайн → в канале посты → реконнект: getDifference отдаёт
// updateChannelTooLong, и канал с состоянием догоняется (tweb :658-662).
describe('channelFunnel.onTooLong — updateChannelTooLong', () => {
  it('канал с состоянием догоняется разницей', async () => {
    const h = harness([difference(8, [6, 7, 8])])
    h.funnel.addChannelState(PEER, 5)
    h.funnel.onTooLong(PEER)
    await vi.waitFor(() => expect(h.dispatched).toHaveLength(3))
    expect(h.getChannelDifference).toHaveBeenCalledWith(PEER, 5)
  })

  it('канал без состояния — ничего', () => {
    const h = harness()
    h.funnel.onTooLong(PEER)
    expect(h.getChannelDifference).not.toHaveBeenCalled()
  })

  it('не чаще: живой кадр только что двигал состояние — разницы нет', () => {
    vi.useFakeTimers()
    const h = harness([], { syncDelay: 250 })
    h.funnel.addChannelState(PEER, 5)
    h.funnel.processUpdate(PEER, 'updateNewChannelMessage', 6, {})
    h.funnel.onTooLong(PEER)
    expect(h.getChannelDifference).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    h.funnel.onTooLong(PEER)
    expect(h.getChannelDifference).toHaveBeenCalledTimes(1)
  })
})

// Открыт чужой публичный канал: живых кадров нет, лента опрашивает разницу
// (tweb subscribeToChannelUpdates :850-875).
describe('channelFunnel.subscribe — опрос открытого канала', () => {
  it('сразу и раз в интервал, если разницы не было дольше зазора; отписка гасит', async () => {
    vi.useFakeTimers()
    const h = harness()
    const funnel = newChannelFunnel({
      dispatch: () => {}, getChannelDifference: h.getChannelDifference,
      savePeers: () => {}, onChannelReload: () => {},
    })
    funnel.addChannelState(PEER, 5)
    funnel.subscribe(PEER)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.getChannelDifference).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.getChannelDifference).toHaveBeenCalledTimes(2)
    funnel.unsubscribe(PEER)
    await vi.advanceTimersByTimeAsync(9000)
    expect(h.getChannelDifference).toHaveBeenCalledTimes(2)
  })

  it('новые посты опроса применяются, без состояния опрос молчит', async () => {
    vi.useFakeTimers()
    const h = harness([difference(6, [6])])
    h.funnel.subscribe(-9)                      // состояния нет — ничего
    h.funnel.addChannelState(PEER, 5)
    h.funnel.subscribe(PEER)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.getChannelDifference).toHaveBeenCalledTimes(1)
    expect(h.dispatched.map((d) => d.t)).toEqual(['updateNewChannelMessage'])
    h.funnel.unsubscribe(PEER); h.funnel.unsubscribe(-9)
  })

  it('две подписки — опрос живёт до последней отписки', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.funnel.addChannelState(PEER, 5)
    h.funnel.subscribe(PEER)
    h.funnel.subscribe(PEER)
    h.funnel.unsubscribe(PEER)
    await vi.advanceTimersByTimeAsync(3000)
    const calls = h.getChannelDifference.mock.calls.length
    h.funnel.unsubscribe(PEER)
    await vi.advanceTimersByTimeAsync(9000)
    expect(h.getChannelDifference.mock.calls.length).toBe(calls)
    expect(calls).toBeGreaterThan(0)
  })
})

// tweb 1dc32d889: ожидание уведомления пира-канала учитывает догон этого
// канала (и только его).
describe('channelFunnel.syncState', () => {
  it('отдаёт идущую разницу канала и обновляет признак жизни на каждой странице', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const resolvers: Array<(d: ChannelDifference) => void> = []
    const funnel = newChannelFunnel({
      dispatch: () => {},
      getChannelDifference: () => new Promise<ChannelDifference>((r) => { resolvers.push(r) }),
      savePeers: () => {}, onChannelReload: () => {},
    })
    expect(funnel.syncState(PEER)).toBeUndefined()
    funnel.addChannelState(PEER, 5)
    const p = funnel.getChannelDifference(PEER)
    expect(funnel.syncState(PEER)).toEqual({ loading: p, progressTime: 1000 })

    vi.setSystemTime(2000)
    resolvers[0](difference(6, [6], false))
    await vi.advanceTimersByTimeAsync(0)
    expect(resolvers).toHaveLength(2)
    expect(funnel.syncState(PEER)?.progressTime).toBe(2000)

    resolvers[1](difference(6, []))
    await p
    expect(funnel.syncState(PEER)?.loading).toBeNull()
  })
})

// Ревью #410, №3: живой пост канала двигает дату общего состояния (tweb
// :736-738), а реконнект с маркерами по многим каналам не шлёт разницы залпом.
describe('channelFunnel — дата и очередь разниц', () => {
  it('применённый живой кадр канала отдаёт свою дату в advanceDate', () => {
    const dates: number[] = []
    const funnel = newChannelFunnel({
      dispatch: () => {}, getChannelDifference: vi.fn(), savePeers: () => {}, onChannelReload: () => {},
      advanceDate: (d) => dates.push(d),
    })
    funnel.addChannelState(PEER, 5)
    funnel.processUpdate(PEER, 'updateNewChannelMessage', 6, { message: { date: 1700 } })
    funnel.processUpdate(PEER, 'updateNewChannelMessage', 6, { message: { date: 1800 } })   // дубль
    expect(dates).toEqual([1700])
  })

  it('разниц каналов одновременно не больше maxConcurrent', async () => {
    let inFlight = 0
    let peak = 0
    const resolvers: Array<() => void> = []
    const funnel = newChannelFunnel({
      dispatch: () => {}, savePeers: () => {}, onChannelReload: () => {}, maxConcurrent: 4,
      getChannelDifference: (_peer, pts) => new Promise<ChannelDifference>((r) => {
        peak = Math.max(peak, ++inFlight)
        resolvers.push(() => { inFlight--; r({ _: 'updates.channelDifferenceEmpty', pFlags: { final: true }, pts }) })
      }),
    })
    for (let k = 1; k <= 10; k++) { funnel.addChannelState(-k, 5); funnel.onTooLong(-k) }
    await new Promise((r) => setTimeout(r, 0))
    expect(peak).toBe(4)
    while (resolvers.length) { resolvers.shift()!(); await new Promise((r) => setTimeout(r, 0)) }
    expect(peak).toBe(4)
    expect(inFlight).toBe(0)
  })
})
