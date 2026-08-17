// Байты файла стикера + определение его типа — ванильный (без React) владелец
// того, что в tweb делают ДВЕ разные подсистемы:
//   * `appDownloadManager.downloadMedia({media: doc})` — сами байты;
//   * `doc.sticker`/`doc.mime_type` из MTProto — КАКОЙ это стикер
//     (`StickerType.Lottie` / `WebM` / `Static`, `wrapSticker.ts:117-120`).
//
// Второго у нас нет: в списках стикеров и в медиа сообщения приезжает только
// `media_id`, mime документа витрине не гарантирован (у `Sticker` он есть, у
// медиа сообщения — нет). Поэтому тип определяется по `Content-Type` ответа
// media-эндпоинта — это адаптация под наш транспорт, а не упрощение: другого
// источника формата в нашей модели данных не существует.
//
// Медиа-bytes НЕ-картинок идут прямым `fetch` к аутентифицированному
// media-эндпоинту (токен-URL строит `core/mediaUrl`) — санкционированное
// исключение, см. web-client/CLAUDE.md «МОЖНО». Через воркерный конвейер
// картинок (`downloadMediaURL`) сюда нельзя: он отдаёт objectURL и теряет
// `Content-Type`, по которому мы только и различаем lottie/webm/webp.
//
// ВРЕМЕННОЕ ДУБЛИРОВАНИЕ: тот же код (и свой, второй, кэш) живёт в
// `components/StickerMedia.tsx::loadStickerContent` — React-лента ещё жива и
// правка того файла вне периметра этой задачи. Кэши независимы, поэтому один
// и тот же стикер, показанный обеими лентами разом, скачается дважды. Уходит
// вместе с `StickerMedia.tsx`, когда лента переедет на ваниль.
import { mediaContentUrl, primeMediaToken } from '@core/mediaUrl'
import { isLottieMime, readLottie } from '@core/stickers/tgs'
import type { LazyLoadQueue } from '@core/lazyLoadQueue'

export type StickerContent =
  | { kind: 'lottie'; data: unknown }
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }

const cache = new Map<number, Promise<StickerContent>>()

/**
 * Файл стикера уже скачан (или скачивается) — аналог `cacheContext.downloaded`
 * в tweb (`wrapSticker.ts:222`). По нему `wrapSticker` решает, идти ли через
 * `lazyLoadQueue`: уже скачанное грузится в обход очереди (tweb:735).
 */
export function hasStickerContent(mediaId: number): boolean {
  return cache.has(mediaId)
}

/**
 * @param loadQueue общая на экран очередь (tweb `wrapSticker`'s `lazyLoadQueue`)
 *   — опциональна и здесь оставлена ради вызывающих, которым нужен ИМЕННО
 *   гейт на сам fetch (пикер, медиаредактор). `wrapSticker` ставит в очередь
 *   весь `load()` целиком, как tweb, и сюда очередь не передаёт.
 * @param isVisible живой геттер видимости цели — приоритезация внутри очереди
 *   (порт tweb `LazyLoadQueue.onVisibilityChange`, см. `core/lazyLoadQueue.ts`).
 *
 * ВАЖНО: `loadQueue.clear()` РЕДЖЕКТИТ снятую до старта задачу — поэтому
 * упавший промис вычищается из кэша, иначе следующий запрос того же `mediaId`
 * унаследовал бы навсегда отклонённый промис.
 */
export function loadStickerContent(
  mediaId: number,
  loadQueue?: LazyLoadQueue,
  isVisible?: () => boolean,
): Promise<StickerContent> {
  let p = cache.get(mediaId)
  if (!p) {
    const fetchContent = async (): Promise<StickerContent> => {
      await primeMediaToken()
      const res = await fetch(mediaContentUrl(mediaId))
      if (!res.ok) throw new Error(`sticker media ${mediaId}: HTTP ${res.status}`)
      const ct = res.headers.get('content-type') ?? ''
      // tweb StickerType.Lottie — у нас это несжатый json либо gzip'нутый
      // application/x-tgsticker (см. core/stickers/tgs).
      if (isLottieMime(ct)) return { kind: 'lottie', data: await readLottie(res) }
      // tweb StickerType.WebM — видео-стикер.
      if (ct.startsWith('video/')) return { kind: 'video', url: URL.createObjectURL(await res.blob()) }
      // tweb StickerType.Static — webp/png.
      return { kind: 'image', url: URL.createObjectURL(await res.blob()) }
    }
    p = loadQueue ? loadQueue.push(fetchContent, isVisible) : fetchContent()
    p.catch(() => cache.delete(mediaId))
    cache.set(mediaId, p)
  }
  return p
}

/** Только для тестов: сбросить кэш между кейсами. */
export function resetStickerContentCache(): void {
  cache.clear()
}
