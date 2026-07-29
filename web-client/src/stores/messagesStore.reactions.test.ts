// applyReaction (Wave 3): АБСОЛЮТНЫЙ агрегат из серверного counts + деривация mine;
// applyReactionOptimistic: дельта оптимистичного клика до эха.
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
  return useMessagesStore.getState().byKey[String(CHAT)].msgs.find((m) => m.id === id)?.reactions
}

describe('messagesStore.applyReaction (absolute)', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(String(CHAT), { msgs: [msg(10)], reachedTop: true, reachedBottom: true })
  })

  it('ставит агрегат counts verbatim (чужое действие → mine=false)', () => {
    useMessagesStore.getState().applyReaction(CHAT, 10, [{ emoji: '🔥', count: 1 }], null, null)
    expect(reactionsOf(10)).toEqual([{ emoji: '🔥', count: 1, mine: false }])
  })

  it('моё add ставит mine на своём emoji; моё remove — снимает', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(CHAT, 10, [{ emoji: '🔥', count: 2 }], '🔥', 'add')
    expect(reactionsOf(10)).toEqual([{ emoji: '🔥', count: 2, mine: true }])
    st.applyReaction(CHAT, 10, [{ emoji: '🔥', count: 1 }], '🔥', 'remove')
    expect(reactionsOf(10)).toEqual([{ emoji: '🔥', count: 1, mine: false }])
  })

  it('сохраняет mine для не затронутых emoji при чужом обновлении', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(CHAT, 10, [{ emoji: '👍', count: 1 }], '👍', 'add') // моё
    // чужой добавил ❤️ — mine на 👍 должен сохраниться
    st.applyReaction(CHAT, 10, [{ emoji: '👍', count: 1 }, { emoji: '❤️', count: 1 }], null, null)
    expect(reactionsOf(10)).toEqual([
      { emoji: '👍', count: 1, mine: true },
      { emoji: '❤️', count: 1, mine: false },
    ])
  })

  it('пустой counts убирает чипы', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(CHAT, 10, [{ emoji: '🔥', count: 1 }], null, null)
    st.applyReaction(CHAT, 10, [], null, null)
    expect(reactionsOf(10)).toBeUndefined()
  })

  it('идемпотентно на реплей: тот же агрегат → без изменения ссылки msgs', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(CHAT, 10, [{ emoji: '🔥', count: 3 }], '🔥', 'add')
    const before = useMessagesStore.getState().byKey[String(CHAT)].msgs
    st.applyReaction(CHAT, 10, [{ emoji: '🔥', count: 3 }], '🔥', 'add') // catch-up повтор
    const after = useMessagesStore.getState().byKey[String(CHAT)].msgs
    expect(after).toBe(before) // no-op, ссылка окна не пересобралась
    expect(reactionsOf(10)).toEqual([{ emoji: '🔥', count: 3, mine: true }])
  })

  it('незагруженное окно / чужой msgId — no-op', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(999, 10, [{ emoji: '🔥', count: 1 }], null, null)
    st.applyReaction(CHAT, 555, [{ emoji: '🔥', count: 1 }], null, null)
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
    st.applyReaction(CHAT, 10, [{ emoji: '👍', count: 2 }], '👍', 'add')
    expect(reactionsOf(10)).toEqual([{ emoji: '👍', count: 2, mine: true }])
  })
})
