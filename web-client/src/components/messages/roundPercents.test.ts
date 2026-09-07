// Пин на РЕЗУЛЬТАТ округления долей опроса, а не на форму вызова: показанные
// проценты обязаны давать в сумме ровно 100, иначе под вопросом стоит
// «33% 33% 33%» — это видно глазом и это первое, что ломает наивный `round`.
import { describe, expect, it } from 'vitest'
import type { PollResults } from '@core/media/messageMedia'
import { getRoundedPercentsFromResults, roundPercents } from './roundPercents'

const results = (voters: number[]): PollResults => ({
  _: 'pollResults',
  results: voters.map((v, i) => ({
    _: 'pollAnswerVoters' as const,
    option: btoa(String.fromCharCode(i)),
    voters: v,
  })),
  total_voters: voters.reduce((a, b) => a + b, 0),
})

describe('roundPercents (tweb bubbleParts/pollMessageContent/roundPercents.ts)', () => {
  it('три равные трети дают 34/33/33, а не 33/33/33', () => {
    // Наивный Math.floor дал бы сумму 99; недостающий процент уходит первому
    // по правилу «равные остатки → больше целая часть».
    expect(roundPercents([100 / 3, 100 / 3, 100 / 3])).toEqual([34, 33, 33])
  })

  it('сумма всегда ровно 100 на любом наборе голосов', () => {
    const cases = [
      [1, 1, 1],
      [1, 2, 3, 4],
      [5, 5, 5, 5, 5, 5, 5],
      [1, 1, 1, 1, 1, 1],
      [7, 11, 13],
      [1, 999],
    ]
    for (const voters of cases) {
      const percents = getRoundedPercentsFromResults(results(voters))
      expect(percents.reduce((a, b) => a + b, 0), `голоса ${voters.join(', ')}`).toBe(100)
    }
  })

  it('без голосов — нули по числу вариантов, а не пустой список и не NaN', () => {
    // Мутация «убрать ветку totalVotes === 0» дала бы [NaN, NaN, NaN]:
    // деление на ноль в процентах.
    expect(getRoundedPercentsFromResults(results([0, 0, 0]))).toEqual([0, 0, 0])
  })

  it('единственный проголосовавший вариант забирает все 100%', () => {
    expect(getRoundedPercentsFromResults(results([0, 3, 0]))).toEqual([0, 100, 0])
  })

  it('итогов нет вовсе — пустой список', () => {
    expect(getRoundedPercentsFromResults(undefined)).toEqual([])
    expect(getRoundedPercentsFromResults({ _: 'pollResults' })).toEqual([])
  })
})
