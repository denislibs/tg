// hasRights зрителя — 1:1 с tweb `hasRights.ts:41`: `admin_rights ||
// banned_rights || default_banned_rights` как есть. Объединение личных
// запретов с запретами по умолчанию делает сервер (ViewerBannedRights), поэтому
// при `banned_rights` клиент на `default_banned_rights` не смотрит.
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

describe('hasRights — banned_rights как есть (tweb hasRights.ts:41)', () => {
  it('ограниченный видит свои (объединённые сервером) запреты (A1-06)', () => {
    const chat = group({ send_media: true, send_messages: true }, { send_messages: true })
    expect(hasRights(chat, 'send_media')).toBe(false)
    expect(hasRights(chat, 'send_messages')).toBe(false)
  })

  it('при banned_rights default_banned_rights не читается (как у tweb)', () => {
    expect(hasRights(group({ send_media: true }, { send_messages: true }), 'send_messages')).toBe(true)
  })

  it('без личного ограничения — запреты по умолчанию', () => {
    expect(hasRights(group(undefined, { send_media: true }), 'send_media')).toBe(false)
    expect(hasRights(group(undefined, {}), 'send_media')).toBe(true)
  })
})
