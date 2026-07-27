// src/core/managers/peersManager.ts
import { HttpError, type RestClient } from '../net/restClient'
import { saveUsers, loadUsers } from '../store/persist'

export interface Peer { id: number; username: string; displayName: string; avatarUrl: string }

export function newPeersManager({ rest }: { rest: Pick<RestClient, 'get'> }) {
  const cache = new Map<number, Peer>()
  return {
    async getUsers(ids: number[]): Promise<Peer[]> {
      const missing = ids.filter((id) => !cache.has(id))
      if (missing.length) {
        try {
          const r = await rest.get<{ users: { id: number; username: string; display_name: string; avatar_url: string }[] }>('/users', { ids: missing.join(',') })
          const fetched: Peer[] = (r.users ?? []).map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url }))
          for (const u of fetched) cache.set(u.id, u)
          void saveUsers(fetched) // write-through в офлайн-стор (нормализовано по id)
        } catch (e) {
          // Сеть недоступна — поднимаем персистнутых юзеров в память, чтобы имена/
          // аватары резолвились офлайн. Не глотаем HTTP-ошибки (401/500 и т.п.).
          if (e instanceof HttpError) throw e
          for (const u of await loadUsers()) if (!cache.has(u.id)) cache.set(u.id, u)
        }
      }
      return ids.map((id) => cache.get(id)).filter((p): p is Peer => !!p)
    },
  }
}
export type PeersManager = ReturnType<typeof newPeersManager>
