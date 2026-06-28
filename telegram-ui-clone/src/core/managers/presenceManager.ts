import type { RestClient } from '../net/restClient'
import type { PresenceEvt } from '../realtime/events'

interface RestLike {
  get: RestClient['get']
}

// Fetches the initial online / last-seen snapshot for a set of users. Live
// updates then arrive via rt:presence; this just seeds the state on open.
export function newPresenceManager({ rest }: { rest: RestLike }) {
  return {
    async get(ids: number[]): Promise<PresenceEvt[]> {
      if (!ids.length) return []
      const r = await rest.get<{ presence: PresenceEvt[] }>('/presence', { ids: ids.join(',') })
      return r.presence ?? []
    },
  }
}

export type PresenceManager = ReturnType<typeof newPresenceManager>
