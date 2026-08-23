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

const ME = { _: 'user' as const, id: 7, first_name: 'Me', photo: { _: 'userProfilePhoto' as const, photo_id: 1 } }
const BOB = { _: 'user' as const, id: 2, first_name: 'Bob', photo: { _: 'userProfilePhoto' as const, photo_id: 2 } }

// История на проводе — КОНСТРУКТОР `storyItem`; маппера у менеджера нет, поэтому
// сравнивать можно ровно то, что пришло.
const media = { _: 'messageMediaPhoto' as const, photo: { _: 'photo' as const, id: 11, sizes: [] } }
const story = (id: number, over: Record<string, unknown> = {}) => ({
  _: 'storyItem' as const, id, date: 1787334148, expire_date: 1787420548, media, ...over,
})

// Контейнер `stories.allStories`: группы ССЫЛАЮТСЯ на автора, карточки едут
// вектором `users`.
const peerUser = (id: number) => ({ _: 'peerUser' as const, user_id: id })

describe('StoriesManager', () => {
  it('feed разрешает ССЫЛКУ на автора по вектору `users` контейнера', async () => {
    const { rest, calls } = fakeRest({
      _: 'stories.allStories',
      peer_stories: [
        { _: 'peerStories', peer: peerUser(7), stories: [story(1, { caption: 'hi' })] },
        // Горизонт — свойство ГРУППЫ: один номер на автора.
        { _: 'peerStories', peer: peerUser(2), max_read_id: 3, stories: [story(2)] },
      ],
      users: [ME, BOB],
      chats: [],
    })
    const mgr = newStoriesManager({ rest })
    const groups = await mgr.feed()
    expect(calls[0]).toEqual({ method: 'GET', path: '/stories' })
    // Истории кладутся ВЕРБАТИМ: маппера у менеджера нет.
    expect(groups).toEqual([
      { author: ME, stories: [story(1, { caption: 'hi' })], maxReadId: 0 },
      { author: BOB, stories: [story(2)], maxReadId: 3 },
    ])
  })

  it('feed отбрасывает группу, чьей карточки в векторе `users` нет', async () => {
    const { rest } = fakeRest({
      peer_stories: [
        { _: 'peerStories', peer: peerUser(7), stories: [story(1)] },
        { _: 'peerStories', peer: peerUser(404), stories: [story(2)] },
      ],
      users: [ME],
    })
    const mgr = newStoriesManager({ rest })
    const groups = await mgr.feed()
    // Показать историю без автора хуже, чем не показать её вовсе.
    expect(groups.map((g) => g.author.id)).toEqual([7])
  })

  it('feed tolerates a missing peer_stories array', async () => {
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
    await mgr.setReaction(2, 7, '🔥')
    await mgr.removeReaction(2, 7)
    expect(calls[0]).toEqual({ method: 'POST', path: '/stories/2/7/reaction', body: { reaction: '🔥' } })
    expect(calls[1]).toEqual({ method: 'DELETE', path: '/stories/2/7/reaction' })
  })

  it('view POSTs /stories/:id/view', async () => {
    const { rest, calls } = fakeRest({})
    const mgr = newStoriesManager({ rest })
    await mgr.view(2, 42)
    expect(calls[0]).toEqual({ method: 'POST', path: '/stories/2/42/view', body: {} })
  })

  it('viewers отдаёт контейнер: просмотр и карточка — РАЗНЫМИ векторами', async () => {
    const view = { _: 'storyView' as const, user_id: 2, date: 1787334148, reaction: { _: 'reactionEmoji' as const, emoticon: '❤' } }
    const { rest, calls } = fakeRest({ _: 'stories.storyViewsList', count: 1, views: [view], users: [BOB] })
    const mgr = newStoriesManager({ rest })
    const list = await mgr.viewers(2, 42)
    expect(calls[0]).toEqual({ method: 'GET', path: '/stories/2/42/viewers' })
    // Дата просмотра и реакция зрителя до порта терялись — витрина отдавала
    // голые карточки.
    expect(list).toEqual({ count: 1, views: [view], users: [BOB] })
  })

  it('del DELETEs /stories/:id', async () => {
    const { rest, calls } = fakeRest({})
    const mgr = newStoriesManager({ rest })
    await mgr.del(2, 42)
    expect(calls[0]).toEqual({ method: 'DELETE', path: '/stories/2/42' })
  })

  it('stats GETs /stories/:id/stats and maps snake->camel (incl. reactions)', async () => {
    const { rest, calls } = fakeRest({
      views: 12, views_by_day: [{ date: '2026-01-02', value: 12 }],
      reactions_total: 4, reactions: [{ emoji: '❤', count: 3 }, { emoji: '🔥', count: 1 }],
    })
    const mgr = newStoriesManager({ rest })
    const stats = await mgr.stats(2, 42)
    expect(calls[0]).toEqual({ method: 'GET', path: '/stories/2/42/stats' })
    expect(stats).toEqual({
      views: 12, viewsByDay: [{ date: '2026-01-02', value: 12 }],
      reactionsTotal: 4, reactions: [{ emoji: '❤', count: 3 }, { emoji: '🔥', count: 1 }],
    })
  })

  it('stats tolerates missing series/reaction arrays', async () => {
    const { rest } = fakeRest({ views: 0 })
    const mgr = newStoriesManager({ rest })
    expect(await mgr.stats(2, 1)).toEqual({ views: 0, viewsByDay: [], reactionsTotal: 0, reactions: [] })
  })

  it('closeFriends GETs /me/close_friends → ids; setCloseFriends PUTs body', async () => {
    const { rest, calls } = fakeRest({ user_ids: [2, 3] }, { ok: true })
    const mgr = newStoriesManager({ rest })
    expect(await mgr.closeFriends()).toEqual([2, 3])
    expect(calls[0]).toEqual({ method: 'GET', path: '/me/close_friends' })
    await mgr.setCloseFriends([4, 5])
    expect(calls[1]).toEqual({ method: 'PUT', path: '/me/close_friends', body: { user_ids: [4, 5] } })
  })

  it('stealth-окно — конструктор с СЕКУНДАМИ; «окна нет» это отсутствие параметра', async () => {
    const { rest, calls } = fakeRest(
      { _: 'storiesStealthMode' },
      { _: 'storiesStealthMode', active_until_date: 1787334148, cooldown_until_date: 1787337748 },
    )
    const mgr = newStoriesManager({ rest })
    expect(await mgr.stealthState()).toEqual({ _: 'storiesStealthMode' })
    expect(calls[0]).toEqual({ method: 'GET', path: '/stories/stealth' })
    const st = await mgr.activateStealth()
    expect(st).toEqual({ _: 'storiesStealthMode', active_until_date: 1787334148, cooldown_until_date: 1787337748 })
    expect(calls[1]).toEqual({ method: 'POST', path: '/stories/stealth/activate', body: {} })
  })

  it('archive GETs /stories/archive with query and returns the container list', async () => {
    const { rest, calls } = fakeRest({ _: 'stories.stories', count: 1, stories: [story(1, { viewed: true })] })
    const mgr = newStoriesManager({ rest })
    const items = await mgr.archive(20, 5)
    expect(calls[0]).toEqual({ method: 'GET', path: '/stories/archive?limit=20&offset_id=5' })
    expect(items[0]).toEqual(story(1, { viewed: true }))
    // no args → bare path
    await mgr.archive()
    expect(calls[1].path).toBe('/stories/archive')
  })

  it('pin POSTs /stories/:id/pin; pinnedStories GETs by peer', async () => {
    const { rest, calls } = fakeRest({ stories: [] }, { ok: true })
    const mgr = newStoriesManager({ rest })
    await mgr.pin(2, 7, true)
    expect(calls[0]).toEqual({ method: 'POST', path: '/stories/2/7/pin', body: { pinned: true } })
    await mgr.pinnedStories(42)
    expect(calls[1]).toEqual({ method: 'GET', path: '/stories/pinned?peer=42' })
  })

  it('editStory PATCHes /stories/:id with only provided fields', async () => {
    const { rest, calls } = fakeRest({}, { ok: true })
    const mgr = newStoriesManager({ rest })
    await mgr.editStory(2, 7, { caption: 'x', privacy: 'selected', allowIds: [2] })
    expect(calls[0]).toEqual({ method: 'PATCH', path: '/stories/2/7', body: { caption: 'x', privacy: 'selected', allow_user_ids: [2] } })
    // omitted fields absent from body
    await mgr.editStory(2, 7, { caption: 'only' })
    expect(calls[1].body).toEqual({ caption: 'only' })
  })

  it('post отдаёт области КОНСТРУКТОРАМИ — та же форма, что и на витрине', async () => {
    const { rest, calls } = fakeRest({}, { id: 1 })
    const mgr = newStoriesManager({ rest })
    const areas = [{
      _: 'mediaAreaSuggestedReaction' as const,
      coordinates: { _: 'mediaAreaCoordinates' as const, x: 50, y: 78, w: 22, h: 12, rotation: 0 },
      reaction: { _: 'reactionEmoji' as const, emoticon: '👍' },
    }]
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

  it('share POSTs /stories/{peer}/{id}/share and returns sent count', async () => {
    const { rest, calls } = fakeRest({}, { sent: 2 })
    const mgr = newStoriesManager({ rest })
    const n = await mgr.share(2, 7, [10, 11])
    expect(n).toBe(2)
    expect(calls[0]).toEqual({ method: 'POST', path: '/stories/2/7/share', body: { peer_ids: [10, 11] } })
  })
})
