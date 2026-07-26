// src/core/managers/peersManager.ts
import type { RestClient } from '../net/restClient'

export interface Peer { id: number; username: string; displayName: string; avatarUrl: string }

export function newPeersManager({ rest }: { rest: Pick<RestClient, 'get'> }) {
  const cache = new Map<number, Peer>()
  return {
    async getUsers(ids: number[]): Promise<Peer[]> {
      const missing = ids.filter((id) => !cache.has(id))
      if (missing.length) {
        const r = await rest.get<{ users: { id: number; username: string; display_name: string; avatar_url: string }[] }>('/users', { ids: missing.join(',') })
        for (const u of r.users ?? []) cache.set(u.id, { id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url })
      }
      return ids.map((id) => cache.get(id)).filter((p): p is Peer => !!p)
    },
  }
}
export type PeersManager = ReturnType<typeof newPeersManager>
