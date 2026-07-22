import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { PostStats } from '../managers/statsManager'

// Загружает статистику поста канала (read/command-путь через managers, не подписка).
// Возвращает данные + флаги загрузки/ошибки для экрана «Статистика поста».
export function usePostStats(chatId: number, msgId: number): {
  stats: PostStats | null
  loading: boolean
  error: boolean
} {
  const managers = useManagers()
  const [stats, setStats] = useState<PostStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    void managers.stats
      .getPostStats(chatId, msgId)
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
  }, [chatId, msgId, managers])

  return { stats, loading, error }
}
