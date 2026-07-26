// src/core/managers/peersManager.test.ts
import { describe, it, expect } from 'vitest'
import { newPeersManager } from './peersManager'
import type { RestClient } from '../net/restClient'

function fakeRest(users: { id: number; username: string; display_name: string; avatar_url: string }[]) {
  const calls: { path: string; query?: Record<string, string | number> }[] = []
  const rest = {
    async get<R>(path: string, query?: Record<string, string | number>): Promise<R> {
      calls.push({ path, query })
      // Echo back only the requested ids, like the real /users endpoint.
      const requested = new Set(String(query?.ids ?? '').split(',').filter(Boolean).map(Number))
      return { users: users.filter((u) => requested.has(u.id)) } as unknown as R
    },
  } as unknown as RestClient
  return { rest, calls }
}

describe('PeersManager', () => {
  it('maps GET /users payload snake->camel', async () => {
    const { rest, calls } = fakeRest([
      { id: 2, username: 'bob', display_name: 'Bob', avatar_url: 'a.png' },
    ])
    const mgr = newPeersManager({ rest })
    const peers = await mgr.getUsers([2])
    expect(calls[0].path).toBe('/users')
    expect(calls[0].query).toEqual({ ids: '2' })
    expect(peers).toEqual([{ id: 2, username: 'bob', displayName: 'Bob', avatarUrl: 'a.png' }])
  })

  it('caches: two calls for the same id => one GET /users', async () => {
    const { rest, calls } = fakeRest([
      { id: 5, username: 'cy', display_name: 'Cy', avatar_url: '' },
    ])
    const mgr = newPeersManager({ rest })
    const a = await mgr.getUsers([5])
    const b = await mgr.getUsers([5])
    expect(calls).toHaveLength(1)
    expect(a).toEqual(b)
    expect(b[0].displayName).toBe('Cy')
  })

  it('only fetches missing ids on subsequent calls', async () => {
    const { rest, calls } = fakeRest([
      { id: 1, username: 'a', display_name: 'A', avatar_url: '' },
      { id: 2, username: 'b', display_name: 'B', avatar_url: '' },
    ])
    const mgr = newPeersManager({ rest })
    await mgr.getUsers([1])
    await mgr.getUsers([1, 2])
    expect(calls).toHaveLength(2)
    expect(calls[0].query).toEqual({ ids: '1' })
    expect(calls[1].query).toEqual({ ids: '2' })
  })
})
