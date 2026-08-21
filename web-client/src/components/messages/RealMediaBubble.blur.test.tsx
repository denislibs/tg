// Канвас-превью медиабабла (Task 9): tweb-модель — до прихода полного URL в
// контейнере лежит canvas из helpers/blur с классами
// `media-photo thumbnail canvas-thumbnail` (wrapPhoto + getImageFromStrippedThumb),
// а НЕ background-image; при синхронно известном URL превью не монтируется
// (аналог tweb `cacheContext.downloaded`).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { ReactElement } from 'react'

// mediaUrl на импорте стартует SharedWorker (нет в happy-dom) — мокаем.
vi.mock('../../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/media/${id}`,
  hasMediaToken: () => true,
  primeMediaToken: vi.fn(),
  useMediaTokenVersion: () => 0,
}))
// happy-dom: getContext('2d') → null; для blur() нужен нативный canvas-filter.
vi.mock('@environment/canvasFilterSupport', () => ({ default: true }))

import RealMediaBubble from './RealMediaBubble'
import { THUMB_TYPE_FULL, THUMB_TYPE_STRIPPED, type MyPhoto } from '../../core/media/messageMedia'
import { ManagersProvider } from '../../core/hooks/useManagers'
import { applyMediaUrl } from '../../core/mediaCache'
import type { Managers } from '../../client/bootstrap'

// Фотография в форме оригинала: лестница `sizes` — stripped-ступень + оригинал.
const photo = (w: number, h: number, stripped: string): MyPhoto => ({
  _: 'photo',
  id: 1,
  sizes: [
    { _: 'photoStrippedSize', type: THUMB_TYPE_STRIPPED, bytes: stripped },
    { _: 'photoSize', type: THUMB_TYPE_FULL, w, h, size: 0 },
  ],
})

// 2D-контекст канваса (happy-dom его не умеет) — блюру достаточно заглушки.
HTMLCanvasElement.prototype.getContext = (() => ({
  filter: '',
  drawImage: () => {},
})) as unknown as typeof HTMLCanvasElement.prototype.getContext

// URL не резолвится (вечный pending) — «полная картинка ещё не пришла».
const fakeManagers = { media: { downloadMediaURL: vi.fn(() => new Promise(() => {})) } } as unknown as Managers
const withManagers = (ui: ReactElement) => (
  <ManagersProvider managers={fakeManagers}>{ui}</ManagersProvider>
)

afterEach(cleanup)

describe('RealMediaBubble: канвас-превью из blurPreview', () => {
  it('до прихода полного URL в контейнере рендерится canvas .media-photo.thumbnail.canvas-thumbnail', () => {
    const { container } = render(withManagers(
      <RealMediaBubble type="photo" mediaId={101} media={photo(800, 600, 'QUJD')} />,
    ))
    const canvas = container.querySelector('canvas.canvas-thumbnail')
    expect(canvas).toBeTruthy()
    expect(canvas!.classList.contains('media-photo')).toBe(true)
    expect(canvas!.classList.contains('thumbnail')).toBe(true)
    // превью лежит в контейнере медиа, ПЕРВЫМ ребёнком (tweb: thumb аппендится
    // до самого медиа — оно проявляется поверх)
    expect(canvas!.parentElement!.classList.contains('media-container')).toBe(true)
    expect(canvas!.parentElement!.firstElementChild).toBe(canvas)
    // background-image больше не используется (старый LQIP-путь)
    expect((canvas!.parentElement as HTMLElement).style.backgroundImage).toBe('')
  })

  it('URL известен синхронно (зеркало конвейера) — превью не монтируется, как в tweb при cacheContext.downloaded', () => {
    applyMediaUrl({ id: 102, thumb: false, url: 'blob:media-102' })
    const { container } = render(withManagers(
      <RealMediaBubble type="photo" mediaId={102} media={photo(800, 600, 'QUJD')} />,
    ))
    expect(container.querySelector('img.media-photo')?.getAttribute('src')).toBe('blob:media-102')
    expect(container.querySelector('canvas.canvas-thumbnail')).toBeNull()
  })

  it('платное заблокированное медиа: канвас-превью монтируется всегда (кроме blur у нас ничего нет)', () => {
    // «Заблокировано» — ВЫБОР конструктора позиции вектора, а не флаг рядом с
    // ценой: неоплативший получает превью, а не объект.
    const { container } = render(withManagers(
      <RealMediaBubble
        type="photo"
        media={photo(800, 600, 'QUJD')}
        paidMedia={{
          _: 'messageMediaPaidMedia',
          stars_amount: 5,
          extended_media: [{ _: 'messageExtendedMediaPreview', w: 800, h: 600, thumb: { _: 'photoStrippedSize', type: 'i', bytes: 'QUJD' } }],
        }}
      />,
    ))
    expect(container.querySelector('canvas.canvas-thumbnail')).toBeTruthy()
  })
})
