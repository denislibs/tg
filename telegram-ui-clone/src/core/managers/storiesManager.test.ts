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
        stories: [{ id: 1, mediaId: 11, caption: 'hi', createdAt: 't0', viewed: false }],
      },
      {
        author: { id: 2, displayName: 'Bob', avatarUrl: 'bob.png' },
        stories: [{ id: 2, mediaId: 22, caption: '', createdAt: 't1', viewed: true }],
      },
    ])
  })

  it('feed tolerates a missing groups array', async () => {
    const { rest } = fakeRest({})
    const mgr = newStoriesManager({ rest })
    expect(await mgr.feed()).toEqual([])
  })

  it('post POSTs /stories with snake_case body and returns id', async () => {
    const { rest, calls } = fakeRest({}, { id: 99 })
    const mgr = newStoriesManager({ rest })
    const id = await mgr.post({ mediaId: 11, caption: 'cap', privacy: 'contacts', allowIds: [2, 3] })
    expect(id).toBe(99)
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/stories',
      body: { media_id: 11, caption: 'cap', privacy: 'contacts', allow_user_ids: [2, 3] },
    })
  })

  it('post applies defaults for caption/privacy/allowIds', async () => {
    const { rest, calls } = fakeRest({}, { id: 1 })
    const mgr = newStoriesManager({ rest })
    await mgr.post({ mediaId: 5 })
    expect(calls[0].body).toEqual({ media_id: 5, caption: '', privacy: 'contacts', allow_user_ids: [] })
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
})
