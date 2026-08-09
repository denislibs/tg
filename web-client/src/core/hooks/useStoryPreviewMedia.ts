import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'

// Резолвит медиа одной истории для read-only просмотра: контент-URL + признак
// видео и длительность (по meta). Общий для StoryViewer (каждый пир карусели),
// StoriesArchiveSheet и PinnedStoriesSection.
export function useStoryPreviewMedia(mediaId: number): { url: string; isVideo: boolean; duration: number } {
  const managers = useManagers()
  const [state, setState] = useState({ url: '', isVideo: false, duration: 0 })
  useEffect(() => {
    let alive = true
    void Promise.all([managers.media.contentUrl(mediaId), managers.media.meta(mediaId)]).then(([u, m]) => {
      if (!alive) return
      setState({ url: u, isVideo: m.mime.startsWith('video/'), duration: m.duration })
    })
    return () => { alive = false }
  }, [managers, mediaId])
  return state
}
