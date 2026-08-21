// Развилка дерева бабла и параметры стикера берутся ИЗ ВЛОЖЕНИЯ сообщения
// (`messageMediaPhoto`/`messageMediaDocument`), а не из плоских полей:
//   • какой бабл рисовать, решает `doc.type` — tweb bubbles.ts:8510-8512
//     (стикер / video|gif|round медиа-контейнером, всё прочее — строкой
//     документа внутри тела сообщения);
//   • бокс стикера — `setAttachmentSize` по `doc.w`/`doc.h` в ступень
//     `animatedSticker`/`staticSticker`, выбранную по `doc.animated`
//     (bubbles.ts:6102-6111);
//   • нижние слои стикера — ступени его `thumbs`: stripped-JPEG и векторный
//     контур `photoPathSize`, который до перехода на модель до бабла не доезжал.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { ReactElement } from 'react'

// mediaUrl на импорте стартует SharedWorker (нет в happy-dom) — мокаем.
vi.mock('../../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/media/${id}`,
  resolveStreamUrl: (id: number) => `/media/${id}`,
  hasMediaToken: () => true,
  primeMediaToken: vi.fn(),
  useMediaTokenVersion: () => 0,
}))

// Сам файл стикера к предмету не относится — подменяем узлом, пишущим пропсы.
const stickerProps = vi.fn()
vi.mock('../StickerMedia', () => ({
  default: (props: Record<string, unknown>) => {
    stickerProps(props)
    return <div data-testid="sticker" />
  },
}))
vi.mock('../../core/hooks/useManagers', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useManagers: () => ({ stickers: { setByMediaId: vi.fn().mockResolvedValue(null) } }),
}))

import MessageContent from './MessageContent'
import {
  saveDocument,
  THUMB_TYPE_PATH,
  THUMB_TYPE_STRIPPED,
  type DocumentAttribute,
  type MessageMedia,
  type PhotoSize,
} from '../../core/media/messageMedia'
import type { ConvMsg } from '../../data'
import type { FeedFns } from './MessageRow'

const feedFns = { openLightbox: vi.fn(), toggleSelect: vi.fn(), cancelUpload: vi.fn() } as unknown as FeedFns

const docMedia = (mime: string, attributes: DocumentAttribute[], thumbs?: PhotoSize[]): MessageMedia => ({
  _: 'messageMediaDocument',
  document: saveDocument({ _: 'document', id: 9, mime_type: mime, size: 1000, attributes, thumbs }),
})

const show = (m: Partial<ConvMsg>): ReactElement => (
  <MessageContent
    m={{ id: 1, peerId: 1, type: 'text', text: '', time: '10:00', ...m } as ConvMsg}
    out={false}
    firstInGroup
    lastInGroup
    selecting={false}
    showReactions={false}
    rowLive={false}
    canSeeReactionList
    feedFns={feedFns}
  />
)

afterEach(() => {
  cleanup()
  stickerProps.mockClear()
})

describe('MessageContent: развилка бабла по doc.type', () => {
  it('видео (documentAttributeVideo) — медиа-контейнер, а не строка документа', () => {
    const media = docMedia('video/mp4', [{ _: 'documentAttributeVideo', duration: 12, w: 640, h: 480 }])
    const { container } = render(show({ type: 'video', mediaId: 9, media }))
    expect(container.querySelector('.media-container')).toBeTruthy()
    expect(container.querySelector('.document-container')).toBeNull()
  })

  it('pdf — строка документа в теле сообщения, медиа-контейнера нет', () => {
    const media = docMedia('application/pdf', [{ _: 'documentAttributeFilename', file_name: 'оферта.pdf' }])
    const { container } = render(show({ type: 'document', mediaId: 9, media }))
    expect(container.querySelector('.document-container .document')).toBeTruthy()
    expect(container.querySelector('.media-container')).toBeNull()
  })
})

describe('MessageContent: стикер читает свой документ', () => {
  const stickerMedia = (mime: string, w: number, h: number) => docMedia(
    mime,
    [{ _: 'documentAttributeSticker', alt: '🔥', stickerset: { _: 'inputStickerSetID', id: 9 } }, { _: 'documentAttributeImageSize', w, h }],
    [
      { _: 'photoStrippedSize', type: THUMB_TYPE_STRIPPED, bytes: 'c3RyaXBwZWQ=' },
      { _: 'photoPathSize', type: THUMB_TYPE_PATH, bytes: 'cGF0aA==' },
    ],
  )

  it('бокс — вписанные doc.w/doc.h, ступени thumbs едут нижними слоями', () => {
    render(show({ type: 'sticker', mediaId: 9, media: stickerMedia('image/webp', 512, 256) }))
    expect(stickerProps.mock.calls[0][0]).toMatchObject({
      // staticSticker 200×200 (desktop), аспект 2:1 → 200×100
      width: 200,
      height: 100,
      thumb: 'c3RyaXBwZWQ=',
      pathThumb: 'cGF0aA==',
      // система координат контура — натуральные пиксели документа
      docWidth: 512,
      docHeight: 256,
    })
  })

  it('lottie (.tgs) идёт в ступень animatedSticker — тот же 200×200 бокс', () => {
    render(show({ type: 'sticker', mediaId: 9, media: stickerMedia('application/x-tgsticker', 512, 512) }))
    expect(stickerProps.mock.calls[0][0]).toMatchObject({ width: 200, height: 200 })
  })
})
