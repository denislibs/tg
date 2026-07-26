import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { ChannelStats } from '../managers/statsManager'

// Загружает статистику канала (read/command-путь через managers, не подписка).
// Возвращает данные + флаги загрузки/ошибки для панели «Статистика».
export function useChannelStats(chatId: number): {
  stats: ChannelStats | null
  loading: boolean
  error: boolean
} {
  const managers = useManagers()
  const [stats, setStats] = useState<ChannelStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    void managers.stats
      .getChannelStats(chatId)
      .then((s) => {
        if (alive) setStats(s)
      })
      .catch(() => {
        if (alive) setError(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [chatId, managers])

  return { stats, loading, error }
}
