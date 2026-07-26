// src/core/managers/stickersManager.test.ts
import { describe, it, expect } from 'vitest'
import { newStickersManager } from './stickersManager'
import type { RestClient } from '../net/restClient'

function fakeRest(getResult: unknown = {}, postResult: unknown = {}) {
  const calls: { method: string; path: string; query?: unknown; body?: unknown }[] = []
  const rest = {
    async get<R>(path: string, query?: Record<string, string | number>): Promise<R> {
      calls.push({ method: 'GET', path, query })
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

describe('StickersManager', () => {
  it('recent maps snake->camel', async () => {
    const { rest, calls } = fakeRest({ stickers: [{ id: 1, set_id: 2, media_id: 33, emoji: '🔥' }] })
    const mgr = newStickersManager({ rest })
    const list = await mgr.recent()
    expect(calls[0]).toEqual({ method: 'GET', path: '/stickers/recent', query: undefined })
    expect(list).toEqual([{ id: 1, setId: 2, mediaId: 33, emoji: '🔥' }])
  })

  it('recent/faved tolerate a missing stickers array', async () => {
    const { rest } = fakeRest({})
    const mgr = newStickersManager({ rest })
    expect(await mgr.recent()).toEqual([])
    expect(await mgr.faved()).toEqual([])
  })

  it('use POSTs /stickers/:id/use', async () => {
    const { rest, calls } = fakeRest()
    const mgr = newStickersManager({ rest })
    await mgr.use(7)
    expect(calls[0]).toEqual({ method: 'POST', path: '/stickers/7/use', body: {} })
  })

  it('fave/unfave hit POST/DELETE /stickers/:id/fave', async () => {
    const { rest, calls } = fakeRest()
    const mgr = newStickersManager({ rest })
    await mgr.fave(5)
    await mgr.unfave(5)
    expect(calls).toEqual([
      { method: 'POST', path: '/stickers/5/fave', body: {} },
      { method: 'DELETE', path: '/stickers/5/fave' },
    ])
  })

  it('searchByEmoji passes emoji as a query param and maps rows', async () => {
    const { rest, calls } = fakeRest({ stickers: [{ id: 9, set_id: 1, media_id: 12, emoji: '👍' }] })
    const mgr = newStickersManager({ rest })
    const list = await mgr.searchByEmoji('👍')
    expect(calls[0]).toEqual({ method: 'GET', path: '/stickers/search', query: { emoji: '👍' } })
    expect(list).toEqual([{ id: 9, setId: 1, mediaId: 12, emoji: '👍' }])
  })

  it('setBySlug returns the set and mapped stickers', async () => {
    const set = { id: 1, slug: 'duck', title: 'Duck', kind: 'sticker', count: 2 }
    const { rest, calls } = fakeRest({ set, stickers: [{ id: 1, set_id: 1, media_id: 10, emoji: '🦆' }] })
    const mgr = newStickersManager({ rest })
    const r = await mgr.setBySlug('duck')
    expect(calls[0].path).toBe('/sticker-sets/duck')
    expect(r.set).toEqual(set)
    expect(r.stickers).toEqual([{ id: 1, setId: 1, mediaId: 10, emoji: '🦆' }])
  })

  it('install/uninstall hit POST/DELETE /sticker-sets/:id/install', async () => {
    const { rest, calls } = fakeRest()
    const mgr = newStickersManager({ rest })
    await mgr.install(3)
    await mgr.uninstall(3)
    expect(calls).toEqual([
      { method: 'POST', path: '/sticker-sets/3/install', body: {} },
      { method: 'DELETE', path: '/sticker-sets/3/install' },
    ])
  })

  // ── GIF ──

  it('savedGifs maps media_id -> mediaId and tolerates an empty payload', async () => {
    const { rest, calls } = fakeRest({ gifs: [{ media_id: 42 }, { media_id: 7 }] })
    const mgr = newStickersManager({ rest })
    expect(await mgr.savedGifs()).toEqual([{ mediaId: 42 }, { mediaId: 7 }])
    expect(calls[0]).toEqual({ method: 'GET', path: '/gifs/saved', query: undefined })
    const { rest: emptyRest } = fakeRest({})
    expect(await newStickersManager({ rest: emptyRest }).savedGifs()).toEqual([])
  })

  it('saveGif/deleteGif hit POST /gifs/saved and DELETE /gifs/saved/:id', async () => {
    const { rest, calls } = fakeRest()
    const mgr = newStickersManager({ rest })
    await mgr.saveGif(42)
    await mgr.deleteGif(42)
    expect(calls).toEqual([
      { method: 'POST', path: '/gifs/saved', body: { media_id: 42 } },
      { method: 'DELETE', path: '/gifs/saved/42' },
    ])
  })

  it('searchGifs maps the Tenor page snake->camel and passes q/pos', async () => {
    const { rest, calls } = fakeRest({
      gifs: [{ id: 'abc', mp4_url: 'https://t/a.mp4', gif_url: 'https://t/a.gif', preview_url: 'https://t/a.png', width: 200, height: 100 }],
      next: 'cursor1',
    })
    const mgr = newStickersManager({ rest })
    const page = await mgr.searchGifs('cats', 'pos0')
    expect(calls[0]).toEqual({ method: 'GET', path: '/gifs/search', query: { q: 'cats', pos: 'pos0' } })
    expect(page).toEqual({
      gifs: [{ id: 'abc', mp4Url: 'https://t/a.mp4', gifUrl: 'https://t/a.gif', previewUrl: 'https://t/a.png', width: 200, height: 100 }],
      next: 'cursor1',
    })
  })

  it('searchGifs without a Tenor key returns an empty page (gifs missing/next empty)', async () => {
    const { rest } = fakeRest({ gifs: [], next: '' })
    const mgr = newStickersManager({ rest })
    expect(await mgr.searchGifs('')).toEqual({ gifs: [], next: '' })
  })
})
