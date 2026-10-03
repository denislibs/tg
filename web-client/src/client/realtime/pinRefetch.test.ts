// Кадр закрепления — конструктор `updatePinnedMessages`, и пир у него тоже
// конструктор (`Peer`), а не знаковое число рядом с телом.
//
// Пин держит проводку: подписчик обязан взять ключ пира из конструктора, сбросить
// кэш закрепов и объявить `peer_pinned_messages` (tweb `resetPinnedMessagesCache`)
// ИМЕННО этого чата — по нему плашка и экран закрепов перечитывают список.
import { afterEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type PinMessageEvt } from '../../core/realtime/events'
import type { Managers } from '../bootstrap'

import { registerRefetchSubscriber } from './refetchSubscriber'

describe('refetchSubscriber: закрепление объявляет peer_pinned_messages по ключу из конструктора', () => {
  const listener = vi.fn()
  afterEach(() => {
    rootScope.removeEventListener('peer_pinned_messages', listener)
    listener.mockClear()
  })

  it('пир из peerChannel → отрицательный ключ, номера и бит закрепления', () => {
    registerRefetchSubscriber({} as unknown as Managers)
    rootScope.addEventListener('peer_pinned_messages', listener)

    const frame: PinMessageEvt = {
      _: 'updatePinnedMessages',
      peer: { _: 'peerChannel', channel_id: 42 },
      messages: [7],
      pFlags: { pinned: true },
    }
    rootScope.dispatchEventSingle(RT.pinMessage, frame)

    expect(listener).toHaveBeenCalledWith({ peerId: -42, mids: [7], pinned: true })
  })

  it('открепление — тот же конструктор без бита', () => {
    registerRefetchSubscriber({} as unknown as Managers)
    rootScope.addEventListener('peer_pinned_messages', listener)

    rootScope.dispatchEventSingle(RT.pinMessage, { _: 'updatePinnedMessages', peer: { _: 'peerUser', user_id: 5 }, messages: [3] })

    expect(listener).toHaveBeenCalledWith({ peerId: 5, mids: [3], pinned: false })
  })
})
