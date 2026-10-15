// Б-9: после конца эфира зритель выходит из множества участников на сервере —
// StopLivestream его не чистит, и без group_call_leave «призрак» держал бы
// видеочат идущим без админа.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendCallFrame = vi.fn()
vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({ managers: { realtime: { sendCallFrame: (...a: unknown[]) => sendCallFrame(...a) } } }),
}))

const PEER = -100

describe('livestreamEngine: конец эфира', () => {
  let engine: typeof import('./livestreamEngine')
  let store: typeof import('../../stores/livestreamStore')

  beforeEach(async () => {
    vi.resetModules()
    sendCallFrame.mockReset()
    engine = await import('./livestreamEngine')
    store = await import('../../stores/livestreamStore')
  })

  it('зритель при stopped шлёт group_call_leave и снимает просмотр', () => {
    engine.watchLivestream(PEER)
    sendCallFrame.mockClear()
    engine.handleLivestreamFrame({ t: 'livestream_update', d: { peer_id: PEER, action: 'stopped' } })
    expect(store.useLivestreamStore.getState().watchingPeerId).toBeNull()
    expect(sendCallFrame).toHaveBeenCalledWith({ type: 'group_call_leave', data: { peer_id: PEER } })
  })

  it('не зритель — кадров не шлёт', () => {
    engine.handleLivestreamFrame({ t: 'livestream_update', d: { peer_id: PEER, action: 'stopped' } })
    expect(sendCallFrame).not.toHaveBeenCalled()
  })
})
