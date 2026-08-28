// wrapAlbum — ванильный порт tweb `components/wrappers/album.ts`.
//
// Пиним то, что делает альбом альбомом, а не колонкой картинок:
//   • ОДИН общий контейнер с пиксельным боксом, ячейки внутри — в процентах;
//   • раскладка считается ПО РАЗМЕРАМ КАЖДОГО элемента: у фотографии — ступень
//     лестницы под 480×480, у документа его собственные `w`/`h` (tweb album.ts:42-44);
//   • на каждой ячейке свои data-mid/data-peer-id — по ним лента находит
//     сообщение под кликом/меню/выделением;
//   • дерево и классы совпадают с живым DOM tweb
//     (docs/tweb/dom/dumps/03-album-channel.json);
//   • скрытое медиа накрывается ПОЭЛЕМЕНТНО (tweb album.ts:122-148), а размер
//     крышки считается из процента ячейки и пиксельного бокса контейнера;
//   • неоплаченное платное медиа — не пустая ячейка, а псевдо-фото из превью
//     (`generatePhotoForExtendedMediaPreview`: единственная ступень — stripped,
//     и `wrapPhoto` уходит на ней в ранний выход photo.ts:207).
//
// Мокаем только границу владельца URL (managers.media.downloadMediaURL) и
// драйверы, которых нет в happy-dom (blur/WebGL точек) — prepareAlbum,
// wrapPhoto, wrapMediaSpoiler, ensureMediaUrl и зеркало работают настоящие.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getMediaFromMessage,
  saveDocument,
  THUMB_TYPE_FULL,
  THUMB_TYPE_SERVER,
  THUMB_TYPE_STRIPPED,
  type MessageMedia,
  type PhotoSize,
} from '@core/media/messageMedia'
import type { MessageReal } from '@core/models'
import { generateMessageId } from '@core/history/messageId'
import { makeMessage } from '@core/messages/testMessage'
import { getMiddleware } from '@helpers/middleware'

const { downloadMediaURL } = vi.hoisted(() => ({
  downloadMediaURL: vi.fn<(id: number, opts?: { thumb?: boolean }) => Promise<string>>(),
}))
vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL } } }),
}))

vi.mock('@helpers/blur', () => ({
  default: vi.fn((dataUri: string) => {
    const canvas = document.createElement('canvas')
    canvas.className = 'canvas-thumbnail'
    canvas.dataset.uri = dataUri
    return { canvas, promise: Promise.resolve() }
  }),
}))

// Точки спойлера: за `dotRendererCore` начинается WebGL-драйвер, которого в
// happy-dom нет (тот же стаб, что в `mediaSpoiler.test.ts`).
class FakeCore {
  public inited = false
  public lastDrawTime = 0
  constructor(public canvas: HTMLCanvasElement, public config: unknown) {}
  resize() {}
  init() { this.inited = true; return true }
  draw() {}
  destroy() { this.inited = false }
}
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

let wrapAlbum: typeof import('./album').default

const flush = async () => {
  for (let i = 0; i < 3; ++i) await new Promise<void>((r) => { setTimeout(r, 0) })
}

const STRIPPED = 'AAECAwQ='

/** Ступени вложения: stripped-плейсхолдер, серверное превью, оригинал. */
const sizes = ({ w, h, stripped, serverThumb }: {
  w: number, h: number, stripped: boolean, serverThumb: boolean,
}): PhotoSize[] => [
  ...(stripped ? [{ _: 'photoStrippedSize', type: THUMB_TYPE_STRIPPED, bytes: STRIPPED } as PhotoSize] : []),
  ...(serverThumb ? [{ _: 'photoSize', type: THUMB_TYPE_SERVER, w: 800, h: 450, size: 40_000 } as PhotoSize] : []),
  { _: 'photoSize', type: THUMB_TYPE_FULL, w, h, size: 400_000 },
]

const photoMedia = (
  id: number,
  { w = 1600, h = 900, stripped = true, serverThumb = false, spoiler }: {
    w?: number, h?: number, stripped?: boolean, serverThumb?: boolean, spoiler?: true,
  } = {},
): MessageMedia => ({
  _: 'messageMediaPhoto',
  ...(spoiler ? { pFlags: { spoiler } } : {}),
  photo: { _: 'photo', id, sizes: sizes({ w, h, stripped, serverThumb }) },
})

/** Видео альбома: `type`/`w`/`h`/`duration` выводит `saveDocument` из атрибутов. */
const videoMedia = (
  id: number,
  { w = 900, h = 1600, duration = 46, serverThumb = false }: {
    w?: number, h?: number, duration?: number, serverThumb?: boolean,
  } = {},
): MessageMedia => ({
  _: 'messageMediaDocument',
  document: saveDocument({
    _: 'document',
    id,
    mime_type: 'video/mp4',
    size: 3 * 1024 * 1024,
    attributes: [{ _: 'documentAttributeVideo', duration, w, h }],
    thumbs: [
      { _: 'photoStrippedSize', type: THUMB_TYPE_STRIPPED, bytes: STRIPPED },
      ...(serverThumb ? [{ _: 'photoSize', type: THUMB_TYPE_SERVER, w: 800, h: 450, size: 40_000 } as PhotoSize] : []),
    ],
  }),
})

let seq = 0
/** Сообщение альбома. Адрес файла живёт ВНУТРИ вложения (плоского `media_id`
 *  рядом больше нет), поэтому фабрика вложения и есть источник этого id. */
function msg(patch: Partial<MessageReal> = {}, makeMedia: (id: number) => MessageMedia = photoMedia): MessageReal {
  ++seq
  const mediaId = 1000 + seq
  return {
    ...makeMessage({
      id: generateMessageId(100 + seq), peerId: -42, fromId: 1,
      date: 1_755_302_400, groupedId: 1, media: makeMedia(mediaId),
    }),
    ...patch,
  }
}

/** Адрес файла вложения — то, чем раньше был плоский `mediaId`. */
const mediaIdOf = (m: MessageReal) => getMediaFromMessage(m)?.id

beforeEach(async () => {
  vi.resetModules()
  seq = 0
  downloadMediaURL.mockReset()
  downloadMediaURL.mockImplementation((id) => Promise.resolve(`blob:${id}`))
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true, writable: true, value: () => Promise.resolve(),
  })
  wrapAlbum = (await import('./album')).default
})

afterEach(() => {
  document.body.replaceChildren()
})

/**
 * Неоплаченное платное медиа: вместо вложения приезжает ПРЕВЬЮ
 * (`messageExtendedMediaPreview`) — коробка кадра и stripped-подложка, файла
 * нет вовсе. «Заблокировано» это и есть выбор ЭТОГО конструктора позиции
 * вектора, а не булев ключ рядом с ценой.
 */
const paidPreviewMedia = ({ stripped = true, w = 1600, h = 900 } = {}): MessageMedia => ({
  _: 'messageMediaPaidMedia',
  stars_amount: 5,
  extended_media: [{
    _: 'messageExtendedMediaPreview',
    w,
    h,
    ...(stripped ? { thumb: { _: 'photoStrippedSize' as const, type: THUMB_TYPE_STRIPPED, bytes: STRIPPED } } : {}),
  }],
})

const paid = ({ stripped = true }: { stripped?: boolean } = {}) =>
  msg({}, () => paidPreviewMedia({ stripped }))

const attachment = () => {
  const div = document.createElement('div')
  div.classList.add('attachment')
  return div
}

describe('wrapAlbum', () => {
  it('дерево и классы 1:1 с живым DOM tweb, один общий контейнер', async () => {
    const attachmentDiv = attachment()
    const messages = [msg(), msg(), msg()]

    wrapAlbum({ messages, attachmentDiv })
    await flush()

    expect(attachmentDiv.style.width).toMatch(/^\d+px$/)
    expect(attachmentDiv.style.height).toMatch(/^\d+px$/)
    expect(attachmentDiv.children).toHaveLength(3)

    for (const [idx, div] of [...attachmentDiv.children].entries()) {
      const item = div as HTMLElement
      expect(item.classList.contains('album-item')).toBe(true)
      expect(item.classList.contains('grouped-item')).toBe(true)
      expect(item.style.width).toMatch(/%$/)

      const media = item.firstElementChild as HTMLElement
      expect(media.classList.contains('album-item-media')).toBe(true)
      expect(media.classList.contains('media-container')).toBe(true)
      // ячейку размерами НЕ трогаем: бокс задан гридом (boxWidth/boxHeight = 0)
      expect(media.style.width).toBe('')
      expect(media.querySelector('img.media-photo')).toBeTruthy()
      expect(item.dataset.mid).toBe('' + messages[idx].id)
      expect(item.dataset.peerId).toBe('' + messages[idx].peerId)
    }
  })

  // Ядро: грид — производная от размеров ЭЛЕМЕНТОВ, а не константа.
  it('раскладка считается по размерам каждого элемента', () => {
    const wide = attachment()
    wrapAlbum({ messages: [msg(), msg()], attachmentDiv: wide })

    const tall = attachment()
    wrapAlbum({
      messages: [
        msg({}, (id) => photoMedia(id, { w: 900, h: 1600 })),
        msg({}, (id) => photoMedia(id, { w: 900, h: 1600 })),
      ],
      attachmentDiv: tall,
    })

    // две широких — друг под другом, две узких — рядом
    expect(parseFloat((wide.children[1] as HTMLElement).style.top)).toBeGreaterThan(45)
    expect(parseFloat((wide.children[1] as HTMLElement).style.left)).toBeCloseTo(0, 1)
    expect(parseFloat((tall.children[1] as HTMLElement).style.top)).toBeCloseTo(0, 1)
    expect(parseFloat((tall.children[1] as HTMLElement).style.left)).toBeGreaterThan(45)
  })

  it('каждый элемент грузит СВОЁ медиа (свой mediaId), а не медиа первого сообщения', async () => {
    const attachmentDiv = attachment()
    const messages = [msg(), msg(), msg()]

    wrapAlbum({ messages, attachmentDiv })
    await flush()

    expect(downloadMediaURL.mock.calls.map(([id]) => id)).toEqual(messages.map(mediaIdOf))
    const srcs = [...attachmentDiv.querySelectorAll('img.media-photo')].map((i) => (i as HTMLImageElement).src)
    expect(srcs).toEqual(messages.map((m) => `blob:${mediaIdOf(m)}`))
  })

  // Адрес файла ячейки решает ступень, выбранная под 480×480 (tweb album.ts:43):
  // серверное превью бокс покрывает — качается оно, а не оригинал.
  it('серверная ступень покрыла бокс ячейки — качается превью', async () => {
    wrapAlbum({ messages: [msg({}, (id) => photoMedia(id, { serverThumb: true }))], attachmentDiv: attachment() })
    await flush()

    expect(downloadMediaURL).toHaveBeenCalledWith(1001, { thumb: true })
  })

  it('автозагрузка фото выключена — к владельцу не ходим', async () => {
    wrapAlbum({
      messages: [msg(), msg()],
      attachmentDiv: attachment(),
      autoDownload: { photo: 0, video: 0, file: 0 },
    })
    await flush()

    expect(downloadMediaURL).not.toHaveBeenCalled()
  })

  it('превью из сообщения появляется до сети', () => {
    const attachmentDiv = attachment()
    wrapAlbum({ messages: [msg(), msg()], attachmentDiv })

    expect(attachmentDiv.querySelectorAll('canvas.canvas-thumbnail.thumbnail.media-photo')).toHaveLength(2)
    expect(attachmentDiv.querySelector('img.media-photo')).toBeNull()
  })

  // Не-фото ячейку рисует wrapVideo (tweb album.ts:100-115) — теми же
  // аргументами: нулевой бокс (грид уже задал размер) и запрет автоплея.
  it('видео-элемент: ячейка рисуется wrapVideo — превью, таймкод и кнопка воспроизведения', async () => {
    const attachmentDiv = attachment()
    const messages = [
      msg(),
      msg({}, (id) => videoMedia(id)),
    ]

    wrapAlbum({ messages, attachmentDiv })
    await flush()

    const videoItem = attachmentDiv.children[1] as HTMLElement
    expect(videoItem.dataset.mid).toBe('' + messages[1].id)
    const mediaDiv = videoItem.firstElementChild!
    expect(mediaDiv.classList.contains('album-item-media')).toBe(true)
    // элемент альбома автоплея не получает: таймкод + кнопка, самого <video> нет
    expect(mediaDiv.querySelector('span.video-time')!.firstChild!.nodeValue).toBe('0:46')
    expect(mediaDiv.querySelector('button.btn-circle.video-play.position-center')).toBeTruthy()
    expect(mediaDiv.querySelector('.video-time-icon')).toBeNull()
    expect(mediaDiv.querySelector('video')).toBeNull()
    // превью ячейки — ступень stripped вложения (серверной ступени у него нет):
    // её рисует `wrapPhoto` ранним выходом photo.ts:207, отсюда класс `media-photo`
    expect(mediaDiv.querySelector('canvas.canvas-thumbnail.thumbnail.media-photo')).toBeTruthy()
    // геометрия посчитана по ВСЕМ элементам, включая видео
    expect(parseFloat(videoItem.style.width)).toBeGreaterThan(0)
  })

  it('видео-элемент с серверным постером качает уменьшенную версию, а не полный файл', async () => {
    const attachmentDiv = attachment()
    const messages = [msg({}, (id) => videoMedia(id, { serverThumb: true }))]

    wrapAlbum({ messages, attachmentDiv })
    await flush()

    expect(downloadMediaURL).toHaveBeenCalledWith(1001, { thumb: true })
  })

  // tweb album.ts:150-153 — готовый таймкод вызывающего. Нужен ячейке, которую
  // враппер не рисует (непроплаченное платное медиа): длительность знает только
  // вызывающий, и бейдж обязан появиться независимо от загрузки.
  it('videoTimes: готовый таймкод вызывающего кладётся в ячейку, включая неоплаченную', async () => {
    const attachmentDiv = attachment()
    const messages = [msg(), paid()]
    const badge = document.createElement('span')
    badge.classList.add('video-time')
    badge.textContent = '0:12'

    wrapAlbum({ messages, attachmentDiv, videoTimes: [undefined, badge] })
    await flush()

    expect(attachmentDiv.children[0].querySelector('.video-time')).toBeNull()
    expect(attachmentDiv.children[1].firstElementChild!.lastElementChild).toBe(badge)
  })
})

// tweb album.ts:122-148 — крышка кладётся ПОЭЛЕМЕНТНО: у альбома одна ячейка
// может быть скрыта, а соседняя нет (признак живёт у каждого сообщения).
describe('wrapAlbum: скрытое медиа', () => {
  const helpers: { destroy: () => void }[] = []
  const mw = () => {
    const helper = getMiddleware()
    helpers.push(helper)
    return helper.get()
  }

  beforeEach(() => {
    vi.stubGlobal('devicePixelRatio', 1)
  })

  afterEach(() => {
    helpers.splice(0).forEach((h) => h.destroy())
    vi.unstubAllGlobals()
  })

  const covers = (attachmentDiv: HTMLElement) =>
    [...attachmentDiv.children].map((cell) => cell.querySelector('.media-spoiler-container'))

  it('признак сообщения накрывает ТОЛЬКО свою ячейку, поверх уже построенного медиа', async () => {
    const attachmentDiv = attachment()
    const messages = [msg(), msg({}, (id) => photoMedia(id, { spoiler: true }))]

    wrapAlbum({ messages, attachmentDiv, middleware: mw() })
    await flush()

    const [plain, hidden] = covers(attachmentDiv)
    expect(plain).toBeNull()
    expect(hidden).toBeTruthy()
    // дерево оригинала: размытое превью + слой точек
    expect(hidden!.querySelector('canvas.media-spoiler-thumbnail')).toBeTruthy()
    expect(hidden!.querySelector('canvas.canvas-dots')).toBeTruthy()
    // крышка легла В ЯЧЕЙКУ, а медиа под ней продолжает грузиться (крышка
    // перекрывает его z-index'ом, а не отменой загрузки)
    const mediaDiv = attachmentDiv.children[1].firstElementChild!
    expect(hidden!.parentElement).toBe(mediaDiv)
    expect(mediaDiv.querySelector('img.media-photo')).toBeTruthy()
    expect(downloadMediaURL).toHaveBeenCalledWith(mediaIdOf(messages[1]), { thumb: false })
  })

  it('размер крышки — процент ячейки от пиксельного бокса контейнера', async () => {
    const attachmentDiv = attachment()

    wrapAlbum({ messages: [msg({}, (id) => photoMedia(id, { spoiler: true }))], attachmentDiv, middleware: mw() })
    await flush()

    const cell = attachmentDiv.children[0] as HTMLElement
    const containerWidth = parseInt(attachmentDiv.style.width)
    const containerHeight = parseInt(attachmentDiv.style.height)
    const expectedWidth = +cell.style.width.slice(0, -1) / 100 * containerWidth
    const expectedHeight = +cell.style.height.slice(0, -1) / 100 * containerHeight

    const dots = cell.querySelector('canvas.canvas-dots') as HTMLCanvasElement
    expect(expectedWidth).toBeGreaterThan(0)
    expect(dots.width).toBe(Math.floor(expectedWidth))
    expect(dots.height).toBe(Math.floor(expectedHeight))
  })

  it('spoilered от вызывающего скрывает ВЕСЬ альбом (неоплаченное платное медиа)', async () => {
    const attachmentDiv = attachment()

    wrapAlbum({ messages: [msg(), msg()], attachmentDiv, middleware: mw(), spoilered: true })
    await flush()

    expect(covers(attachmentDiv).every(Boolean)).toBe(true)
  })

  it('протухшее поколение крышку не дописывает', async () => {
    const attachmentDiv = attachment()
    const helper = getMiddleware()

    wrapAlbum({ messages: [msg({}, (id) => photoMedia(id, { spoiler: true }))], attachmentDiv, middleware: helper.get() })
    helper.destroy()
    await flush()

    expect(covers(attachmentDiv)).toEqual([null])
  })
})

// tweb bubbles.ts:8929-8931 — у неоплаченного платного медиа `media_id` нет, и
// ячейку рисует ПСЕВДО-ФОТО из превью, а не пустой прямоугольник.
describe('wrapAlbum: неоплаченное платное медиа', () => {
  it('ячейка показывает превью сообщения как медиа и в сеть не ходит', async () => {
    const attachmentDiv = attachment()

    wrapAlbum({ messages: [paid(), paid()], attachmentDiv })
    await flush()

    const cells = [...attachmentDiv.children].map((cell) => cell.firstElementChild!)
    for (const mediaDiv of cells) {
      expect(mediaDiv.querySelector('canvas.canvas-thumbnail.thumbnail.media-photo')).toBeTruthy()
      // качать нечего: ни полного <img>, ни запроса к владельцу URL
      expect(mediaDiv.querySelector('img.media-photo')).toBeNull()
    }
    expect(downloadMediaURL).not.toHaveBeenCalled()
  })

  it('видео без оплаты — тоже псевдо-фото (ячейку рисует не wrapVideo)', async () => {
    const attachmentDiv = attachment()

    wrapAlbum({
      // неоплаченное видео приезжает тем же превью: длительности в нём нет
      // (её стирает `stripLockedMedia`), поэтому ячейку рисует не wrapVideo, а
      // псевдо-фото — как `generatePhotoForExtendedMediaPreview` у оригинала
      messages: [msg({}, () => paidPreviewMedia({ w: 900, h: 1600 }))],
      attachmentDiv,
    })
    await flush()

    const mediaDiv = attachmentDiv.children[0].firstElementChild!
    expect(mediaDiv.querySelector('canvas.canvas-thumbnail.thumbnail.media-photo')).toBeTruthy()
    expect(mediaDiv.querySelector('video')).toBeNull()
  })

  it('превью не пришло вовсе — ячейка всё равно не пустая (заплатка оригинала)', async () => {
    const attachmentDiv = attachment()

    wrapAlbum({ messages: [paid({ stripped: false })], attachmentDiv })
    await flush()

    const canvas = attachmentDiv.children[0].firstElementChild!
      .querySelector('canvas.canvas-thumbnail.media-photo') as HTMLCanvasElement
    expect(canvas).toBeTruthy()
    expect(canvas.dataset.uri).toMatch(/^data:image\/jpeg;base64,\/9j\//)
  })
})
