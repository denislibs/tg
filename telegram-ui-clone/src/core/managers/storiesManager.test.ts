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
    async put<R>(path: string, body: unknown): Promise<R> {
      calls.push({ method: 'PUT', path, body })
      return postResult as R
    },
    async patch<R>(path: string, body: unknown): Promise<R> {
      calls.push({ method: 'PATCH', path, body })
      return postResult as R
    },
    async del<R>(path: string): Promise<R> {
      calls.push({ method: 'DELETE', path })
      return undefined as R
    },
  } as unknown as RestClient
  return { rest, calls }
}

// Полный набор дефолтных полей истории после mapStory (для сравнения объектов).
const dflt = { reactionsCount: 0, myReaction: null, reactions: [], privacy: 'contacts', pinned: false, edited: false, expiresAt: '', mediaAreas: [] }

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
        stories: [{ id: 1, mediaId: 11, caption: 'hi', createdAt: 't0', viewed: false, ...dflt }],
      },
      {
        author: { id: 2, displayName: 'Bob', avatarUrl: 'bob.png' },
        stories: [{ id: 2, mediaId: 22, caption: '', createdAt: 't1', viewed: true, ...dflt }],
      },
    ])
  })

  it('feed maps 4c fields (privacy/pinned/edited/expires_at)', async () => {
    const { rest } = fakeRest({
      groups: [{
        author: { id: 7, display_name: 'Me', avatar_url: '' },
        stories: [{ id: 9, media_id: 90, caption: 'c', created_at: 't', viewed: false, privacy: 'close', pinned: true, edited: true, expires_at: 'tE' }],
      }],
    })
    const mgr = newStoriesManager({ rest })
    const groups = await mgr.feed()
    expect(groups[0].stories[0]).toMatchObject({ privacy: 'close', pinned: true, edited: true, expiresAt: 'tE' })
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
      privacy: 'contacts', pinned: false, edited: false, expiresAt: '', mediaAreas: [],
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
      body: { media_id: 11, caption: 'cap', privacy: 'contacts', allow_user_ids: [2, 3], period: 43200, media_areas: [] },
    })
  })

  it('post applies defaults for caption/privacy/allowIds/period (24h)', async () => {
    const { rest, calls } = fakeRest({}, { id: 1 })
    const mgr = newStoriesManager({ rest })
    await mgr.post({ mediaId: 5 })
    expect(calls[0].body).toEqual({ media_id: 5, caption: '', privacy: 'contacts', allow_user_ids: [], period: 86400, media_areas: [] })
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

  it('closeFriends GETs /me/close_friends → ids; setCloseFriends PUTs body', async () => {
    const { rest, calls } = fakeRest({ user_ids: [2, 3] }, { ok: true })
    const mgr = newStoriesManager({ rest })
    expect(await mgr.closeFriends()).toEqual([2, 3])
    expect(calls[0]).toEqual({ method: 'GET', path: '/me/close_friends' })
    await mgr.setCloseFriends([4, 5])
    expect(calls[1]).toEqual({ method: 'PUT', path: '/me/close_friends', body: { user_ids: [4, 5] } })
  })

  it('stealthState/activateStealth map snake->camel (null when unset)', async () => {
    const { rest, calls } = fakeRest(
      { active_until: null, cooldown_until: null },
      { active_until: '2026-01-01T00:25:00Z', cooldown_until: '2026-01-01T01:00:00Z' },
    )
    const mgr = newStoriesManager({ rest })
    expect(await mgr.stealthState()).toEqual({ activeUntil: null, cooldownUntil: null })
    expect(calls[0]).toEqual({ method: 'GET', path: '/stories/stealth' })
    const s = await mgr.activateStealth()
    expect(s).toEqual({ activeUntil: '2026-01-01T00:25:00Z', cooldownUntil: '2026-01-01T01:00:00Z' })
    expect(calls[1]).toEqual({ method: 'POST', path: '/stories/stealth/activate', body: {} })
  })

  it('archive GETs /stories/archive with query and maps items', async () => {
    const { rest, calls } = fakeRest({ stories: [{ id: 1, media_id: 10, caption: '', created_at: 't', viewed: true }] })
    const mgr = newStoriesManager({ rest })
    const items = await mgr.archive(20, 5)
    expect(calls[0]).toEqual({ method: 'GET', path: '/stories/archive?limit=20&offset_id=5' })
    expect(items[0]).toMatchObject({ id: 1, mediaId: 10 })
    // no args → bare path
    await mgr.archive()
    expect(calls[1].path).toBe('/stories/archive')
  })

  it('pin POSTs /stories/:id/pin; pinnedStories GETs by peer', async () => {
    const { rest, calls } = fakeRest({ stories: [] }, { ok: true })
    const mgr = newStoriesManager({ rest })
    await mgr.pin(7, true)
    expect(calls[0]).toEqual({ method: 'POST', path: '/stories/7/pin', body: { pinned: true } })
    await mgr.pinnedStories(42)
    expect(calls[1]).toEqual({ method: 'GET', path: '/stories/pinned?peer=42' })
  })

  it('editStory PATCHes /stories/:id with only provided fields', async () => {
    const { rest, calls } = fakeRest({}, { ok: true })
    const mgr = newStoriesManager({ rest })
    await mgr.editStory(7, { caption: 'x', privacy: 'selected', allowIds: [2] })
    expect(calls[0]).toEqual({ method: 'PATCH', path: '/stories/7', body: { caption: 'x', privacy: 'selected', allow_user_ids: [2] } })
    // omitted fields absent from body
    await mgr.editStory(7, { caption: 'only' })
    expect(calls[1].body).toEqual({ caption: 'only' })
  })

  // 4d
  it('feed maps media_areas and fwd_from', async () => {
    const { rest } = fakeRest({
      groups: [{
        author: { id: 2, display_name: 'Bob', avatar_url: '' },
        stories: [{
          id: 5, media_id: 50, caption: '', created_at: 't', viewed: false,
          media_areas: [{ type: 'reaction', coordinates: { x: 50, y: 78, w: 22, h: 12, rotation: 0 }, reaction: '❤' }],
          fwd_from: { author_id: 9, story_id: 3 },
        }],
      }],
    })
    const mgr = newStoriesManager({ rest })
    const groups = await mgr.feed()
    expect(groups[0].stories[0].mediaAreas).toEqual([{ type: 'reaction', coordinates: { x: 50, y: 78, w: 22, h: 12, rotation: 0 }, reaction: '❤' }])
    expect(groups[0].stories[0].fwdFrom).toEqual({ authorId: 9, storyId: 3 })
  })

  it('post passes media_areas', async () => {
    const { rest, calls } = fakeRest({}, { id: 1 })
    const mgr = newStoriesManager({ rest })
    const areas = [{ type: 'reaction' as const, coordinates: { x: 50, y: 78, w: 22, h: 12, rotation: 0 }, reaction: '👍' }]
    await mgr.post({ mediaId: 5, mediaAreas: areas })
    expect(calls[0].body).toMatchObject({ media_areas: areas })
  })

  it('repost POSTs /stories/repost with source + returns id', async () => {
    const { rest, calls } = fakeRest({}, { id: 77 })
    const mgr = newStoriesManager({ rest })
    const id = await mgr.repost({ sourceAuthorId: 2, sourceStoryId: 5, caption: 'c', privacy: 'contacts', period: 43200 })
    expect(id).toBe(77)
    expect(calls[0]).toEqual({
      method: 'POST', path: '/stories/repost',
      body: { source_author_id: 2, source_story_id: 5, caption: 'c', privacy: 'contacts', allow_user_ids: [], period: 43200 },
    })
  })

  it('share POSTs /stories/:id/share and returns sent count', async () => {
    const { rest, calls } = fakeRest({}, { sent: 2 })
    const mgr = newStoriesManager({ rest })
    const n = await mgr.share(7, [10, 11])
    expect(n).toBe(2)
    expect(calls[0]).toEqual({ method: 'POST', path: '/stories/7/share', body: { chat_ids: [10, 11] } })
  })
})
