// `chats.deleteHistory` — «удалить чат» лички и «Избранного» (tweb
// `flushHistory({justClear: false, revoke})` → `messages.deleteHistory` без
// `just_clear`): `DELETE /chats/{peer}/history`, `revoke=1` — и у собеседника.
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { RestClient } from '../net/restClient'
import { newChatsManager } from './chatsManager'

describe('chatsManager.deleteHistory', () => {
  const setup = () => {
    const del = vi.fn(async (_path: string) => ({}))
    return { del, mgr: newChatsManager({ rest: { del } as unknown as RestClient }) }
  }

  it('только у себя — без параметра revoke', async () => {
    const { del, mgr } = setup()
    await mgr.deleteHistory(42, false)
    expect(del).toHaveBeenCalledWith('/chats/42/history')
  })

  it('и у собеседника — revoke=1', async () => {
    const { del, mgr } = setup()
    await mgr.deleteHistory(42, true)
    expect(del).toHaveBeenCalledWith('/chats/42/history?revoke=1')
  })
})
