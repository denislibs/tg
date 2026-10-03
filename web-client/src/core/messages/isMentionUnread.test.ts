import { describe, expect, it } from 'vitest'
import isMentionUnread from './isMentionUnread'
import type { MyMessage } from '../models'

const msg = (pFlags: MyMessage['pFlags'], docType?: string): MyMessage => ({
  _: 'message',
  id: 1,
  date: 0,
  message: '@bob_petrov',
  pFlags,
  ...(docType ? { media: { _: 'messageMediaDocument', document: { type: docType } } } : {}),
} as unknown as MyMessage)

describe('isMentionUnread (tweb utils/messages/isMentionUnread)', () => {
  it('mentioned + media_unread — непрочитанное упоминание', () => {
    expect(isMentionUnread(msg({ mentioned: true, media_unread: true }))).toBe(true)
  })
  it('прочитанное упоминание (без media_unread) — нет', () => {
    expect(isMentionUnread(msg({ mentioned: true }))).toBe(false)
  })
  it('media_unread без mentioned (непрослушанное голосовое) — нет', () => {
    expect(isMentionUnread(msg({ media_unread: true }, 'voice'))).toBe(false)
  })
  it('голосовое/кружок с упоминанием — по этому признаку нет', () => {
    expect(isMentionUnread(msg({ mentioned: true, media_unread: true }, 'voice'))).toBe(false)
    expect(isMentionUnread(msg({ mentioned: true, media_unread: true }, 'round'))).toBe(false)
  })
  it('документ-фото с упоминанием — да; нет сообщения — нет', () => {
    expect(isMentionUnread(msg({ mentioned: true, media_unread: true }, 'photo'))).toBe(true)
    expect(isMentionUnread(undefined)).toBe(false)
  })
})
