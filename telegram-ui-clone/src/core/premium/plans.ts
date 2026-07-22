// Telegram Premium subscription plans (clone). Prices MUST match the backend
// domain.premiumPlans table — the "$N" the user sees is what the server charges
// (mock). Longer plans are cheaper per month.

export type PremiumPlanId = '1m' | '6m' | '12m'

export interface PremiumPlan {
  id: PremiumPlanId
  months: number
  /** total price in USD cents */
  priceCents: number
  /** i18n key for the plan name */
  labelKey: string
}

// Ordered as shown in the checkout (best value first), like tweb.
export const PREMIUM_PLANS: PremiumPlan[] = [
  { id: '12m', months: 12, priceCents: 4499, labelKey: 'Annual' },
  { id: '6m', months: 6, priceCents: 2499, labelKey: '6 Months' },
  { id: '1m', months: 1, priceCents: 499, labelKey: 'Monthly' },
]

export function planById(id: PremiumPlanId): PremiumPlan {
  return PREMIUM_PLANS.find((p) => p.id === id) ?? PREMIUM_PLANS[PREMIUM_PLANS.length - 1]
}

/** "$44.99" */
export function formatUsd(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

/** Per-month price in cents (rounded), for the "$X / month" subtitle. */
export function perMonthCents(p: PremiumPlan): number {
  return Math.round(p.priceCents / p.months)
}

/** Whole-percent discount vs. the monthly plan; 0 for the monthly plan itself. */
export function discountPct(p: PremiumPlan): number {
  const monthly = planById('1m')
  if (p.id === '1m') return 0
  const ratio = perMonthCents(p) / monthly.priceCents
  return Math.round((1 - ratio) * 100)
}
