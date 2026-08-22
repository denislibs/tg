// src/core/managers/stickersManager.test.ts
//
// Мапперов у менеджера больше нет: сервер отдаёт конструкторы схемы, форма
// провода и форма модели совпали. Поэтому тесты проверяют не «перекладывание
// snake в camel», а то, что осталось предметом: правильный маршрут и что
// документ проходит `saveDocument` — тип файла, размеры, эмодзи и набор
// выводятся ИЗ АТРИБУТОВ, а не приезжают готовыми полями.
import { describe, it, expect } from 'vitest'
import { newStickersManager } from './stickersManager'
import { makeSticker, makeStickerSet } from '../stickers/testSticker'
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
  it('recent — маршрут и документы как есть', async () => {
    const { rest, calls } = fakeRest({ stickers: [makeSticker({ id: 33, setId: 2, emoji: '🔥' })] })
    const mgr = newStickersManager({ rest })
    const list = await mgr.recent()
    expect(calls[0]).toEqual({ method: 'GET', path: '/stickers/recent', query: undefined })
    expect(list.map((d) => d.id)).toEqual([33])
  })

  // Тип файла, размеры, эмодзи и набор ВЫВОДЯТСЯ из атрибутов — тем же
  // saveDocument, что и у документа из ленты. Если менеджер перестанет его
  // звать, стикер приедет без `type`/`w`/`h` и нарисуется квадратом.
  it('документ проходит saveDocument: тип, размеры, эмодзи и набор — из атрибутов', async () => {
    const { rest } = fakeRest({
      stickers: [makeSticker({ id: 33, setId: 2, emoji: '🔥', width: 512, height: 384, thumb: '/9j/' })],
    })
    const mgr = newStickersManager({ rest })
    const [doc] = await mgr.recent()
    expect(doc.type).toBe('sticker')
    expect([doc.w, doc.h]).toEqual([512, 384])
    expect(doc.stickerEmojiRaw).toBe('🔥')
    expect(doc.stickerSetInput).toEqual({ _: 'inputStickerSetID', id: 2 })
  })

  // Медиа без прогона процессинга: ступеней и атрибута размеров нет вовсе — в
  // схеме «неизвестно» это ОТСУТСТВИЕ элемента вектора, а не элемент с нулями.
  it('без метаданных документ едет без ступеней, а не с пустыми', async () => {
    const bare = { _: 'document' as const, id: 33, mime_type: 'image/webp', size: 0, attributes: [] }
    const { rest } = fakeRest({ stickers: [bare] })
    const mgr = newStickersManager({ rest })
    const [doc] = await mgr.recent()
    expect(doc.thumbs).toBeUndefined()
    expect(doc.w).toBeUndefined()
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

  it('searchByEmoji передаёт эмодзи параметром запроса', async () => {
    const { rest, calls } = fakeRest({ stickers: [makeSticker({ id: 12, setId: 1, emoji: '👍' })] })
    const mgr = newStickersManager({ rest })
    const list = await mgr.searchByEmoji('👍')
    expect(calls[0]).toEqual({ method: 'GET', path: '/stickers/search', query: { emoji: '👍' } })
    expect(list.map((d) => d.stickerEmojiRaw)).toEqual(['👍'])
  })

  it('getStickerSet по короткому имени: набор и его документы', async () => {
    const set = makeStickerSet({ id: 1, shortName: 'duck', title: 'Duck', count: 2 })
    const { rest, calls } = fakeRest({ set, documents: [makeSticker({ id: 10, setId: 1, emoji: '🦆' })] })
    const mgr = newStickersManager({ rest })
    const r = await mgr.getStickerSet({ shortName: 'duck' })
    expect(calls[0].path).toBe('/sticker-sets/duck')
    expect(r.set).toEqual(set)
    expect(r.stickers.map((d) => d.id)).toEqual([10])
  })

  // Второй конструктор того же адреса (InputStickerSet): им пользуется клик по
  // стикеру в чате — документ несёт ЧИСЛО набора, а короткого имени в нём нет.
  it('getStickerSet по числу набора бьёт в маршрут id', async () => {
    const set = makeStickerSet({ id: 7, shortName: 'duck', title: 'Duck', count: 1 })
    const { rest, calls } = fakeRest({ set, documents: [] })
    const mgr = newStickersManager({ rest })
    const r = await mgr.getStickerSet({ id: 7 })
    expect(calls[0].path).toBe('/sticker-sets/id/7')
    expect(r.set.id).toBe(7)
  })

  // Набор едет ВМЕСТЕ со своими документами одним конструктором
  // (stickerSetFullCovered) — отдельной карты превью на проводе больше нет,
  // менеджер раскладывает её сам для быстрого lookup при рендере строки.
  it('featuredSets раскладывает covered-наборы в пару «наборы, карта превью»', async () => {
    const set = makeStickerSet({ id: 1, shortName: 'duck', title: 'Duck', count: 5 })
    const { rest, calls } = fakeRest({
      sets: [{
        _: 'stickerSetFullCovered',
        set,
        packs: [{ _: 'stickerPack', emoticon: '🦆', documents: [100] }],
        documents: [makeSticker({ id: 100, setId: 1, emoji: '🦆', thumb: '/9j/', pathThumb: 'AAA' })],
      }],
    })
    const mgr = newStickersManager({ rest })
    const r = await mgr.featuredSets()
    expect(calls[0]).toEqual({ method: 'GET', path: '/sticker-sets/featured', query: undefined })
    expect(r.sets).toEqual([set])
    expect(r.covers).toBeInstanceOf(Map)
    expect(r.covers.get(1)?.map((d) => d.id)).toEqual([100])
    // Документ превью тоже прошёл saveDocument — иначе строка выдачи рисовала
    // бы его без нижнего слоя.
    expect(r.covers.get(1)?.[0].type).toBe('sticker')
  })

  it('searchSets — тот же разбор; пустая выдача даёт пустую Map, а не падает', async () => {
    const { rest, calls } = fakeRest({ sets: [] })
    const mgr = newStickersManager({ rest })
    const r = await mgr.searchSets('duck')
    expect(calls[0]).toEqual({ method: 'GET', path: '/sticker-sets/search', query: { q: 'duck' } })
    expect(r.sets).toEqual([])
    expect(r.covers).toEqual(new Map())
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

  it('savedGifs — документы, а не голые ссылки; пустой ответ терпим', async () => {
    const gif = (id: number) => ({
      _: 'document' as const, id, mime_type: 'video/mp4', size: 100,
      attributes: [{ _: 'documentAttributeAnimated' as const }],
    })
    const { rest, calls } = fakeRest({ gifs: [gif(42), gif(7)] })
    const mgr = newStickersManager({ rest })
    const gifs = await mgr.savedGifs()
    expect(gifs.map((d) => d.id)).toEqual([42, 7])
    // Вид файла выводится из атрибута, а не приезжает полем.
    expect(gifs[0].type).toBe('gif')
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
