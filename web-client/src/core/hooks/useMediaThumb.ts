import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'

// Резолвит превью медиа (thumbUrl) в токен-URL для <img>. Медиа-байты отдаёт
// аутентифицированный эндпоинт — путь резолвится через media-manager. '' пока
// не загружено. Плитки-превью (архив историй и т.п.).
export function useMediaThumb(mediaId: number): string {
  const managers = useManagers()
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    void managers.media.thumbUrl(mediaId)
      .then((u) => { if (alive) setUrl(u) })
      .catch(() => {})
    return () => { alive = false }
  }, [managers, mediaId])
  return url
}
