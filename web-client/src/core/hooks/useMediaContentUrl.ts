import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'

// Резолвит media_id в контент-URL для <img>/фона (миниатюра последнего медиа в
// списке диалогов и т.п.). '' пока не загружено. Семейство media-хуков вместе с
// useMediaThumb/useStoryPreviewMedia; inline-вариант в компонентах не плодить.
export function useMediaContentUrl(mediaId: number): string {
  const managers = useManagers()
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    void managers.media.contentUrl(mediaId)
      .then((u) => { if (alive) setUrl(u) })
      .catch(() => {})
    return () => { alive = false }
  }, [managers, mediaId])
  return url
}
