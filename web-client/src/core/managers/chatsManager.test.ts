// src/core/managers/chatsManager.test.ts
import { describe, it, expect } from 'vitest'
import { newChatsManager } from './chatsManager'
import type { RestClient } from '../net/restClient'

function fakeRest(payload: unknown): RestClient {
  return { get: async () => payload } as unknown as RestClient
}

describe('ChatsManager', () => {
  it('listDialogs maps GET /chats payload', async () => {
    const rest = fakeRest({
      chats: [
        { chat_id: 1, type: 'private', last_read_seq: 4, unread: 0, muted: false,
          peer: { id: 2, display_name: 'Bob', avatar_url: '' },
          last_message: { seq: 4, text: 'hi', sender_id: 2, at: '2026-06-24T10:00:00Z' } },
      ],
    })
    const mgr = newChatsManager({ rest })
    const dialogs = await mgr.listDialogs()
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0].peer?.displayName).toBe('Bob')
    expect(dialogs[0].chatId).toBe(1)
  })

  it('listDialogs tolerates an empty/absent chats array', async () => {
    const mgr = newChatsManager({ rest: fakeRest({}) })
    expect(await mgr.listDialogs()).toEqual([])
  })
})
