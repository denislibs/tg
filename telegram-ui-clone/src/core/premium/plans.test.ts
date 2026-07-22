import { describe, it, expect } from 'vitest'
import { PREMIUM_PLANS, planById, formatUsd, perMonthCents, discountPct } from './plans'

describe('premium plans', () => {
  it('exposes 1/6/12-month tiers', () => {
    expect(PREMIUM_PLANS.map((p) => p.id).sort()).toEqual(['12m', '1m', '6m'])
  })
  it('resolves by id', () => {
    expect(planById('6m').months).toBe(6)
  })
  it('formats USD', () => {
    expect(formatUsd(4499)).toBe('$44.99')
    expect(formatUsd(499)).toBe('$4.99')
  })
  it('computes per-month price', () => {
    expect(perMonthCents(planById('12m'))).toBe(Math.round(4499 / 12))
    expect(perMonthCents(planById('1m'))).toBe(499)
  })
  it('computes a discount vs monthly (0 for monthly)', () => {
    expect(discountPct(planById('1m'))).toBe(0)
    expect(discountPct(planById('12m'))).toBeGreaterThan(0)
    expect(discountPct(planById('12m'))).toBeGreaterThan(discountPct(planById('6m')))
  })
})
