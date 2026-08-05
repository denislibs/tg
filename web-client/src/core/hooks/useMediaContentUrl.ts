import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { AppConfig } from '../../config/app'

// Резолвит media_id в контент-URL для <img>/фона (миниатюра последнего медиа в
// списке диалогов и т.п.). '' пока не загружено. Семейство media-хуков вместе с
// useMediaThumb/useStoryPreviewMedia; inline-вариант в компонентах не плодить.
export function useMediaContentUrl(mediaId: number): string {
  const managers = useManagers()
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    let objectUrl = ''
    const setFromToken = () => {
      void managers.media.contentUrl(mediaId).then((u) => { if (alive) setUrl(u) }).catch(() => {})
    }
    if (AppConfig.dnp.enabled) {
      // DNP-ON: тянем байты через канал, отдаём blob-URL. Ошибка (канал не готов) →
      // fallback на token-URL, чтобы изображение не пропадало.
      void managers.media.contentBlob(mediaId)
        .then((blob) => {
          if (!alive) return
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
        })
        .catch(() => { if (alive) setFromToken() })
    } else {
      setFromToken()
    }
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [managers, mediaId])
  return url
}
