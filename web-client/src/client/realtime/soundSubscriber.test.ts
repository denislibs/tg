// Гейт catch-up для звукового подписчика: живой new_message с эффектом должен
// проиграть canvas-эффект (порт tweb message effects), а кадр, восстановленный
// funnel'ом при reconnect/backfill (meta.catchUp === true), — уже «прошлое» и
// звучать не должен. Раньше это держалось ТОЛЬКО на побочном эффекте дедупа
// funnel'а по pts (см. 6edebfd/07c8967) — здесь подписчик спрашивает meta явно.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type NewMessageEvt } from '../../core/realtime/events'
import { useChatsStore } from '../../stores/chatsStore'

const playEmojiEffect = vi.fn()
vi.mock('../../core/effects/emojiEffects', () => ({
  playEmojiEffect: (...args: unknown[]) => playEmojiEffect(...args),
}))

import { registerSoundSubscriber } from './soundSubscriber'

// Открытый чат 5, эффект от чужого отправителя (2 !== meId 1) — оба условия
// обработчика выполнены, дальше решает только meta.catchUp.
const evt = { peer_id: 5, sender_id: 2, effect: 'hearts' } as unknown as NewMessageEvt

describe('soundSubscriber — RT.newMessage учитывает meta.catchUp', () => {
  beforeAll(() => registerSoundSubscriber())

  beforeEach(() => {
    playEmojiEffect.mockClear()
    useChatsStore.setState({ meId: 1, activePeerId: 5 })
  })

  it('живой кадр (catchUp: false) — эффект играет', () => {
    rootScope.dispatchEventSingle(RT.newMessage, evt, { catchUp: false })
    expect(playEmojiEffect).toHaveBeenCalledTimes(1)
  })

  it('кадр из catch-up (catchUp: true) — эффект НЕ играет', () => {
    rootScope.dispatchEventSingle(RT.newMessage, evt, { catchUp: true })
    expect(playEmojiEffect).not.toHaveBeenCalled()
  })
})
