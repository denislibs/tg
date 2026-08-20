// Платное медиа (Telegram paid media): заблокированное сообщение приходит без
// media_id (только blur/цена). Раскрытие баббла (paid_media_unlock) с Task 6
// проверяют MessagesManager.cachePaidUnlock (генерация операции, включая
// многооконность — messagesManager.test.ts) и applyOp (слияние patch —
// messageOps.test.ts); сторный applyPaidUnlock, дублировавший ту же семантику
// вручную, стал недостижим и удалён.
import { describe, it, expect } from 'vitest'
import { mapMyMessage, type MessageReal, type RawMessageReal } from '../core/models'
import { makeRawMessage } from '../core/messages/testMessage'
import { getMediaFromMessage, getStrippedThumb } from '../core/media/messageMedia'

const base = (id: number, peerId: PeerId = 5): RawMessageReal =>
  makeRawMessage({ id, peerId, fromId: 1 })

// Заблокированное платное фото: media_id отсутствует, а вместо медиа сервер
// отдаёт ПСЕВДО-ФОТО (domain.LockedPlaceholder) — одна stripped-ступень с
// размерами кадра, ровно как оригинал собирает из messageExtendedMediaPreview.
const locked = (id: number): RawMessageReal => ({
  ...base(id),
  media: {
    _: 'messageMediaPhoto',
    // Две ступени, как их и собирает `domain.LockedPlaceholder`: превью и
    // размеры кадра ступенью `w` с нулевым `size` (скачивать нечего).
    photo: {
      _: 'photo', id: 0,
      sizes: [
        { _: 'photoStrippedSize', type: 'i', bytes: 'AAAA' },
        { _: 'photoSize', type: 'w', w: 800, h: 600, size: 0 },
      ],
    },
  },
  paid_media: { price: 25, locked: true },
})

describe('mapMessage paid_media', () => {
  it('maps a locked paid photo: no mediaId, has price + locked flag', () => {
    const m = mapMyMessage(locked(1)) as MessageReal
    // Адреса файла нет вовсе: у заблокированного медиа сервер отдаёт
    // псевдо-фото с нулевым id и одной stripped-ступенью.
    expect(m.paid_media).toEqual({ price: 25, locked: true })
    // плейсхолдер остаётся — но спрашиваем его у вложения (ступень
    // photoStrippedSize), как это делает wrapPhoto оригинала
    expect(getStrippedThumb(getMediaFromMessage(m))).toBe('AAAA')
  })
})
