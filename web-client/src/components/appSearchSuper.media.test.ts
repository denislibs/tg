// Пины РЕНДЕРА МЕДИА-ГРИДА и открытия медиавьювера из `AppSearchSuper`
// (`processPhotoVideoFilter`, порт tweb `src/components/appSearchSuper.ts:874-938`;
// клик по плитке — `:716-777`).
//
// Предмет проверок — узлы в DOM и то, ЧТО ПОЛУЧИЛ вьювер (список целей, индекс,
// узел-источник полёта), а не форма вызова. Врапперы настоящие
// (`wrapPhoto`/`wrapVideo`/`wrapMediaSpoiler`); замоканы только ГРАНИЦЫ —
// владелец URL (`managers.media.*`), `@helpers/blur` (грузит Image из
// data-URI, happy-dom его не декодирует) и `dotRendererCore` (за ним WebGL) —
// тот же набор, что в `chat/bubbleMediaSpoiler.test.ts`.
//
// Фейковый бэкенд — курсорная ручка `/chats/{id}/media`, как в
// `appSearchSuper.load.test.ts`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { downloadMediaURL, contentUrl, streamUrl, tokenInfo } = vi.hoisted(() => ({
  downloadMediaURL: vi.fn<(id: number, opts?: { thumb?: boolean }) => Promise<string>>(),
  contentUrl: vi.fn<(id: number) => Promise<string>>(),
  streamUrl: vi.fn<(id: number) => Promise<string>>(),
  tokenInfo: vi.fn<() => Promise<{ token: string, expiresAt: number }>>(),
}))
vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL, contentUrl, streamUrl, tokenInfo } } }),
}))

vi.mock('@helpers/blur', () => ({
  default: vi.fn((dataUri: string) => {
    const canvas = document.createElement('canvas')
    canvas.className = 'canvas-thumbnail'
    canvas.dataset.uri = dataUri
    return { canvas, promise: Promise.resolve() }
  }),
}))

// `vi.hoisted`: фабрика `vi.mock` поднимается выше любых объявлений файла
const { FakeCore } = vi.hoisted(() => ({
  FakeCore: class {
    public inited = false
    public lastDrawTime = 0
    constructor(public canvas: HTMLCanvasElement, public config: unknown) {}
    resize() {}
    init() { this.inited = true; return true }
    draw() {}
    destroy() { this.inited = false }
  },
}))
vi.mock('@lib/spoiler/dotRendererCore', () => ({
  default: FakeCore,
  buildDotRendererConfig: (_w: number, _h: number, dpr: number, config = {}) => ({ dpr, ...config }),
  getDefaultParticlesCount: () => 1000,
  drawClippingCircle: vi.fn(),
}))
vi.mock('@lib/spoiler/spoilerSupport', () => ({
  TEXT_SPOILER_WIDTH: 240,
  TEXT_SPOILER_HEIGHT: 120,
  spoilerSimDpr: () => 1,
  animationsEnabled: () => true,
  isWorkerSimSupported: () => false,
}))
class IntersectionObserverStub {
  constructor(_cb: (entries: IntersectionObserverEntry[]) => void) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

const noop = () => {}
HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
  return id === '2d' ? ({
    clearRect: noop, drawImage: noop, save: noop, restore: noop, beginPath: noop,
    arc: noop, fill: noop, fillRect: noop,
    globalCompositeOperation: '', fillStyle: '', shadowBlur: 0, shadowColor: '',
  } as unknown as CanvasRenderingContext2D) : null
} as HTMLCanvasElement['getContext']

import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import { getHistoryStorage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import * as viewer from '@components/mediaViewer/openMediaViewer'
import type { OpenMediaViewerArgs } from '@components/mediaViewer/openMediaViewer'
import { makeMessage } from '@core/messages/testMessage'
import {
  saveDocument,
  saveMessageMedia,
  THUMB_TYPE_FULL,
  THUMB_TYPE_STRIPPED,
  type MessageMedia,
} from '@core/media/messageMedia'
import type { MyMessage } from '@core/models'
import { i18n, type LangPackKey } from '@lib/langPack'

const PEER: PeerId = 1
const STRIPPED = 'AAECAwQ='

/** Фото в форме оригинала: лестница со stripped-ступенью (из неё — крышка спойлера) и полной. */
const photoMedia = (id: number, spoiler?: boolean): MessageMedia => ({
  _: 'messageMediaPhoto',
  photo: {
    _: 'photo',
    id,
    sizes: [
      { _: 'photoStrippedSize', type: THUMB_TYPE_STRIPPED, bytes: STRIPPED },
      { _: 'photoSize', type: THUMB_TYPE_FULL, w: 1600, h: 900, size: 200_000 },
    ],
  },
  ...(spoiler ? { pFlags: { spoiler: true as const } } : {}),
})

/** Видео — документ; тип выводит `saveDocument` из `documentAttributeVideo`
 *  (`gif` — при `documentAttributeAnimated`: во вкладке `media` он тоже видео, поправка 2 плана). */
const videoMedia = (id: number, gif?: boolean): MessageMedia => ({
  _: 'messageMediaDocument',
  document: saveDocument({
    _: 'document',
    id,
    mime_type: 'video/mp4',
    size: 3_000_000,
    attributes: [
      { _: 'documentAttributeVideo', duration: 5, w: 1280, h: 720 },
      ...(gif ? [{ _: 'documentAttributeAnimated' as const }] : []),
    ],
    thumbs: [
      { _: 'photoStrippedSize', type: THUMB_TYPE_STRIPPED, bytes: STRIPPED },
      { _: 'photoSize', type: THUMB_TYPE_FULL, w: 1280, h: 720, size: 50_000 },
    ],
  }),
})

const photo = (id: number, spoiler?: boolean): MyMessage => makeMessage({
  id, peerId: PEER, fromId: PEER, media: saveMessageMedia(photoMedia(id, spoiler)),
})

const video = (id: number, gif?: boolean): MyMessage => makeMessage({
  id, peerId: PEER, fromId: PEER, media: saveMessageMedia(videoMedia(id, gif)),
})

/** Список newest-first: id по убыванию, как отдаёт `ORDER BY m.seq DESC`. */
const feed = (n: number) => Array.from({ length: n }, (_, i) => photo(n - i))

function fakeBackend(all: MyMessage[]) {
  const managers = {
    messages: {
      mediaHistory: async (_peerId: number, filter: string, offsetId = 0, limit = 30) => {
        const src = filter === 'media' ? all : []
        const from = offsetId ? src.filter((m) => m.id < offsetId) : src
        return { messages: from.slice(0, limit), count: src.length }
      },
      searchCounters: async (_peerId: number, filters: string[]) =>
        filters.map((filter) => ({ filter, count: all.length })),
    },
  } as unknown as SearchSuperManagers
  return managers
}

function makeMediaTabs(): SearchSuperMediaTab[] {
  return [
    { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
    { type: 'files', inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2' as LangPackKey },
  ]
}

function build(all: MyMessage[]) {
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  const host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  const searchSuper = new AppSearchSuper({ mediaTabs: makeMediaTabs(), scrollable, managers: fakeBackend(all) })
  host.append(searchSuper.container)
  searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })
  return searchSuper
}

/** Дать очереди рендера, промисам врапперов и отложенной предзагрузке разобраться. */
async function settle() {
  for (let i = 0; i < 6; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const grid = (searchSuper: AppSearchSuper) =>
  searchSuper.container.querySelector<HTMLElement>('.search-super-content-media-grid')!

const tiles = (searchSuper: AppSearchSuper) =>
  Array.from(grid(searchSuper).querySelectorAll<HTMLElement>('.grid-item.search-super-item'))

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

function spyViewer() {
  const opened = vi.fn<(args: OpenMediaViewerArgs) => void>()
  vi.spyOn(viewer, 'openMediaViewer').mockImplementation((args) => { opened(args); return undefined })
  return opened
}

beforeEach(() => {
  resetSharedMediaHistories()
  vi.restoreAllMocks()
  downloadMediaURL.mockResolvedValue('blob:full')
  contentUrl.mockResolvedValue('blob:content')
  streamUrl.mockResolvedValue('blob:stream')
  tokenInfo.mockResolvedValue({ token: 't', expiresAt: Date.now() + 60_000 })
  vi.stubGlobal('devicePixelRatio', 1)
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('AppSearchSuper: медиа-грид (tweb :874-938)', () => {
  it('фото и видео становятся плитками .grid-item.search-super-item в .search-super-content-media-grid', async () => {
    const searchSuper = build([video(4, true), video(3), photo(2), photo(1)])
    await searchSuper.load(true)
    await settle()

    const items = tiles(searchSuper)
    expect(items.map((el) => +el.dataset.mid!)).toEqual([4, 3, 2, 1])
    expect(items.every((el) => el.dataset.peerId === String(PEER))).toBe(true)

    // Плитка — это и есть контейнер враппера (tweb `container: div`), картинка
    // в ней помечена `grid-item-media` (tweb `:932-937`).
    for (const tile of items) {
      expect(tile.classList.contains('media-container')).toBe(true)
      expect(tile.querySelector('.grid-item-media')).not.toBeNull()
    }

    // Видео в гриде — только постер: ни кнопки воспроизведения
    // (`noPlayButton`), ни `<video>` (`onlyPreview`). Второе видно на GIF: он
    // автоплеится и без `onlyPreview` завёл бы в плитке `<video>` и стрим.
    const [gifTile, videoTile] = items
    expect(videoTile.querySelector('.video-play')).toBeNull()
    expect(gifTile.querySelector('video')).toBeNull()
    expect(streamUrl).not.toHaveBeenCalled()
  })

  it('крышка спойлера ставится ТОЛЬКО на сообщение с `pFlags.spoiler`', async () => {
    const searchSuper = build([photo(2, true), photo(1)])
    await searchSuper.load(true)
    await settle()

    const [hidden, plain] = tiles(searchSuper)
    expect(hidden.querySelector('.media-spoiler-container')).not.toBeNull()
    expect(plain.querySelector('.media-spoiler-container')).toBeNull()
  })

  it('первый клик по скрытой плитке снимает крышку и НЕ открывает вьювер (tweb :726-733)', async () => {
    const opened = spyViewer()
    const searchSuper = build([photo(2, true), photo(1)])
    await searchSuper.load(true)
    await settle()

    const [hidden] = tiles(searchSuper)
    const cover = hidden.querySelector<HTMLElement>('.media-spoiler-container')!
    click(cover)

    expect(opened).not.toHaveBeenCalled()
    expect(cover.classList.contains('is-revealing') || cover.dataset.isRevealing === 'true').toBe(true)
  })

  it('пустая вкладка получает `.content-empty` с `Chat.Search.NothingFound`, а не пустой грид', async () => {
    const searchSuper = build([])
    await searchSuper.load(true)
    await settle()

    expect(tiles(searchSuper)).toHaveLength(0)
    const empty = searchSuper.mediaTab.contentTab!.parentElement!.querySelector('.content-empty')
    expect(empty).not.toBeNull()
    expect(empty!.textContent).toBe(i18n('Chat.Search.NothingFound').textContent)
  })
})

describe('AppSearchSuper: медиавьювер по клику (tweb :716-777)', () => {
  it('цели листания — ПЛИТКИ ЭТОЙ ВКЛАДКИ в её порядке, а не кэш и не лента чата', async () => {
    const opened = spyViewer()
    // Страниц больше одной: первая отрисована, вторая уже предзагружена в
    // кэш (`tweb:2329-2348`). Если бы цели брались из кэша, их было бы больше,
    // чем плиток.
    const searchSuper = build(feed(60))
    await searchSuper.load(true)
    await settle()

    const items = tiles(searchSuper)
    expect(items.length).toBeGreaterThan(1)
    expect(getHistoryStorage(PEER).inputMessagesFilterPhotoVideo!.length).toBeGreaterThan(items.length)

    // клик — по КАРТИНКЕ внутри плитки, а не по самой плитке: цель ищется
    // подъёмом до `.grid-item` (tweb `findUpClassName(e.target, className)`)
    const idx = 2
    click(items[idx].querySelector('.grid-item-media')!)

    expect(opened).toHaveBeenCalledTimes(1)
    const args = opened.mock.calls[0][0]
    expect(args.items.map((it) => it.mid)).toEqual(items.map((el) => +el.dataset.mid!))
    expect(args.index).toBe(idx)
    expect(args.target).toBe(items[idx])
    // источник полёта у каждой цели — её плитка (tweb `element: el`)
    expect(args.items.map((it) => it.element)).toEqual(items)
    // порядок вкладки — newest-first, вьюверу `reverse` не нужен
    expect(args.reverse).toBeFalsy()
    expect(args.items[idx].media.kind).toBe('photo')
  })

  it('видео уезжает во вьювер как видео, а не как фото', async () => {
    const opened = spyViewer()
    const searchSuper = build([video(2), photo(1)])
    await searchSuper.load(true)
    await settle()

    click(tiles(searchSuper)[0])

    const args = opened.mock.calls[0][0]
    expect(args.items.map((it) => it.media.kind)).toEqual(['video', 'photo'])
  })

  it('за пределы плиток вьювер листает той же ручкой вкладки (аналог `setSearchContext`, tweb :757)', async () => {
    const opened = spyViewer()
    const searchSuper = build(feed(60))
    await searchSuper.load(true)
    await settle()

    const items = tiles(searchSuper)
    click(items[0])

    const args = opened.mock.calls[0][0]
    const last = args.items[args.items.length - 1]
    const older = await args.loadMoreMedia!(true, last, 5)
    // строго старше последней плитки, по убыванию, без дыр
    expect(older.map((it) => it.mid)).toEqual([1, 2, 3, 4, 5].map((k) => last.mid - k))
  })
})
