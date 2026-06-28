// src/core/realtime/syncEngine.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newSyncEngine } from './syncEngine'

function fakeRest(pages: Array<{ new_messages: unknown[]; other_updates: unknown[]; state: { pts: number; date: number }; slice: boolean; too_long?: boolean }>) {
  let i = 0
  return { get: vi.fn(async () => pages[i++]) } as never
}
const mem = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v) } }

describe('SyncEngine.catchUp', () => {
  it('drains slices, dispatches updates, advances + persists pts', async () => {
    const rest = fakeRest([
      { new_messages: [{ msg_id: 1 }], other_updates: [], state: { pts: 5, date: 10 }, slice: true },
      { new_messages: [{ msg_id: 2 }], other_updates: [{ up_to_seq: 3, chat_id: 1, user_id: 2 }], state: { pts: 9, date: 11 }, slice: false },
    ])
    const onNew = vi.fn(); const onOther = vi.fn(); const onResync = vi.fn()
    const store = mem()
    const se = newSyncEngine({ rest, store, onNewMessage: onNew, onOtherUpdate: onOther, onResync })
    await se.catchUp()
    expect(onNew).toHaveBeenCalledTimes(2)
    expect(onOther).toHaveBeenCalledTimes(1)
    expect(await store.get('pts')).toBe(9)
    expect(onResync).not.toHaveBeenCalled()
  })

  it('triggers onResync on too_long and stops', async () => {
    const rest = fakeRest([{ new_messages: [], other_updates: [], state: { pts: 0, date: 0 }, slice: false, too_long: true }])
    const onResync = vi.fn()
    const se = newSyncEngine({ rest, store: mem(), onNewMessage: vi.fn(), onOtherUpdate: vi.fn(), onResync })
    await se.catchUp()
    expect(onResync).toHaveBeenCalledTimes(1)
  })
})
