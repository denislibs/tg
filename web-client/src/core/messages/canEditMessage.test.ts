// Срок правки (tweb `canEditMessage` :8382-8386, `config.edit_time_limit`): своё
// сообщение в личке правится 48 ч — тем же сроком сервер отказывает
// (`message_edit.go::editTimeLimit`). Без проверки меню показывало «Изменить»,
// а правка тонула в 403.
import { describe, expect, it } from 'vitest'
import canEditMessage, { EDIT_TIME_LIMIT } from './canEditMessage'
import { makeMessage } from './testMessage'

const ME = 1
const BOB = 2
const ctx = { myId: ME as PeerId, getPeer: () => undefined }
const now = () => Math.floor(Date.now() / 1000)

describe('canEditMessage: срок правки', () => {
  it('своё в личке — до 48 ч можно, после — нельзя', () => {
    const fresh = makeMessage({ id: 1, peerId: BOB as PeerId, fromId: ME as PeerId, out: true, text: 'x', date: now() - 60 })
    const old = makeMessage({ id: 2, peerId: BOB as PeerId, fromId: ME as PeerId, out: true, text: 'x', date: now() - EDIT_TIME_LIMIT - 60 })
    expect(canEditMessage(fresh, 'text', ctx)).toBe(true)
    expect(canEditMessage(old, 'text', ctx)).toBe(false)
  })

  it('«Избранное» — без срока', () => {
    const old = makeMessage({ id: 3, peerId: ME as PeerId, fromId: ME as PeerId, out: true, text: 'x', date: now() - EDIT_TIME_LIMIT - 60 })
    expect(canEditMessage(old, 'text', ctx)).toBe(true)
  })
})
