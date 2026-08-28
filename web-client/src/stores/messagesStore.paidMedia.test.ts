// Платное медиа (Telegram paid media): «заблокировано» это ВЫБОР КОНСТРУКТОРА
// позиции вектора — `messageExtendedMediaPreview` (коробка кадра и
// stripped-подложка, и ничего, по чему можно получить байты) против
// `messageExtendedMedia` с объектом целиком. Булева ключа рядом с ценой больше
// нет вовсе.
//
// Раскрытие баббла (paid_media_unlock) проверяют MessagesManager.cachePaidUnlock
// (генерация операции, включая многооконность — messagesManager.test.ts) и
// applyOp (слияние patch — messageOps.test.ts).
import { describe, it, expect } from 'vitest'
import { mapMyMessage, type MessageReal, type RawMessageReal } from '../core/models'
import { makeRawMessage } from '../core/messages/testMessage'
import {
  getExtendedMediaPreview, getMediaFromMessage, getPaidMedia, getStrippedThumb, isPaidMediaLocked,
} from '../core/media/messageMedia'

const base = (id: number, peerId: PeerId = 5): RawMessageReal =>
  makeRawMessage({ id, peerId, fromId: 1 })

/** Неоплативший зритель: вместо вложения — превью. Ни id файла, ни mime, ни
 *  длительности; только размеры кадра и stripped-подложка. */
const locked = (id: number): RawMessageReal => ({
  ...base(id),
  media: {
    _: 'messageMediaPaidMedia',
    stars_amount: 25,
    extended_media: [{
      _: 'messageExtendedMediaPreview',
      w: 800,
      h: 600,
      thumb: { _: 'photoStrippedSize', type: 'i', bytes: 'AAAA' },
    }],
  },
})

/** Оплачено: та же обёртка, но позиция вектора несёт настоящее вложение. */
const unlocked = (id: number): RawMessageReal => ({
  ...base(id),
  media: {
    _: 'messageMediaPaidMedia',
    stars_amount: 25,
    extended_media: [{
      _: 'messageExtendedMedia',
      media: {
        _: 'messageMediaPhoto',
        photo: { _: 'photo', id: 77, sizes: [{ _: 'photoSize', type: 'w', w: 800, h: 600, size: 100 }] },
      },
    }],
  },
})

describe('платное медиа — гейт задан конструктором, а не флагом', () => {
  it('неоплаченное: приезжает превью, файла нет вовсе', () => {
    const m = mapMyMessage(locked(1)) as MessageReal
    const paid = getPaidMedia(m)!
    expect(paid.stars_amount).toBe(25)
    expect(isPaidMediaLocked(paid)).toBe(true)
    // Адреса файла нет ВООБЩЕ — спрашивать его у вложения бессмысленно.
    expect(getMediaFromMessage(m)).toBeUndefined()
    // Подложка есть — но она лежит в превью, а не в псевдо-фото рядом.
    expect(getExtendedMediaPreview(m)?.thumb).toEqual({ _: 'photoStrippedSize', type: 'i', bytes: 'AAAA' })
  })

  it('оплаченное: тот же конструктор обёртки, но внутри настоящее вложение', () => {
    const m = mapMyMessage(unlocked(2)) as MessageReal
    const paid = getPaidMedia(m)!
    expect(isPaidMediaLocked(paid)).toBe(false)
    expect(getExtendedMediaPreview(m)).toBeUndefined()
    expect(getMediaFromMessage(m)?.id).toBe(77)
  })

  it('обычное вложение платным не считается', () => {
    const m = mapMyMessage({
      ...base(3),
      media: {
        _: 'messageMediaPhoto',
        photo: { _: 'photo', id: 9, sizes: [{ _: 'photoStrippedSize', type: 'i', bytes: 'BBBB' }] },
      },
    }) as MessageReal
    expect(getPaidMedia(m)).toBeUndefined()
    expect(getStrippedThumb(getMediaFromMessage(m))).toBe('BBBB')
  })
})
