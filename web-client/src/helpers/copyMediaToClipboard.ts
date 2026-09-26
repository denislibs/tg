// Порт tweb `src/helpers/copyMediaToClipboard.ts:1-99` (812502980, коммит
// 508acd4f5 «Add full-size media clipboard copying») — полноразмерная
// картинка сообщения в буфер обмена. Потребитель — `components/
// copyMessageMediaWithFeedback.ts` (пункт «Копировать» меню сообщения, меню
// shared media и кнопка медиавьювера).
//
// Порядок оригинала сохранён дословно, и он существенный: `clipboard.write`
// зовётся СИНХРОННО, в тике пользовательского жеста, а ещё не скачанный файл
// уезжает в `ClipboardItem` ПРОМИСОМ — браузер сам дождётся его перед
// записью. Дождаться загрузки и только потом писать нельзя: жест к тому
// моменту истечёт, и запись отклонят.
//
// ── Адаптация (одна) ─────────────────────────────────────────────────────────
// `appDownloadManager.downloadMedia({media, thumb: choosePhotoSize(media,
// Infinity, Infinity)})` — у нас скачивание картинки принадлежит воркерному
// конвейеру: `ensureMediaUrl(media.id)` (единственная точка входа
// императивного кода за URL медиа, `core/media/ensureMediaUrl.ts`) отдаёт
// objectURL ПОЛНОГО файла, а байты читаются из него `fetch`-ем. «Самая
// большая ступень» (`choosePhotoSize(…, Infinity, Infinity)`) у нас и есть
// полный файл: ступени фото — это превью (`thumb`) и оригинал, других
// размеров сервер не хранит.
import IMAGE_MIME_TYPES_SUPPORTED from '@environment/imageMimeTypesSupport'
import canvasToBlob from '@helpers/canvas/canvasToBlob'
import { canWriteClipboardItem, writeClipboardItem } from '@helpers/clipboard'
import { ensureMediaUrl } from '@core/media/ensureMediaUrl'
import type { MyDocument, MyPhoto } from '@core/media/messageMedia'

const CLIPBOARD_MIME_TYPE = 'image/png'

type CopyableMedia = MyPhoto | MyDocument

export function canCopyMediaToClipboard(media: CopyableMedia | undefined) {
  if (!media || (
    media._ !== 'photo' &&
    (media._ !== 'document' || !IMAGE_MIME_TYPES_SUPPORTED.has(media.mime_type))
  )) {
    return false
  }

  return canWriteClipboardItem(CLIPBOARD_MIME_TYPE)
}

// см. «Адаптация» в шапке
async function downloadFullSizeMedia(media: CopyableMedia) {
  const url = await ensureMediaUrl(media.id)
  const response = await fetch(url)
  return response.blob()
}

async function convertToPng(blob: Blob) {
  if (blob.type === CLIPBOARD_MIME_TYPE) {
    return blob
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  let source: CanvasImageSource
  let width: number
  let height: number
  let cleanup: () => void

  // `appWindow.createImageBitmap` оригинала — проверка наличия метода: в
  // старых Safari его нет
  if ('createImageBitmap' in window) {
    const bitmap = await window.createImageBitmap(blob)
    source = bitmap
    width = bitmap.width
    height = bitmap.height
    cleanup = () => bitmap.close()
  } else {
    const image = document.createElement('img')
    const url = URL.createObjectURL(blob)
    image.src = url
    try {
      await image.decode()
    } catch(error) {
      URL.revokeObjectURL(url)
      throw error
    }

    source = image
    width = image.naturalWidth
    height = image.naturalHeight
    cleanup = () => URL.revokeObjectURL(url)
  }

  canvas.width = width
  canvas.height = height

  try {
    // `context` у оригинала не проверяется (strictNullChecks выключен); нет
    // контекста — нечем рисовать, и `canvasToBlob` отклонит пустой канвас
    context?.drawImage(source, 0, 0)
    return await canvasToBlob(canvas, CLIPBOARD_MIME_TYPE)
  } finally {
    cleanup()
  }
}

export default function copyMediaToClipboard(media: CopyableMedia | undefined) {
  if (!media || !canCopyMediaToClipboard(media)) {
    return Promise.reject(new Error('Media clipboard writing is not supported'))
  }

  const blobPromise = Promise.resolve()
    .then(() => downloadFullSizeMedia(media))
    .then(convertToPng)

  try {
    // The write itself must stay in the user-activation tick. ClipboardItem
    // accepts the pending full-size download and resolves it before committing.
    return writeClipboardItem({
      [CLIPBOARD_MIME_TYPE]: blobPromise,
    })
  } catch(error) {
    void blobPromise.catch((): void => {})
    return Promise.reject(error as Error)
  }
}
