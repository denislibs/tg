// src/core/managers/channelsManager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { newChannelsManager } from './channelsManager'
import type { RestClient } from '../net/restClient'
import type { RawMessage } from '../models'
import { idbGet, idbSet } from '../store/idbKv'

vi.mock('../store/idbKv', () => ({
  idbGet: vi.fn(async () => 0),
  idbSet: vi.fn(async () => {}),
}))

beforeEach(() => {
  vi.mocked(idbGet).mockClear()
  vi.mocked(idbSet).mockClear()
  vi.mocked(idbGet).mockResolvedValue(0 as never)
})

function raw(seq: number): RawMessage {
  return {
    id: seq, chat_id: 7, seq, sender_id: 1, type: 'text', text: `m${seq}`,
    reply_to_id: null, media_id: null, created_at: '2026-06-24T10:00:00Z',
  }
}

describe('ChannelsManager.createChannel', () => {
  it('POSTs /channels and returns the new chat id', async () => {
    const post = vi.fn(async () => ({ chat_id: 42 }))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const mgr = newChannelsManager({ rest })
    const id = await mgr.createChannel({ title: 'News', isPublic: true })
    expect(id).toBe(42)
    expect(post).toHaveBeenCalledWith('/channels', { title: 'News', about: '', username: '', is_public: true })
  })
})

describe('ChannelsManager.post', () => {
  it('POSTs /channels/{id}/messages and returns a mapped Message', async () => {
    const post = vi.fn(async () => raw(6))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const mgr = newChannelsManager({ rest })
    const m = await mgr.post(7, 'hey', 'c1')
    expect(post).toHaveBeenCalledWith('/channels/7/messages', { text: 'hey', client_msg_id: 'c1' })
    expect(m.chatId).toBe(7)
    expect(m.seq).toBe(6)
    expect(m.text).toBe('m6')
  })
})

describe('ChannelsManager.getDifference', () => {
  it('reads stored pts, GETs difference, returns ascending and persists new pts', async () => {
    vi.mocked(idbGet).mockResolvedValue(3 as never)
    const get = vi.fn(async () => ({ updates: [raw(6), raw(4), raw(5)], pts: 6 }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest })
    const msgs = await mgr.getDifference(7)
    expect(idbGet).toHaveBeenCalledWith('chpts:7')
    expect(get).toHaveBeenCalledWith('/channels/7/difference', { pts: 3 })
    expect(msgs.map((m) => m.seq)).toEqual([4, 5, 6])
    expect(idbSet).toHaveBeenCalledWith('chpts:7', 6)
  })
})

describe('ChannelsManager.enableDiscussion', () => {
  it('POSTs /channels/{id}/discussion and returns discussion_chat_id', async () => {
    const post = vi.fn(async () => ({ discussion_chat_id: 555 }))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const mgr = newChannelsManager({ rest })
    const id = await mgr.enableDiscussion(7)
    expect(post).toHaveBeenCalledWith('/channels/7/discussion', {})
    expect(id).toBe(555)
  })
})

describe('ChannelsManager.postComment', () => {
  it('POSTs comment and returns a mapped Message with threadRootId', async () => {
    const post = vi.fn(async () => ({ ...raw(9), thread_root_id: 3 }))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const mgr = newChannelsManager({ rest })
    const m = await mgr.postComment(7, 3, 'hi', 'c2')
    expect(post).toHaveBeenCalledWith('/channels/7/posts/3/comments', { text: 'hi', client_msg_id: 'c2' })
    expect(m.seq).toBe(9)
    expect(m.threadRootId).toBe(3)
  })
})

describe('ChannelsManager.listComments', () => {
  it('GETs comments and maps {messages,count}', async () => {
    const get = vi.fn(async () => ({ messages: [raw(1), raw(2)], count: 2 }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest })
    const r = await mgr.listComments(7, 3)
    expect(get).toHaveBeenCalledWith('/channels/7/posts/3/comments', { offset: 0, limit: 50 })
    expect(r.count).toBe(2)
    expect(r.messages.map((m) => m.seq)).toEqual([1, 2])
    expect(r.messages[0].threadRootId).toBeNull()
  })

  it('handles missing messages array', async () => {
    const get = vi.fn(async () => ({ count: 0 }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest })
    const r = await mgr.listComments(7, 3)
    expect(r.messages).toEqual([])
  })
})

describe('ChannelsManager.commentCounts', () => {
  it('GETs comment_counts and maps string keys to numbers', async () => {
    const get = vi.fn(async () => ({ counts: { '5': 2, '6': 0 } }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest })
    const r = await mgr.commentCounts(7, [5, 6])
    expect(get).toHaveBeenCalledWith('/channels/7/comment_counts', { ids: '5,6' })
    expect(r).toEqual({ 5: 2, 6: 0 })
  })

  it('short-circuits empty ids without hitting REST', async () => {
    const get = vi.fn()
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest })
    const r = await mgr.commentCounts(7, [])
    expect(r).toEqual({})
    expect(get).not.toHaveBeenCalled()
  })
})

describe('ChannelsManager.search', () => {
  it('short-circuits an empty query without hitting REST', async () => {
    const get = vi.fn()
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest })
    const r = await mgr.search('   ')
    expect(r).toEqual({ chats: [], users: [] })
    expect(get).not.toHaveBeenCalled()
  })

  it('GETs /search and maps snake_case to camelCase', async () => {
    const get = vi.fn(async () => ({
      chats: [{ id: 1, type: 'channel', title: 'News', username: 'news', member_count: 99 }],
      users: [{ id: 2, username: 'bob', display_name: 'Bob', avatar_url: 'u/2' }],
    }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest })
    const r = await mgr.search('news')
    expect(get).toHaveBeenCalledWith('/search', { q: 'news' })
    expect(r.chats[0]).toEqual({ id: 1, type: 'channel', title: 'News', username: 'news', memberCount: 99 })
    expect(r.users[0]).toEqual({ id: 2, username: 'bob', displayName: 'Bob', avatarUrl: 'u/2' })
  })
})
