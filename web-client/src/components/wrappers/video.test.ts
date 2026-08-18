// wrapVideo — ванильный порт tweb `components/wrappers/video.ts`.
//
// Пиним то, что отличает порт от «поставил <video src> и всё»:
//   • дерево и классы совпадают с живым DOM tweb (docs/tweb/dom/dumps/
//     `03-video-poll.json` — `.video-time` + `.video-time-icon` + `.media-video`,
//     `03-service-round.json` — `.media-round.z-depth-1` > canvas/span/svg/video);
//   • информационный слой появляется ровно там, где предписывает оригинал:
//     таймкод у видео, бейдж GIF у гифки, иконка «без звука» только у автоплея,
//     кнопка воспроизведения — только когда автоплея нет;
//   • АДРЕС видео берётся через `resolveStreamUrl` (стрим), а не через конвейер
//     картинок: при DNP-ON это асинхронный `/dnp-stream/{id}`, и путь не ломается;
//   • смена медиа-токена доезжает до ЖИВОГО элемента (иначе 401 на середине);
//   • постер строится из ступени `photoStrippedSize` вложения — у видео
//     «скачано» относится к файлу, а не к первому кадру;
//   • кружок играет ЧЕРЕЗ контроллер коллекции (элемент принадлежит сообщению),
//     а не заводит себе второй звук;
//   • протухший middleware в DOM ничего не дописывает.
//
// Мокаем ГРАНИЦУ владельца (managers.media.*) — `ensureMediaUrl`, зеркало,
// `core/mediaUrl`, `wrapPhoto` и контроллер коллекции работают настоящие.
// Модульное состояние (зеркало URL, токен, коллекция) живёт в модулях, поэтому
// каждый кейс поднимает свежий реестр (vi.resetModules), как в photo.test.ts.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  saveDocument,
  THUMB_TYPE_SERVER,
  THUMB_TYPE_STRIPPED,
  type DocumentAttribute,
  type MyDocument,
  type PhotoSize,
} from '@core/media/messageMedia'

const { downloadMediaURL, contentUrl, streamUrl, tokenInfo } = vi.hoisted(() => ({
  downloadMediaURL: vi.fn<(id: number, opts?: { thumb?: boolean }) => Promise<string>>(),
  contentUrl: vi.fn<(id: number) => Promise<string>>(),
  streamUrl: vi.fn<(id: number) => Promise<string>>(),
  tokenInfo: vi.fn<() => Promise<{ token: string, expiresAt: number }>>(),
}))
vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL, contentUrl, streamUrl, tokenInfo } } }),
}))

// blur грузит Image из data:-URI — happy-dom onload не гарантирует; мок держит
// контракт (канвас .canvas-thumbnail + промис готовности).
vi.mock('@helpers/blur', () => ({
  default: vi.fn((dataUri: string) => {
    const canvas = document.createElement('canvas')
    canvas.className = 'canvas-thumbnail'
    canvas.dataset.uri = dataUri
    return { canvas, promise: Promise.resolve() }
  }),
}))

type FakeMedia = HTMLMediaElement & { _playing?: boolean, _time?: number, _dur?: number }

let wrapVideo: typeof import('./video').default
let USE_VIDEO_OBSERVER: boolean
let mediaUrl: typeof import('@core/mediaUrl')
let mediaCache: typeof import('@core/mediaCache')
let playback: typeof import('@core/audio/mediaPlaybackController')
let getMiddleware: typeof import('@helpers/middleware').getMiddleware
let settings: typeof import('@/settings')

const STRIPPED = 'AAECAwQ='
const TOKEN = (token: string) => ({ token, expiresAt: Date.now() + 900_000 })

const flush = async () => {
  for (let i = 0; i < 5; ++i) await new Promise<void>((r) => { setTimeout(r, 0) })
}

/** Свежий реестр модулей; `dnp` поднимает канал DNP (адрес стрима — асинхронный). */
async function setup(opts: { dnp?: boolean } = {}) {
  vi.resetModules()
  if (opts.dnp) {
    vi.doMock('@config/app', () => ({
      AppConfig: { dnp: { enabled: true, serverStaticPublicKeys: [] }, vanillaFeed: false },
    }))
  } else {
    vi.doUnmock('@config/app')
  }

  const mod = await import('./video')
  wrapVideo = mod.default
  USE_VIDEO_OBSERVER = mod.USE_VIDEO_OBSERVER
  mediaUrl = await import('@core/mediaUrl')
  mediaCache = await import('@core/mediaCache')
  playback = await import('@core/audio/mediaPlaybackController')
  getMiddleware = (await import('@helpers/middleware')).getMiddleware
  settings = await import('@/settings')
}

beforeAll(() => {
  // Медиа-элементы окружения не играют — прототип подменён предсказуемыми
  // заглушками, дёргающими настоящие события (приём из components/audio.test.ts).
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>
  const define = (key: string, desc: PropertyDescriptor) =>
    Object.defineProperty(proto, key, { configurable: true, ...desc })
  define('HAVE_METADATA', { get() { return 1 } })
  define('readyState', { get() { return 0 } })
  define('paused', { get(this: FakeMedia) { return !this._playing } })
  define('currentTime', {
    get(this: FakeMedia) { return this._time ?? 0 },
    set(this: FakeMedia, v: number) { this._time = v },
  })
  define('duration', {
    get(this: FakeMedia) { return this._dur ?? 0 },
    set(this: FakeMedia, v: number) { this._dur = v },
  })
  proto.play = function(this: FakeMedia) {
    this._playing = true
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  proto.pause = function(this: FakeMedia) {
    if(!this._playing) return
    this._playing = false
    this.dispatchEvent(new Event('pause'))
  }
  proto.load = function() {}

  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true, writable: true, value: () => Promise.resolve(),
  })
})

beforeEach(async () => {
  downloadMediaURL.mockReset()
  downloadMediaURL.mockImplementation((id, o) => Promise.resolve(`blob:${id}${o?.thumb ? '_thumb' : ''}`))
  contentUrl.mockReset()
  contentUrl.mockImplementation((id) => Promise.resolve(`/api/media/${id}/content?token=async`))
  streamUrl.mockReset()
  streamUrl.mockImplementation((id) => Promise.resolve(`/dnp-stream/${id}?size=1&mime=video%2Fmp4`))
  tokenInfo.mockReset()
  tokenInfo.mockResolvedValue(TOKEN('T1'))
  await setup()
})

afterEach(() => {
  document.body.replaceChildren()
})

const box = () => {
  const container = document.createElement('div')
  container.classList.add('attachment')
  document.body.append(container)
  return container
}

/**
 * Обычное видео истории: с серверной ступенью постера и stripped-ступенью.
 * Документ — в форме оригинала: `type`/`w`/`h`/`duration` рукой не задаются, их
 * выводит `saveDocument` из атрибутов (порт `appDocsManager.saveDoc`).
 */
const videoDoc = ({
  id = 7, w = 1600, h = 900, duration = 46, size = 3 * 1024 * 1024,
  round, animated, serverThumb = true,
}: {
  id?: number, w?: number, h?: number, duration?: number, size?: number,
  round?: true, animated?: true, serverThumb?: boolean,
} = {}): MyDocument => saveDocument({
  _: 'document',
  id,
  mime_type: 'video/mp4',
  size,
  attributes: [
    { _: 'documentAttributeVideo', duration, w, h, ...(round ? { pFlags: { round_message: true as const } } : {}) },
    ...(animated ? [{ _: 'documentAttributeAnimated' } as DocumentAttribute] : []),
  ],
  thumbs: [
    { _: 'photoStrippedSize', type: THUMB_TYPE_STRIPPED, bytes: STRIPPED },
    ...(serverThumb ? [{ _: 'photoSize', type: THUMB_TYPE_SERVER, w: 400, h: 225, size: 20_000 } as PhotoSize] : []),
  ],
})

const REGULAR = { boxWidth: 420, boxHeight: 400 }

describe('wrapVideo: информационный слой и дерево', () => {
  it('видео с автоплеем: таймкод + иконка «без звука», кнопки воспроизведения нет', async () => {
    const container = box()
    mediaUrl.applyMediaToken(TOKEN('T1'))

    const res = await wrapVideo({
      doc: videoDoc(), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    const spanTime = container.querySelector('span.video-time')!
    expect(spanTime).toBeTruthy()
    // порядок tweb: .video-time встаёт в контейнер ДО постера (кольцо загрузки
    // прибавляется prepend'ом и потому оказывается перед ним — как в оригинале)
    const kids = [...container.children]
    expect(kids.indexOf(spanTime)).toBeLessThan(kids.findIndex((el) => el.classList.contains('media-photo')))
    expect(spanTime.firstChild!.nodeValue).toBe('0:46')
    expect(spanTime.querySelector('span.tgico.video-time-icon')).toBeTruthy()
    expect(container.querySelector('button.video-play')).toBeNull()

    // видео встаёт в дерево по первому кадру (tweb `onMediaLoad`; happy-dom
    // стреляет `canplay` прямо на присвоении src, поэтому к этому моменту готово)
    const video = container.querySelector('video.media-video') as HTMLVideoElement
    expect(video).toBe(res.video)
    expect(video.autoplay).toBe(true)
    expect(video.loop).toBe(true)
    expect(video.muted).toBe(true)
  })

  it('крупное видео (>50 МБ): кнопка воспроизведения вместо автоплея, стрим не трогаем', async () => {
    const container = box()

    const res = await wrapVideo({
      doc: videoDoc({ size: 60 * 1024 * 1024 }), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    const play = container.querySelector('button.btn-circle.video-play.position-center')!
    expect(play).toBeTruthy()
    expect(play.querySelector('span.tgico.button-icon')).toBeTruthy()
    expect(container.querySelector('.video-time-icon')).toBeNull()
    // ранний выход оригинала: элемента видео нет вовсе, показан постер
    expect(res.video).toBeUndefined()
    expect(container.querySelector('video')).toBeNull()
    expect(downloadMediaURL).toHaveBeenCalledWith(7, { thumb: true })
  })

  it('элемент альбома (бокс задаёт грид): автоплея нет даже у маленького видео', async () => {
    const container = box()

    const res = await wrapVideo({
      doc: videoDoc(), container, message: { mid: 1, peerId: -42 },
      boxWidth: 0, boxHeight: 0, noAutoplayAttribute: true, middleware: getMiddleware().get(),
    })
    await flush()

    expect(container.querySelector('button.video-play')).toBeTruthy()
    expect(res.video).toBeUndefined()
  })

  it('гифка: бейдж GIF вместо таймкода, цикл-автоплей без кнопки', async () => {
    const container = box()
    mediaUrl.applyMediaToken(TOKEN('T1'))

    const res = await wrapVideo({
      doc: videoDoc({ animated: true, serverThumb: false }), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    expect(container.classList.contains('media-gif-wrapper')).toBe(true)
    expect(container.dataset.docId).toBe('7')
    expect(container.querySelector('span.video-time')!.textContent).toBe('GIF')
    expect(container.querySelector('.video-time-icon')).toBeNull()
    expect(container.querySelector('button.video-play')).toBeNull()

    res.video!.dispatchEvent(new Event('canplay'))
    await flush()
    const video = container.querySelector('video.media-video') as HTMLVideoElement
    expect(video.loop).toBe(true)
    expect(video.autoplay).toBe(true)
    expect(video.src).toContain('/api/media/7/content?token=T1')
  })

  it('гейт автоплея гифки (liteMode): без анимаций — кнопка, и стрим только по клику', async () => {
    settings.useSettingsStore.setState({ reduceMotion: true })
    mediaUrl.applyMediaToken(TOKEN('T1'))
    const container = box()

    const res = await wrapVideo({
      doc: videoDoc({ animated: true, serverThumb: false }), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    expect(container.querySelector('button.video-play')).toBeTruthy()
    expect(container.querySelector('span.video-time')!.textContent).toBe('GIF')
    expect(res.video!.getAttribute('src')).toBeNull()

    container.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()

    expect(res.video!.src).toContain('/api/media/7/content?token=T1')
    expect(container.querySelector('button.video-play')).toBeNull()
    settings.useSettingsStore.setState({ reduceMotion: false })
  })
})

describe('wrapVideo: постер', () => {
  it('без серверного постера превью показывается КАК медиа и держится, даже когда байты уже в зеркале', async () => {
    // Ранний выход tweb photo.ts:207: подходящей ступени у документа нет
    // (`photoSizeEmpty` у оригинала, отсутствие ступени у нас), поэтому постером
    // работает stripped и рисует его тот же `wrapPhoto` (класс `media-photo`, а
    // не подложка `media-poster` кладки). «Скачано» при этом считается ПО
    // ВЫБРАННОЙ ступени: своего файла у stripped нет, поэтому попадание полного
    // файла в зеркало превью не снимает — иначе бабл открылся бы пустым.
    mediaCache.applyMediaUrl({ id: 7, thumb: false, url: 'blob:7' })
    mediaUrl.applyMediaToken(TOKEN('T1'))
    const container = box()

    await wrapVideo({
      doc: videoDoc({ serverThumb: false }), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    expect(container.querySelector('canvas.canvas-thumbnail.thumbnail.media-photo')).toBeTruthy()
    // постера на сервере нет — за картинкой не ходим, и mp4 в <img> не просим
    expect(downloadMediaURL).not.toHaveBeenCalled()
    expect(container.querySelector('img.media-photo')).toBeNull()
  })

  it('серверный постер качается уменьшенной версией и живёт под видео', async () => {
    mediaUrl.applyMediaToken(TOKEN('T1'))
    const container = box()

    const res = await wrapVideo({
      doc: videoDoc(), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    expect(downloadMediaURL).toHaveBeenCalledWith(7, { thumb: true })
    const poster = container.querySelector('img.media-photo') as HTMLImageElement
    expect(poster.src).toContain('blob:7_thumb')

    res.video!.dispatchEvent(new Event('canplay'))
    await flush()
    // видео легло в тот же слой, что и постер (tweb: `photoRes.aspecter`)
    expect(res.video!.parentElement).toBe(res.thumb!.aspecter)
  })

  // tweb video.ts:412 отдаёт в `wrapPhoto` САМ документ (`photo: doc`), а
  // `setAttachmentSize` подставляет документу дефолт 512×512 (:52-56), не 100.
  // Видео без media_w/media_h иначе резервировало бы 200×200.
  it('видео без натуральных размеров резервирует бокс от 512 (400×400)', async () => {
    mediaUrl.applyMediaToken(TOKEN('T1'))
    const container = box()

    await wrapVideo({
      doc: videoDoc({ w: 0, h: 0, serverThumb: false }), container,
      message: { mid: 1, peerId: -42 }, ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    expect(container.style.width).toBe('400px')
    expect(container.style.height).toBe('400px')
  })
})

describe('wrapVideo: стриминг и токен', () => {
  it('src берётся через resolveStreamUrl (токен-URL стрима), а не через конвейер картинок', async () => {
    mediaUrl.applyMediaToken(TOKEN('T1'))
    const container = box()

    const res = await wrapVideo({
      doc: videoDoc({ serverThumb: false }), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    expect(res.video!.src).toContain('/api/media/7/content?token=T1')
    // байты видео конвейер картинок не тянет
    expect(downloadMediaURL).not.toHaveBeenCalled()
  })

  it('DNP-ON: адрес резолвится асинхронно и доезжает до элемента', async () => {
    await setup({ dnp: true })
    mediaUrl.applyMediaToken(TOKEN('T1')) // токен есть — и всё равно идём в канал
    const container = box()

    const res = await wrapVideo({
      doc: videoDoc({ serverThumb: false }), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    // адрес считает воркер (Noise-канал), токенный content-URL не строится
    expect(streamUrl).toHaveBeenCalledWith(7)
    expect(contentUrl).not.toHaveBeenCalled()
    expect(res.video!.src).toContain('/dnp-stream/7')
  })

  it('смена токена пересобирает src живого элемента, сохраняя позицию', async () => {
    mediaUrl.applyMediaToken(TOKEN('T1'))
    const container = box()

    const res = await wrapVideo({
      doc: videoDoc({ serverThumb: false }), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()
    const video = res.video as FakeMedia & HTMLVideoElement
    expect(video.src).toContain('token=T1')

    video._time = 12
    mediaUrl.applyMediaToken(TOKEN('T2'))
    await flush()

    expect(video.src).toContain('token=T2')
    video.dispatchEvent(new Event('loadedmetadata'))
    expect(video.currentTime).toBe(12)
  })

  it('протухший middleware: в DOM ничего не дописывается', async () => {
    const helper = getMiddleware()
    const container = box()

    const promise = wrapVideo({
      doc: videoDoc({ serverThumb: false }), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: helper.get(),
    })
    helper.destroy()
    const res = await promise
    await flush()

    // '' — след уборки createVideo (onDestroy отпускает декодер); адрес стрима
    // элементу не назначался, в дерево он не попал
    expect(res.video!.getAttribute('src') ?? '').not.toContain('/api/media/7')
    expect(container.querySelector('video.media-video')).toBeNull()
  })
})

describe('wrapVideo: кружок', () => {
  const roundDoc = () => videoDoc({ round: true, w: 240, h: 240, duration: 8, serverThumb: false })

  it('дерево 1:1 с живым DOM tweb', async () => {
    mediaUrl.applyMediaToken(TOKEN('T1'))
    const container = box()

    await wrapVideo({
      doc: roundDoc(), container, message: { mid: 5, peerId: -42, mediaUnread: true },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    const divRound = container.querySelector('div.media-round.z-depth-1') as HTMLElement
    expect(divRound).toBeTruthy()
    expect(divRound.dataset.mid).toBe('5')
    expect(divRound.dataset.peerId).toBe('-42')
    expect(divRound.classList.contains('is-unread')).toBe(true)
    expect(divRound.classList.contains('is-paused')).toBe(true)

    // порядок узлов оригинала: canvas, .video-time, кольцо, само видео
    const kids = [...divRound.children].map((el) => el.tagName.toLowerCase() + '.' + el.className.toString())
    expect(kids[0]).toContain('canvas.video-round-canvas')
    expect(kids[1]).toContain('span.video-time')
    expect(divRound.children[2].classList.contains('progress-ring')).toBe(true)
    expect(divRound.children[2].firstElementChild!.classList.contains('progress-ring__circle')).toBe(true)
    expect(kids[3]).toContain('video.media-video')
    // на паузе бейдж показывает иконку «без звука»
    expect(divRound.querySelector('span.video-time .video-time-icon')).toBeTruthy()
  })

  it('воспроизведение идёт через контроллер коллекции, кольцо прогресса обновляется', async () => {
    mediaUrl.applyMediaToken(TOKEN('T1'))
    const container = box()

    await wrapVideo({
      doc: roundDoc(), container, message: { mid: 5, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    // элемент со звуком принадлежит СООБЩЕНИЮ и живёт в контроллере
    const globalVideo = playback.mediaPlayback.getMedia(7) as FakeMedia
    expect(globalVideo).toBeTruthy()
    expect(globalVideo).not.toBe(container.querySelector('video.media-video'))
    globalVideo._dur = 10
    globalVideo._time = 5

    const divRound = container.querySelector('div.media-round') as HTMLElement
    const circle = divRound.querySelector('.progress-ring__circle') as SVGCircleElement
    const before = circle.style.strokeDashoffset

    const canvas = divRound.querySelector('canvas.video-round-canvas') as HTMLElement
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()

    expect(globalVideo.paused).toBe(false)
    // очередь объявил контроллер — трек стал текущим
    expect(divRound.classList.contains('is-paused')).toBe(false)
    expect(divRound.querySelector('video.media-video')!.classList.contains('hide')).toBe(true)
    expect(circle.style.strokeDashoffset).not.toBe(before)
    expect(parseFloat(circle.style.strokeDashoffset)).toBeCloseTo(parseFloat(before) / 2, 1)

    // повторный клик — пауза (через тот же элемент коллекции)
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(globalVideo.paused).toBe(true)
    expect(divRound.classList.contains('is-paused')).toBe(true)

    playback.resetPlayback()
  })

  // tweb video.ts:54-74 — размер кружка зависит от брейкпоинта
  // (HANDHELDS.round ≠ DESKTOP.round), а бабл на смене экрана не пересобирается:
  // кольцо обязано пересчитаться на месте, иначе оно останется прежнего диаметра
  // поверх кружка нового размера.
  it('смена брейкпоинта пересчитывает кольца ЖИВЫХ кружков на месте', async () => {
    mediaUrl.applyMediaToken(TOKEN('T1'))
    const container = box()
    document.body.append(container) // хендлер ищет кольца по документу

    await wrapVideo({
      doc: roundDoc(), container, message: { mid: 5, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    const svg = container.querySelector('.media-round .progress-ring') as SVGSVGElement
    const circle = svg.firstElementChild as SVGCircleElement
    const sizes = await import('@core/dom/mediaSizes')
    const before = svg.getAttribute('width')
    expect(before).toBe('' + sizes.DESKTOP.round.width)

    sizes.default.active = sizes.HANDHELDS
    sizes.default.dispatchEvent('changeScreen', sizes.ScreenSize.large, sizes.ScreenSize.mobile)

    const width = sizes.HANDHELDS.round.width
    // предмет проверки существует только пока размеры кружка РАЗНЫЕ
    expect(width).not.toBe(sizes.DESKTOP.round.width)
    const radius = width / 2 - 3.5 * 2
    expect(svg.getAttribute('width')).toBe('' + width)
    expect(svg.getAttribute('height')).toBe('' + width)
    expect(circle.getAttribute('cx')).toBe('' + width / 2)
    expect(circle.getAttribute('cy')).toBe('' + width / 2)
    expect(circle.getAttribute('r')).toBe('' + radius)
    // кольцо сброшено в пустое: dashoffset = полная новая окружность
    const circumference = 2 * Math.PI * radius
    expect(parseFloat(circle.style.strokeDashoffset)).toBeCloseTo(circumference, 6)
    expect(circle.style.strokeDasharray).toBe(`${circumference} ${circumference}`)

    sizes.default.active = sizes.DESKTOP
    container.remove()
    playback.resetPlayback()
  })
})

// Минимальная ширина видео (MIN_VIDEO_SIDE_SIZE = 368) в оригинале принадлежит
// НЕ типу медиа, а UI плеера: в `canHaveVideoPlayer` едет `willObserveSound`
// (tweb video.ts:428), а он поднимается только под гейтом
// `observer && USE_VIDEO_OBSERVER` (video.ts:151-157), и константа стоит
// `false`. Значит, в tweb этот минимум не срабатывает НИ РАЗУ — узкое видео
// рисуется вписанным, а не расширенным. Порт «намерения»
// (`canHaveVideoPlayer: doc.type === 'video'`) делал наш бокс шире
// оригинального; кейс краснеет на возврате такого порта.
describe('wrapVideo: бокс узкого видео — гейт USE_VIDEO_OBSERVER', () => {
  it('узкое видео получает ВПИСАННЫЙ бокс (133×400), а не расширенный до 368', async () => {
    const container = box()
    mediaUrl.applyMediaToken(TOKEN('T1'))

    await wrapVideo({
      doc: videoDoc({ w: 200, h: 600 }), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    expect(USE_VIDEO_OBSERVER).toBe(false) // причина: гейт закрыт, ровно как в tweb
    expect(container.style.width).toBe('133px')
    expect(container.style.height).toBe('400px')
  })

  it('второй потребитель того же флага: без наблюдателя звука у видео нет PiP', async () => {
    const container = box()
    mediaUrl.applyMediaToken(TOKEN('T1'))

    const res = await wrapVideo({
      doc: videoDoc(), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    // createVideo({pip: willObserveSound}) — tweb video.ts:217
    expect(res.video!.disablePictureInPicture).toBe(true)
  })
})
