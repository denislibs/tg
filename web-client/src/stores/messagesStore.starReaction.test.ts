// applyStarReaction: агрегат платной ⭐-реакции (total) + сохранение личного
// вклада (mine) когда апдейт не от самого зрителя.
import { beforeEach, describe, expect, it } from 'vitest'
import { useMessagesStore } from './messagesStore'
import type { MyMessage } from '../core/models'
import { makeMessage } from '../core/messages/testMessage'

const CHAT = 7

function msg(id: number): MyMessage {
  return makeMessage({ id, peerId: CHAT, fromId: 1, text: 'hi' })
}

function starOf(id: number) {
  return useMessagesStore.getState().byKey[String(CHAT)].msgs.find((m) => m.id === id)?.starReaction
}

describe('messagesStore.applyStarReaction', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(String(CHAT), { msgs: [msg(10)], reachedTop: true, reachedBottom: true })
  })

  it('ставит total и mine (своё действие)', () => {
    useMessagesStore.getState().applyStarReaction(CHAT, 10, 15, 15)
    expect(starOf(10)).toEqual({ total: 15, mine: 15 })
  })

  it('чужой апдейт меняет total, сохраняя мой вклад', () => {
    const st = useMessagesStore.getState()
    st.applyStarReaction(CHAT, 10, 15, 15) // мой вклад 15
    st.applyStarReaction(CHAT, 10, 40) // кто-то добавил ещё, mine не передан
    expect(starOf(10)).toEqual({ total: 40, mine: 15 })
  })

  it('незагруженное окно / чужой msgId — no-op', () => {
    const st = useMessagesStore.getState()
    st.applyStarReaction(999, 10, 5, 5)
    st.applyStarReaction(CHAT, 555, 5, 5)
    expect(useMessagesStore.getState().byKey[String(999)]).toBeUndefined()
    expect(starOf(10)).toBeUndefined()
  })
})
