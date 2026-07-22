// Платное медиа (Telegram paid media): заблокированное сообщение приходит без
// media_id (только blur/цена); applyPaidUnlock раскрывает баббл (возвращает
// media_id + снимает флаг locked) во всех окнах чата.
import { describe, it, expect, beforeEach } from 'vitest'
import { useMessagesStore, winKey } from './messagesStore'
import { mapMessage, type RawMessage } from '../core/models'

const base = (id: number, chatId = 5): RawMessage => ({
  id, chat_id: chatId, seq: id, sender_id: 1, type: 'photo', text: '',
  reply_to_id: null, media_id: null, created_at: '2026-07-01T00:00:00Z',
})

// Заблокированное платное фото: media_id отсутствует, есть blur/размеры + цена.
const locked = (id: number): RawMessage => ({
  ...base(id), media_id: null, media_w: 800, media_h: 600, media_blur: 'AAAA',
  paid_media: { price: 25, locked: true },
})

// Разблокированный вариант того же сообщения (кадр paid_media_unlock).
const unlocked = (id: number): RawMessage => ({
  ...base(id), media_id: 909, media_w: 800, media_h: 600, media_mime: 'image/jpeg',
  media_blur: 'AAAA', media_size: 12345, paid_media: { price: 25, locked: false },
})

describe('mapMessage paid_media', () => {
  it('maps a locked paid photo: no mediaId, has price + locked flag', () => {
    const m = mapMessage(locked(1))
    expect(m.mediaId).toBeNull()
    expect(m.paidMedia).toEqual({ price: 25, locked: true })
    expect(m.mediaBlur).toBe('AAAA') // плейсхолдер остаётся
  })
})

describe('messagesStore.applyPaidUnlock', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(winKey(5), {
      msgs: [mapMessage(base(1, 5)), mapMessage(locked(2))],
      reachedTop: true, reachedBottom: true,
    })
    useMessagesStore.getState().setWindow(winKey(7), {
      msgs: [mapMessage(locked(2))],
      reachedTop: true, reachedBottom: true,
    })
  })

  it('reveals the media (mediaId back, locked cleared)', () => {
    useMessagesStore.getState().applyPaidUnlock(5, mapMessage(unlocked(2)))
    const m = useMessagesStore.getState().byKey[winKey(5)].msgs.find((x) => x.id === 2)
    expect(m?.mediaId).toBe(909)
    expect(m?.mediaMime).toBe('image/jpeg')
    expect(m?.paidMedia).toEqual({ price: 25, locked: false })
  })

  it('touches only the given chat', () => {
    useMessagesStore.getState().applyPaidUnlock(5, mapMessage(unlocked(2)))
    // чат 7 не тронут (разблокировка персональна для окна чата 5)
    const other = useMessagesStore.getState().byKey[winKey(7)].msgs.find((x) => x.id === 2)
    expect(other?.mediaId).toBeNull()
    expect(other?.paidMedia).toEqual({ price: 25, locked: true })
  })

  it('is a no-op for an unknown message', () => {
    const before = useMessagesStore.getState().byKey
    useMessagesStore.getState().applyPaidUnlock(5, mapMessage(unlocked(999)))
    expect(useMessagesStore.getState().byKey).toBe(before)
  })
})
