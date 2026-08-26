// applyReactionOptimistic — дельта СВОЕГО клика до эха, единственное, что
// осталось от реакций в этом сторе.
//
// Абсолютного агрегата здесь БОЛЬШЕ НЕТ: и живой кадр, и ответ ручки
// react/unreact применяет владелец (`messages.cacheReaction` в воркере,
// слияние — `mergeReactions`) и объявляет готовое значение поля `reactions`
// операцией `patch`. Тесты той семантики — `core/reactions/messageReactions.test.ts`
// (сами функции) и `client/realtime/storeProjection.windowWriters.test.ts`
// (операция доехала до окна и до зеркала).
//
// Сам этот путь — React-ленточный (единственный вызыватель —
// `core/hooks/useMessageActions.tsx`) и уходит вместе с ней (этап 7).
import { beforeEach, describe, expect, it } from 'vitest'
import { useMessagesStore } from './messagesStore'
import type { MyMessage } from '../core/models'
import { isChosen } from '../core/reactions/messageReactions'
import { makeMessage } from '../core/messages/testMessage'

const CHAT = 7

function msg(id: number): MyMessage {
  return makeMessage({ id, peerId: CHAT, fromId: 1, text: 'hi' })
}
function reactionsOf(id: number) {
  return useMessagesStore.getState().byKey[String(CHAT)].msgs.find((m) => m.id === id)?.reactions
}
/** Что видно в чипах: эмодзи, счётчик, «моя». */
const chips = (id: number) =>
  (reactionsOf(id)?.results ?? []).map((c) => ({
    emoji: c.reaction._ === 'reactionPaid' ? '⭐' : c.reaction.emoticon,
    count: c.count,
    mine: isChosen(c),
  }))

describe('messagesStore.applyReactionOptimistic (delta)', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(String(CHAT), { msgs: [msg(10)], reachedTop: true, reachedBottom: true })
  })

  it('инкремент своего клика ставит чип с mine', () => {
    useMessagesStore.getState().applyReactionOptimistic(CHAT, 10, '👍', 'add')
    expect(chips(10)).toEqual([{ emoji: '👍', count: 1, mine: true }])
  })

  it('снятие своего клика убирает чип', () => {
    const st = useMessagesStore.getState()
    st.applyReactionOptimistic(CHAT, 10, '👍', 'add')
    st.applyReactionOptimistic(CHAT, 10, '👍', 'remove')
    expect(reactionsOf(10)).toBeUndefined()
  })

  it('незагруженное окно / чужой msgId — no-op', () => {
    const st = useMessagesStore.getState()
    st.applyReactionOptimistic(999, 10, '🔥', 'add')
    st.applyReactionOptimistic(CHAT, 555, '🔥', 'add')
    expect(useMessagesStore.getState().byKey[String(999)]).toBeUndefined()
    expect(reactionsOf(10)).toBeUndefined()
  })
})
