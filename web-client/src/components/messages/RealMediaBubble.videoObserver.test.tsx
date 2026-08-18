// Пин на МЕХАНИЗМ, а не на значение: минимальная ширина видео
// (`MIN_VIDEO_SIDE_SIZE` = 368) висит на `canHaveVideoPlayer`, а тот в tweb —
// это `willObserveSound` (wrappers/video.ts:139-157 → :428), поднимающийся
// только под рубильником `USE_VIDEO_OBSERVER`. Константа в оригинале `false`,
// поэтому минимум не срабатывает ни разу (парный кейс с настоящей константой —
// `RealMediaBubble.fitted.test.tsx`, узкое видео 133×400).
//
// Здесь рубильник ВКЛЮЧЁН мокой модуля-владельца — ровно та подмена, которую
// сделает будущий порт наблюдателя звука. Бокс обязан поехать на 368: это и
// доказывает, что портирован гейт, а не зашито значение. Зашитый `false`
// (равно как и зашитый `true` в `canHaveVideoPlayer`) красит один из двух
// кейсов пары.
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

// Единственное, что бабл берёт из враппера видео, — сам рубильник (как tweb
// bubbles.ts:110 берёт его оттуда же), поэтому фабрика отдаёт только его.
vi.mock('../wrappers/video', () => ({ USE_VIDEO_OBSERVER: true }))

import RealMediaBubble from './RealMediaBubble'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'

const fakeManagers = { media: { downloadMediaURL: vi.fn(() => new Promise(() => {})) } } as unknown as Managers
const withManagers = (ui: ReactElement) => (
  <ManagersProvider managers={fakeManagers}>{ui}</ManagersProvider>
)

afterEach(cleanup)

describe('RealMediaBubble: включённый USE_VIDEO_OBSERVER', () => {
  it('узкое видео добивается до MIN_VIDEO_SIDE_SIZE (368), вписанный size остаётся 133', () => {
    const { container } = render(withManagers(
      <RealMediaBubble type="video" mediaId={401} width={200} height={600} mime="video/mp4" duration={46} />,
    ))

    const media = container.querySelector('.media-container') as HTMLElement
    expect(media.style.width).toBe('368px')
    expect(media.style.height).toBe('400px')

    // бокс раздвинут → медиа уезжает в аспектер вписанным (tweb photo.ts:136-137)
    const aspecter = media.querySelector('.media-container-aspecter') as HTMLElement
    expect(aspecter.style.width).toBe('133px')
    expect(aspecter.style.height).toBe('400px')
  })

  it('гифка плеера не получает и при включённом рубильнике (tweb: ветка doc.type !== gif)', () => {
    const { container } = render(withManagers(
      <RealMediaBubble type="video" mediaId={402} width={200} height={600} mime="video/mp4" fileName="tenor.gif.mp4" />,
    ))

    const media = container.querySelector('.media-container') as HTMLElement
    expect(media.style.width).toBe('133px')
  })
})
