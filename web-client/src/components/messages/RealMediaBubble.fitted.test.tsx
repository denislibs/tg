// Расширенный бокс медиабабла (tweb `setAttachmentSize` + wrappers/photo.ts:134-137,
// живой DOM dumps/03-video-poll.json): узкой картинке с подписью контейнер
// раздвигают до 320px (`boxSize`), а САМО медиа остаётся вписанным — 300×400 —
// и живёт в `.media-container-aspecter`. Аспектер, получивший размер контейнера,
// вырождается: картинка растягивается на весь раздвинутый бокс.
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

import RealMediaBubble from './RealMediaBubble'
import { ManagersProvider } from '../../core/hooks/useManagers'
import { applyMediaUrl } from '../../core/mediaCache'
import type { Managers } from '../../client/bootstrap'

const fakeManagers = { media: { downloadMediaURL: vi.fn(() => new Promise(() => {})) } } as unknown as Managers
const withManagers = (ui: ReactElement) => (
  <ManagersProvider managers={fakeManagers}>{ui}</ManagersProvider>
)

afterEach(cleanup)

describe('RealMediaBubble: расширенный бокс', () => {
  it('контейнер — boxSize (320×400), аспектер — вписанный size (300×400)', () => {
    applyMediaUrl({ id: 301, thumb: false, url: 'blob:media-301' })
    const { container } = render(withManagers(
      <RealMediaBubble type="photo" mediaId={301} width={600} height={800} hasMessageBlock />,
    ))

    const media = container.querySelector('.media-container') as HTMLElement
    expect(media.classList.contains('media-container-fitted')).toBe(true)
    expect(media.style.width).toBe('320px')
    expect(media.style.height).toBe('400px')

    const aspecter = media.querySelector('.media-container-aspecter') as HTMLElement
    expect(aspecter).toBeTruthy()
    expect(aspecter.style.width).toBe('300px')
    expect(aspecter.style.height).toBe('400px')
    // само медиа — внутри аспектера, а не в раздвинутом контейнере
    expect(aspecter.querySelector('img.media-photo')).toBeTruthy()
  })

  it('вписанное медиа аспектера не получает вовсе (isFit)', () => {
    applyMediaUrl({ id: 302, thumb: false, url: 'blob:media-302' })
    const { container } = render(withManagers(
      <RealMediaBubble type="photo" mediaId={302} width={1600} height={900} hasMessageBlock />,
    ))

    const media = container.querySelector('.media-container') as HTMLElement
    expect(media.style.width).toBe('420px')
    expect(media.style.height).toBe('236px')
    expect(media.querySelector('.media-container-aspecter')).toBeNull()
    expect(media.querySelector('img.media-photo')).toBeTruthy()
  })

  // Минимум 368 (MIN_VIDEO_SIDE_SIZE) в оригинале включает `canHaveVideoPlayer`,
  // а это `willObserveSound` из wrapVideo — он стоит под `USE_VIDEO_OBSERVER`,
  // и константа выключена. Поэтому узкое видео у tweb такое же узкое, как узкое
  // фото. Парный кейс с ВКЛЮЧЁННОЙ константой — RealMediaBubble.videoObserver.test.tsx.
  it('узкое видео — вписанный бокс 133×400 (минимум 368 не срабатывает, как в tweb)', () => {
    const { container } = render(withManagers(
      <RealMediaBubble type="video" mediaId={303} width={200} height={600} mime="video/mp4" duration={46} />,
    ))

    const media = container.querySelector('.media-container') as HTMLElement
    expect(media.style.width).toBe('133px')
    expect(media.style.height).toBe('400px')
  })
})
