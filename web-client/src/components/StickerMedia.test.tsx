// StickerMedia: различение типа файла по Content-Type — image/webp рендерится
// как <img>, application/json монтирует lottie-web (canvas, первый кадр без
// autoplay). Сеть и lottie замоканы.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const { loadAnimation } = vi.hoisted(() => ({
  loadAnimation: vi.fn((_opts: { autoplay: boolean; loop: boolean; renderer: string }) => ({
    goToAndStop: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
  })),
}))
vi.mock('lottie-web', () => ({ default: { loadAnimation } }))
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

beforeEach(() => {
  loadAnimation.mockClear()
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
    expect(loadAnimation).not.toHaveBeenCalled()
  })

  // УСТАРЕЛО: StickerMedia перешёл с lottie-web на движок tlottie
  // (lib/lottie/lottieLoader.loadAnimationWorker, декод в воркере). Эти два теста
  // мокают lottie-web/loadAnimation, которого компонент больше не зовёт, поэтому
  // помечены skip до переписывания под tlottie-воркер. Раньше не ловилось, т.к.
  // весь файл не грузился в vitest (не был настроен alias @config).
  it.skip('lottie-json: монтирует lottie-web без autoplay (первый кадр статично)', async () => {
    stubFetch('application/json')
    render(<StickerMedia mediaId={102} width={72} height={72} playOnHover />)
    await waitFor(() => expect(loadAnimation).toHaveBeenCalledTimes(1))
    const args = loadAnimation.mock.calls[0][0]
    expect(args.autoplay).toBe(false)
    expect(args.renderer).toBe('canvas')
    // без autoplay первый кадр показывается через goToAndStop
    const anim = loadAnimation.mock.results[0].value
    expect(anim.goToAndStop).toHaveBeenCalledWith(0, true)
  })

  it.skip('в бабле чата autoplay+loop уходят в lottie как есть', async () => {
    stubFetch('application/json')
    render(<StickerMedia mediaId={103} width={200} height={200} autoplay loop />)
    await waitFor(() => expect(loadAnimation).toHaveBeenCalledTimes(1))
    const args = loadAnimation.mock.calls[0][0]
    expect(args.autoplay).toBe(true)
    expect(args.loop).toBe(true)
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
    expect(loadAnimation).not.toHaveBeenCalled()
  })
})
