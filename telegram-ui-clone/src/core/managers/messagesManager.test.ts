// src/core/managers/messagesManager.test.ts
import { describe, it, expect } from 'vitest'
import { newMessagesManager } from './messagesManager'
import type { RestClient } from '../net/restClient'
import type { RawMessage } from '../models'

function rawPage(seqs: number[]): { messages: RawMessage[]; count: number } {
  // backend returns newest-first (DESC) for offset_id=0 / older pages
  const messages = seqs.map((seq) => ({
    id: seq, chat_id: 1, seq, sender_id: 1, type: 'text', text: `m${seq}`,
    reply_to_id: null, media_id: null, created_at: '2026-06-24T10:00:00Z',
  }))
  return { messages, count: messages.length }
}

function countingRest(pages: Record<string, { messages: RawMessage[]; count: number }>) {
  let calls = 0
  const rest = {
    get: async (_path: string, q?: Record<string, string | number>) => {
      calls++
      const key = `${q?.offset_id ?? 0}:${q?.add_offset ?? 0}:${q?.limit ?? 0}`
      return pages[key] ?? { messages: [], count: 0 }
    },
    post: async () => ({}),
  } as unknown as RestClient
  return { rest, calls: () => calls }
}

describe('MessagesManager.getHistory', () => {
  it('fetches the newest window and returns ascending messages', async () => {
    const { rest } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    const r = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    expect(r.messages.map((m) => m.seq)).toEqual([3, 4, 5]) // ascending for UI
    expect(r.count).toBe(3)
  })

  it('serves the second identical request from cache (no extra REST call)', async () => {
    const { rest, calls } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    expect(calls()).toBe(1)
  })

  it('reports reachedTop when an older page is short', async () => {
    const { rest } = countingRest({
      '0:0:40': rawPage([5, 4, 3, 2, 1]),
      '1:1:40': rawPage([1]), // older inclusive of 1 → just [1] (< limit)
    })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const older = await mgr.getHistory({ chatId: 1, offsetSeq: 1, addOffset: 1, limit: 40 })
    expect(older.reachedTop).toBe(true)
  })

  // Regression: re-opening a chat (cached newest page of exactly `limit`) must
  // NOT report reachedTop — the real top isn't reached, so scroll-up paging
  // stays enabled. (Previously `fulfilled` conflated page-satisfied with top.)
  it('does not report reachedTop on re-open when only the newest page is cached', async () => {
    const { rest } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    const first = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    expect(first.reachedTop).toBe(false)
    // simulate re-open: identical initial request, now served from cache
    const reopen = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    expect(reopen.reachedBottom).toBe(true)
    expect(reopen.reachedTop).toBe(false)
  })
})

describe('MessagesManager.sendMessage', () => {
  it('POSTs and returns the created message, caching it', async () => {
    const created: RawMessage = {
      id: 10, chat_id: 1, seq: 6, sender_id: 1, type: 'text', text: 'hey',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T11:00:00Z',
    }
    const rest = { post: async () => created, get: async () => ({ messages: [], count: 0 }) } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const m = await mgr.sendMessage({ chatId: 1, text: 'hey', clientMsgId: 'c1' })
    expect(m.seq).toBe(6)
    expect(m.text).toBe('hey')
  })
})
