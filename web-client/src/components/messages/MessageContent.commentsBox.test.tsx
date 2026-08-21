// Пятый терм «блока сообщения» у бокса вложения — ПЛАШКА КОММЕНТАРИЕВ.
//
// Оригинал (tweb `setAttachmentSize.ts:75-87`) расширяет узкое медиа до 320px,
// когда под ним есть читаемый блок, и перечисляет пять источников такого блока:
// текст, фактчек, ответ, превью ссылки и `replies.pFlags.comments` — пост канала
// с обсуждением. Последний у нас приезжает готовым слотом `footer`
// (`ChatFeed` строит `CommentsBar` по `discussionsEnabled`), и до этого пина
// терм был потерян: плашка «N комментариев» висела под медиа шириной 300 и
// переносилась.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'

// mediaUrl на импорте стартует SharedWorker (нет в happy-dom) — мокаем.
vi.mock('../../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/media/${id}`,
  resolveStreamUrl: (id: number) => `/media/${id}`,
  hasMediaToken: () => true,
  primeMediaToken: vi.fn(),
  useMediaTokenVersion: () => 0,
}))

import MessageContent from './MessageContent'
import { THUMB_TYPE_FULL, type MessageMedia } from '../../core/media/messageMedia'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import type { ConvMsg } from '../../data'
import type { FeedFns } from './MessageRow'

const fakeManagers = { media: { downloadMediaURL: vi.fn(() => new Promise(() => {})) } } as unknown as Managers

const feedFns = { openLightbox: vi.fn(), toggleSelect: vi.fn(), cancelUpload: vi.fn() } as unknown as FeedFns

// Портрет 600×800: во вписанном виде это 300×400 — уже, чем 320.
const NARROW_PHOTO: MessageMedia = {
  _: 'messageMediaPhoto',
  photo: { _: 'photo', id: 1, sizes: [{ _: 'photoSize', type: THUMB_TYPE_FULL, w: 600, h: 800, size: 0 }] },
}

const show = (footer?: ReactNode): ReactElement => (
  <ManagersProvider managers={fakeManagers}>
    <MessageContent
      m={{ id: 1, peerId: 1, type: 'photo', text: '', time: '10:00', mediaId: 9, media: NARROW_PHOTO } as ConvMsg}
      out={false}
      firstInGroup
      lastInGroup
      selecting={false}
      showReactions={false}
      rowLive={false}
      canSeeReactionList
      feedFns={feedFns}
      footer={footer}
    />
  </ManagersProvider>
)

const mediaWidth = (container: HTMLElement) =>
  (container.querySelector('.media-container') as HTMLElement).style.width

afterEach(cleanup)

describe('MessageContent: бокс медиа под плашкой комментариев', () => {
  it('плашка комментариев расширяет узкое медиа до 320px', () => {
    const { container } = render(show(<div className="replies">2 комментария</div>))

    expect(mediaWidth(container)).toBe('320px')
  })

  it('без плашки и подписи медиа остаётся вписанным', () => {
    const { container } = render(show())

    expect(mediaWidth(container)).toBe('300px')
  })
})
