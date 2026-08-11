import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'

// Резолвит превью медиа (thumbUrl) в токен-URL для <img>. Медиа-байты отдаёт
// аутентифицированный эндпоинт — путь резолвится через media-manager. '' пока
// не загружено. Плитки-превью (архив историй и т.п.).
//
// '' и у медиа БЕЗ миниатюры (голосовое, аудио, файл без превью): `thumbUrl`
// строит `?v=thumb` безусловно, а такой URL картинкой не отдаётся — вызывающий
// нарисовал бы битый <img>. Правило tweb (replyContainer.ts:79-81): превью не
// строится вовсе, если нет ни фото, ни документа с миниатюрами
// (`if(!photo && !(document && document.thumbs?.length)) return {setMedia…}`) —
// наш аналог `document.thumbs?.length` это `MediaMeta.hasThumb`. Пустая строка
// здесь = `setMedia === false` там: по ней вызывающий снимает и <img>, и класс
// `is-media` — как пин-плашка tweb по `isMediaSet` (pinnedMessage.tsx:561, :223).
export function useMediaThumb(mediaId: number | null): string {
  const managers = useManagers()
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (mediaId == null) { setUrl(''); return }
    let alive = true
    void managers.media.meta(mediaId)
      .then((m) => (m.hasThumb ? managers.media.thumbUrl(mediaId) : ''))
      .then((u) => { if (alive) setUrl(u) })
      .catch(() => {})
    return () => { alive = false }
  }, [managers, mediaId])
  return url
}
