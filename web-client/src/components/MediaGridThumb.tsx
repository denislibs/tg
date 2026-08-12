import { useMediaUrl } from '../core/hooks/useMediaUrl'

// Плитка медиа-грида (глобальный поиск, shared media): превью из воркерного
// конвейера (Task 7: useMediaUrl → downloadMediaURL), синхронно из зеркала при
// повторном рендере. Канал выбирает has_thumb из read model сообщения (бэкенд
// шлёт media_has_thumb): превью ещё не сгенерировано → сразу полный контент —
// прежний onError-фолбэк с 404-заходом за token-URL больше не нужен.
export default function MediaGridThumb({ className, mediaId, hasThumb }: {
  className: string
  mediaId: number
  hasThumb: boolean
}) {
  const url = useMediaUrl(mediaId, { thumb: hasThumb })
  if (!url) return null
  return <img className={className} src={url} alt="" loading="lazy" decoding="async" />
}
