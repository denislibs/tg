// StickerMedia: различение типа файла по Content-Type — image/webp рендерится
// как <img>, video/webm как <video>, lottie (несжатый application/json и
// gzip'нутый application/x-tgsticker) уходит в движок tlottie.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { gzipSync } from 'node:zlib'

// Движок анимации — вендорный tlottie (декод в воркере); здесь важен сам факт
// попадания в lottie-ветку и то, ЧТО в неё приехало (разжатый JSON).
const { loadAnimationWorker } = vi.hoisted(() => ({
  loadAnimationWorker: vi.fn(async (_opts: { animationData: Blob; loop: boolean; autoplay: boolean }) => ({
    canvas: [document.createElement('canvas')],
    onFirstFrame: vi.fn(),
    onComplete: vi.fn(),
    restart: vi.fn(),
    remove: vi.fn(),
  })),
}))
vi.mock('../lib/lottie/lottieLoader', () => ({ default: { loadAnimationWorker } }))
vi.mock('../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/api/media/${id}/content?token=t`,
  primeMediaToken: () => Promise.resolve(),
}))

import StickerMedia from './StickerMedia'

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

/** Настоящий Response с телом-потоком: lottie-ветка снимает gzip через DecompressionStream. */
function stubFetchTgs(body: ArrayBuffer, contentType: string) {
  const fetchMock = vi.fn(async () => new Response(body, { headers: { 'content-type': contentType } }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** .tgs — gzip поверх lottie-json (ровно то, чем Telegram отдаёт стикеры). */
function tgsOf(json: unknown): ArrayBuffer {
  const buf = gzipSync(Buffer.from(JSON.stringify(json)))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

const LOTTIE = { v: '5.5.7', fr: 60, layers: [] }

beforeEach(() => {
  loadAnimationWorker.mockClear()
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

describe('StickerMedia', () => {
  it('webp: рендерит <img> c object-URL содержимого', async () => {
    const fetchMock = stubFetch('image/webp')
    const { container } = render(<StickerMedia mediaId={101} width={72} height={72} />)
    await waitFor(() => {
      const img = container.querySelector('img')
      expect(img).not.toBeNull()
      expect(img!.getAttribute('src')).toBe('blob:sticker')
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/media/101/content?token=t')
    expect(loadAnimationWorker).not.toHaveBeenCalled()
  })

  // .tgs — то, чем Telegram отдаёт анимированные стикеры (gzip поверх того же
  // lottie-json, mime application/x-tgsticker; все 13 тыс. залитых стикеров
  // такие). Без этой проверки сужение детекта обратно до 'application/json'
  // оставляло прогон зелёным, а каждый .tgs уходил в image-ветку — битые
  // квадраты вместо стикеров.
  it('tgs (application/x-tgsticker): снимает gzip и отдаёт разобранный lottie движку', async () => {
    const fetchMock = stubFetchTgs(tgsOf(LOTTIE), 'application/x-tgsticker')
    const { container } = render(<StickerMedia mediaId={107} width={200} height={200} autoplay loop />)

    await waitFor(() => expect(loadAnimationWorker).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/media/107/content?token=t')
    // в image-ветку не свалились
    expect(container.querySelector('img')).toBeNull()

    const opts = loadAnimationWorker.mock.calls[0][0]
    expect(opts.autoplay).toBe(true)
    expect(opts.loop).toBe(true)
    // движку уходит уже разжатый json
    await expect(opts.animationData.text()).resolves.toBe(JSON.stringify(LOTTIE))
  })

  it('несжатый lottie-json тоже уходит в движок (сид-наборы времён ручной сборки)', async () => {
    stubFetch('application/json')
    render(<StickerMedia mediaId={108} width={72} height={72} playOnHover />)

    await waitFor(() => expect(loadAnimationWorker).toHaveBeenCalledTimes(1))
    const opts = loadAnimationWorker.mock.calls[0][0]
    expect(opts.autoplay).toBe(false)
  })

  // Слой превью: stripped-JPEG с бэка показывается СРАЗУ, до загрузки файла —
  // без него ячейка стоит пустой, пока летят байты и декодируется первый кадр.
  it('thumb: stripped-превью встаёт нижним слоем до загрузки файла', async () => {
    // Загрузка «зависает» — проверяем именно состояние до прихода медиа.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = render(<StickerMedia mediaId={105} width={72} height={72} thumb="/9j/" />)

    await waitFor(() => {
      const img = container.querySelector('img.media-sticker.thumbnail')
      expect(img).not.toBeNull()
      expect(img!.getAttribute('src')).toBe('data:image/jpeg;base64,/9j/')
      expect((img as HTMLElement).dataset.stickerThumb).toBe('105')
    })
  })

  it('без thumb нижнего слоя нет (пустых <img> в контейнере не появляется)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = render(<StickerMedia mediaId={106} width={72} height={72} />)

    await Promise.resolve()
    expect(container.querySelector('img')).toBeNull()
  })

  it('video/webm: рендерит <video> c object-URL содержимого (видео-стикер)', async () => {
    const fetchMock = stubFetch('video/webm')
    const { container } = render(<StickerMedia mediaId={104} width={200} height={200} autoplay loop />)
    await waitFor(() => {
      const video = container.querySelector('video')
      expect(video).not.toBeNull()
      expect(video!.getAttribute('src')).toBe('blob:sticker')
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/media/104/content?token=t')
    expect(loadAnimationWorker).not.toHaveBeenCalled()
  })
})
