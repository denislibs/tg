// `chats.unpinAllMessages` — порт tweb `unpinAllMessages` (`appMessagesManager.ts:6858-6893`):
// `DELETE /chats/{peer}/pins` отвечает `messages.affectedHistory`; ответ становится местным
// `updatePts` воронки, при `offset` запрос повторяется, затем закрепы снимаются в окнах чата.
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { MessagesAffectedHistory } from '@layer'
import type { RestClient } from '../net/restClient'
import { generateMessageId } from '../history/messageId'
import { newChatsManager } from './chatsManager'

const affected = (pts: number, pts_count: number, offset = 0): MessagesAffectedHistory =>
  ({ _: 'messages.affectedHistory', pts, pts_count, offset })

describe('chatsManager.unpinAllMessages', () => {
  const setup = (answers: MessagesAffectedHistory[] = [affected(13, 1)]) => {
    const calls: string[] = []
    const queue = [...answers]
    const del = vi.fn(async (path: string) => { calls.push(`del ${path}`); return queue.shift() ?? answers[answers.length - 1] })
    const applyLocalPts = vi.fn((pts: number, count: number) => { calls.push(`pts ${pts}/${count}`) })
    const cacheUnpinAll = vi.fn((peerId: number, threadId?: number) => { calls.push(`local ${peerId}/${threadId ?? '-'}`); return [] })
    const broadcast = vi.fn((event: string, payload: unknown) => { calls.push(`broadcast ${event} ${JSON.stringify(payload)}`) })
    const mgr = newChatsManager({
      rest: { del } as unknown as RestClient,
      getFunnel: () => ({ applyLocalPts }),
      messages: { cacheUnpinAll } as never,
      broadcast,
    })
    return { mgr, calls, del, applyLocalPts, cacheUnpinAll, broadcast }
  }

  it('один DELETE без top_msg_id, местный updatePts, затем локальное снятие закрепов', async () => {
    const { mgr, calls } = setup()
    await expect(mgr.unpinAllMessages(42)).resolves.toBe(true)
    expect(calls).toEqual(['del /chats/42/pins', 'pts 13/1', 'local 42/-', 'broadcast peer_unpinned_all {"peerId":42}'])
  })

  it('тема: top_msg_id — серверный номер, локальное снятие с клиентским threadId', async () => {
    const { mgr, calls } = setup()
    const threadId = generateMessageId(7)
    await mgr.unpinAllMessages(42, threadId)
    expect(calls).toEqual(['del /chats/42/pins?top_msg_id=7', 'pts 13/1', `local 42/${threadId}`, `broadcast peer_unpinned_all {"peerId":42,"threadId":${threadId}}`])
  })

  it('offset > 0 — запрос повторяется (tweb :6890), каждый ответ идёт в воронку, локально — один раз в конце', async () => {
    const { mgr, del, applyLocalPts, cacheUnpinAll } = setup([affected(11, 1, 5), affected(14, 1)])
    await mgr.unpinAllMessages(42)
    expect(del).toHaveBeenCalledTimes(2)
    expect(applyLocalPts.mock.calls).toEqual([[11, 1], [14, 1]])
    expect(cacheUnpinAll).toHaveBeenCalledTimes(1)
  })

  it('pts_count 0 (канал, нечего снимать) — воронка получает вызов, сама решает no-op', async () => {
    const { mgr, applyLocalPts } = setup([affected(9, 0)])
    await mgr.unpinAllMessages(42)
    expect(applyLocalPts).toHaveBeenCalledWith(9, 0)
  })

  it('отказ сервера: воронка и окна не тронуты', async () => {
    const applyLocalPts = vi.fn()
    const cacheUnpinAll = vi.fn()
    const broadcast = vi.fn()
    const mgr = newChatsManager({
      rest: { del: vi.fn(async () => { throw new Error('403') }) } as unknown as RestClient,
      getFunnel: () => ({ applyLocalPts }),
      messages: { cacheUnpinAll } as never,
      broadcast,
    })
    await expect(mgr.unpinAllMessages(42)).rejects.toThrow('403')
    expect(applyLocalPts).not.toHaveBeenCalled()
    expect(cacheUnpinAll).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })
})
