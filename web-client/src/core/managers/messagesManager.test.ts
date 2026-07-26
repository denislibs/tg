// src/core/managers/messagesManager.test.ts
import { describe, it, expect } from 'vitest'
import { newMessagesManager } from './messagesManager'
import type { RestClient } from '../net/restClient'
import type { RawMessage } from '../models'
import type { NewMessageEvt } from '../realtime/events'

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

  it('forwards reply_to_peer_id for a cross-chat reply', async () => {
    let body: Record<string, unknown> = {}
    const created: RawMessage = {
      id: 10, chat_id: 1, seq: 6, sender_id: 1, type: 'text', text: 'hey',
      reply_to_id: 5, media_id: null, created_at: '2026-06-24T11:00:00Z',
    }
    const rest = { post: async (_p: string, b: Record<string, unknown>) => { body = b; return created } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    await mgr.sendMessage({ chatId: 1, text: 'hey', clientMsgId: 'c1', replyToId: 5, replyToPeerId: 99 })
    expect(body.reply_to_id).toBe(5)
    expect(body.reply_to_peer_id).toBe(99)
  })
})

describe('MessagesManager scheduled', () => {
  const rawScheduled = (over: Record<string, unknown> = {}) => ({
    id: 1, chat_id: 1, sender_id: 1, type: 'text', text: 'later',
    send_at: '2026-07-20T10:00:00Z', created_at: '2026-07-19T10:00:00Z', ...over,
  })

  it('sends when_online=true and maps the whenOnline flag', async () => {
    let body: Record<string, unknown> = {}
    const rest = { post: async (_p: string, b: Record<string, unknown>) => { body = b; return rawScheduled({ when_online: true }) } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const s = await mgr.scheduleMessage(1, { text: 'later', sendAt: 0, whenOnline: true })
    expect(body.when_online).toBe(true)
    expect(s.whenOnline).toBe(true)
  })

  it('defaults when_online to false for a dated schedule', async () => {
    let body: Record<string, unknown> = {}
    const rest = { post: async (_p: string, b: Record<string, unknown>) => { body = b; return rawScheduled() } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const s = await mgr.scheduleMessage(1, { text: 'later', sendAt: 1_800_000_000 })
    expect(body.when_online).toBe(false)
    expect(s.whenOnline).toBe(false)
  })

  it('editScheduled PATCHes the new send_at and returns the updated record', async () => {
    let path = ''
    let body: Record<string, unknown> = {}
    const rest = { patch: async (p: string, b: Record<string, unknown>) => { path = p; body = b; return rawScheduled({ send_at: '2026-07-21T09:00:00Z' }) } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const s = await mgr.editScheduled(1, 7, 1_800_000_500)
    expect(path).toBe('/chats/1/scheduled/7')
    expect(body.send_at).toBe(1_800_000_500)
    expect(s.sendAt).toBe('2026-07-21T09:00:00Z')
  })
})

describe('MessagesManager.cacheLive', () => {
  // Регресс Bug 4: снимок кросс-чат-reply должен пережить кэш — иначе при
  // переоткрытии чата из кэша превью кросс-чат-ответа не рисуется.
  it('preserves cross-chat reply snapshot in the cache entry', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    mgr.cacheLive({
      chat_id: 1, msg_id: 4, seq: 4, sender_id: 1, type: 'text', text: 'ответ',
      media_id: null, created_at: '2026-06-24T10:00:00Z',
      reply_to_id: 999, reply_to_peer_id: 77,
      reply_snapshot_name: 'Алиса', reply_snapshot_text: 'из другого чата',
    } as NewMessageEvt)
    const r = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const live = r.messages.find((m) => m.id === 4)
    expect(live).toBeTruthy()
    expect(live?.replyToPeerId).toBe(77)
    expect(live?.replySnapshotName).toBe('Алиса')
    expect(live?.replySnapshotText).toBe('из другого чата')
  })
})
