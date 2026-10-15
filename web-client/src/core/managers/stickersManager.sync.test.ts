// src/core/managers/stickersManager.sync.test.ts
//
// Ф-6 f6-stickers: кадры журнала своих устройств. tweb:
//  • appStickersManager.ts:80-84 — `updateNewStickerSet` → saveStickerSet, затем
//    `stickers_installed` с `stickerset.set`;
//  • :86, :88, :126-132 — `updateRecentStickers`/`updateFavedStickers` → перечитать
//    и `stickers_updated{type, stickers}`;
//  • appGifsManager.ts:21-29 — `updateSavedGifs` → перечитать и `gifs_updated`.
import { describe, it, expect } from 'vitest'
import { newStickersManager } from './stickersManager'
import { makeSticker, makeStickerSet } from '../stickers/testSticker'
import type { RestClient } from '../net/restClient'

type Call = { event: string; payload: unknown }

function setup(getImpl: (path: string) => Promise<unknown>) {
  const gets: string[] = []
  const rest = {
    get: async (path: string) => { gets.push(path); return getImpl(path) },
    post: async () => ({}),
    del: async () => undefined,
  } as unknown as RestClient
  const calls: Call[] = []
  const mgr = newStickersManager({ rest, dispatch: (event, payload) => calls.push({ event, payload }) })
  return { mgr, gets, calls }
}

const wait = () => new Promise((r) => setTimeout(r, 0))

describe('StickersManager: кадры своих устройств', () => {
  it('updateNewStickerSet → stickers_installed с самим набором (stickerset.set)', () => {
    const { mgr, calls } = setup(async () => ({}))
    const set = makeStickerSet({ id: 5 })
    mgr.onNewStickerSet({
      _: 'updateNewStickerSet',
      stickerset: { _: 'messages.stickerSet', set, packs: [], keywords: [], documents: [makeSticker({ id: 33, setId: 5, emoji: '🔥' })] },
    })
    expect(calls).toEqual([{ event: 'stickers_installed', payload: set }])
  })

  it('updateRecentStickers → перечитать недавние и stickers_updated{recent}', async () => {
    const { mgr, gets, calls } = setup(async () => ({ stickers: [makeSticker({ id: 33, setId: 2, emoji: '🔥' })] }))
    await mgr.onStickersUpdated('recent')
    expect(gets).toEqual(['/stickers/recent'])
    expect(calls).toHaveLength(1)
    expect(calls[0].event).toBe('stickers_updated')
    const p = calls[0].payload as { type: string; stickers: { id: number; type?: string }[] }
    expect(p.type).toBe('recent')
    expect(p.stickers.map((d) => d.id)).toEqual([33])
    expect(p.stickers[0].type).toBe('sticker') // прошёл saveDocument
  })

  it('updateFavedStickers → faved', async () => {
    const { mgr, gets, calls } = setup(async () => ({ stickers: [] }))
    await mgr.onStickersUpdated('faved')
    expect(gets).toEqual(['/stickers/faved'])
    expect(calls).toEqual([{ event: 'stickers_updated', payload: { type: 'faved', stickers: [] } }])
  })

  it('updateSavedGifs → GET /gifs/saved и gifs_updated документами', async () => {
    const gif = { _: 'document', id: 9, mime_type: 'video/mp4', size: 1, attributes: [] }
    const { mgr, gets, calls } = setup(async () => ({ gifs: [gif] }))
    await mgr.onGifsUpdated()
    expect(gets).toEqual(['/gifs/saved'])
    expect(calls[0].event).toBe('gifs_updated')
    expect((calls[0].payload as { id: number }[]).map((d) => d.id)).toEqual([9])
  })

  // Два кадра подряд: первый ответ приходит ПОСЛЕ второго. Устаревший список не
  // должен затереть свежий.
  it('устаревший ответ перечитывания не затирает свежий', async () => {
    const resolvers: ((v: unknown) => void)[] = []
    const { mgr, calls } = setup(() => new Promise((r) => resolvers.push(r)))
    const first = mgr.onStickersUpdated('recent')
    const second = mgr.onStickersUpdated('recent')
    resolvers[1]({ stickers: [makeSticker({ id: 2, setId: 1, emoji: '🙂' })] })
    await second
    resolvers[0]({ stickers: [makeSticker({ id: 1, setId: 1, emoji: '🙂' })] })
    await first
    await wait()
    expect(calls).toHaveLength(1)
    expect((calls[0].payload as { stickers: { id: number }[] }).stickers.map((d) => d.id)).toEqual([2])
  })

  it('сбой чтения: ничего не объявляется, ошибка уходит вызывающему', async () => {
    const { mgr, calls } = setup(async () => { throw new Error('net') })
    await expect(mgr.onStickersUpdated('recent')).rejects.toThrow('net')
    await expect(mgr.onGifsUpdated()).rejects.toThrow('net')
    expect(calls).toEqual([])
  })
})
