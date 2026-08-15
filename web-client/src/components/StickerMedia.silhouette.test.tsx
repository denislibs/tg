// Силуэт (Task 6) — самый нижний слой StickerMedia: SVG из векторного
// контура (pathThumb), рисуется синхронно вместо пустой ячейки, пока не
// декодировался даже stripped-JPEG (thumb), не то что сам файл. Это отдельный
// файл от StickerMedia.test.tsx (там уже несколько render-тестов без
// afterEach(cleanup) — здесь нужен собственный, раз рендеров тоже несколько).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const { loadAnimationWorker } = vi.hoisted(() => ({
  loadAnimationWorker: vi.fn(),
}))
vi.mock('../lib/lottie/lottieLoader', () => ({ default: { loadAnimationWorker } }))
vi.mock('../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/api/media/${id}/content?token=t`,
  primeMediaToken: () => Promise.resolve(),
}))

import StickerMedia from './StickerMedia'

// Байты контура сами по себе не важны для этого теста (проверяется, что слой
// вообще встаёт, а не конкретная форма) — те же, что в backend-тесте
// stickers_handler_test.go (0x4D, 0x7A), закодированные в base64.
const PATH_THUMB_B64 = btoa(String.fromCharCode(0x4d, 0x7a))

beforeEach(() => {
  loadAnimationWorker.mockClear()
  // Загрузка «зависает» — проверяем состояние ДО прихода медиа, как и в
  // соседнем StickerMedia.test.tsx («thumb: stripped-превью…»).
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(cleanup)

describe('StickerMedia — силуэт из векторного контура', () => {
  it('с pathThumb: до загрузки файла в DOM стоит SVG-силуэт нижним слоем', () => {
    const { container } = render(
      <StickerMedia mediaId={201} width={72} height={72} pathThumb={PATH_THUMB_B64} />,
    )

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.classList.contains('lottie-vector')).toBe(true)
    expect(svg!.classList.contains('media-sticker')).toBe(true)
    expect(svg!.classList.contains('thumbnail')).toBe(true)
    expect((svg as unknown as HTMLElement).dataset.stickerThumb).toBe('201')
    // viewBox — из тех же width/height, что рендерит бокс (см. StickerMedia.tsx
    // про выбор источника размеров для viewBox силуэта).
    expect(svg!.getAttribute('viewBox')).toBe('0 0 72 72')

    const path = svg!.querySelector('path')
    expect(path).not.toBeNull()
    expect(path!.getAttribute('d')).toMatch(/^M/)
  })

  it('без pathThumb силуэта нет — рендер не ломается', () => {
    const { container } = render(<StickerMedia mediaId={202} width={72} height={72} />)

    expect(container.querySelector('svg')).toBeNull()
    // ячейка-обёртка всё равно на месте — отсутствие контура не роняет компонент
    expect(container.querySelector('div')).not.toBeNull()
  })

  it('pathThumb + thumb: stripped-JPEG апгрейдит силуэт (тот же underlay, что и setThumb)', async () => {
    const { container } = render(
      <StickerMedia mediaId={203} width={72} height={72} pathThumb={PATH_THUMB_B64} thumb="/9j/" />,
    )

    // Силуэт встал первым (синхронно, до decode() у thumb-картинки).
    expect(container.querySelector('svg')).not.toBeNull()

    // decode() у data:-URI картинки в happy-dom резолвится микротасками —
    // после них silhouette обязан уступить место thumb (appearance.setThumb
    // заменяет underlay через replaceWith, см. wrappers/stickerAppearance.ts).
    await waitFor(() => {
      const img = container.querySelector('img.media-sticker.thumbnail')
      expect(img).not.toBeNull()
    })
    expect(container.querySelector('svg')).toBeNull()
  })
})
