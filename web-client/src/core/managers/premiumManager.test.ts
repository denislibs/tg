import { describe, it, expect, vi } from 'vitest'
import { newPremiumManager } from './premiumManager'
import type { RestClient } from '../net/restClient'

const RAW_USER = {
  id: 1,
  phone: '+79990000001',
  username: 'denis_m',
  display_name: 'Denis M',
  premium: true,
}

const RAW_SUB = {
  plan: '1m',
  price_cents: 499,
  started_at: '2026-08-09T00:00:00Z',
  expires_at: '2026-09-09T00:00:00Z',
  auto_renew: true,
}

const CARD = { number: '4242424242424242', expiry: '12/30', cvc: '123' }

describe('PremiumManager.checkout', () => {
  it('POSTs /me/premium/checkout and maps user + subscription', async () => {
    const post = vi.fn(async () => ({ user: RAW_USER, subscription: RAW_SUB }))
    const mgr = newPremiumManager({ rest: { post } as unknown as RestClient })

    const { user, subscription } = await mgr.checkout('1m', CARD)
    expect(post).toHaveBeenCalledWith('/me/premium/checkout', { plan: '1m', card: CARD })
    expect(user.premium).toBe(true)
    expect(subscription.priceCents).toBe(499)
  })

  // Stage 1C.2 (Task 1): `me` — воркер единственный владелец; успешная покупка
  // премиума меняет пользователя (флаг premium) и обязана опубликовать это
  // всем вкладкам (rt:me) тем же вызовом, что возвращает результат звонящей
  // вкладке — иначе остальные окна той же сессии не увидели бы значок ⭐.
  it('зовёт onMeChanged со свежим пользователем', async () => {
    const post = vi.fn(async () => ({ user: RAW_USER, subscription: RAW_SUB }))
    const onMeChanged = vi.fn()
    const mgr = newPremiumManager({ rest: { post } as unknown as RestClient, onMeChanged })

    const { user } = await mgr.checkout('1m', CARD)
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).toHaveBeenCalledWith(user)
  })

  it('onMeChanged опционален — без него checkout() не падает', async () => {
    const post = vi.fn(async () => ({ user: RAW_USER, subscription: RAW_SUB }))
    const mgr = newPremiumManager({ rest: { post } as unknown as RestClient })
    await expect(mgr.checkout('1m', CARD)).resolves.toMatchObject({ user: { premium: true } })
  })
})
