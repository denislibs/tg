// StickerAssets (движок кадров стикеров медиа-редактора, порт на tlottie —
// Этап 3 плана «один движок lottie», docs/superpowers/plans/2026-09-05-
// lottie-single-engine.md). До этого файла тестов не было — пины:
//  • lottie: loadAnimationWorker получает СВОЙ офскрин-контейнер и Blob;
//    источник кадра — canvas[0] САМОГО плеера, а не чужой 2D-контекст (у
//    tlottie нет lottie-web'овского rendererSettings.context, см. комментарий
//    у ensure() в stickerAssets.ts);
//  • seek(): детерминированный кадр = floor(timeSec * 60) mod totalFrames
//    (60 — тот же хардкод, что у tweb finalRender/constants.ts
//    FRAMES_PER_SECOND), пауза + requestFrame — вместо lottie-web'овского
//    goToAndStop, которого у LottiePlayer нет;
//  • destroy(): плеер и офскрин-контейнер снимаются, повторный ensure() не
//    грузит дважды;
//  • без WASM SIMD loadAnimationWorker отклоняется — get() остаётся null,
//    контейнер убирается, исключение наружу не течёт.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Форма опций, которые реально читает наш порт (`stickerAssets.ts`) — только
// то, что нужно тесту, не полный `LottieOptions` вендоренного острова.
type LoadAnimationWorkerOpts = {
  container: HTMLElement
  animationData: Blob
  loop: boolean
  autoplay: boolean
  width: number
  height: number
  group: string
  noOffscreen: boolean
}

const { loadAnimationWorker, players } = vi.hoisted(() => {
  const players: {
    canvas: HTMLCanvasElement[]
    maxFrame: number
    addEventListener: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    requestFrame: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
    fireEnterFrame: () => void
  }[] = []

  const loadAnimationWorker = vi.fn(async (_opts: LoadAnimationWorkerOpts) => {
    let enterFrame: (() => void) | undefined
    const player = {
      canvas: [document.createElement('canvas')],
      maxFrame: 9, // totalFrames = 10
      addEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === 'enterFrame') enterFrame = cb
      }),
      pause: vi.fn(),
      requestFrame: vi.fn(),
      remove: vi.fn(),
      fireEnterFrame: () => enterFrame?.(),
    }
    players.push(player)
    return player
  })

  return { loadAnimationWorker, players }
})
vi.mock('@lib/lottie/lottieLoader', () => ({ default: { loadAnimationWorker } }))

const { loadStickerContent } = vi.hoisted(() => ({ loadStickerContent: vi.fn() }))
vi.mock('../StickerMedia', () => ({ loadStickerContent }))

import { StickerAssets } from './stickerAssets'

const flush = async () => {
  for (let i = 0; i < 5; ++i) await Promise.resolve()
}

beforeEach(() => {
  loadAnimationWorker.mockClear()
  players.length = 0
  loadStickerContent.mockReset()
})

describe('StickerAssets: lottie — canvas[0] плеера, а не чужой контекст', () => {
  it('ensure(): свой контейнер+Blob уходят в loadAnimationWorker, get() отдаёт canvas[0] плеера', async () => {
    const data = { v: '5.5.7', fr: 60, layers: [] }
    loadStickerContent.mockResolvedValue({ kind: 'lottie', data })
    const onFrame = vi.fn()
    const assets = new StickerAssets(onFrame)

    assets.ensure(1)
    await flush()

    expect(loadAnimationWorker).toHaveBeenCalledTimes(1)
    const opts = loadAnimationWorker.mock.calls[0][0]
    expect(opts.container).toBeInstanceOf(HTMLDivElement)
    expect(document.body.contains(opts.container)).toBe(true)
    expect(opts.loop).toBe(true)
    expect(opts.autoplay).toBe(true)
    // мимо animationIntersector — офскрин-канвасу видимость страницы не указ
    expect(opts.group).toBe('none')
    // синхронное чтение canvas[0] на enterFrame — offscreen-worker блит не даёт гарантии
    expect(opts.noOffscreen).toBe(true)
    // loadStickerContent отдаёт разобранный json, воркер ждёт Blob с текстом
    expect(await opts.animationData.text()).toBe(JSON.stringify(data))

    const player = players[0]
    expect(assets.get(1)).toBe(player.canvas[0])

    onFrame.mockClear()
    player.fireEnterFrame()
    expect(onFrame).toHaveBeenCalledTimes(1)
  })

  it('ensure(): повторный вызов для того же mediaId не грузит дважды', async () => {
    loadStickerContent.mockResolvedValue({ kind: 'lottie', data: {} })
    const assets = new StickerAssets(vi.fn())

    assets.ensure(1)
    assets.ensure(1) // пока загрузка не завершилась — идемпотентно
    await flush()
    assets.ensure(1) // уже готов — идемпотентно

    expect(loadAnimationWorker).toHaveBeenCalledTimes(1)
  })
})

describe('StickerAssets: seek() — детерминированный покадровый проход при экспорте', () => {
  it('кадр = floor(timeSec * 60) mod totalFrames; плеер ставится на паузу', async () => {
    loadStickerContent.mockResolvedValue({ kind: 'lottie', data: {} })
    const assets = new StickerAssets(vi.fn())
    assets.ensure(1)
    await flush()
    const player = players[0] // maxFrame=9 → totalFrames=10

    assets.seek(0.05) // 0.05*60 = 3
    expect(player.pause).toHaveBeenCalled()
    expect(player.requestFrame).toHaveBeenLastCalledWith(3)

    assets.seek(0.2) // 0.2*60 = 12 → 12 mod 10 = 2 (лап анимации короче видео)
    expect(player.requestFrame).toHaveBeenLastCalledWith(2)
  })

  it('граница кадра не съезжает по количеству кадров', async () => {
    loadStickerContent.mockResolvedValue({ kind: 'lottie', data: {} })
    const assets = new StickerAssets(vi.fn())
    assets.ensure(1)
    await flush()
    const player = players[0]

    assets.seek(10 / 60) // ровно кадр 10 → mod 10 = 0, не 10
    expect(player.requestFrame).toHaveBeenLastCalledWith(0)
    assets.seek(9 / 60) // последний валидный кадр
    expect(player.requestFrame).toHaveBeenLastCalledWith(9)
  })
})

describe('StickerAssets: destroy() и деградация без WASM', () => {
  it('destroy(): плеер и офскрин-контейнер снимаются', async () => {
    loadStickerContent.mockResolvedValue({ kind: 'lottie', data: {} })
    const assets = new StickerAssets(vi.fn())
    assets.ensure(1)
    await flush()
    const player = players[0]
    const container = loadAnimationWorker.mock.calls[0][0].container as HTMLElement

    assets.destroy()

    expect(player.remove).toHaveBeenCalled()
    expect(document.body.contains(container)).toBe(false)
  })

  it('без WASM SIMD (NO_WASM): get() остаётся null, контейнер убирается, исключение не течёт наружу', async () => {
    loadStickerContent.mockResolvedValue({ kind: 'lottie', data: {} })
    loadAnimationWorker.mockRejectedValueOnce(Object.assign(new Error('NO_WASM'), { type: 'NO_WASM' }))
    const assets = new StickerAssets(vi.fn())

    assets.ensure(1)
    await flush()

    const container = loadAnimationWorker.mock.calls[0][0].container as HTMLElement
    expect(assets.get(1)).toBeNull()
    expect(document.body.contains(container)).toBe(false)
  })

  // ПИН (backlogs/frontend/lottie-no-wasm-fallback.md, «медиаредактор — потеря
  // тяжелее»): слой без источника не должен теряться молча — вызывающий
  // (MediaEditor.tsx) обязан узнать об этом через hasFailed()/onFail(), а не
  // тихо получить null навсегда неотличимый от «ещё грузится».
  it('без WASM SIMD (NO_WASM): hasFailed() становится true, onFail зовётся с mediaId', async () => {
    loadStickerContent.mockResolvedValue({ kind: 'lottie', data: {} })
    loadAnimationWorker.mockRejectedValueOnce(Object.assign(new Error('NO_WASM'), { type: 'NO_WASM' }))
    const onFail = vi.fn()
    const assets = new StickerAssets(vi.fn(), onFail)

    expect(assets.hasFailed(1)).toBe(false) // ещё не отклонилось — не путать с провалом
    assets.ensure(1)
    await flush()

    expect(assets.hasFailed(1)).toBe(true)
    expect(onFail).toHaveBeenCalledTimes(1)
    expect(onFail).toHaveBeenCalledWith(1)
  })
})

describe('StickerAssets: картинки — ветка без lottie не затронута портом', () => {
  it('image: onload переносит decode в источник кадра', async () => {
    loadStickerContent.mockResolvedValue({ kind: 'image', url: 'blob:sticker' })
    const created: HTMLImageElement[] = []
    class SpyImage extends Image {
      constructor() {
        super()
        created.push(this)
      }
    }
    vi.stubGlobal('Image', SpyImage)
    try {
      const onFrame = vi.fn()
      const assets = new StickerAssets(onFrame)

      assets.ensure(1)
      await flush()
      expect(created).toHaveLength(1)
      expect(assets.get(1)).toBeNull() // байты картинки ещё не декодированы

      created[0].onload?.(new Event('load'))
      expect(assets.get(1)).toBe(created[0])
      expect(onFrame).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
