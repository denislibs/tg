// applyReaction: дельты агрегатов реакций + идемпотентность к серверному эху
// собственного действия (оптимистичный апдейт уже применён).
import { beforeEach, describe, expect, it } from 'vitest'
import { useMessagesStore } from './messagesStore'
import type { Message } from '../core/models'

const CHAT = 7

function msg(id: number): Message {
  return {
    id, chatId: CHAT, seq: id, senderId: 1, type: 'text', text: 'hi',
    replyToId: null, mediaId: null, createdAt: '2026-07-19T10:00:00Z', threadRootId: null,
  }
}

function reactionsOf(id: number) {
  return useMessagesStore.getState().byChat[CHAT].msgs.find((m) => m.id === id)?.reactions
}

describe('messagesStore.applyReaction', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byChat: {} })
    useMessagesStore.getState().setWindow(CHAT, { msgs: [msg(10)], reachedTop: true, reachedBottom: true })
  })

  it('добавляет новый чип и инкрементит существующий', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(CHAT, 10, '🔥', 'add', false)
    expect(reactionsOf(10)).toEqual([{ emoji: '🔥', count: 1, mine: false }])
    st.applyReaction(CHAT, 10, '🔥', 'add', true)
    expect(reactionsOf(10)).toEqual([{ emoji: '🔥', count: 2, mine: true }])
  })

  it('remove декрементит и убирает чип при нуле', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(CHAT, 10, '❤️', 'add', false)
    st.applyReaction(CHAT, 10, '❤️', 'add', true)
    st.applyReaction(CHAT, 10, '❤️', 'remove', false)
    expect(reactionsOf(10)).toEqual([{ emoji: '❤️', count: 1, mine: true }])
    st.applyReaction(CHAT, 10, '❤️', 'remove', true)
    expect(reactionsOf(10)).toBeUndefined()
  })

  it('эхо собственного add поверх оптимистичного — no-op', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(CHAT, 10, '👍', 'add', true) // оптимистично
    st.applyReaction(CHAT, 10, '👍', 'add', true) // серверное эхо
    expect(reactionsOf(10)).toEqual([{ emoji: '👍', count: 1, mine: true }])
  })

  it('эхо собственного remove поверх оптимистичного — no-op', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(CHAT, 10, '👍', 'add', false) // чужая остаётся
    st.applyReaction(CHAT, 10, '👍', 'add', true)
    st.applyReaction(CHAT, 10, '👍', 'remove', true) // оптимистичное снятие
    st.applyReaction(CHAT, 10, '👍', 'remove', true) // эхо
    expect(reactionsOf(10)).toEqual([{ emoji: '👍', count: 1, mine: false }])
  })

  it('незагруженное окно / чужой msgId — no-op', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(999, 10, '🔥', 'add', false)
    st.applyReaction(CHAT, 555, '🔥', 'add', false)
    expect(useMessagesStore.getState().byChat[999]).toBeUndefined()
    expect(reactionsOf(10)).toBeUndefined()
  })
})
