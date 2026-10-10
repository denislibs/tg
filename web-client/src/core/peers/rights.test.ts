// hasRights зрителя: личные запреты (`channel.banned_rights`, только личные —
// Ф-3б, ревью #409 п. 3) объединяются с запретами чата по умолчанию; A1-06 —
// ограниченный видит свои запреты.
import { describe, expect, it } from 'vitest'
import { hasRights } from './rights'
import type { Chat } from './peer'

const group = (banned?: Record<string, true>, defaults: Record<string, true> = {}): Chat => ({
  _: 'channel',
  id: 6,
  title: 'Г',
  photo: { _: 'chatPhotoEmpty' },
  date: 0,
  pFlags: { megagroup: true },
  default_banned_rights: { _: 'chatBannedRights', pFlags: defaults, until_date: 0 },
  ...(banned ? { banned_rights: { _: 'chatBannedRights', pFlags: banned, until_date: 0 } } : {}),
}) as Chat

describe('hasRights — личные запреты ∪ запреты по умолчанию', () => {
  it('личный запрет действует (A1-06)', () => {
    expect(hasRights(group({ send_media: true }), 'send_media')).toBe(false)
    expect(hasRights(group({ send_media: true }), 'send_messages')).toBe(true)
  })

  it('запрет по умолчанию действует и у лично ограниченного', () => {
    const chat = group({ pin_messages: true }, { send_messages: true })
    expect(hasRights(chat, 'send_messages')).toBe(false)
    expect(hasRights(chat, 'pin_messages')).toBe(false)
  })

  it('без личного ограничения — только запреты по умолчанию', () => {
    expect(hasRights(group(undefined, { send_media: true }), 'send_media')).toBe(false)
    expect(hasRights(group(undefined, {}), 'send_media')).toBe(true)
  })
})
