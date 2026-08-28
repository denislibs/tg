import { describe, it, expect, vi } from 'vitest'
import { newPremiumManager } from './premiumManager'
import type { RestClient } from '../net/restClient'

// Проводная форма профиля: конструктор `users.userFull` В КОРНЕ, `can_message`
// ВНУТРИ него (наш клиентский параметр конструктора, не обёртка снаружи).
// Премиум — `pFlags.premium` внутри краткого `user`, а не поле витрины.
const RAW_USER = {
  _: 'users.userFull' as const,
  full_user: { _: 'userFull' as const, id: 1 },
  chats: [],
  users: [{ _: 'user' as const, pFlags: { self: true as const, premium: true as const }, id: 1, phone: '+79990000001', username: 'denis_m' }],
  can_message: true,
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
    expect(user.user.pFlags?.premium).toBe(true)
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
    await expect(mgr.checkout('1m', CARD)).resolves.toMatchObject({ user: { user: { pFlags: { premium: true } } } })
  })
})
