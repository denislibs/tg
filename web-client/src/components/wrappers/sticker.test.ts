// wrapSticker (ванильный порт tweb `components/wrappers/sticker.ts`).
//
// Что здесь пинится:
//   * три формата файла — lottie / webm / webp — дают ожидаемое дерево с
//     классами tweb (`media-sticker-wrapper` на контейнере, `media-sticker` на
//     медиа);
//   * нижний слой (превью) снимается по ДОКАЗАННОМУ кадру верхнего
//     (`ensurePresented`), а не по таймеру;
//   * протухший `middleware` — загрузка в DOM не пишет;
//   * `destroy()` снимает поколение: плеер уничтожен, регистрация в
//     `animationIntersector` снята, `<video>` отвязан от источника (узлы при
//     этом намеренно остаются в контейнере — см. шапку sticker.ts);
//   * в модуле нет React.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Движок анимации вендорный (декод в воркере) — здесь важен факт попадания в
// lottie-ветку и то, что уехало в плеер. Мок воспроизводит контракт настоящего
// `lottieLoader.loadAnimationWorker`: он сам вешает `middleware.onClean(() =>
// player.remove())` (lottieLoader.ts:272-276) — на этом держится уборка плеера
// по смерти поколения, своей у wrapSticker нет.
const { loadAnimationWorker, players } = vi.hoisted(() => {
  const players: {
    canvas: HTMLCanvasElement[]
    onFirstFrame: (cb: () => void) => void
    fireFirstFrame: () => void
    ensurePresented: ReturnType<typeof vi.fn>
    releasePresented: () => void
    remove: ReturnType<typeof vi.fn>
  }[] = []

  const loadAnimationWorker = vi.fn(async (opts: { middleware?: { onClean: (cb: () => void) => void } }) => {
    let release!: () => void
    const presented = new Promise<void>((r) => {
      release = r
    })
    let firstFrame: (() => void) | undefined
    const player = {
      canvas: [document.createElement('canvas')],
      onFirstFrame: (cb: () => void) => {
        firstFrame = cb
      },
      fireFirstFrame: () => firstFrame?.(),
      ensurePresented: vi.fn(() => presented),
      releasePresented: () => release(),
      remove: vi.fn(),
    }
    opts.middleware?.onClean(() => player.remove())
    players.push(player)
    return player
  })

  return { loadAnimationWorker, players }
})
vi.mock('@lib/lottie/lottieLoader', () => ({ default: { loadAnimationWorker } }))
vi.mock('@core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/api/media/${id}/content?token=t`,
  primeMediaToken: () => Promise.resolve(),
}))

import animationIntersector from '@components/animationIntersector'
import { createLazyLoadQueue } from '@core/lazyLoadQueue'
import { getMiddleware } from '@helpers/middleware'
import { useSettingsStore } from '@/settings'
import wrapSticker from './sticker'
import { resetStickerContentCache } from './stickerContent'

function stubFetch(contentType: string) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    headers: { get: () => contentType },
    blob: async () => new Blob(['x'], { type: contentType }),
    json: async () => ({ v: '5.5.7', fr: 60, layers: [] }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** дать отработать цепочке промисов внутри load() */
const flush = async () => {
  for (let i = 0; i < 10; ++i) await Promise.resolve()
}

let mediaId = 0
const nextId = () => ++mediaId

beforeEach(() => {
  loadAnimationWorker.mockClear()
  players.length = 0
  resetStickerContentCache()
  URL.createObjectURL = vi.fn(() => 'blob:sticker') as typeof URL.createObjectURL
  // happy-dom не реализует IntersectionObserver — заглушка для видео-ветки.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

describe('wrapSticker: дерево по формату файла', () => {
  it('lottie (application/json): уходит в движок, контейнер размечен по-tweb', async () => {
    const fetchMock = stubFetch('application/json')
    const div = document.createElement('div')
    const id = nextId()

    const { render } = wrapSticker({ mediaId: id, div, width: 200, height: 200, play: true, loop: true })
    await render

    expect(fetchMock).toHaveBeenCalledWith(`/api/media/${id}/content?token=t`)
    expect(div.classList.contains('media-sticker-wrapper')).toBe(true)
    expect(div.dataset.docId).toBe(String(id))
    expect(loadAnimationWorker).toHaveBeenCalledTimes(1)

    const opts = loadAnimationWorker.mock.calls[0][0] as unknown as {
      container: HTMLElement
      autoplay: boolean
      loop: boolean
      width: number
      height: number
      noCache: boolean
    }
    expect(opts.container).toBe(div)
    expect(opts.autoplay).toBe(true)
    expect(opts.loop).toBe(true)
    expect(opts.width).toBe(200)
    // зацикленному кэш кадров нужен, одноразовому — нет (см. sticker.ts)
    expect(opts.noCache).toBe(false)
    // картинки/видео в lottie-ветке не появляются
    expect(div.querySelector('img')).toBeNull()
    expect(div.querySelector('video')).toBeNull()
  })

  it('webm: <video class="media-sticker"> в контейнере + регистрация в animationIntersector', async () => {
    stubFetch('video/webm')
    const div = document.createElement('div')

    const { render } = wrapSticker({
      mediaId: nextId(),
      div,
      width: 200,
      height: 200,
      play: true,
      loop: true,
      group: 'chat',
    })
    await render

    const video = div.querySelector('video')
    expect(video).not.toBeNull()
    expect(video!.classList.contains('media-sticker')).toBe(true)
    expect(video!.getAttribute('src')).toBe('blob:sticker')
    expect(video!.autoplay).toBe(true)
    expect(video!.loop).toBe(true)
    expect(video!.muted).toBe(true)
    expect(video!.getAttribute('playsinline')).toBe('true')
    // наблюдение вешается на КОНТЕЙНЕР (tweb `observeElement: div`)
    expect(animationIntersector.getAnimations(div)).toHaveLength(1)
    expect(loadAnimationWorker).not.toHaveBeenCalled()
  })

  it('webp: <img class="media-sticker"> с object-URL содержимого', async () => {
    stubFetch('image/webp')
    const div = document.createElement('div')

    const { render } = wrapSticker({ mediaId: nextId(), div, width: 72, height: 72 })
    await render

    const img = div.querySelector('img.media-sticker')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('blob:sticker')
    expect(loadAnimationWorker).not.toHaveBeenCalled()
    expect(div.querySelector('video')).toBeNull()
  })

  it('силуэт из контура встаёт самым нижним слоем ещё до прихода файла', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const div = document.createElement('div')

    // base64 валидного контура (байты формата photoPathSize)
    wrapSticker({ mediaId: nextId(), div, width: 72, height: 72, pathThumb: 'wKDBwA==' })

    const svg = div.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.classList.contains('lottie-vector')).toBe(true)
    expect(svg!.classList.contains('media-sticker')).toBe(true)
    expect(svg!.classList.contains('thumbnail')).toBe(true)
  })
})

describe('wrapSticker: очередь и lite-mode', () => {
  it('через очередь идёт только НЕ скачанное: повторный показ того же файла её минует', async () => {
    stubFetch('image/webp')
    const queue = createLazyLoadQueue()
    const push = vi.spyOn(queue, 'push')
    const id = nextId()

    await wrapSticker({ mediaId: id, div: document.createElement('div'), width: 72, height: 72, lazyLoadQueue: queue })
      .render
    expect(push).toHaveBeenCalledTimes(1)

    // файл уже в кэше содержимого — второй показ грузится в обход очереди
    await wrapSticker({ mediaId: id, div: document.createElement('div'), width: 72, height: 72, lazyLoadQueue: queue })
      .render
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('lite-mode «без анимаций» снимает автоплей и зацикливание', async () => {
    const previous = useSettingsStore.getState().reduceMotion
    useSettingsStore.setState({ reduceMotion: true })
    try {
      stubFetch('application/json')
      const { render } = wrapSticker({
        mediaId: nextId(),
        div: document.createElement('div'),
        width: 200,
        height: 200,
        play: true,
        loop: true,
        liteModeKey: 'stickers_chat',
      })
      await render

      const opts = loadAnimationWorker.mock.calls[0][0] as unknown as { autoplay: boolean; loop: boolean }
      expect(opts.autoplay).toBe(false)
      expect(opts.loop).toBe(false)
    } finally {
      useSettingsStore.setState({ reduceMotion: previous })
    }
  })

  it('анимированное эмодзи не зацикливается (tweb: loop только у стикеров)', async () => {
    stubFetch('application/json')
    const { render } = wrapSticker({
      mediaId: nextId(),
      div: document.createElement('div'),
      width: 200,
      height: 200,
      play: true,
      loop: true,
      emoji: '😀',
    })
    await render

    const opts = loadAnimationWorker.mock.calls[0][0] as unknown as { loop: boolean }
    expect(opts.loop).toBe(false)
  })
})

describe('wrapSticker: слои', () => {
  it('превью снимается по ДОКАЗАННОМУ кадру плеера, а не по таймеру', async () => {
    stubFetch('application/json')
    const div = document.createElement('div')

    const { render } = wrapSticker({
      mediaId: nextId(),
      div,
      width: 200,
      height: 200,
      play: true,
      thumb: '/9j/',
    })
    await render
    await flush()

    const thumbImage = div.querySelector('img.media-sticker.thumbnail')
    expect(thumbImage).not.toBeNull()

    const player = players[0]
    player.fireFirstFrame()
    await flush()

    // ensurePresented ещё не резолвился — превью обязано оставаться в DOM,
    // иначе на его месте окажется непрокрашенный canvas.
    expect(player.ensurePresented).toHaveBeenCalled()
    expect(div.contains(thumbImage)).toBe(true)

    player.releasePresented()
    await flush()
    expect(div.contains(thumbImage)).toBe(false)
  })

  it('withThumb: false — превью не строится вовсе', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const div = document.createElement('div')

    wrapSticker({ mediaId: nextId(), div, width: 72, height: 72, thumb: '/9j/', pathThumb: 'wKDBwA==', withThumb: false })
    await flush()

    expect(div.children).toHaveLength(0)
  })
})

describe('wrapSticker: актуальность и уборка', () => {
  // Файл приезжает асинхронно, и к этому моменту поколение может быть уже
  // погашено (бабл уехал из окна, стикер в ячейке сменился). Проверяем ОБЕ
  // ветки с DOM-вставкой: у видео вставка идёт до всяких колбэков загрузки,
  // поэтому её удерживает только проверка middleware сразу после await.
  it.each([
    ['image/webp', 'img'],
    ['video/webm', 'video'],
  ])('протухший middleware (%s): приехавший файл в DOM не пишет', async (contentType, tag) => {
    stubFetch(contentType)
    const div = document.createElement('div')
    const helper = getMiddleware()

    const { render } = wrapSticker({
      mediaId: nextId(),
      div,
      width: 72,
      height: 72,
      play: true,
      middleware: helper.get(),
    })
    helper.clean() // поколение погасили ДО прихода байтов
    await expect(render).rejects.toMatchObject({ type: 'MIDDLEWARE' })
    await flush()

    expect(div.querySelector(tag)).toBeNull()
    expect(div.children).toHaveLength(0)
    expect(animationIntersector.getAnimations(div)).toHaveLength(0)
  })

  it('destroy(): плеер уничтожен, регистрация снята, поздний кадр в DOM не пишет', async () => {
    stubFetch('application/json')
    const div = document.createElement('div')

    const { render, destroy } = wrapSticker({
      mediaId: nextId(),
      div,
      width: 200,
      height: 200,
      play: true,
      thumb: '/9j/',
    })
    await render
    await flush()

    const thumbImage = div.querySelector('img.media-sticker.thumbnail')
    expect(thumbImage).not.toBeNull()
    const player = players[0]
    destroy()

    expect(player.remove).toHaveBeenCalled()

    // кадр, доехавший ПОСЛЕ смерти поколения, нижний слой не трогает
    player.fireFirstFrame()
    await flush()
    expect(div.contains(thumbImage)).toBe(true)
  })

  it('destroy(): <video> снят с наблюдения и отвязан от источника', async () => {
    stubFetch('video/webm')
    const div = document.createElement('div')

    const { render, destroy } = wrapSticker({ mediaId: nextId(), div, width: 200, height: 200, play: true })
    await render

    const video = div.querySelector('video')!
    expect(animationIntersector.getAnimations(div)).toHaveLength(1)

    destroy()
    await flush()

    expect(animationIntersector.getAnimations(div)).toHaveLength(0)
    expect(video.getAttribute('src')).toBe('')
    // узел намеренно остаётся в контейнере: следующее поколение усыновит его
    // нижним слоем (tweb SuperStickerRenderer.processInvisible)
    expect(div.contains(video)).toBe(true)
  })
})

describe('wrapSticker: без React', () => {
  it('в модулях нет импортов из react', () => {
    for (const file of ['sticker.ts', 'stickerContent.ts']) {
      const source = readFileSync(resolve(__dirname, file), 'utf8')
      expect(source).not.toMatch(/from ['"]react/)
      expect(source).not.toMatch(/\buse[A-Z]\w*\(/)
    }
  })
})
