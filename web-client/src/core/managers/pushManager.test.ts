import { describe, it, expect, vi } from 'vitest'
import { newPushManager } from './pushManager'
import type { RestClient } from '../net/restClient'

describe('PushManager', () => {
  it('vapidKey returns the public key', async () => {
    const rest = { get: vi.fn(async () => ({ public_key: 'KEY123' })) } as unknown as RestClient
    const mgr = newPushManager({ rest })
    expect(await mgr.vapidKey()).toBe('KEY123')
  })

  it('subscribe posts endpoint/p256dh/auth', async () => {
    const post = vi.fn(async () => ({ ok: true }))
    const rest = { post } as unknown as RestClient
    const mgr = newPushManager({ rest })
    const r = await mgr.subscribe({ endpoint: 'https://fcm/x', p256dh: 'p', auth: 'a' })
    expect(r.ok).toBe(true)
    expect(post).toHaveBeenCalledWith('/push/subscribe', { endpoint: 'https://fcm/x', p256dh: 'p', auth: 'a' })
  })
})
