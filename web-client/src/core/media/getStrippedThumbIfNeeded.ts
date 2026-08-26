// Порт tweb `src/helpers/getStrippedThumbIfNeeded.ts` (экспорт
// `getMediaThumbIfNeeded`) + `src/helpers/getImageFromStrippedThumb.ts` —
// ванильный узел stripped-превью для бабла. React-обвязки нет: функция отдаёт
// готовый DOM-узел и промис его готовности, как в оригинале.
//
// ── Как оригинал ложится на нашу модель медиа ───────────────────────────────
// tweb решает «нужно ли превью» по `cacheContext` (`downloaded` + `type`
// конкретного `PhotoSize`) и умеет подставить уже скачанный БОЛЕЕ МЕЛКИЙ
// размер вместо stripped. У нас лестницы `PhotoSize` не существует вовсе:
// медиа адресуется одним `id`, а размеров ровно два — `{thumb:true|false}`
// (`core/managers/mediaManager.ts::downloadMediaURL`). Поэтому:
//   • `cacheContext.downloaded` → параметр `downloaded` (у вызывающего это
//     `cachedMediaUrl(id) !== undefined` — тот же смысл: байты уже на руках);
//   • ветка `photo._ === 'document' && … && cacheContext.type !== THUMB_TYPE_FULL`
//     не портирована — она различает размеры внутри документа, различать
//     нечего;
//   • цикл по `sizes` под `!onlyStripped` (подстановка скачанного соседнего
//     размера) не портирован по той же причине; вместе с ним отпадает и сам
//     параметр `onlyStripped`;
//   • `sizes.find((s) => s._ === 'photoStrippedSize')` → параметр
//     `strippedThumb` (base64-JPEG из payload сообщения — то, что у нас
//     приезжает полем `blurPreview`/`blur_preview`);
//   • `getPreviewURLFromThumb` → `data:image/jpeg;base64,…`: наш bytes-канал
//     отдаёт превью уже base64-строкой, промежуточный blob-URL строить не из
//     чего и незачем (тот же приём — `mediaViewer/base.ts`).
//
// Что портировано БЕЗ изменений и почему это важно:
//   • `isVideo` продолжает требовать превью даже при `downloaded` — у видео
//     «скачано» относится к постеру/файлу, а не к первому кадру, и без
//     stripped-подложки бабл видео открывался бы пустым прямоугольником;
//   • `useBlur: boolean | number` — `false` даёт обычный `<img>` (превью без
//     блюра, путь `noBlur` у tweb), число задаёт радиус;
//   • класс `thumbnail` вешает именно этот модуль
//     (getImageFromStrippedThumb.ts:24), а `media-photo` — вызывающий враппер
//     (photo.ts:157,199). Не сливать: `thumbnail` есть и у превью вьювера, где
//     `media-photo` не нужен.
import blur from '@helpers/blur'
import { renderImageFromUrlPromise } from '@helpers/dom/renderImageFromUrl'

export interface StrippedThumb {
  image: HTMLImageElement | HTMLCanvasElement
  loadPromise: Promise<void>
}

/**
 * Порт tweb `helpers/bytes/getPreviewURLFromBytes` в нашей форме входа: там
 * stripped-превью приезжает `Uint8Array` и заворачивается в blob-URL, у нас
 * bytes-канал отдаёт его СРАЗУ base64-строкой (см. шапку файла), поэтому
 * промежуточного blob'а нет. Экспортируется, потому что тот же URL строит
 * аватарка — `components/avatar.ts` (порт `avatarNew.tsx:576`), а третья копия
 * строки-префикса в дереве не нужна.
 */
export function getPreviewURLFromStrippedThumb(strippedThumb: string): string {
  return `data:image/jpeg;base64,${strippedThumb}`
}

// Порт tweb `getImageFromStrippedThumb`: канвас с блюром либо голый <img>.
export function getImageFromStrippedThumb(strippedThumb: string, useBlur: boolean | number): StrippedThumb {
  const url = getPreviewURLFromStrippedThumb(strippedThumb)

  let image: HTMLImageElement | HTMLCanvasElement
  let loadPromise: Promise<void>
  if (!useBlur) {
    image = new Image()
    loadPromise = renderImageFromUrlPromise(image, url)
  } else {
    const result = blur(url, typeof useBlur === 'number' ? useBlur : undefined)
    image = result.canvas
    loadPromise = result.promise
  }

  image.classList.add('thumbnail')

  return { image, loadPromise }
}

/**
 * Порт tweb `getMediaThumbIfNeeded`: узел превью — или `null`, если превью не
 * нужно (медиа уже скачано) либо его не из чего построить (stripped нет).
 *
 * @param strippedThumb base64-JPEG stripped-превью из payload медиа
 * @param downloaded байты полного медиа уже есть (наш аналог
 *        `cacheContext.downloaded` — попадание в зеркало `cachedMediaUrl`)
 * @param isVideo видео/гиф: превью нужно даже при `downloaded`
 * @param useBlur `false` — <img> без блюра, число — радиус блюра
 * @param ignoreCache строить превью независимо от `downloaded`
 */
export default function getMediaThumbIfNeeded({
  strippedThumb,
  downloaded,
  isVideo,
  useBlur,
  ignoreCache,
}: {
  strippedThumb: string | undefined
  downloaded?: boolean
  isVideo?: boolean
  useBlur: boolean | number
  ignoreCache?: boolean
}): StrippedThumb | null {
  if (!(!downloaded || isVideo || ignoreCache)) {
    return null
  }

  if (!strippedThumb) {
    return null
  }

  return getImageFromStrippedThumb(strippedThumb, useBlur)
}
