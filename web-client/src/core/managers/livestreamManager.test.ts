import { describe, it, expect } from 'vitest'
import { newLivestreamManager } from './livestreamManager'
import type { RestClient } from '../net/restClient'

function fakeRest(handlers: {
  get?: (path: string) => unknown
  post?: (path: string) => unknown
}) {
  return {
    get: async (path: string) => handlers.get?.(path) ?? {},
    post: async (path: string) => handlers.post?.(path) ?? {},
  } as unknown as RestClient
}

describe('LivestreamManager', () => {
  it('maps snake_case status to camelCase (admin creds included)', async () => {
    const mgr = newLivestreamManager({
      rest: fakeRest({
        get: () => ({
          active: true, viewers: 3, is_admin: true,
          started_at: '2026-07-19T10:00:00Z',
          rtmp_url: 'rtmp://test/live', stream_key: 'secret123',
        }),
      }),
    })
    const st = await mgr.status(7)
    expect(st).toEqual({
      active: true, viewers: 3, isAdmin: true,
      startedAt: '2026-07-19T10:00:00Z',
      rtmpUrl: 'rtmp://test/live', streamKey: 'secret123',
    })
  })

  it('viewer status has no creds', async () => {
    const mgr = newLivestreamManager({
      rest: fakeRest({ get: () => ({ active: true, viewers: 5, is_admin: false }) }),
    })
    const st = await mgr.status(7)
    expect(st.isAdmin).toBe(false)
    expect(st.rtmpUrl).toBeUndefined()
    expect(st.streamKey).toBeUndefined()
    expect(st.viewers).toBe(5)
  })

  it('start posts to the start route and returns creds', async () => {
    let posted = ''
    const mgr = newLivestreamManager({
      rest: fakeRest({
        post: (path) => { posted = path; return { active: true, viewers: 0, is_admin: true, rtmp_url: 'u', stream_key: 'k' } },
      }),
    })
    const st = await mgr.start(7)
    expect(posted).toBe('/chats/7/livestream/start')
    expect(st.streamKey).toBe('k')
  })

  it('revokeKey posts to the revoke route', async () => {
    let posted = ''
    const mgr = newLivestreamManager({
      rest: fakeRest({
        post: (path) => { posted = path; return { active: false, viewers: 0, is_admin: true, rtmp_url: 'u', stream_key: 'k2' } },
      }),
    })
    const st = await mgr.revokeKey(7)
    expect(posted).toBe('/chats/7/livestream/revoke_key')
    expect(st.streamKey).toBe('k2')
  })
})
