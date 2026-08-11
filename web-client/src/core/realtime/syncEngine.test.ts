// src/core/realtime/syncEngine.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newSyncEngine, type SyncItem } from './syncEngine'
import type { Cursor } from './cursor'

interface Page { new_messages: SyncItem[]; other_updates: SyncItem[]; state: { pts: number; date: number }; slice: boolean; too_long?: boolean }
function fakeRest(pages: Page[]) {
  let i = 0
  return { get: vi.fn(async () => pages[i++]) } as never
}
// In-memory cursor double: advance is monotonic, set is unconditional.
function fakeCursor(pts = 0, date = 0): Cursor {
  return {
    ready: async () => {},
    get: () => ({ pts, date }),
    advance: (p, d) => { if (p > pts) pts = p; if (typeof d === 'number' && d > date) date = d },
    set: (p, d) => { pts = p; date = d },
  }
}
const nm = (pts: number, id: number): SyncItem => ({ t: 'new_message', pts, d: { msg_id: id } })
const ou = (pts: number, id: number): SyncItem => ({ t: 'read', pts, d: { up_to_seq: id } })

describe('SyncEngine.catchUp', () => {
  it('drains slices, applies updates, advances + persists pts', async () => {
    const rest = fakeRest([
      { new_messages: [nm(5, 1)], other_updates: [], state: { pts: 5, date: 10 }, slice: true },
      { new_messages: [nm(9, 2)], other_updates: [ou(8, 3)], state: { pts: 9, date: 11 }, slice: false },
    ])
    const onUpdate = vi.fn(); const onResync = vi.fn()
    const cursor = fakeCursor()
    const se = newSyncEngine({ rest, cursor, onUpdate, onResync })
    await se.catchUp()
    expect(onUpdate).toHaveBeenCalledTimes(3)
    expect(cursor.get().pts).toBe(9)
    expect(onResync).not.toHaveBeenCalled()
  })

  it('merges new_messages + other_updates into ONE pts-ordered stream (edit-before-base fix)', async () => {
    // other_update pts=6 sits BETWEEN two messages (pts 5 and 7). Draining messages
    // first would invert it; the single sorted stream restores true order.
    const rest = fakeRest([
      { new_messages: [nm(7, 2), nm(5, 1)], other_updates: [ou(6, 9)], state: { pts: 7, date: 3 }, slice: false },
    ])
    const seen: number[] = []
    const se = newSyncEngine({ rest, cursor: fakeCursor(), onUpdate: (it) => seen.push(it.pts), onResync: vi.fn() })
    await se.catchUp()
    expect(seen).toEqual([5, 6, 7])
  })

  it('too_long → onResync + parks cursor on server pts (no perpetual gap)', async () => {
    const rest = fakeRest([{ new_messages: [], other_updates: [], state: { pts: 42, date: 7 }, slice: false, too_long: true }])
    const onResync = vi.fn()
    const cursor = fakeCursor()
    const se = newSyncEngine({ rest, cursor, onUpdate: vi.fn(), onResync })
    await se.catchUp()
    expect(onResync).toHaveBeenCalledTimes(1)
    expect(cursor.get().pts).toBe(42)
  })

  it('isSyncing is true during a run and false after', async () => {
    let resolveGet: ((v: Page) => void) | null = null
    const rest = { get: vi.fn(() => new Promise<Page>((r) => { resolveGet = r })) } as never
    const se = newSyncEngine({ rest, cursor: fakeCursor(), onUpdate: vi.fn(), onResync: vi.fn() })
    const p = se.catchUp()
    // run() awaits cursor.ready() (a microtask) before the first rest.get — flush it.
    await vi.waitFor(() => expect(resolveGet).not.toBeNull())
    expect(se.isSyncing()).toBe(true)
    resolveGet!({ new_messages: [], other_updates: [], state: { pts: 0, date: 0 }, slice: false })
    await p
    expect(se.isSyncing()).toBe(false)
  })

  // Задача 1 (порт ConnectionStatusComponent): аналог tweb state_synchronizing/
  // state_synchronized — начало и конец catch-up ровно по разу на успешный прогон.
  it('onSyncStart/onSyncEnd fire exactly once each on a successful catch-up', async () => {
    const rest = fakeRest([{ new_messages: [], other_updates: [], state: { pts: 1, date: 1 }, slice: false }])
    const onSyncStart = vi.fn(); const onSyncEnd = vi.fn()
    const se = newSyncEngine({ rest, cursor: fakeCursor(), onUpdate: vi.fn(), onResync: vi.fn(), onSyncStart, onSyncEnd })
    await se.catchUp()
    expect(onSyncStart).toHaveBeenCalledTimes(1)
    expect(onSyncEnd).toHaveBeenCalledTimes(1)
  })

  // Пара не должна залипать: если /sync упал с ошибкой, «конец» обязан прийти
  // всё равно — иначе автомат витрины (Задача 3) навсегда застрянет в
  // «синхронизирую» (см. докблок onSyncEnd в syncEngine.ts).
  it('onSyncEnd still fires when the catch-up rejects (no stuck "synchronizing")', async () => {
    const rest = { get: vi.fn(async () => { throw new Error('network down') }) } as never
    const onSyncStart = vi.fn(); const onSyncEnd = vi.fn()
    const se = newSyncEngine({ rest, cursor: fakeCursor(), onUpdate: vi.fn(), onResync: vi.fn(), onSyncStart, onSyncEnd })
    await expect(se.catchUp()).rejects.toThrow('network down')
    expect(onSyncStart).toHaveBeenCalledTimes(1)
    expect(onSyncEnd).toHaveBeenCalledTimes(1)
    expect(se.isSyncing()).toBe(false)
  })

  // Вызовы catchUp() во время уже идущего прогона схлопываются в один run() (см.
  // `if (running) return running`) — start/end тоже должны быть по разу, а не по
  // разу на каждый вызов catchUp().
  it('concurrent catchUp() calls share one run — start/end still fire exactly once', async () => {
    let resolveGet: ((v: Page) => void) | null = null
    const rest = { get: vi.fn(() => new Promise<Page>((r) => { resolveGet = r })) } as never
    const onSyncStart = vi.fn(); const onSyncEnd = vi.fn()
    const se = newSyncEngine({ rest, cursor: fakeCursor(), onUpdate: vi.fn(), onResync: vi.fn(), onSyncStart, onSyncEnd })
    const p1 = se.catchUp()
    await vi.waitFor(() => expect(resolveGet).not.toBeNull())
    const p2 = se.catchUp()
    resolveGet!({ new_messages: [], other_updates: [], state: { pts: 0, date: 0 }, slice: false })
    await Promise.all([p1, p2])
    expect(onSyncStart).toHaveBeenCalledTimes(1)
    expect(onSyncEnd).toHaveBeenCalledTimes(1)
  })
})
