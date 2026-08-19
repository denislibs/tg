// Гейт catch-up для подписчика браузерных уведомлений: живой new_message должен
// дойти до notifyIncomingMessage, а кадр, восстановленный funnel'ом при
// reconnect/backfill (meta.catchUp === true), — уже «прошлое» и уведомление
// показывать не должен. Раньше это держалось ТОЛЬКО на побочном эффекте дедупа
// funnel'а по pts (см. 6edebfd/07c8967) — здесь подписчик спрашивает meta явно.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type NewMessageEvt } from '../../core/realtime/events'

const notifyIncomingMessage = vi.fn()
vi.mock('../uiNotifications', () => ({
  notifyIncomingMessage: (...args: unknown[]) => notifyIncomingMessage(...args),
}))

import { registerNotificationSubscriber } from './notificationSubscriber'

const evt = { peer_id: 5, sender_id: 2, type: 'text', text: 'привет' } as unknown as NewMessageEvt

describe('notificationSubscriber — RT.newMessage учитывает meta.catchUp', () => {
  beforeAll(() => registerNotificationSubscriber())

  beforeEach(() => {
    notifyIncomingMessage.mockClear()
  })

  it('живой кадр (catchUp: false) — уведомление уходит в notifyIncomingMessage', () => {
    rootScope.dispatchEventSingle(RT.newMessage, evt, { catchUp: false })
    expect(notifyIncomingMessage).toHaveBeenCalledTimes(1)
    expect(notifyIncomingMessage).toHaveBeenCalledWith(evt)
  })

  it('кадр из catch-up (catchUp: true) — уведомление НЕ показывается', () => {
    rootScope.dispatchEventSingle(RT.newMessage, evt, { catchUp: true })
    expect(notifyIncomingMessage).not.toHaveBeenCalled()
  })
})
