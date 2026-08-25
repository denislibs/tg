// Реакции бабла — порт tweb `ReactionsElement`/`ReactionElement`.
//
// Пины: разметка чипа, порог счётчика (у оригинала до четвёртой реакции место
// занимают аватарки) и отсутствие узла, когда реакций нет вовсе.
import { describe, expect, it } from 'vitest'
import type { MessageReactions } from '@core/models'
import { createReactionsElement, REACTIONS_DISPLAY_COUNTER_AT } from './reactions'

const agg = (...counts: { emoticon: string; count: number; mine?: boolean }[]): MessageReactions => ({
  _: 'messageReactions',
  results: counts.map((c) => ({
    _: 'reactionCount',
    reaction: { _: 'reactionEmoji', emoticon: c.emoticon },
    count: c.count,
    ...(c.mine ? { chosen_order: 0 } : {}),
  })),
})

describe('createReactionsElement', () => {
  it('чип несёт эмодзи и разметку оригинала', () => {
    const el = createReactionsElement(agg({ emoticon: '👍', count: 1 }))!

    expect(el.classList.contains('reactions')).toBe(true)
    expect(el.classList.contains('reactions-block')).toBe(true)

    const chip = el.querySelector('.reaction')!
    expect(chip.classList.contains('reaction-block')).toBe(true)
    expect(chip.querySelector('.reaction-sticker')!.textContent).toBe('👍')
  })

  it('МОЯ реакция помечена is-chosen', () => {
    const el = createReactionsElement(agg(
      { emoticon: '👍', count: 2, mine: true },
      { emoticon: '🔥', count: 1 },
    ))!

    const chips = el.querySelectorAll('.reaction')
    expect(chips[0].classList.contains('is-chosen')).toBe(true)
    expect(chips[1].classList.contains('is-chosen')).toBe(false)
  })

  it('счётчик появляется только с ЧЕТВЁРТОЙ реакции (tweb REACTIONS_DISPLAY_COUNTER_AT)', () => {
    // До порога оригинал показывает аватарки реагировавших, а не число.
    expect(REACTIONS_DISPLAY_COUNTER_AT).toBe(4)

    const few = createReactionsElement(agg({ emoticon: '👍', count: 3 }))!
    expect(few.querySelector('.reaction-counter')).toBeNull()

    const many = createReactionsElement(agg({ emoticon: '👍', count: 4 }))!
    expect(many.querySelector('.reaction-counter')!.textContent).toBe('4')
  })

  it('реакций нет — узла тоже нет (пустой занял бы строку под баблом)', () => {
    expect(createReactionsElement(undefined)).toBeUndefined()
    expect(createReactionsElement({ _: 'messageReactions', results: [] })).toBeUndefined()
  })

  it('порядок чипов — порядок вектора результатов', () => {
    const el = createReactionsElement(agg(
      { emoticon: '👍', count: 5 },
      { emoticon: '🔥', count: 9 },
    ))!

    const stickers = [...el.querySelectorAll('.reaction-sticker')].map((s) => s.textContent)
    expect(stickers).toEqual(['👍', '🔥'])
  })
})
