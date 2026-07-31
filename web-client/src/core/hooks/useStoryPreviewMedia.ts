import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'

// Резолвит медиа одной истории для read-only просмотра: контент-URL + признак
// видео (по mime из meta). Общий для StoriesArchiveSheet и PinnedStoriesSection.
export function useStoryPreviewMedia(mediaId: number): { url: string; isVideo: boolean } {
  const managers = useManagers()
  const [url, setUrl] = useState('')
  const [isVideo, setIsVideo] = useState(false)
  useEffect(() => {
    let alive = true
    void Promise.all([managers.media.contentUrl(mediaId), managers.media.meta(mediaId)]).then(([u, m]) => {
      if (!alive) return
      setUrl(u)
      setIsVideo(m.mime.startsWith('video/'))
    })
    return () => { alive = false }
  }, [managers, mediaId])
  return { url, isVideo }
}
