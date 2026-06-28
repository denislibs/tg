import { describe, it, expect } from 'vitest'
import { newAuthManager, type AuthDeps } from './authManager'

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
    expect(r.user.id).toBe(1)
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
})
