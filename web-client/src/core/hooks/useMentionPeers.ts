// Кандидаты @упоминаний для композера группы: участники чата (без себя),
// резолв имён/юзернеймов через peers-кэш (tweb getMentions → участники).
import { useEffect, useMemo, useState } from 'react'
import { useManagers } from './useManagers'
import { usePeers } from './usePeers'
import { useChatsStore } from '../../stores/chatsStore'
import type { UserReal } from '../peers/peer'

export function useMentionPeers(peerId: PeerId | null, enabled: boolean): UserReal[] {
  const managers = useManagers()
  const meId = useChatsStore((s) => s.meId)
  const [ids, setIds] = useState<number[]>([])
  useEffect(() => {
    setIds([])
    if (!enabled || peerId == null) return
    let alive = true
    void managers.groups
      .members(peerId)
      .then((ms) => { if (alive) setIds(ms.map((m) => m.userId)) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [peerId, enabled, managers])
  const peersMap = usePeers(ids)
  return useMemo(
    // Упомянуть можно только ЧЕЛОВЕКА — сужение по конструктору, а не по
    // приведению типа: в зеркале по ключу лежат и чаты.
    () => ids.filter((id) => id !== meId).map((id) => peersMap.get(id)).filter((p): p is UserReal => p?._ === 'user'),
    [ids, peersMap, meId],
  )
}
