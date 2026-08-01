import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { StoryItem } from '../managers/storiesManager'

// Закреплённые в профиле истории (managers.stories.pinnedStories). [] — нет
// закреплённых или ошибка (секция тогда ничего не рендерит).
export function usePinnedStories(peerId: number): StoryItem[] {
  const managers = useManagers()
  const [items, setItems] = useState<StoryItem[]>([])
  useEffect(() => {
    let alive = true
    managers.stories.pinnedStories(peerId)
      .then((list) => { if (alive) setItems(list) })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [managers, peerId])
  return items
}
