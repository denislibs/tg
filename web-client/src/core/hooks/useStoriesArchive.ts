import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { StoryItem } from '../managers/storiesManager'

// Архив своих истёкших историй (GET /stories/archive) для StoriesArchiveSheet.
// null = ещё грузится, [] = пусто/ошибка.
export function useStoriesArchive(): StoryItem[] | null {
  const managers = useManagers()
  const [items, setItems] = useState<StoryItem[] | null>(null)
  useEffect(() => {
    let alive = true
    managers.stories.archive(60)
      .then((list) => { if (alive) setItems(list) })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [managers])
  return items
}
