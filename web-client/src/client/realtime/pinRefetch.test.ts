// Кадр закрепления — конструктор `updatePinnedMessages`, и пир у него тоже
// конструктор (`Peer`), а не знаковое число рядом с телом.
//
// Пин держит проводку: подписчик обязан взять ключ пира из конструктора и
// перечитать закреплённые ИМЕННО этого чата. Прежде кадр вёз `peer_id` числом,
// и та же строка молча брала бы `undefined` — список закреплённых просто не
// обновился бы, а тестов на этот путь не было вовсе.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type PinMessageEvt } from '../../core/realtime/events'
import type { Managers } from '../bootstrap'

import { registerRefetchSubscriber } from './refetchSubscriber'

const listPins = vi.fn().mockResolvedValue([])

describe('refetchSubscriber: закрепление перечитывает пины по ключу из конструктора', () => {
  beforeEach(() => {
    listPins.mockClear()
  })

  it('пир из peerChannel → отрицательный ключ', async () => {
    registerRefetchSubscriber({ messages: { listPins } } as unknown as Managers)

    const frame: PinMessageEvt = {
      _: 'updatePinnedMessages',
      peer: { _: 'peerChannel', channel_id: 42 },
      messages: [7],
      pFlags: { pinned: true },
    }
    rootScope.dispatchEventSingle(RT.pinMessage, frame)
    await Promise.resolve()

    expect(listPins).toHaveBeenCalledWith(-42)
  })
})
