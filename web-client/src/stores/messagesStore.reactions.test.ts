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
import type { MessageReactions, MyMessage } from '../core/models'
import { isChosen, myPaidStars } from '../core/reactions/messageReactions'
import { makeMessage } from '../core/messages/testMessage'

const CHAT = 7

function msg(id: number): MyMessage {
  return makeMessage({ id, peerId: CHAT, fromId: 1, text: 'hi' })
}
function reactionsOf(id: number) {
  return useMessagesStore.getState().byKey[String(CHAT)].msgs.find((m) => m.id === id)?.reactions
}
/** Агрегат в форме провода: `chosen_order` в кадре не бывает (`pFlags.min`). */
const frame = (
  results: { emoticon?: string; paid?: true; count: number }[],
): MessageReactions => ({
  _: 'messageReactions',
  results: results.map((r) => ({
    _: 'reactionCount',
    reaction: r.paid ? { _: 'reactionPaid' } : { _: 'reactionEmoji', emoticon: r.emoticon! },
    count: r.count,
  })),
})
/** Что видно в чипах: эмодзи, счётчик, «моя». */
const chips = (id: number) =>
  (reactionsOf(id)?.results ?? []).map((c) => ({
    emoji: c.reaction._ === 'reactionPaid' ? '⭐' : c.reaction.emoticon,
    count: c.count,
    mine: isChosen(c),
  }))

describe('messagesStore.applyReaction (absolute)', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(String(CHAT), { msgs: [msg(10)], reachedTop: true, reachedBottom: true })
  })

  it('ставит агрегат кадра verbatim (чужое действие → не моя)', () => {
    useMessagesStore.getState().applyReaction(CHAT, 10, frame([{ emoticon: '🔥', count: 1 }]))
    expect(chips(10)).toEqual([{ emoji: '🔥', count: 1, mine: false }])
  })

  it('своё mine ставит клик, агрегат его сохраняет; снятый клик — снимает', () => {
    const st = useMessagesStore.getState()
    st.applyReactionOptimistic(CHAT, 10, '🔥', 'add')
    st.applyReaction(CHAT, 10, frame([{ emoticon: '🔥', count: 2 }]))
    expect(chips(10)).toEqual([{ emoji: '🔥', count: 2, mine: true }])
    st.applyReactionOptimistic(CHAT, 10, '🔥', 'remove')
    st.applyReaction(CHAT, 10, frame([{ emoticon: '🔥', count: 1 }]))
    expect(chips(10)).toEqual([{ emoji: '🔥', count: 1, mine: false }])
  })

  it('сохраняет mine для не затронутых emoji при чужом обновлении', () => {
    const st = useMessagesStore.getState()
    st.applyReactionOptimistic(CHAT, 10, '👍', 'add') // моё
    // чужой добавил ❤️ — мой выбор на 👍 должен сохраниться
    st.applyReaction(CHAT, 10, frame([{ emoticon: '👍', count: 1 }, { emoticon: '❤️', count: 1 }]))
    expect(chips(10)).toEqual([
      { emoji: '👍', count: 1, mine: true },
      { emoji: '❤️', count: 1, mine: false },
    ])
  })

  it('пустой агрегат убирает чипы', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(CHAT, 10, frame([{ emoticon: '🔥', count: 1 }]))
    st.applyReaction(CHAT, 10, frame([]))
    expect(reactionsOf(10)).toBeUndefined()
  })

  it('идемпотентно на реплей: тот же агрегат → без изменения ссылки msgs', () => {
    const st = useMessagesStore.getState()
    st.applyReactionOptimistic(CHAT, 10, '🔥', 'add')
    st.applyReaction(CHAT, 10, frame([{ emoticon: '🔥', count: 3 }]))
    const before = useMessagesStore.getState().byKey[String(CHAT)].msgs
    st.applyReaction(CHAT, 10, frame([{ emoticon: '🔥', count: 3 }])) // catch-up повтор
    const after = useMessagesStore.getState().byKey[String(CHAT)].msgs
    expect(after).toBe(before) // no-op, ссылка окна не пересобралась
    expect(chips(10)).toEqual([{ emoji: '🔥', count: 3, mine: true }])
  })

  it('платный чип того же агрегата: сумма из кадра, свой вклад — из окна', () => {
    const st = useMessagesStore.getState()
    // Свой вклад известен только из ответа ручки: в общем теле кадра его нет.
    st.applyStarReaction(CHAT, 10, 10, 10)
    // Кадр принёс агрегат целиком — вместе с платным чипом, он в том же векторе.
    st.applyReaction(CHAT, 10, frame([{ paid: true, count: 25 }, { emoticon: '🔥', count: 1 }]))
    expect(chips(10)).toEqual([
      { emoji: '⭐', count: 25, mine: false },
      { emoji: '🔥', count: 1, mine: false },
    ])
    expect(myPaidStars(reactionsOf(10))).toBe(10)
  })

  it('агрегат без платного чипа снимает ⭐: половин у него не бывает', () => {
    const st = useMessagesStore.getState()
    st.applyStarReaction(CHAT, 10, 10, 10)
    st.applyReaction(CHAT, 10, frame([]))
    expect(reactionsOf(10)).toBeUndefined()
  })

  it('незагруженное окно / чужой msgId — no-op', () => {
    const st = useMessagesStore.getState()
    st.applyReaction(999, 10, frame([{ emoticon: '🔥', count: 1 }]))
    st.applyReaction(CHAT, 555, frame([{ emoticon: '🔥', count: 1 }]))
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
    expect(chips(10)).toEqual([{ emoji: '👍', count: 1, mine: true }])
    // сервер прислал абсолютный агрегат (кто-то ещё тоже нажал) — мой выбор цел
    st.applyReaction(CHAT, 10, frame([{ emoticon: '👍', count: 2 }]))
    expect(chips(10)).toEqual([{ emoji: '👍', count: 2, mine: true }])
  })
})
