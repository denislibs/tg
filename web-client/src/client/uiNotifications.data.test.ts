import { describe, expect, it, vi } from 'vitest'
import { generateMessageId } from '../core/history/messageId'

vi.mock('./bootstrap', () => ({ startClient: vi.fn() }))
vi.mock('../lib/appImManager', () => ({ default: { chat: undefined } }))

import { foregroundNotificationData } from './uiNotifications'

/* Клик по уведомлению вкладки идёт через тот же `notificationclick` в `public/sw.js`,
 * что и по серверному пушу, и читается тем же `appImManager.onPushClick`: адрес —
 * `custom.peerId` и `custom.msg_id` строками, номер серверный (tweb `PushNotificationObject`). */
describe('foregroundNotificationData', () => {
  it('peerId со знаком и серверный номер строками, как в теле серверного пуша', () => {
    expect(foregroundNotificationData({ peerId: -5, id: generateMessageId(9) }))
      .toEqual({ custom: { peerId: '-5', msg_id: '9' } })
    expect(foregroundNotificationData({ peerId: 7, id: generateMessageId(3) }))
      .toEqual({ custom: { peerId: '7', msg_id: '3' } })
  })
})
