// wrapPhoto — ванильный порт tweb `components/wrappers/photo.ts`.
//
// Пиним свойства, которые отличают порт от «поставил img.src и всё»:
//   • дерево и классы совпадают с живым DOM tweb (docs/tweb/dom/dumps/:
//     `.media-container` / `-fitted` / `-aspecter`, `.media-photo`, `.thumbnail`);
//   • stripped-превью из самого сообщения попадает в DOM СИНХРОННО, до любой
//     сети, а полное медиа встаёт ПОВЕРХ него и снимает его ПО СОБЫТИЮ
//     анимации, а не по таймеру;
//   • URL берётся только через `ensureMediaUrl` — значит ответ владельца
//     оказывается в зеркале и достаётся следующему потребителю того же id без
//     второго round-trip'а (пин обхода — core/noDuplicateMediaUrl.test.ts);
//   • протухший `middleware` в DOM ничего не дописывает;
//   • `ProgressivePreloader` появляется на время загрузки и снимается после.
//
// Мокаем ГРАНИЦУ, а не сам конвейер: подменён только владелец
// (`managers.media.downloadMediaURL`), а `ensureMediaUrl` + зеркало
// `core/mediaCache` работают настоящие. Модульное состояние (зеркало, склейка
// inflight) живёт в модулях, поэтому каждый кейс поднимает свежий реестр
// (vi.resetModules) — как в core/media/ensureMediaUrl.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import { createLazyLoadQueue } from '@core/lazyLoadQueue'
import generatePhotoForExtendedMediaPreview from '@core/media/generatePhotoForExtendedMediaPreview'
import {
  THUMB_TYPE_FULL,
  THUMB_TYPE_SERVER,
  THUMB_TYPE_STRIPPED,
  type MyDocument,
  type MyPhoto,
  type PhotoSize,
} from '@core/media/messageMedia'

const { downloadMediaURL } = vi.hoisted(() => ({
  downloadMediaURL: vi.fn<(id: number, opts?: { thumb?: boolean }) => Promise<string>>(),
}))
vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL } } }),
}))

// blur грузит Image из data:-URI — happy-dom onload не гарантирует; мок держит
// контракт (канвас .canvas-thumbnail + промис готовности), как в
// core/media/getStrippedThumbIfNeeded.test.ts.
vi.mock('@helpers/blur', () => ({
  default: vi.fn((dataUri: string) => {
    const canvas = document.createElement('canvas')
    canvas.className = 'canvas-thumbnail'
    canvas.dataset.uri = dataUri
    ;(canvas as unknown as { toDataURL: () => string }).toDataURL = () => 'data:image/jpeg;base64,BLURRED'
    return { canvas, promise: Promise.resolve() }
  }),
}))

let wrapPhoto: typeof import('./photo').default
let cache: typeof import('@core/mediaCache')

const STRIPPED = 'AAECAwQ='

// Вложения — в форме оригинала (лестница `PhotoSize`), вопросы к ней задаёт
// сам враппер: `choosePhotoSize` выбирает ступень, ступень решает адрес файла.
const photo = ({ id = 7, w = 1600, h = 900, stripped = true, serverThumb = false } = {}): MyPhoto => ({
  _: 'photo',
  id,
  sizes: [
    ...(stripped ? [{ _: 'photoStrippedSize', type: THUMB_TYPE_STRIPPED, bytes: STRIPPED } as PhotoSize] : []),
    ...(serverThumb ? [{ _: 'photoSize', type: THUMB_TYPE_SERVER, w: 400, h: 225, size: 20_000 } as PhotoSize] : []),
    { _: 'photoSize', type: THUMB_TYPE_FULL, w, h, size: 200_000 },
  ],
})

// Псевдо-фото неоплаченного платного медиа: единственная ступень — stripped
// (её и производит `generatePhotoForExtendedMediaPreview` из превью).
const previewPhoto = () => generatePhotoForExtendedMediaPreview(photo({ w: 600, h: 800 }))

// Видео без серверного постера: подходящей ступени в `thumbs` нет вовсе —
// у оригинала это `photoSizeEmpty`, у нас отсутствие ступени.
const videoDocWithoutPoster = (): MyDocument => ({
  _: 'document',
  id: 9,
  mime_type: 'video/mp4',
  size: 3_000_000,
  type: 'video',
  w: 600,
  h: 800,
  attributes: [{ _: 'documentAttributeVideo', duration: 12, w: 600, h: 800 }],
  thumbs: [{ _: 'photoStrippedSize', type: THUMB_TYPE_STRIPPED, bytes: STRIPPED }],
})

function deferred() {
  let resolve!: (url: string) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  vi.resetModules()
  downloadMediaURL.mockReset()
  downloadMediaURL.mockResolvedValue('blob:full')
  // happy-dom не декодирует картинки — стаб «декодировано мгновенно»
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true, writable: true, value: () => Promise.resolve(),
  })
  wrapPhoto = (await import('./photo')).default
  cache = await import('@core/mediaCache')
})

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

const box = () => {
  const container = document.createElement('div')
  container.classList.add('attachment')
  return container
}

// wrapPhoto (как и оригинал) резолвится, НЕ дожидаясь отрисовки полного медиа:
// `loadPromise` — это `ret.loadPromises.full`, вызывающий сам решает, ждать его
// или отдать бабл в ленту сразу с одним превью.
type Wrapped = Awaited<ReturnType<typeof wrapPhoto>>
const rendered = async (promise: Promise<Wrapped>) => {
  const ret = await promise
  await ret.loadPromises.full.catch(() => {}) // отказ владельца/протухший middleware — штатный исход
  return ret
}

describe('wrapPhoto: дерево и слои', () => {
  it('вписанное медиа: контейнер .media-container с боксом в пикселях, превью → полное поверх', async () => {
    const container = box()

    const promise = wrapPhoto({
      photo: photo(), container, middleware: getMiddleware().get(),
    })

    // ── синхронно, ДО сети ──
    expect(container.classList.contains('media-container')).toBe(true)
    expect(container.style.width).toBe('420px')
    expect(container.style.height).toBe('236px')
    const thumb = container.querySelector('canvas.canvas-thumbnail.thumbnail.media-photo')
    expect(thumb).toBeTruthy()
    expect(container.querySelector('img.media-photo')).toBeNull()

    const ret = await rendered(promise)

    // ── полное медиа встало ПОВЕРХ превью, превью ещё на месте ──
    const full = container.querySelector('img.media-photo')!
    expect(full).toBe(ret.images.full)
    expect(ret.images.thumb).toBe(thumb)
    // порядок по DOM: превью раньше медиа → медиа рисуется поверх
    expect(thumb!.nextElementSibling).toBe(full)
    expect(full.classList.contains('fade-in')).toBe(true)
    expect(thumb!.parentElement).toBe(container)
    // бокс не расширяли → аспектера нет, слой один
    expect(ret.aspecter).toBe(container)
    expect(container.querySelector('.media-container-aspecter')).toBeNull()
    expect(container.classList.contains('media-container-fitted')).toBe(false)
  })

  // Это и есть «не по таймеру»: длительность анимации живёт в CSS.
  it('превью снимается по событию animationend, а не по времени', async () => {
    vi.useFakeTimers()
    const container = box()
    await rendered(wrapPhoto({ photo: photo(), container }))

    const thumb = container.querySelector('canvas.thumbnail')!
    const full = container.querySelector('img.media-photo')!

    await vi.advanceTimersByTimeAsync(5000)
    expect(thumb.parentElement).toBe(container)
    expect(container.classList.contains('no-background')).toBe(false)

    full.dispatchEvent(new Event('animationend'))
    await vi.advanceTimersByTimeAsync(32)

    expect(thumb.parentElement).toBeNull()
    expect(container.classList.contains('no-background')).toBe(true)
  })

  // Живой DOM tweb: docs/tweb/dom/dumps/03-video-poll.json —
  // .media-container.media-container-fitted 320×400 > .media-container-aspecter 300×400.
  it('расширенный бокс: подложка на весь контейнер + аспектер СВОЕГО размера', async () => {
    const container = box()

    const ret = await rendered(wrapPhoto({
      photo: photo({ w: 600, h: 800 }), container, hasMessageBlock: true,
    }))

    expect(container.classList.contains('media-container-fitted')).toBe(true)
    expect(container.style.width).toBe('320px') // EXPAND_TEXT_WIDTH
    expect(container.style.height).toBe('400px')

    const aspecter = ret.aspecter!
    expect(aspecter.className).toBe('media-container-aspecter')
    expect(aspecter.parentElement).toBe(container)
    // аспектер держит ВПИСАННЫЙ размер, а не расширенный бокс контейнера
    expect(aspecter.style.width).toBe('300px')
    expect(aspecter.style.height).toBe('400px')

    // подложка — прямой ребёнок контейнера (закрывает поля по краям),
    // превью и полное медиа — внутри аспектера
    const backdrop = container.querySelector(':scope > canvas.thumbnail.media-photo')
    expect(backdrop).toBeTruthy()
    expect(aspecter.querySelector('canvas.thumbnail.media-photo')).toBeTruthy()
    expect(aspecter.querySelector('img.media-photo')).toBe(ret.images.full)
  })

  it('элемент альбома (boxWidth/boxHeight = 0): бокс не назначается, слой один', async () => {
    const container = box()

    const ret = await rendered(wrapPhoto({
      photo: photo({ w: 600, h: 800 }), container, boxWidth: 0, boxHeight: 0,
    }))

    expect(container.style.width).toBe('')
    expect(container.style.height).toBe('')
    expect(ret.aspecter).toBe(container)
    expect(container.querySelector('img.media-photo')).toBeTruthy()
  })

  // tweb photo.ts:207-209: показывать больше нечего — выбранная ступень САМА
  // является байтами превью. Так рисуется неоплаченное платное медиа: без этой
  // ветки враппер строил бы `<img>` и шёл за байтами, которых нет.
  it('ступень stripped: превью показано КАК медиа — без <img>, без сети', async () => {
    const container = box()

    const ret = await rendered(wrapPhoto({
      photo: previewPhoto(), container,
    }))

    // бокс контейнера всё равно назначен (ветка сайзинга в оригинале идёт раньше)
    expect(container.style.width).toBe('300px')
    expect(container.style.height).toBe('400px')

    const media = container.querySelector('canvas.canvas-thumbnail.thumbnail.media-photo')!
    expect(media).toBeTruthy()
    expect(ret.images.thumb).toBe(media)
    // полного медиа нет вовсе — ни узла, ни байтов, ни кольца
    expect(ret.images.full).toBeNull()
    expect(container.querySelector('img.media-photo')).toBeNull()
    expect(downloadMediaURL).not.toHaveBeenCalled()
    expect(ret.preloader).toBeNull()
    expect(container.querySelector('.preloader-container')).toBeNull()
  })

  it('ступень stripped + расширенный бокс: превью лежит в аспектере (медиа), а не подложкой', async () => {
    const container = box()

    const ret = await rendered(wrapPhoto({
      photo: previewPhoto(), container, hasMessageBlock: true,
    }))

    const aspecter = ret.aspecter!
    expect(aspecter.className).toBe('media-container-aspecter')
    // слот медиа — аспектер; подложка на весь бокс — прямой ребёнок контейнера
    expect(ret.images.thumb!.parentElement).toBe(aspecter)
    expect(container.querySelector(':scope > canvas.thumbnail.media-photo')).toBeTruthy()
    expect(aspecter.querySelector('img.media-photo')).toBeNull()
    expect(downloadMediaURL).not.toHaveBeenCalled()
  })

  // Вторая половина того же раннего выхода (tweb `photoSizeEmpty && isDocument`):
  // у видео без серверного постера подходящей ступени НЕТ. Без неё враппер
  // потянул бы в `<img>` полный mp4.
  it('документ без подходящей ступени: постером работает stripped, за файлом не ходим', async () => {
    const container = box()

    const ret = await rendered(wrapPhoto({ photo: videoDocWithoutPoster(), container }))

    expect(ret.images.thumb).toBeTruthy()
    expect(ret.images.full).toBeNull()
    expect(container.querySelector('img.media-photo')).toBeNull()
    expect(downloadMediaURL).not.toHaveBeenCalled()
  })

  // tweb photo.ts:73,120-126 (`isImageFromDocument`): настоящая картинка
  // приезжает ДОКУМЕНТОМ (`image/gif` из `wrapVideo`), и ступенью ей работает
  // сам файл. Без этой ветки документ без серверной ступени ушёл бы в ранний
  // выход выше — гифка осталась бы одним stripped-превью.
  it('картинка-документ: ступень собирается из самого файла, качается оригинал', async () => {
    const container = box()
    const gif: MyDocument = {
      _: 'document',
      id: 11,
      mime_type: 'image/gif',
      size: 400_000,
      type: 'gif',
      w: 1600,
      h: 900,
      attributes: [{ _: 'documentAttributeAnimated' }],
      thumbs: [{ _: 'photoStrippedSize', type: THUMB_TYPE_STRIPPED, bytes: STRIPPED }],
    }

    const ret = await rendered(wrapPhoto({ photo: gif, container }))

    // бокс посчитан по геометрии самого документа
    expect(container.style.width).toBe('420px')
    expect(container.style.height).toBe('236px')
    expect(downloadMediaURL).toHaveBeenCalledWith(11, { thumb: false })
    expect(ret.images.full).toBeTruthy()
  })

  it('noThumb — превью не строится вовсе', async () => {
    const container = box()
    const ret = await wrapPhoto({ photo: photo(), container, noThumb: true })

    expect(ret.images.thumb).toBeNull()
    expect(container.querySelector('canvas.thumbnail')).toBeNull()
  })
})

describe('wrapPhoto: URL медиа', () => {
  it('URL берётся через ensureMediaUrl — ответ владельца оказывается в зеркале', async () => {
    const container = box()
    await rendered(wrapPhoto({ photo: photo({ stripped: false }), container }))

    expect(downloadMediaURL).toHaveBeenCalledWith(7, { thumb: false })
    expect(cache.cachedMediaUrl(7)).toBe('blob:full')
    expect((container.querySelector('img.media-photo') as HTMLImageElement).src).toBe('blob:full')
  })

  // Адрес файла решает ВЫБРАННАЯ СТУПЕНЬ, а не флаг вызывающего (tweb отдаёт
  // ступень в `downloadMediaURL({media, thumb: size})`): в бокс 320×180
  // серверное превью (`y`) укладывается — качается оно, а не оригинал.
  it('ступень `y` покрыла бокс — качается превью, отдельным ключом зеркала', async () => {
    downloadMediaURL.mockResolvedValue('blob:thumb')
    await rendered(wrapPhoto({
      photo: photo({ stripped: false, serverThumb: true }),
      container: box(), boxWidth: 320, boxHeight: 180,
    }))

    expect(downloadMediaURL).toHaveBeenCalledWith(7, { thumb: true })
    expect(cache.cachedMediaUrl(7, true)).toBe('blob:thumb')
    expect(cache.cachedMediaUrl(7, false)).toBeUndefined()
  })

  // Тот же ладдер в обычном боксе: `y` его не покрывает, выбирается оригинал.
  it('ступень `y` бокс не покрыла — качается оригинал', async () => {
    await rendered(wrapPhoto({ photo: photo({ stripped: false, serverThumb: true }), container: box() }))

    expect(downloadMediaURL).toHaveBeenCalledWith(7, { thumb: false })
  })

  // Попадание в зеркало = tweb `cacheContext.downloaded`: ни сети, ни превью,
  // ни fade-in (показывать поверх нечего).
  it('медиа уже в зеркале: в сеть не ходим, превью не строим, без fade-in', async () => {
    cache.applyMediaUrl({ id: 7, thumb: false, url: 'blob:hit' })
    const container = box()

    const ret = await rendered(wrapPhoto({ photo: photo(), container }))

    expect(downloadMediaURL).not.toHaveBeenCalled()
    expect(ret.images.thumb).toBeNull()
    expect(container.querySelector('canvas.thumbnail')).toBeNull()
    const full = container.querySelector('img.media-photo')!
    expect(full.classList.contains('fade-in')).toBe(false)
    expect(container.classList.contains('no-background')).toBe(true)
  })
})

describe('wrapPhoto: актуальность и очередь', () => {
  it('middleware протух во время загрузки — в DOM ничего не дописывается', async () => {
    const d = deferred()
    downloadMediaURL.mockReturnValue(d.promise)
    const container = box()
    const helper = getMiddleware()

    const promise = wrapPhoto({
      photo: photo(), container, middleware: helper.get(),
    })
    helper.clean()
    d.resolve('blob:late')
    await rendered(promise)

    expect(container.querySelector('img.media-photo')).toBeNull()
    expect(container.classList.contains('no-background')).toBe(false)
  })

  it('мёртвый middleware на входе — полное медиа не рисуется', async () => {
    const helper = getMiddleware()
    const middleware = helper.get()
    helper.clean()
    const container = box()

    await rendered(wrapPhoto({ photo: photo(), container, middleware }))

    expect(container.querySelector('img.media-photo')).toBeNull()
  })

  it('lazyLoadQueue: загрузка идёт через очередь, а не мимо неё', async () => {
    const queue = createLazyLoadQueue(0) // мест нет — задача стоит в очереди
    const container = box()

    await rendered(wrapPhoto({ photo: photo(), container, lazyLoadQueue: queue }))

    expect(downloadMediaURL).not.toHaveBeenCalled()
    expect(container.querySelector('canvas.thumbnail')).toBeTruthy() // превью уже видно
    expect(container.querySelector('img.media-photo')).toBeNull()

    queue.clear() // снятая задача не должна оставлять висящий реджект
    await Promise.resolve()
  })
})

describe('wrapPhoto: ProgressivePreloader', () => {
  it('кольцо появляется на время загрузки и снимается после неё', async () => {
    vi.useFakeTimers()
    const d = deferred()
    downloadMediaURL.mockReturnValue(d.promise)
    const container = box()
    document.body.append(container)

    const promise = wrapPhoto({ photo: photo(), container })
    await vi.advanceTimersByTimeAsync(32)

    const preloader = container.querySelector('.preloader-container')
    expect(preloader).toBeTruthy()

    d.resolve('blob:full')
    void promise
    // отрисовка (sequentialDom → rAF), затем detach: 150 мс ожидания дуги + 200 мс перехода
    await vi.advanceTimersByTimeAsync(500)

    expect(container.querySelector('.preloader-container')).toBeNull()
  })

  it('мелкое медиа кольца не получает (tweb: стороны < 150)', async () => {
    vi.useFakeTimers()
    const d = deferred()
    downloadMediaURL.mockReturnValue(d.promise)
    const container = box()
    document.body.append(container)

    void wrapPhoto({ photo: photo({ w: 100, h: 80 }), container })
    await vi.advanceTimersByTimeAsync(32)

    expect(container.querySelector('.preloader-container')).toBeNull()
    d.resolve('blob:full')
  })

  it('автозагрузка выключена (autoDownloadSize 0): к владельцу не ходим, кольцо — ручное', async () => {
    vi.useFakeTimers()
    const container = box()
    document.body.append(container)

    void wrapPhoto({
      photo: photo(), container, autoDownloadSize: 0,
    })
    await vi.advanceTimersByTimeAsync(32)

    expect(downloadMediaURL).not.toHaveBeenCalled()
    const preloader = container.querySelector('.preloader-container')!
    expect(preloader).toBeTruthy()
    expect(preloader.classList.contains('manual')).toBe(true)
    expect(container.querySelector('img.media-photo')).toBeNull()
  })

  it('отгрузка (uploadPromise): кольцо аплоада висит с самого начала', async () => {
    vi.useFakeTimers()
    const container = box()
    document.body.append(container)
    const d = deferred()

    void wrapPhoto({
      photo: photo({ stripped: false }), container, uploadPromise: d.promise, autoDownloadSize: 0,
    })

    expect(container.querySelector('.preloader-container')).toBeTruthy()
    d.resolve('done')
    await vi.advanceTimersByTimeAsync(500)
  })
})
