// Кандидаты @упоминаний для композера группы: участники чата (без себя),
// резолв имён/юзернеймов через peers-кэш (tweb getMentions → участники).
import { useEffect, useMemo, useState } from 'react'
import { useManagers } from './useManagers'
import { usePeers } from './usePeers'
import { useChatsStore } from '../../stores/chatsStore'
import type { Peer } from '../managers/peersManager'

export function useMentionPeers(chatId: number | null, enabled: boolean): Peer[] {
  const managers = useManagers()
  const meId = useChatsStore((s) => s.meId)
  const [ids, setIds] = useState<number[]>([])
  useEffect(() => {
    setIds([])
    if (!enabled || chatId == null) return
    let alive = true
    void managers.groups
      .members(chatId)
      .then((ms) => { if (alive) setIds(ms.map((m) => m.userId)) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [chatId, enabled, managers])
  const peersMap = usePeers(ids)
  return useMemo(
    () => ids.filter((id) => id !== meId).map((id) => peersMap.get(id)).filter((p): p is Peer => !!p),
    [ids, peersMap, meId],
  )
}
