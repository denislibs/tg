import { describe, it, expect } from 'vitest'
import type { BoostsStatus } from '../models'
import { boostedByMe, boostProgress, mergeBoosts } from './boostsStatus'

const status = (over: Partial<BoostsStatus> = {}): BoostsStatus => ({
  _: 'premium.boostsStatus', level: 2, boosts: 4, current_level_boosts: 3, next_level_boosts: 6, ...over,
})

describe('boostProgress', () => {
  it('доля до следующего уровня и остаток бустов', () => {
    // уровень 2 (порог 3), следующий — 6, текущих бустов 4
    expect(boostProgress(status())).toEqual({ progress: (4 - 3) / (6 - 3), need: 2 })
  })
  it('на пороге уровня прогресс 0', () => {
    expect(boostProgress(status({ boosts: 3 }))).toEqual({ progress: 0, need: 3 })
  })
  // ПОСЛЕДНИЙ УРОВЕНЬ — отсутствие следующего порога, а не ноль рядом. Прежний
  // маппер склеивал эти два состояния (`next_level_boosts ?? 0`), и «максимум»
  // приходилось восстанавливать догадкой «span<=0».
  it('последний уровень (порога дальше нет) → полоса полная, добирать нечего', () => {
    const max = status({ boosts: 10, current_level_boosts: 10 })
    delete max.next_level_boosts
    expect(boostProgress(max)).toEqual({ progress: 1, need: 0 })
  })
  it('клампится в [0..1]', () => {
    expect(boostProgress(status({ boosts: 100 })).progress).toBe(1)
  })
  it('статуса ещё нет — полоса не считается', () => {
    expect(boostProgress(undefined)).toEqual({ progress: 1, need: 0 })
  })
})

describe('boostedByMe', () => {
  // «Бустнул ли я» — БИТ конструктора: «нет» это отсутствие ключа, а не false.
  it('читается из pFlags, отсутствие бита = не бустил', () => {
    expect(boostedByMe(status({ pFlags: { my_boost: true } }))).toBe(true)
    expect(boostedByMe(status())).toBe(false)
    expect(boostedByMe(undefined)).toBe(false)
  })
})

describe('mergeBoosts — живой кадр канала', () => {
  // Тело кадра одно на всех подписчиков: пер-зрительского в нём нет и быть не
  // может — ни «бустнул ли я», ни свободных слотов.
  it('счётчики берутся из кадра, мой буст и слоты — из прежнего состояния', () => {
    const prev = { status: status({ pFlags: { my_boost: true } }), slots: 3 }
    const merged = mergeBoosts(prev, status({ boosts: 9, level: 3 }))
    expect(merged.status.boosts).toBe(9)
    expect(merged.status.level).toBe(3)
    expect(boostedByMe(merged.status)).toBe(true)
    expect(merged.slots).toBe(3)
  })

  it('без прежнего состояния слотов не выдумывает', () => {
    expect(mergeBoosts(undefined, status())).toEqual({ status: status(), slots: 0 })
  })
})
