// Срок правки (tweb `canEditMessage` :8382-8386, `config.edit_time_limit`): своё
// сообщение в личке правится не дольше `editTimeLimit` секунд — число берётся из
// конфига приложения (`help.getConfig`, тем же сроком сервер отказывает:
// `domain.EditTimeLimit`). Без проверки меню показывало «Изменить», а правка
// тонула в 403.
import { describe, expect, it } from 'vitest'
import canEditMessage from './canEditMessage'
import { makeMessage } from './testMessage'

const ME = 1
const BOB = 2
const DAY = 86400
const ctx = { myId: ME as PeerId, getPeer: () => undefined, editTimeLimit: 2 * DAY }
const now = () => Math.floor(Date.now() / 1000)

describe('canEditMessage: срок правки', () => {
  it('своё в личке — до срока можно, после — нельзя', () => {
    const fresh = makeMessage({ id: 1, peerId: BOB as PeerId, fromId: ME as PeerId, out: true, text: 'x', date: now() - 60 })
    const old = makeMessage({ id: 2, peerId: BOB as PeerId, fromId: ME as PeerId, out: true, text: 'x', date: now() - 2 * DAY - 60 })
    expect(canEditMessage(fresh, 'text', ctx)).toBe(true)
    expect(canEditMessage(old, 'text', ctx)).toBe(false)
  })

  // Срок — из конфига, а не зашитые 48 ч: при сроке в час сообщение двухчасовой
  // давности уже не правится, а при двух сутках — правится.
  it('срок приходит из конфига', () => {
    const twoHours = makeMessage({ id: 4, peerId: BOB as PeerId, fromId: ME as PeerId, out: true, text: 'x', date: now() - 7200 })
    expect(canEditMessage(twoHours, 'text', { ...ctx, editTimeLimit: 3600 })).toBe(false)
    expect(canEditMessage(twoHours, 'text', { ...ctx, editTimeLimit: 2 * DAY })).toBe(true)
  })

  // Конфига нет (первый запуск без сети): `message.date < now - undefined` у
  // tweb ложно, срок не ограничивает — сервер откажет сам.
  it('конфига нет — срок не ограничивает', () => {
    const old = makeMessage({ id: 5, peerId: BOB as PeerId, fromId: ME as PeerId, out: true, text: 'x', date: now() - 30 * DAY })
    expect(canEditMessage(old, 'text', { myId: ME as PeerId, getPeer: () => undefined })).toBe(true)
  })

  it('«Избранное» — без срока', () => {
    const old = makeMessage({ id: 3, peerId: ME as PeerId, fromId: ME as PeerId, out: true, text: 'x', date: now() - 3 * DAY })
    expect(canEditMessage(old, 'text', ctx)).toBe(true)
  })
})
