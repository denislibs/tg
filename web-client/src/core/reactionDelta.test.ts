import { describe, it, expect } from 'vitest'
import { reactionDelta } from './reactionDelta'

const me = { id: 7, name: 'Я' }

describe('reactionDelta — свой peer в recent', () => {
  it('новая своя реакция сразу несёт карточку зрителя', () => {
    const next = reactionDelta(undefined, '👍', 'add', true, me)
    expect(next).toEqual([{ emoji: '👍', count: 1, mine: true, recent: [me] }])
  })

  it('своя реакция поверх чужой — я первым в recent, чужие сохраняются', () => {
    const list = [{ emoji: '👍', count: 1, mine: false, recent: [{ id: 2, name: 'B' }] }]
    const next = reactionDelta(list, '👍', 'add', true, me)
    expect(next?.[0].recent).toEqual([me, { id: 2, name: 'B' }])
    expect(next?.[0].count).toBe(2)
  })

  it('снятие своей реакции убирает меня из recent, остальных оставляет', () => {
    const list = [{ emoji: '👍', count: 2, mine: true, recent: [me, { id: 2, name: 'B' }] }]
    const next = reactionDelta(list, '👍', 'remove', true, me)
    expect(next?.[0].recent).toEqual([{ id: 2, name: 'B' }])
    expect(next?.[0].mine).toBe(false)
  })

  it('recent не теряется, когда карточка зрителя не передана (эхо чужого)', () => {
    const list = [{ emoji: '👍', count: 1, mine: false, recent: [{ id: 2, name: 'B' }] }]
    const next = reactionDelta(list, '👍', 'add', false)
    expect(next?.[0].recent).toEqual([{ id: 2, name: 'B' }])
    expect(next?.[0].count).toBe(2)
  })

  it('recent не растёт бесконечно — не больше трёх карточек', () => {
    const list = [{
      emoji: '👍',
      count: 3,
      mine: false,
      recent: [{ id: 2, name: 'B' }, { id: 3, name: 'C' }, { id: 4, name: 'D' }],
    }]
    const next = reactionDelta(list, '👍', 'add', true, me)
    expect(next?.[0].recent).toHaveLength(3)
    expect(next?.[0].recent?.[0]).toEqual(me)
  })

  it('эхо своего уже применённого действия — по-прежнему no-op', () => {
    const list = [{ emoji: '👍', count: 1, mine: true, recent: [me] }]
    expect(reactionDelta(list, '👍', 'add', true, me)).toBeNull()
  })
})
