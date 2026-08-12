import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { useMediaUrl } from './useMediaUrl'
import { useMiddlewareHelper } from './useMiddlewareHelper'

// Резолвит превью медиа в URL для <img> — тонкая обёртка над useMediaUrl
// (Task 7: воркерный конвейер downloadMediaURL вместо токен-URL). '' пока не
// загружено. Плитки-превью (архив историй, пин-плашка и т.п.).
//
// '' и у медиа БЕЗ миниатюры (голосовое, аудио, файл без превью): thumb-вариант
// контента у такого медиа не отдаётся картинкой — вызывающий нарисовал бы битый
// <img>. Правило tweb (replyContainer.ts:79-81): превью не строится вовсе, если
// нет ни фото, ни документа с миниатюрами
// (`if(!photo && !(document && document.thumbs?.length)) return {setMedia…}`) —
// наш аналог `document.thumbs?.length` это `MediaMeta.hasThumb`. Пустая строка
// здесь = `setMedia === false` там: по ней вызывающий снимает и <img>, и класс
// `is-media` — как пин-плашка tweb по `isMediaSet` (pinnedMessage.tsx:561, :223).
export function useMediaThumb(mediaId: number | null): string {
  const managers = useManagers()
  const middlewareHelper = useMiddlewareHelper()
  // hasThumb известен только из meta; снимок держит id, к которому относится, —
  // рендер со сменившимся mediaId не переиспользует чужой ответ (и не даёт
  // useMediaUrl скачать thumb, которого у нового медиа может не быть).
  const [meta, setMeta] = useState<{ id: number; hasThumb: boolean } | null>(null)
  const hasThumb = meta != null && meta.id === mediaId ? meta.hasThumb : null
  useEffect(() => {
    if (mediaId == null || hasThumb != null) return
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    void managers.media.meta(mediaId)
      .then((m) => { if (middleware()) setMeta({ id: mediaId, hasThumb: m.hasThumb }) })
      .catch(() => {})
    return () => { scope.destroy() }
  }, [managers, mediaId, hasThumb, middlewareHelper])
  return useMediaUrl(mediaId != null && hasThumb ? mediaId : null, { thumb: true })
}
