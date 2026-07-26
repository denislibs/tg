// Подготовка фото к отправке — порт tweb newMedia.ts::scaleImageForTelegram
// (+ helpers/canvas/scaleMediaElement.ts, modifyMimeTypeForTelegram).
//
// Телеграм не шлёт «сжатое фото» оригиналом: если сторона > 2560px, либо это
// тяжёлый lossless (png/bmp > 2МБ), либо формат несовместим с серверными image-
// типами — картинку пережимают/конвертят в jpeg через canvas, иначе сервер
// отклоняет её (PHOTO_SAVE_FILE_INVALID). В остальных случаях (маленький
// совместимый jpeg) оригинал уходит как есть. GIF не трогаем никогда.
//
// Клиентский thumb/blur тут НЕ генерим — это делает бэкенд (ffmpeg).

import { calcImageInBox } from '../dom/calcImageInBox'

// tweb newMedia.ts
const PHOTO_SIDE_LIMIT = 2560
const PHOTO_HEAVY_BYTES = 2 * 1024 * 1024
const PHOTO_COMPRESSED_QUALITY = 0.9

// tweb appManagers/constants.ts: SERVER_IMAGE_MIME_TYPES — форматы, которые бэкенд
// принимает как «фото». Всё остальное (webp/heic/avif) конвертируем в jpeg.
const SERVER_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/bmp', 'image/gif'])

// Итоговый файл после ресайза/конвертации всегда jpeg (tweb scaleImageForTelegram
// → modifyMimeTypeForTelegram), поэтому расширение всегда .jpg
// (tweb wrapMediaEditorBlobInFile imageTypeToExtMap: jpeg→jpg).
function renameToJpg(name: string): string {
  const replaced = name.replace(/\.[^.]+$/, '.jpg')
  return replaced.endsWith('.jpg') ? replaced : replaced.replace(/\.+$/, '') + '.jpg'
}

// Порт tweb scaleMediaElement: ресайз через createImageBitmap(resizeWidth/Height)
// → canvas → toBlob. Выход — всегда jpeg (без альфы), поэтому под картинку кладём
// белую заливку, иначе прозрачные пиксели png/webp стали бы чёрными.
async function scaleToBlob(file: File, width: number, height: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { resizeWidth: width, resizeHeight: height })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('scaleImageForSend: no 2d context')
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('scaleImageForSend: toBlob failed')
  return blob
}

export interface PreparedImage {
  file: File
  width: number
  height: number
}

// Готовит фото к отправке «как медиа». Возвращает исходный файл (если ресайз/
// конвертация не нужны) либо пережатый в jpeg, с обновлёнными width/height и
// именем/mime. convertIncompatible всегда true (как в tweb attachMedia send-путь).
export async function scaleImageForSend(file: File): Promise<PreparedImage> {
  const mime = file.type
  // GIF — анимация, никогда не трогаем (tweb). Не-изображения сюда не попадают.
  if (mime === 'image/gif' || !mime.startsWith('image/')) {
    const size = await readSize(file)
    return { file, width: size.width, height: size.height }
  }

  try {
    const probe = await createImageBitmap(file)
    const natW = probe.width
    const natH = probe.height
    probe.close()

    const isHeavyLossless = (mime === 'image/png' || mime === 'image/bmp') && file.size > PHOTO_HEAVY_BYTES
    const needsResize = Math.max(natW, natH) > PHOTO_SIDE_LIMIT
    const needsConvert = !SERVER_IMAGE_MIME_TYPES.has(mime) // convertIncompatible=true

    if (!(needsResize || isHeavyLossless || needsConvert)) {
      return { file, width: natW, height: natH }
    }

    // Бокс: каждая сторона ≤ 2560, но никогда не апскейлить (min с натуральным).
    const size = calcImageInBox(
      natW,
      natH,
      Math.min(natW, PHOTO_SIDE_LIMIT),
      Math.min(natH, PHOTO_SIDE_LIMIT),
      true,
    )
    // Качество роняем только при сжатии тяжёлого lossless; чистый ресайз/конвертация
    // — near-lossless (quality=1), как tweb (quality ?? 1).
    const quality = isHeavyLossless ? PHOTO_COMPRESSED_QUALITY : 1
    const blob = await scaleToBlob(file, size.width, size.height, quality)
    const out = new File([blob], renameToJpg(file.name), { type: 'image/jpeg' })
    return { file: out, width: size.width, height: size.height }
  } catch (err) {
    // HEIC/битый файл: браузер не смог декодировать или canvas — пережать. Шлём
    // оригинал как есть (width/height=0), чтобы не оборвать отправку всей партии
    // (sendPendingMedia). Сервер сам решит, что с таким файлом делать.
    console.warn('scaleImageForSend: не удалось декодировать/пережать, отправляю оригинал', err)
    return { file, width: 0, height: 0 }
  }
}

function readSize(file: File): Promise<{ width: number; height: number }> {
  return createImageBitmap(file).then(
    (b) => { const s = { width: b.width, height: b.height }; b.close(); return s },
    () => ({ width: 0, height: 0 }),
  )
}
