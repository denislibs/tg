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
    // Форс-обновление карточек (realtime user_update с avatar_changed): игнорирует
    // кэш и перечитывает /users — сервер применяет PrivacyProfilePhoto к avatar_url.
    // Обновляет кэш воркера; пустой массив при сетевой ошибке (UI оставит старое).
    async refresh(ids: number[]): Promise<Peer[]> {
      if (!ids.length) return []
      try {
        const r = await rest.get<{ users: { id: number; username: string; display_name: string; avatar_url: string }[] }>('/users', { ids: ids.join(',') })
        const fetched: Peer[] = (r.users ?? []).map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url }))
        for (const u of fetched) cache.set(u.id, u)
        void saveUsers(fetched)
        return fetched
      } catch {
        return []
      }
    },
    // Инвалидация кэша по realtime user_update — иначе прямые getUsers (мимо
    // peersStore) продолжали бы отдавать устаревшую карточку из кэша. name-only:
    // патчим имя/username на месте; avatar_changed: выселяем (url приватен
    // per-viewer — следующий getUsers перечитает /users, сервер применит приватность).
    applyUserUpdate(evt: { id: number; username: string; display_name: string; avatar_changed: boolean }): void {
      if (evt.avatar_changed) { cache.delete(evt.id); return }
      const cur = cache.get(evt.id)
      if (!cur || (cur.username === evt.username && cur.displayName === evt.display_name)) return
      const updated: Peer = { ...cur, username: evt.username, displayName: evt.display_name }
      cache.set(evt.id, updated)
      void saveUsers([updated])
    },
  }
}
export type PeersManager = ReturnType<typeof newPeersManager>
