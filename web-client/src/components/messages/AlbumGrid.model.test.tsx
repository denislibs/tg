// Грид медиагруппы берёт геометрию ячеек ИЗ ВЛОЖЕНИЯ каждого элемента, ровно
// как tweb wrappers/album.ts:40-43: у фотографии — ступень лестницы под 480×480
// (`choosePhotoSize`), у документа — его собственные `w`/`h`. Развилка
// «фото/видео» там же (:80 `isPhoto = media._ === 'photo'`), а длительность
// бейджа — `doc.duration` (wrappers/video.ts:147).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { ReactElement } from 'react'

vi.mock('../../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/media/${id}`,
  hasMediaToken: () => true,
  primeMediaToken: vi.fn(),
  useMediaTokenVersion: () => 0,
}))

import AlbumGrid from './AlbumGrid'
import { saveDocument, THUMB_TYPE_FULL, type MessageMedia } from '../../core/media/messageMedia'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import type { ConvMsg } from '../../data'

const fakeManagers = { media: { downloadMediaURL: vi.fn(() => new Promise(() => {})) } } as unknown as Managers
const withManagers = (ui: ReactElement) => <ManagersProvider managers={fakeManagers}>{ui}</ManagersProvider>

const photoMedia = (w: number, h: number): MessageMedia => ({
  _: 'messageMediaPhoto',
  photo: { _: 'photo', id: 1, sizes: [{ _: 'photoSize', type: THUMB_TYPE_FULL, w, h, size: 0 }] },
})
const videoMedia = (w: number, h: number, duration: number): MessageMedia => ({
  _: 'messageMediaDocument',
  document: saveDocument({
    _: 'document',
    id: 2,
    mime_type: 'video/mp4',
    size: 1000,
    attributes: [{ _: 'documentAttributeVideo', duration, w, h }],
  }),
})

afterEach(cleanup)

describe('AlbumGrid: геометрия и тип ячейки — из вложения', () => {
  it('ширины ячеек считаются по РЕАЛЬНЫМ пропорциям вложений, длительность — из doc', () => {
    // Разные пропорции: широкое фото и высокое видео. Пока размер брался из
    // плоских полей с общей заплаткой «|| 100», обе ячейки выходили квадратами
    // одинаковой ширины — здесь они обязаны разъехаться.
    const items = [
      { id: 1, type: 'photo', mediaId: 1, media: photoMedia(1200, 400) },
      { id: 2, type: 'video', mediaId: 2, media: videoMedia(400, 1200, 65) },
    ] as unknown as ConvMsg[]
    const { container } = render(withManagers(
      <AlbumGrid items={items} selecting={false} onToggle={vi.fn()} />,
    ))

    const cells = [...container.querySelectorAll('.album-item')] as HTMLElement[]
    expect(cells).toHaveLength(2)
    // 3:1 и 1:3 не встают в один ряд — Layouter кладёт их друг под друга, и
    // высоты полос получаются РАЗНЫМИ (на квадратах-заплатках были бы равны).
    expect(parseFloat(cells[0].style.height)).not.toBeCloseTo(parseFloat(cells[1].style.height), 1)

    // видео-ячейка — та, где вложение документ (tweb: её рисует wrapVideo)
    expect(container.textContent).toContain('1:05')
  })

  it('без вложения-документа бейджа длительности нет вовсе', () => {
    const items = [
      { id: 1, type: 'photo', mediaId: 1, media: photoMedia(600, 600) },
      { id: 2, type: 'photo', mediaId: 2, media: photoMedia(600, 600) },
    ] as unknown as ConvMsg[]
    const { container } = render(withManagers(
      <AlbumGrid items={items} selecting={false} onToggle={vi.fn()} />,
    ))
    expect(container.querySelector('[class*="durBadge"]')).toBeNull()
  })
})
