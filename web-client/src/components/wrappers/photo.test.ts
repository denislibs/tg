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
      mediaId: 7, width: 1600, height: 900, strippedThumb: STRIPPED, container, middleware: getMiddleware().get(),
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
    await rendered(wrapPhoto({ mediaId: 7, width: 1600, height: 900, strippedThumb: STRIPPED, container }))

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
      mediaId: 7, width: 600, height: 800, strippedThumb: STRIPPED, container, hasMessageBlock: true,
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
      mediaId: 7, width: 600, height: 800, strippedThumb: STRIPPED, container, boxWidth: 0, boxHeight: 0,
    }))

    expect(container.style.width).toBe('')
    expect(container.style.height).toBe('')
    expect(ret.aspecter).toBe(container)
    expect(container.querySelector('img.media-photo')).toBeTruthy()
  })

  it('noThumb — превью не строится вовсе', async () => {
    const container = box()
    const ret = await wrapPhoto({ mediaId: 7, width: 1600, height: 900, strippedThumb: STRIPPED, container, noThumb: true })

    expect(ret.images.thumb).toBeNull()
    expect(container.querySelector('canvas.thumbnail')).toBeNull()
  })
})

describe('wrapPhoto: URL медиа', () => {
  it('URL берётся через ensureMediaUrl — ответ владельца оказывается в зеркале', async () => {
    const container = box()
    await rendered(wrapPhoto({ mediaId: 7, width: 1600, height: 900, container }))

    expect(downloadMediaURL).toHaveBeenCalledWith(7, { thumb: false })
    expect(cache.cachedMediaUrl(7)).toBe('blob:full')
    expect((container.querySelector('img.media-photo') as HTMLImageElement).src).toBe('blob:full')
  })

  it('thumb:true — отдельный ключ владельца и зеркала', async () => {
    downloadMediaURL.mockResolvedValue('blob:thumb')
    await rendered(wrapPhoto({ mediaId: 7, width: 1600, height: 900, container: box(), thumb: true }))

    expect(downloadMediaURL).toHaveBeenCalledWith(7, { thumb: true })
    expect(cache.cachedMediaUrl(7, true)).toBe('blob:thumb')
    expect(cache.cachedMediaUrl(7, false)).toBeUndefined()
  })

  // Попадание в зеркало = tweb `cacheContext.downloaded`: ни сети, ни превью,
  // ни fade-in (показывать поверх нечего).
  it('медиа уже в зеркале: в сеть не ходим, превью не строим, без fade-in', async () => {
    cache.applyMediaUrl({ id: 7, thumb: false, url: 'blob:hit' })
    const container = box()

    const ret = await rendered(wrapPhoto({ mediaId: 7, width: 1600, height: 900, strippedThumb: STRIPPED, container }))

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
      mediaId: 7, width: 1600, height: 900, strippedThumb: STRIPPED, container, middleware: helper.get(),
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

    await rendered(wrapPhoto({ mediaId: 7, width: 1600, height: 900, strippedThumb: STRIPPED, container, middleware }))

    expect(container.querySelector('img.media-photo')).toBeNull()
  })

  it('lazyLoadQueue: загрузка идёт через очередь, а не мимо неё', async () => {
    const queue = createLazyLoadQueue(0) // мест нет — задача стоит в очереди
    const container = box()

    await rendered(wrapPhoto({ mediaId: 7, width: 1600, height: 900, strippedThumb: STRIPPED, container, lazyLoadQueue: queue }))

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

    const promise = wrapPhoto({ mediaId: 7, width: 1600, height: 900, strippedThumb: STRIPPED, container })
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

    void wrapPhoto({ mediaId: 7, width: 100, height: 80, strippedThumb: STRIPPED, container })
    await vi.advanceTimersByTimeAsync(32)

    expect(container.querySelector('.preloader-container')).toBeNull()
    d.resolve('blob:full')
  })

  it('автозагрузка выключена (autoDownloadSize 0): к владельцу не ходим, кольцо — ручное', async () => {
    vi.useFakeTimers()
    const container = box()
    document.body.append(container)

    void wrapPhoto({
      mediaId: 7, width: 1600, height: 900, strippedThumb: STRIPPED, container, autoDownloadSize: 0,
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
      mediaId: 7, width: 1600, height: 900, container, uploadPromise: d.promise, autoDownloadSize: 0,
    })

    expect(container.querySelector('.preloader-container')).toBeTruthy()
    d.resolve('done')
    await vi.advanceTimersByTimeAsync(500)
  })
})
