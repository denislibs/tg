import { describe, it, expect } from 'vitest'
import { reactionDelta } from './reactionDelta'

// `recent` — КЛЮЧИ пиров (порт `recentReactions.map((r) => getPeerId(r.peer_id))`,
// tweb `reaction.ts:1083`), а не мини-карточки: имя и фото чип берёт из зеркала.
const ME = 7
const B = 2

describe('reactionDelta — свой peer в recent', () => {
  it('новая своя реакция сразу несёт ключ зрителя', () => {
    const next = reactionDelta(undefined, '👍', 'add', true, ME)
    expect(next).toEqual([{ emoji: '👍', count: 1, mine: true, recent: [ME] }])
  })

  it('своя реакция поверх чужой — я первым в recent, чужие сохраняются', () => {
    const list = [{ emoji: '👍', count: 1, mine: false, recent: [B] }]
    const next = reactionDelta(list, '👍', 'add', true, ME)
    expect(next?.[0].recent).toEqual([ME, B])
    expect(next?.[0].count).toBe(2)
  })

  it('снятие своей реакции убирает меня из recent, остальных оставляет', () => {
    const list = [{ emoji: '👍', count: 2, mine: true, recent: [ME, B] }]
    const next = reactionDelta(list, '👍', 'remove', true, ME)
    expect(next?.[0].recent).toEqual([B])
    expect(next?.[0].mine).toBe(false)
  })

  it('recent не теряется, когда ключ зрителя не передан (эхо чужого)', () => {
    const list = [{ emoji: '👍', count: 1, mine: false, recent: [B] }]
    const next = reactionDelta(list, '👍', 'add', false)
    expect(next?.[0].recent).toEqual([B])
    expect(next?.[0].count).toBe(2)
  })

  it('recent не растёт бесконечно — не больше трёх ключей', () => {
    const list = [{ emoji: '👍', count: 3, mine: false, recent: [2, 3, 4] }]
    const next = reactionDelta(list, '👍', 'add', true, ME)
    expect(next?.[0].recent).toHaveLength(3)
    expect(next?.[0].recent?.[0]).toBe(ME)
  })

  // Ключ пира ЗНАКОВЫЙ: автором реакции может быть канал (`peerChannel`), и
  // тогда в recent лежит отрицательное число. Нуль — законный ключ (пользователь
  // с id 0 у нас не существует, но арифметика знака на нём и ломается), поэтому
  // «ключ не передан» выражено `undefined`, а не ложностью значения.
  it('канал как автор реакции: отрицательный ключ переживает дельту', () => {
    const CHANNEL = -100
    const list = [{ emoji: '👍', count: 1, mine: false, recent: [CHANNEL] }]
    const next = reactionDelta(list, '👍', 'add', true, ME)
    expect(next?.[0].recent).toEqual([ME, CHANNEL])
  })

  it('эхо своего уже применённого действия — по-прежнему no-op', () => {
    const list = [{ emoji: '👍', count: 1, mine: true, recent: [ME] }]
    expect(reactionDelta(list, '👍', 'add', true, ME)).toBeNull()
  })
})
