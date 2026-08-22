// applyReaction: АБСОЛЮТНЫЙ агрегат кадра поверх окна; applyReactionOptimistic —
// дельта своего клика до эха.
//
// Семантика изменилась портом кадра реакций на конструктор схемы: кадр несёт
// только абсолютное состояние и помечен `pFlags.min` (тело одно на всех
// получателей, моего chosen_order в нём нет). Поэтому `mine` больше НЕ
// приезжает извне двумя сигналами («мой эмодзи» + «add/remove») — он живёт в
// окне и сохраняется поверх любого агрегата, а ставит его оптимистичный клик.
import { beforeEach, describe, expect, it } from 'vitest'
import { useMessagesStore } from './messagesStore'
import type { MyMessage } from '../core/models'
import { makeMessage } from '../core/messages/testMessage'

const CHAT = 7

function msg(id: number): MyMessage {
  return makeMessage({ id, peerId: CHAT, fromId: 1, text: 'hi' })
}
function reactionsOf(id: number) {
  return useMessagesStore.getState().byKey[String(CHAT)].msgs.find((m) => m.id === id)?.reactions
}

describe('messagesStore.applyReaction (absolute)', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(String(CHAT), { msgs: [msg(10)], reachedTop: true, reachedBottom: true })
  })

  it('ставит агрегат counts verbatim (чужое действие → mine=false)', () => {
    useMessagesStore.getState().applyReaction(CHAT, 10, [{ emoji: '🔥', count: 1, mine: false }])
    expect(reactionsOf(10)).toEqual([{ emoji: '🔥', count: 1, mine: false }])
  })

  it('своё mine ставит клик, агрегат его сохраняет; снятый клик — снимает', () => {
    const st = useMessagesStore.getState()
    st.applyReactionOptimistic(CHAT, 10, '🔥', 'add')
    st.applyReaction(CHAT, 10, [{ emoji: '🔥', count: 2, mine: false }])
    expect(reactionsOf(10)).toEqual([{ emoji: '🔥', count: 2, mine: true }])
    st.applyReactionOptimistic(CHAT, 10, '🔥', 'remove')
    st.applyReaction(CHAT, 10, [{ emoji: '🔥', count: 1, mine: false }])
    expect(reactionsOf(10)).toEqual([{ emoji: '🔥', count: 1, mine: false }])
  })

  it('сохраняет mine для не затронутых emoji при чужом обновлении', () => {
    const st = useMessagesStore.getState()
    st.applyReactionOptimistic(CHAT, 10, '👍', 'add') // моё
    // чужой добавил ❤️ — mine на 👍 должен сохраниться
    st.applyReaction(CHAT, 10, [{ emoji: '👍', count: 1, mine: false }, { emoji: '❤️', count: 1, mine: false }])
    expect(reactionsOf(10)).toEqual([
      { emoji: '👍', count: 1, mine: true },
      { emoji: '❤️', count: 1, mine: false },
    ])
  })

  it('пустой counts убирает чипы', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(CHAT, 10, [{ emoji: '🔥', count: 1, mine: false }])
    st.applyReaction(CHAT, 10, [])
    expect(reactionsOf(10)).toBeUndefined()
  })

  it('идемпотентно на реплей: тот же агрегат → без изменения ссылки msgs', () => {
    const st = useMessagesStore.getState()
    st.applyReactionOptimistic(CHAT, 10, '🔥', 'add')
    st.applyReaction(CHAT, 10, [{ emoji: '🔥', count: 3, mine: false }])
    const before = useMessagesStore.getState().byKey[String(CHAT)].msgs
    st.applyReaction(CHAT, 10, [{ emoji: '🔥', count: 3, mine: false }]) // catch-up повтор
    const after = useMessagesStore.getState().byKey[String(CHAT)].msgs
    expect(after).toBe(before) // no-op, ссылка окна не пересобралась
    expect(reactionsOf(10)).toEqual([{ emoji: '🔥', count: 3, mine: true }])
  })

  it('незагруженное окно / чужой msgId — no-op', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(999, 10, [{ emoji: '🔥', count: 1, mine: false }])
    st.applyReaction(CHAT, 555, [{ emoji: '🔥', count: 1, mine: false }])
    expect(useMessagesStore.getState().byKey[String(999)]).toBeUndefined()
    expect(reactionsOf(10)).toBeUndefined()
  })
})

describe('messagesStore.applyReactionOptimistic (delta)', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(String(CHAT), { msgs: [msg(10)], reachedTop: true, reachedBottom: true })
  })

  it('инкремент своего клика с mine, затем абсолютное эхо перезаписывает агрегат', () => {
    const st = useMessagesStore.getState()
    st.applyReactionOptimistic(CHAT, 10, '👍', 'add')
    expect(reactionsOf(10)).toEqual([{ emoji: '👍', count: 1, mine: true }])
    // сервер прислал абсолютный агрегат (кто-то ещё тоже нажал) — mine сохраняется
    st.applyReaction(CHAT, 10, [{ emoji: '👍', count: 2, mine: false }])
    expect(reactionsOf(10)).toEqual([{ emoji: '👍', count: 2, mine: true }])
  })
})
