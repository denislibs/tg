import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { MessageMedia } from '../media/messageMedia'
import { getMediaFromMessage } from '../media/messageMedia'

/**
 * Резолвит медиа одной истории для просмотра: URL контента + признак видео и
 * длительность. Общий для StoryViewer (каждый пир карусели),
 * StoriesArchiveSheet и PinnedStoriesSection.
 *
 * Аргумент — САМА СТУПЕНЬ вложения (`storyItem.media`), а не номер файла. До
 * порта историй на конструкторы схемы у истории был только `media_id`, и хук
 * ходил за мимом и длительностью ОТДЕЛЬНЫМ запросом (`managers.media.meta`) на
 * каждую историю ленты. Теперь всё это уже приехало вместе с историей — тем же
 * объектом, каким описано вложение сообщения.
 */
export function useStoryPreviewMedia(media: MessageMedia | undefined): { url: string; isVideo: boolean; duration: number } {
  const file = getMediaFromMessage({ media })
  const mediaId = file?.id ?? 0
  // Вид файла — из самого документа: mime плюс атрибут видео, как это делает
  // `saveDocument`. Фотография видео не бывает по построению.
  const isVideo = file?._ === 'document' && file.mime_type.startsWith('video/')
  const videoAttr = file?._ === 'document'
    ? file.attributes.find((a) => a._ === 'documentAttributeVideo')
    : undefined
  const duration = videoAttr?._ === 'documentAttributeVideo' ? videoAttr.duration : 0

  const managers = useManagers()
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!mediaId) { setUrl(''); return }
    let alive = true
    // Картинка — воркерным конвейером (downloadMediaURL, blob-URL из кэша).
    // Видео истории — не картинка: остаётся на токен-URL до перевода видео-путей
    // (вьювер ходит стримом).
    const pending = isVideo ? managers.media.contentUrl(mediaId) : managers.media.downloadMediaURL(mediaId)
    void pending.then((u) => { if (alive) setUrl(u) }).catch(() => {})
    return () => { alive = false }
  }, [managers, mediaId, isVideo])

  return { url, isVideo, duration }
}
