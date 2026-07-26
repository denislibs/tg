import { describe, it, expect } from 'vitest'
import { boostProgress, mapBoostStatus, mapGiveaway } from './models'

describe('boostProgress', () => {
  it('доля до следующего уровня и остаток бустов', () => {
    // уровень 2 (порог 3), следующий — 6, текущих бустов 4
    expect(boostProgress({ boostsCount: 4, currentLevelBoosts: 3, nextLevelBoosts: 6 }))
      .toEqual({ progress: (4 - 3) / (6 - 3), need: 2 })
  })
  it('на пороге уровня прогресс 0', () => {
    expect(boostProgress({ boostsCount: 3, currentLevelBoosts: 3, nextLevelBoosts: 6 }))
      .toEqual({ progress: 0, need: 3 })
  })
  it('нулевой диапазон (макс. уровень) → прогресс 1', () => {
    expect(boostProgress({ boostsCount: 10, currentLevelBoosts: 10, nextLevelBoosts: 10 }))
      .toEqual({ progress: 1, need: 0 })
  })
  it('клампится в [0..1]', () => {
    expect(boostProgress({ boostsCount: 100, currentLevelBoosts: 3, nextLevelBoosts: 6 }).progress).toBe(1)
  })
})

describe('mapBoostStatus', () => {
  it('snake_case → camelCase', () => {
    const st = mapBoostStatus({
      level: 2, boosts_count: 4, current_level_boosts: 3, next_level_boosts: 6,
      boosted_by_me: true, slots: 3,
    })
    expect(st).toEqual({
      level: 2, boostsCount: 4, currentLevelBoosts: 3, nextLevelBoosts: 6,
      boostedByMe: true, slots: 3,
    })
  })
})

describe('mapGiveaway', () => {
  it('маппит приз/победителей/участие', () => {
    const g = mapGiveaway({
      id: 7, chat_id: 5, prize_kind: 'premium', months: 3, stars: 0,
      winners_count: 10, until_date: 123, status: 'active',
      participants: 4, participating: true, winner_ids: null, i_won: false,
    })
    expect(g.id).toBe(7)
    expect(g.prizeKind).toBe('premium')
    expect(g.winnersCount).toBe(10)
    expect(g.participating).toBe(true)
    expect(g.winnerIds).toEqual([])
    expect(g.iWon).toBe(false)
  })
})
