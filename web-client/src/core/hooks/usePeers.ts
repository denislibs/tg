import { useEffect, useMemo } from 'react'
import { useManagers } from './useManagers'
import type { Peer } from '../managers/peersManager'
import { usePeersStore } from '../../stores/peersStore'

// Stable cache key for a set of ids: sorted, deduped, comma-joined.
// Used as the effect dependency so reorderings/duplicates don't refetch.
export function peersKey(ids: number[]): string {
  return Array.from(new Set(ids))
    .sort((a, b) => a - b)
    .join(',')
}

// Resolve a set of user ids to a name map. Reads the shared peersStore (SSOT),
// fetching only the ids not yet cached. Realtime user_update patches the store,
// so every usePeers consumer of a changed peer re-renders automatically.
//
// Stage 1C.2 (Task 2): запрос карточек остаётся здесь (это read-путь), а вот
// ПРИМЕНЕНИЕ ответа — нет: карточки кладёт в стор проектор по rt:peer_op, который
// публикует владелец (peersManager). Прежний `.then(upsert)` был вторым писателем
// стора и вторым походом в /users в паре с до-фетчем из storeProjection.
export function usePeers(ids: number[]): Map<number, Peer> {
  const managers = useManagers()
  const key = peersKey(ids)
  const byId = usePeersStore((s) => s.byId)

  useEffect(() => {
    if (ids.length === 0) return
    const missing = ids.filter((id) => !usePeersStore.getState().byId[id])
    if (missing.length) void managers.peers.getUsers(missing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Subset map for the requested ids (recomputed when the store or ids change).
  return useMemo(() => {
    const m = new Map<number, Peer>()
    for (const id of ids) {
      const p = byId[id]
      if (p) m.set(id, p)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, byId])
}
