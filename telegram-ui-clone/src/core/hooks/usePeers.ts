import { useEffect, useState } from 'react'
import { startClient } from '../../client/bootstrap'
import type { Peer } from '../managers/peersManager'

// Stable cache key for a set of ids: sorted, deduped, comma-joined.
// Used as the effect dependency so reorderings/duplicates don't refetch.
export function peersKey(ids: number[]): string {
  return Array.from(new Set(ids))
    .sort((a, b) => a - b)
    .join(',')
}

// Resolve a set of user ids to a name map, fetching missing ones via the worker.
export function usePeers(ids: number[]): Map<number, Peer> {
  const [map, setMap] = useState<Map<number, Peer>>(new Map())
  const key = peersKey(ids)
  useEffect(() => {
    if (ids.length === 0) return
    let alive = true
    const { managers } = startClient()
    managers.peers.getUsers(ids).then((peers) => {
      if (!alive) return
      setMap((prev) => {
        const next = new Map(prev)
        for (const p of peers) next.set(p.id, p)
        return next
      })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return map
}
