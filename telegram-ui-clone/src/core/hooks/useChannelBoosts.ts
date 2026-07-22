import { useCallback, useEffect } from 'react'
import { useManagers } from './useManagers'
import { useBoostsStore } from '../../stores/boostsStore'
import type { BoostStatus } from '../models'

// ViewModel-хук бустов канала: читает статус из стора, при монтировании
// подгружает актуальный, отдаёт действие boost(). Live-обновления счётчика
// приходят через realtimeBridge (boost_update) — здесь только read+command.
export function useChannelBoosts(chatId: number): {
  status: BoostStatus | undefined
  boost: () => Promise<BoostStatus>
} {
  const managers = useManagers()
  const status = useBoostsStore((s) => s.byChat[chatId])

  useEffect(() => {
    let alive = true
    void managers.boosts
      .status(chatId)
      .then((st) => { if (alive) useBoostsStore.getState().setStatus(chatId, st) })
      .catch(() => { /* бусты недоступны — фича мягко отключается */ })
    return () => { alive = false }
  }, [chatId, managers])

  const boost = useCallback(async () => {
    const st = await managers.boosts.boost(chatId)
    useBoostsStore.getState().setStatus(chatId, st)
    return st
  }, [chatId, managers])

  return { status, boost }
}
