// Футер «N комментариев» под постом канала читает счётчик и последних
// комментаторов ИЗ САМОГО ПОСТА — параметр `replies` конструктора
// `messageReplies`, как у оригинала (tweb bubbles.ts:9699 берёт
// `message.replies.replies`, appMessagesManager.ts:9237-9247 — `recent_repliers`).
//
// Что ломается без этого. Прежде счётчик возила отдельная карта из ручки
// `/channels/{id}/comment_counts`, которую опрашивал `useChannelExtras` на
// каждое изменение окна: те же данные вторым запросом, да ещё с КЛИЕНТСКИМИ
// номерами постов на проводе (без `getServerMessageId`) — то есть про
// несуществующие номера. Тест смотрит туда, откуда число берётся теперь: в окно.
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

import ChatFeed from './ChatFeed'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import type { ConvMsg } from '../../data'
import type { MessageReplies, MyMessage } from '../../core/models'
import type { FeedFns } from './MessageRow'
import { makeMessage } from '../../core/messages/testMessage'

const CHANNEL = -100

const fakeManagers = {
  media: { downloadMediaURL: vi.fn(() => new Promise(() => {})) },
  // Стек аватаров объявляет пробел зеркала пиров сам (usePeers → fillMirror).
  peers: { fillMirror: vi.fn(async () => {}) },
} as unknown as Managers
const feedFns = { openLightbox: vi.fn(), toggleSelect: vi.fn(), openSender: vi.fn(), openDatePicker: vi.fn() } as unknown as FeedFns

/** Пост канала: в окне — сообщение с тредом, в витрине — его строка. */
const post = (id: number, replies?: MessageReplies): MyMessage =>
  makeMessage({ id, peerId: CHANNEL, text: `пост ${id}`, date: 1_750_000_000 + id, replies })

const conv = (id: number): ConvMsg =>
  ({ id, peerId: CHANNEL, type: 'text', text: `пост ${id}`, time: '10:00' }) as ConvMsg

const show = (winMsgs: MyMessage[], discussionsEnabled = true): ReactElement => (
  <ManagersProvider managers={fakeManagers}>
    <ChatFeed
      msgs={winMsgs.map((m) => conv(m.id))}
      winMsgs={winMsgs}
      isRealChat
      isGroup={false}
      canQuickReact={false}
      discussionsEnabled={discussionsEnabled}
      highlightSeq={null}
      unreadDividerSeq={null}
      selecting={false}
      selected={new Set()}
      stickyDateKey={null}
      feedFns={feedFns}
      onOpenDiscussion={vi.fn()}
    />
  </ManagersProvider>
)

const footerText = (c: HTMLElement) => c.querySelector('.replies-footer-text')?.textContent
const avatars = (c: HTMLElement) => c.querySelectorAll('.replies-footer-avatars .avatar').length

afterEach(cleanup)

describe('ChatFeed: футер комментариев берёт тред из сообщения', () => {
  it('счётчик — `replies.replies` самого поста', () => {
    const { container } = render(show([
      post(5, { _: 'messageReplies', pFlags: { comments: true }, replies: 3, channel_id: 77 }),
    ]))

    // Язык прогона — en по умолчанию, поэтому слово английское; здесь важно
    // ЧИСЛО: оно пришло из `replies.replies`, а не из карты счётчиков.
    expect(footerText(container)).toBe('3 Comments')
  })

  it('стек аватаров — `recent_repliers` того же треда', () => {
    const { container } = render(show([
      post(5, {
        _: 'messageReplies',
        pFlags: { comments: true },
        replies: 2,
        recent_repliers: [{ _: 'peerUser', user_id: 8 }, { _: 'peerUser', user_id: 9 }],
        channel_id: 77,
      }),
    ]))

    expect(avatars(container)).toBe(2)
  })

  // Тред у поста есть всегда, когда каналу привязано обсуждение, — но у поста,
  // приехавшего ЖИВЫМ кадром, параметра `replies` пока нет (кадр его не несёт,
  // см. долг в отчёте задачи). Футер обязан остаться: «комментировать можно» —
  // факт чата (`discussionsEnabled`), а не только сообщения.
  it('пост без треда в сообщении: футер есть, счётчик пустой', () => {
    const { container } = render(show([post(6)]))

    expect(container.querySelector('.replies-footer')).not.toBeNull()
    expect(footerText(container)).toBe('Comments')
    expect(avatars(container)).toBe(0)
  })

  it('без обсуждения у канала футера нет вовсе', () => {
    const { container } = render(show(
      [post(5, { _: 'messageReplies', pFlags: { comments: true }, replies: 3, channel_id: 77 })],
      false,
    ))

    expect(container.querySelector('.replies-footer')).toBeNull()
  })
})
