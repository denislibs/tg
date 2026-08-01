import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { StoryStats } from '../managers/storiesManager'

// Статистика истории (managers.stories.stats) для экрана «Статистика истории».
// Данные + флаги загрузки/ошибки (аналог usePostStats).
export function useStoryStats(storyId: number): {
  stats: StoryStats | null
  loading: boolean
  error: boolean
} {
  const managers = useManagers()
  const [stats, setStats] = useState<StoryStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    void managers.stories
      .stats(storyId)
      .then((v) => { if (alive) setStats(v) })
      .catch(() => { if (alive) setError(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [storyId, managers])

  return { stats, loading, error }
}
