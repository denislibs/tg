// src/components/chat/serviceMediaBubble.test.ts
//
// Смена фото чата рисуется КРУГОМ с новым фото и подписью под ним — порт
// tweb `wrapServiceMediaBubble` (bubbleParts/serviceMediaBubble.ts) через ветку
// `PHOTO_BUBBLE_ACTIONS` (bubbles.ts:8215-8263). Фото берётся из САМОГО
// действия (`action.photo`), а не из текущей аватарки группы.
import { describe, expect, it, vi } from 'vitest'

vi.mock('@core/media/ensureMediaUrl', () => ({ ensureMediaUrl: vi.fn(() => new Promise(() => {})) }))

import { createServiceBubble } from './serviceMessage'
import { getMiddleware } from '@helpers/middleware'
import { makeServiceMessage } from '@core/messages/testMessage'
import type { MessageAction } from '@core/messages/messageAction'

const deps = () => ({
  middleware: getMiddleware().get(),
  managers: { peers: { fillMirror: async () => {} } },
})

const pill = (action: MessageAction) =>
  createServiceBubble({ ...deps(), peerId: -6, message: makeServiceMessage({ id: 36, peerId: -6, fromId: 5, date: 1790489847, action }) })

describe('createServiceBubble — смена фото чата (wrapServiceMediaBubble)', () => {
  it('фото действия — круг 100 с подписью-фразой под ним', async () => {
    const bubble = pill({
      _: 'messageActionChatEditPhoto',
      photo: { _: 'photo', id: 14290, sizes: [
        { _: 'photoStrippedSize', type: 'i', bytes: 'AQID' },
        { _: 'photoSize', type: 'w', w: 640, h: 640, size: 42104 },
      ] },
    })
    const serviceMsg = bubble.querySelector('.service-msg')!
    expect(serviceMsg.classList.contains('bubble-service-media-wrapper')).toBe(true)
    expect(Array.from(serviceMsg.children).map((n) => n.className)).toEqual([
      'bubble-service-media-avatar-container',
      'bubble-service-media-text',
    ])
    const avatar = serviceMsg.querySelector('.bubble-service-media-avatar-container > .avatar')!
    expect(avatar.className).toContain('avatar-100')
    expect(avatar.className).toContain('bubble-service-media-avatar')
    // Фраза — подпись под фото, тем же узлом, что у обычной пилюли.
    expect(serviceMsg.querySelector('.bubble-service-media-text > span.i18n')?.textContent).toContain('фото группы')
    // Некликабельно: медиавьювера по фото чата у нас нет (см. шапку модуля).
    expect(serviceMsg.querySelector('.is-clickable')).toBeNull()

    // wrapPhoto встал в узел аватарки и переименовал классы в аватарочные
    // (tweb wrapPhotoToAvatar, avatarNew.tsx:246-258).
    await vi.waitFor(() => expect(avatar.querySelector('img.avatar-photo, canvas.avatar-photo')).not.toBeNull())
    expect(avatar.classList.contains('media-container')).toBe(false)
    expect(avatar.classList.contains('avatar-relative')).toBe(true)
    expect(avatar.querySelector('.media-photo')).toBeNull()
    expect(avatar.querySelector('.avatar-photo-thumbnail')).not.toBeNull()
    expect((avatar as HTMLElement).style.width).toBe('')
  })

  it('без фото в действии — обычная пилюля (гейт оригинала photo?._ === "photo")', () => {
    const bubble = pill({ _: 'messageActionChatEditPhoto' })
    const serviceMsg = bubble.querySelector('.service-msg')!
    expect(serviceMsg.classList.contains('bubble-service-media-wrapper')).toBe(false)
    expect(serviceMsg.children[0]?.tagName).toBe('SPAN')
  })
})
