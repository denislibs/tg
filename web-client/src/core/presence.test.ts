// Порт tweb `getUserStatusString.ts` целиком: ветки ПО ПИРУ (служебный
// аккаунт по id, бот, поддержка) идут до ветки по присутствию. Без них
// служебный «Telegram» (777000) был «был(а) давно», а бот — человеком.
import { describe, expect, it } from 'vitest'

import I18n from '@lib/langPack'
import { getUserStatusString, userHasPresence } from './presence'
import type { UserReal } from './peers/peer'
import { SERVICE_PEER_ID } from './peers/peerId'

const key = (el: HTMLElement) => (I18n.weakMap.get(el) as { key?: string } | undefined)?.key

const user = (id: number, pFlags: UserReal['pFlags'] = {}, status?: UserReal['status']): UserReal =>
  ({ _: 'user', id, first_name: 'X', pFlags, status })

describe('getUserStatusString (tweb getUserStatusString.ts)', () => {
  it('служебный аккаунт — «service notifications» (:19-21), что бы ни говорило присутствие', () => {
    const tg = user(SERVICE_PEER_ID, { verified: true, support: true })
    expect(key(getUserStatusString(tg))).toBe('Peer.ServiceNotifications')
    expect(key(getUserStatusString(tg, { _: 'userStatusOnline', expires: 1 }))).toBe('Peer.ServiceNotifications')
  })

  it('бот — «bot» (:23-27): числа активных у нас нет, это ветка bot_active_users === undefined', () => {
    expect(key(getUserStatusString(user(5, { bot: true }), { _: 'userStatusRecently' }))).toBe('Bot')
  })

  it('поддержка — «support» (:34-37)', () => {
    expect(key(getUserStatusString(user(6, { support: true }), { _: 'userStatusOnline', expires: 1 }))).toBe('SupportStatus')
  })

  it('человек — по присутствию; без второго аргумента — user.status', () => {
    expect(key(getUserStatusString(user(7, {}, { _: 'userStatusRecently' })))).toBe('Lately')
    expect(key(getUserStatusString(user(7, {}, { _: 'userStatusRecently' }), { _: 'userStatusOnline', expires: 1 }))).toBe('Online')
    expect(key(getUserStatusString(user(7)))).toBe('ALongTimeAgo')
  })

  it('карточки ещё нет — решает присутствие', () => {
    expect(key(getUserStatusString(undefined, { _: 'userStatusLastWeek' }))).toBe('WithinAWeek')
  })
})

describe('userHasPresence (appImManager.getUserStatus :3725)', () => {
  it('бот и служебный аккаунт — без typing/«в сети», человек и неизвестный — с', () => {
    expect(userHasPresence(user(1, { bot: true }))).toBe(false)
    expect(userHasPresence(user(SERVICE_PEER_ID, { support: true }))).toBe(false)
    expect(userHasPresence(user(2))).toBe(true)
    expect(userHasPresence(undefined)).toBe(true)
  })
})
