import { describe, it, expect, vi } from 'vitest'
import { newAuthManager, type AuthDeps } from './authManager'
import { HttpError } from '../net/restClient'

function deps(overrides: Partial<{ token: string | null; qrConfirmed: boolean }> = {}) {
  let token: string | null = overrides.token ?? null
  const qrConfirmed = overrides.qrConfirmed ?? false
  const calls: Array<[string, unknown]> = []
  const store = {
    get: () => token,
    set: async (t: string) => { token = t },
    clear: async () => { token = null },
    ready: async () => {},
  }
  const rest = {
    post: async (path: string, body: unknown) => {
      calls.push([path, body])
      if (path === '/auth/request_code') return { ok: true }
      if (path === '/auth/sign_in') return { token: 'TOK', user: { id: 1, phone: '+700', display_name: '+700' } }
      if (path === '/auth/logout') return { ok: true }
      if (path === '/auth/qr/new') return { token: 'tok123', url: 'http://h/qr/tok123', expires_at: '2026-06-24T00:01:00Z' }
      if (path === '/auth/qr/confirm') return { ok: true }
      throw new Error('unexpected ' + path)
    },
    get: async (path: string) => {
      if (path === '/me') {
        if (!token) throw Object.assign(new Error('missing token'), { status: 401 })
        return { id: 1, phone: '+700', display_name: '+700' }
      }
      if (path === '/auth/qr/tok123') {
        return qrConfirmed
          ? { status: 'confirmed', session_token: 'sess999', user: { id: 7, phone: '+7', display_name: '+7' } }
          : { status: 'pending' }
      }
      throw new Error('unexpected ' + path)
    },
  }
  return { d: { rest, store } as unknown as AuthDeps, calls, token: () => token }
}

describe('AuthManager', () => {
  it('signIn stores the token and me() then returns the user', async () => {
    const { d, token } = deps()
    const auth = newAuthManager(d)
    await auth.requestCode('+7 700')
    const r = await auth.signIn('+7 700', '12345', 'web', 'browser')
    expect(r.user?.id).toBe(1)
    expect(token()).toBe('TOK')
    await expect(auth.me()).resolves.toMatchObject({ id: 1 })
  })

  it('me() returns null when unauthenticated (401)', async () => {
    const { d } = deps()
    const auth = newAuthManager(d)
    await expect(auth.me()).resolves.toBeNull()
  })

  it('logout clears the token; me() then null', async () => {
    const { d, token } = deps({ token: 'TOK' })
    const auth = newAuthManager(d)
    await auth.logout()
    expect(token()).toBeNull()
    await expect(auth.me()).resolves.toBeNull()
  })

  // Stage 1C.2 (Task 1): `me` — воркер единственный владелец; logout() обязан
  // публиковать null всем вкладкам (rt:me), а не оставлять только вкладку-
  // инициатора чистить свой стор локально (useAuthGate.ts) — иначе сиблинг-
  // вкладки/окна той же сессии остались бы с профилем разлогиненного юзера.
  it('logout зовёт onMeChanged(null), даже без активной сессии', async () => {
    const onMeChanged = vi.fn()
    const { d } = deps() // без токена — store.get() пуст, /auth/logout не идёт
    const auth = newAuthManager({ ...d, onMeChanged })
    await auth.logout()
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).toHaveBeenCalledWith(null)
  })

  it('onMeChanged опционален — logout() без него не падает', async () => {
    const { d } = deps({ token: 'TOK' })
    const auth = newAuthManager(d)
    await expect(auth.logout()).resolves.toEqual({ switched: false })
  })

  it('qrNew returns the token + url + expiresAt', async () => {
    const { d } = deps()
    const auth = newAuthManager(d)
    const r = await auth.qrNew('web')
    expect(r.token).toBe('tok123')
    expect(r.url).toBe('http://h/qr/tok123')
    expect(r.expiresAt).toBe('2026-06-24T00:01:00Z')
  })

  it('qrStatus stores the session token when confirmed', async () => {
    const { d, token } = deps({ qrConfirmed: true })
    const auth = newAuthManager(d)
    const r = await auth.qrStatus('tok123')
    expect(r.status).toBe('confirmed')
    expect(r.user?.id).toBe(7)
    expect(token()).toBe('sess999')
  })

  it('qrStatus pending does not store a token', async () => {
    const { d, token } = deps({ qrConfirmed: false })
    const auth = newAuthManager(d)
    const r = await auth.qrStatus('tok123')
    expect(r.status).toBe('pending')
    expect(token()).toBeNull()
  })

  it('qrConfirm posts the token', async () => {
    const { d, calls } = deps()
    const auth = newAuthManager(d)
    await auth.qrConfirm('tok123')
    expect(calls).toContainEqual(['/auth/qr/confirm', { token: 'tok123' }])
  })

  // GET /auth/nearest_country: пустой ответ и любая ошибка — штатный исход,
  // наружу уходит '' и экран входа остаётся на своём фолбэке.
  it('nearestCountry: код страны, пустая строка и ошибка — всё без исключения', async () => {
    const make = (get: (path: string) => Promise<unknown>) =>
      newAuthManager({
        rest: { get } as unknown as AuthDeps['rest'],
        store: { get: () => null, set: async () => {}, clear: async () => {}, ready: async () => {} },
      })
    await expect(make(async () => ({ country_code: 'DE' })).nearestCountry()).resolves.toBe('DE')
    await expect(make(async () => ({ country_code: '' })).nearestCountry()).resolves.toBe('')
    await expect(make(async () => ({})).nearestCountry()).resolves.toBe('')
    await expect(
      make(() => Promise.reject(new Error('offline'))).nearestCountry(),
    ).resolves.toBe('')
  })

  // POST /auth/account/reset: 401/409 — дискриминированный результат, не throw
  // (HttpError не переживает границу worker-RPC).
  it('resetAccount маппит статусы сервера в результат', async () => {
    const make = (post: (path: string, body: unknown) => Promise<unknown>) =>
      newAuthManager({
        rest: { post } as unknown as AuthDeps['rest'],
        store: { get: () => null, set: async () => {}, clear: async () => {}, ready: async () => {} },
      })
    const fail = (status: number, message: string) => () =>
      Promise.reject(new HttpError(status, message))

    const calls: Array<[string, unknown]> = []
    const ok = make(async (path, body) => {
      calls.push([path, body])
      return { ok: true }
    })
    await expect(ok.resetAccount('PWTOK')).resolves.toEqual({ ok: true })
    expect(calls).toEqual([['/auth/account/reset', { password_token: 'PWTOK' }]])

    await expect(make(fail(401, 'password_token_expired')).resetAccount('x'))
      .resolves.toEqual({ error: 'password_token_expired' })
    await expect(make(fail(409, 'recovery_available')).resetAccount('x'))
      .resolves.toEqual({ error: 'recovery_available' })
    await expect(make(fail(500, 'boom')).resetAccount('x'))
      .resolves.toEqual({ error: 'failed' })
  })
})
