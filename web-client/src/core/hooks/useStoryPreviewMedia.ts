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
    void managers.media.meta(mediaId).then(async (m) => {
      const isVideo = m.mime.startsWith('video/')
      // Картинка — воркерным конвейером (Task 7: downloadMediaURL, blob-URL из
      // кэша). Видео истории — не картинка: остаётся на токен-URL до перевода
      // видео-путей (вьювер/стадия E ходит стримом).
      const u = isVideo ? await managers.media.contentUrl(mediaId) : await managers.media.downloadMediaURL(mediaId)
      if (!alive) return
      setState({ url: u, isVideo, duration: m.duration })
    }).catch(() => {})
    return () => { alive = false }
  }, [managers, mediaId])
  return state
}
