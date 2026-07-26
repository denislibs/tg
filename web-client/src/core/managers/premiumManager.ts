import type { RestClient } from '../net/restClient'
import { mapUser, type RawUser, type User } from './authManager'
import type { CardInput } from '../premium/card'
import type { PremiumPlanId } from '../premium/plans'

// A Telegram Premium subscription (clone). Dates are ISO-8601 strings.
export interface PremiumSubscription {
  plan: PremiumPlanId
  priceCents: number
  startedAt: string
  expiresAt: string
  autoRenew: boolean
}

interface RawSubscription {
  plan: PremiumPlanId
  price_cents: number
  started_at: string
  expires_at: string
  auto_renew: boolean
}

function mapSubscription(r: RawSubscription): PremiumSubscription {
  return {
    plan: r.plan,
    priceCents: r.price_cents,
    startedAt: r.started_at,
    expiresAt: r.expires_at,
    autoRenew: r.auto_renew,
  }
}

export interface PremiumDeps {
  rest: RestClient
}

export function newPremiumManager({ rest }: PremiumDeps) {
  return {
    // checkout runs the mock card payment for a plan. The server ignores the card
    // data (any well-formed card is a success) and returns the fresh user +
    // subscription. Card details are validated on the client before calling.
    async checkout(plan: PremiumPlanId, card: CardInput): Promise<{ user: User; subscription: PremiumSubscription }> {
      const res = await rest.post<{ user: RawUser; subscription: RawSubscription }>('/me/premium/checkout', {
        plan,
        card: { number: card.number, expiry: card.expiry, cvc: card.cvc },
      })
      return { user: mapUser(res.user), subscription: mapSubscription(res.subscription) }
    },

    // getSubscription returns the current subscription, or null when the user has
    // never subscribed.
    async getSubscription(): Promise<PremiumSubscription | null> {
      const res = await rest.get<{ subscription: RawSubscription | null }>('/me/premium/subscription')
      return res.subscription ? mapSubscription(res.subscription) : null
    },

    // cancelSubscription disables auto-renew; the subscription stays active until
    // it expires.
    async cancelSubscription(): Promise<PremiumSubscription> {
      const res = await rest.post<{ subscription: RawSubscription }>('/me/premium/cancel', {})
      return mapSubscription(res.subscription)
    },
  }
}

export type PremiumManager = ReturnType<typeof newPremiumManager>
