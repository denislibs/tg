// src/core/managers/storiesManager.test.ts
import { describe, it, expect } from 'vitest'
import { newStoriesManager } from './storiesManager'
import type { RestClient } from '../net/restClient'

function fakeRest(getResult: unknown, postResult: unknown = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const rest = {
    async get<R>(path: string): Promise<R> {
      calls.push({ method: 'GET', path })
      return getResult as R
    },
    async post<R>(path: string, body: unknown): Promise<R> {
      calls.push({ method: 'POST', path, body })
      return postResult as R
    },
    async del<R>(path: string): Promise<R> {
      calls.push({ method: 'DELETE', path })
      return undefined as R
    },
  } as unknown as RestClient
  return { rest, calls }
}

describe('StoriesManager', () => {
  it('feed maps groups snake->camel (own group first)', async () => {
    const { rest, calls } = fakeRest({
      groups: [
        {
          author: { id: 7, display_name: 'Me', avatar_url: 'me.png' },
          stories: [{ id: 1, media_id: 11, caption: 'hi', created_at: 't0', viewed: false }],
        },
        {
          author: { id: 2, display_name: 'Bob', avatar_url: 'bob.png' },
          stories: [{ id: 2, media_id: 22, caption: '', created_at: 't1', viewed: true }],
        },
      ],
    })
    const mgr = newStoriesManager({ rest })
    const groups = await mgr.feed()
    expect(calls[0]).toEqual({ method: 'GET', path: '/stories' })
    expect(groups).toEqual([
      {
        author: { id: 7, displayName: 'Me', avatarUrl: 'me.png' },
        stories: [{ id: 1, mediaId: 11, caption: 'hi', createdAt: 't0', viewed: false, reactionsCount: 0, myReaction: null, reactions: [] }],
      },
      {
        author: { id: 2, displayName: 'Bob', avatarUrl: 'bob.png' },
        stories: [{ id: 2, mediaId: 22, caption: '', createdAt: 't1', viewed: true, reactionsCount: 0, myReaction: null, reactions: [] }],
      },
    ])
  })

  it('feed maps reaction fields (reactions_count/my_reaction/reactions)', async () => {
    const { rest } = fakeRest({
      groups: [
        {
          author: { id: 2, display_name: 'Bob', avatar_url: '' },
          stories: [{
            id: 5, media_id: 50, caption: '', created_at: 't', viewed: false,
            reactions_count: 3, my_reaction: '❤',
            reactions: [{ emoji: '❤', count: 2, mine: true }, { emoji: '🔥', count: 1, mine: false }],
          }],
        },
      ],
    })
    const mgr = newStoriesManager({ rest })
    const groups = await mgr.feed()
    expect(groups[0].stories[0]).toEqual({
      id: 5, mediaId: 50, caption: '', createdAt: 't', viewed: false,
      reactionsCount: 3, myReaction: '❤',
      reactions: [{ emoji: '❤', count: 2, mine: true }, { emoji: '🔥', count: 1, mine: false }],
    })
  })

  it('feed tolerates a missing groups array', async () => {
    const { rest } = fakeRest({})
    const mgr = newStoriesManager({ rest })
    expect(await mgr.feed()).toEqual([])
  })

  it('post POSTs /stories with snake_case body (incl. period) and returns id', async () => {
    const { rest, calls } = fakeRest({}, { id: 99 })
    const mgr = newStoriesManager({ rest })
    const id = await mgr.post({ mediaId: 11, caption: 'cap', privacy: 'contacts', allowIds: [2, 3], period: 43200 })
    expect(id).toBe(99)
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/stories',
      body: { media_id: 11, caption: 'cap', privacy: 'contacts', allow_user_ids: [2, 3], period: 43200 },
    })
  })

  it('post applies defaults for caption/privacy/allowIds/period (24h)', async () => {
    const { rest, calls } = fakeRest({}, { id: 1 })
    const mgr = newStoriesManager({ rest })
    await mgr.post({ mediaId: 5 })
    expect(calls[0].body).toEqual({ media_id: 5, caption: '', privacy: 'contacts', allow_user_ids: [], period: 86400 })
  })

  it('setReaction POSTs /stories/:id/reaction and removeReaction DELETEs it', async () => {
    const { rest, calls } = fakeRest({}, { ok: true })
    const mgr = newStoriesManager({ rest })
    await mgr.setReaction(7, '🔥')
    await mgr.removeReaction(7)
    expect(calls[0]).toEqual({ method: 'POST', path: '/stories/7/reaction', body: { reaction: '🔥' } })
    expect(calls[1]).toEqual({ method: 'DELETE', path: '/stories/7/reaction' })
  })

  it('view POSTs /stories/:id/view', async () => {
    const { rest, calls } = fakeRest({})
    const mgr = newStoriesManager({ rest })
    await mgr.view(42)
    expect(calls[0]).toEqual({ method: 'POST', path: '/stories/42/view', body: {} })
  })

  it('viewers maps snake->camel', async () => {
    const { rest, calls } = fakeRest({
      viewers: [{ id: 2, display_name: 'Bob', avatar_url: 'bob.png' }],
      count: 1,
    })
    const mgr = newStoriesManager({ rest })
    const viewers = await mgr.viewers(42)
    expect(calls[0]).toEqual({ method: 'GET', path: '/stories/42/viewers' })
    expect(viewers).toEqual([{ id: 2, displayName: 'Bob', avatarUrl: 'bob.png' }])
  })

  it('del DELETEs /stories/:id', async () => {
    const { rest, calls } = fakeRest({})
    const mgr = newStoriesManager({ rest })
    await mgr.del(42)
    expect(calls[0]).toEqual({ method: 'DELETE', path: '/stories/42' })
  })

  it('stats GETs /stories/:id/stats and maps snake->camel (incl. reactions)', async () => {
    const { rest, calls } = fakeRest({
      views: 12, views_by_day: [{ date: '2026-01-02', value: 12 }],
      reactions_total: 4, reactions: [{ emoji: '❤', count: 3 }, { emoji: '🔥', count: 1 }],
    })
    const mgr = newStoriesManager({ rest })
    const stats = await mgr.stats(42)
    expect(calls[0]).toEqual({ method: 'GET', path: '/stories/42/stats' })
    expect(stats).toEqual({
      views: 12, viewsByDay: [{ date: '2026-01-02', value: 12 }],
      reactionsTotal: 4, reactions: [{ emoji: '❤', count: 3 }, { emoji: '🔥', count: 1 }],
    })
  })

  it('stats tolerates missing series/reaction arrays', async () => {
    const { rest } = fakeRest({ views: 0 })
    const mgr = newStoriesManager({ rest })
    expect(await mgr.stats(1)).toEqual({ views: 0, viewsByDay: [], reactionsTotal: 0, reactions: [] })
  })
})
