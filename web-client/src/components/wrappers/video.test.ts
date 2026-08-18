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
//   • постер строится из `media_blur` через `getStrippedThumbIfNeeded({isVideo})`
//     — у видео «скачано» относится к файлу, а не к первому кадру;
//   • кружок играет ЧЕРЕЗ контроллер коллекции (элемент принадлежит сообщению),
//     а не заводит себе второй звук;
//   • протухший middleware в DOM ничего не дописывает.
//
// Мокаем ГРАНИЦУ владельца (managers.media.*) — `ensureMediaUrl`, зеркало,
// `core/mediaUrl`, `wrapPhoto` и контроллер коллекции работают настоящие.
// Модульное состояние (зеркало URL, токен, коллекция) живёт в модулях, поэтому
// каждый кейс поднимает свежий реестр (vi.resetModules), как в photo.test.ts.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
let videoDocFromMessage: typeof import('./video').videoDocFromMessage
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
  videoDocFromMessage = mod.videoDocFromMessage
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

/** Обычное видео истории: маленькое, с серверным постером и stripped-превью. */
const videoDoc = (over: Partial<import('./video').WrapVideoDoc> = {}): import('./video').WrapVideoDoc => ({
  id: 7,
  type: 'video',
  width: 1600,
  height: 900,
  duration: 46,
  size: 3 * 1024 * 1024,
  mime: 'video/mp4',
  strippedThumb: STRIPPED,
  hasThumb: true,
  ...over,
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
      doc: videoDoc({ type: 'gif', hasThumb: false }), container, message: { mid: 1, peerId: -42 },
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
      doc: videoDoc({ type: 'gif', hasThumb: false }), container, message: { mid: 1, peerId: -42 },
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
  it('без серверного постера превью строится из media_blur и держится, даже когда байты уже в зеркале', async () => {
    // «скачано» для видео — про файл, а не про первый кадр: без isVideo подложка
    // здесь не появилась бы вовсе, и бабл открылся бы пустым прямоугольником
    mediaCache.applyMediaUrl({ id: 7, thumb: false, url: 'blob:7' })
    mediaUrl.applyMediaToken(TOKEN('T1'))
    const container = box()

    await wrapVideo({
      doc: videoDoc({ hasThumb: false }), container, message: { mid: 1, peerId: -42 },
      ...REGULAR, middleware: getMiddleware().get(),
    })
    await flush()

    expect(container.querySelector('canvas.canvas-thumbnail.thumbnail.media-poster')).toBeTruthy()
    // постера на сервере нет — за картинкой не ходим
    expect(downloadMediaURL).not.toHaveBeenCalled()
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
})

describe('wrapVideo: стриминг и токен', () => {
  it('src берётся через resolveStreamUrl (токен-URL стрима), а не через конвейер картинок', async () => {
    mediaUrl.applyMediaToken(TOKEN('T1'))
    const container = box()

    const res = await wrapVideo({
      doc: videoDoc({ hasThumb: false }), container, message: { mid: 1, peerId: -42 },
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
      doc: videoDoc({ hasThumb: false }), container, message: { mid: 1, peerId: -42 },
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
      doc: videoDoc({ hasThumb: false }), container, message: { mid: 1, peerId: -42 },
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
      doc: videoDoc({ hasThumb: false }), container, message: { mid: 1, peerId: -42 },
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
  const roundDoc = () => videoDoc({ type: 'round', width: 240, height: 240, duration: 8, hasThumb: false })

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
})

describe('videoDocFromMessage', () => {
  const base = {
    id: 1, chatId: -42, seq: 1, senderId: 1, text: '', replyToId: null,
    createdAt: '2026-08-16T00:00:00Z', threadRootId: null,
  }

  it('тип медиа читается из данных сервера: roundVideo → кружок, media_animated → гифка', () => {
    const doc = (patch: Record<string, unknown>) =>
      videoDocFromMessage({ ...base, type: 'video', mediaId: 7, ...patch } as never)

    expect(doc({})!.type).toBe('video')
    expect(doc({ mediaAnimated: true })!.type).toBe('gif')
    expect(doc({ type: 'roundVideo' })!.type).toBe('round')
    // платное медиа до оплаты приезжает без media_id — качать нечего
    expect(videoDocFromMessage({ ...base, type: 'video', mediaId: null } as never)).toBeNull()
  })
})
