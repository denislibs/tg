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

// Реальный контур из выгрузки (`backend/assets/stickers/abcemoji/meta.json`,
// стикер `1.tgs`, поле `path`) — НЕ синтетика. Ревью L6 нашло Critical именно
// потому, что синтетические байты не воспроизводят класс бага «координаты
// контура доходят до ~500, а viewBox строился из размера ячейки (64/72px)» —
// с маленькими тестовыми числами путь визуально не обрезался, хотя формула
// была неверна. Реальные координаты этого контура доходят до 460.
const REAL_PATH_THUMB_B64 =
  'CgOuANxKgWWFaUpFVbdPA4YGUgGNY4YIUwSIBVUDjk+GB06IBEORjJm5oYcGlrisiwGGBpAHiJeGBY8As5AAUIxICYdKAE1HTUtxV3lHRmeAcIBcgHxFSAiARYFOs1uGBU2Naop6ig=='

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
      <StickerMedia mediaId={201} width={72} height={72} pathThumb={REAL_PATH_THUMB_B64} />,
    )

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.classList.contains('lottie-vector')).toBe(true)
    expect(svg!.classList.contains('media-sticker')).toBe(true)
    expect(svg!.classList.contains('thumbnail')).toBe(true)
    expect((svg as unknown as HTMLElement).dataset.stickerThumb).toBe('201')

    const path = svg!.querySelector('path')
    expect(path).not.toBeNull()
    expect(path!.getAttribute('d')).toMatch(/^M/)
  })

  // Critical (ревью L6): viewBox обязан идти из НАТУРАЛЬНЫХ пикселей стикера
  // (docWidth/docHeight, tweb doc.w/doc.h), а не из размера ячейки на экране
  // (width/height рендер-бокса). Контур авторится в системе координат
  // исходного канваса Telegram-документа (числа до ~500 — см. REAL_PATH_THUMB_B64
  // выше), поэтому viewBox из размера ячейки (64/72px и т.п.) обрезал/растягивал
  // бы путь в разы. Тест явно РАЗВОДИТ render-бокс (72×72) и docWidth/docHeight
  // (320×512, намеренно не квадрат и не равен боксу) — если бы компонент снова
  // взял размеры бокса, viewBox не совпал бы с ожиданием.
  it('viewBox силуэта — из docWidth/docHeight, а не из размера ячейки', () => {
    const { container } = render(
      <StickerMedia
        mediaId={204}
        width={72}
        height={72}
        pathThumb={REAL_PATH_THUMB_B64}
        docWidth={320}
        docHeight={512}
      />,
    )

    const svg = container.querySelector('svg')
    expect(svg!.getAttribute('viewBox')).toBe('0 0 320 512')
  })

  // Без docWidth/docHeight (метаданные стикера неизвестны) — откат на дефолт
  // порта/tweb `createSvgFromBytes` (512×512), а не на размер ячейки.
  it('без docWidth/docHeight viewBox падает на дефолт 512×512', () => {
    const { container } = render(
      <StickerMedia mediaId={205} width={72} height={72} pathThumb={REAL_PATH_THUMB_B64} />,
    )

    const svg = container.querySelector('svg')
    expect(svg!.getAttribute('viewBox')).toBe('0 0 512 512')
  })

  it('без pathThumb силуэта нет — рендер не ломается', () => {
    const { container } = render(<StickerMedia mediaId={202} width={72} height={72} />)

    expect(container.querySelector('svg')).toBeNull()
    // ячейка-обёртка всё равно на месте — отсутствие контура не роняет компонент
    expect(container.querySelector('div')).not.toBeNull()
  })

  // Minor (ревью L6): битая base64 не должна ронять эффект целиком — сеть не
  // гарантирует валидность чужих данных, а плейсхолдер необязателен.
  it('битая base64 в pathThumb не роняет рендер — силуэта просто нет', () => {
    const { container } = render(
      <StickerMedia mediaId={206} width={72} height={72} pathThumb="not-valid-base64!!!" />,
    )

    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('div')).not.toBeNull()
  })

  it('pathThumb + thumb: stripped-JPEG апгрейдит силуэт (тот же underlay, что и upgradeToImage)', async () => {
    const { container } = render(
      <StickerMedia mediaId={203} width={72} height={72} pathThumb={REAL_PATH_THUMB_B64} thumb="/9j/" />,
    )

    // Силуэт встал первым (синхронно, до decode() у thumb-картинки).
    expect(container.querySelector('svg')).not.toBeNull()

    // decode() у data:-URI картинки в happy-dom резолвится микротасками —
    // после них silhouette обязан уступить место thumb (appearance.upgradeToImage
    // заменяет underlay через replaceWith, см. wrappers/stickerAppearance.ts).
    await waitFor(() => {
      const img = container.querySelector('img.media-sticker.thumbnail')
      expect(img).not.toBeNull()
    })
    expect(container.querySelector('svg')).toBeNull()
  })
})
