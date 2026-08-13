// Кэш первых кадров стикеров — порт tweb `helpers/saveLottiePreview.ts` +
// `lib/storages/thumbs.ts` (часть про `stickerCachedThumbs`).
//
// Зачем: у lottie/webm-стикера бэк не отдаёт растровое превью (анимацию на
// сервере не растеризуем). tweb решает это тем, что КЛИЕНТ сохраняет первый
// отрисованный кадр и в следующий раз показывает его мгновенно, пока анимация
// грузится и декодируется. Без этого слоя ячейка стоит пустой до первого кадра.
//
// Отличия от tweb (осознанные, каждое — следствие нашей архитектуры):
// * Хранилище живёт на главном потоке, а не в воркере с зеркалированием по
//   вкладкам (`thumbsStorage` + `mirrorStickerThumb`): у нас стикеры и так
//   грузятся и декодируются на вкладке — зеркалить нечего и некому.
// * Ключ — только mediaId, без `toneIndex`: тонов кожи и перекраски по цвету
//   текста (custom emoji с `text_color`) у нас пока нет — как появятся,
//   ключ расширяется ровно как в tweb (`getStickerThumbKey`).
import type LottiePlayer from '@lib/lottie/lottiePlayer'

/** Сохранённый кадр: objectURL картинки и её размер в пикселях. */
export interface StickerThumb {
  url: string
  w: number
  h: number
}

const thumbs = new Map<number, StickerThumb>()
// Идущие прямо сейчас сохранения: tweb держит такой же реестр
// (`savingLottiePreview`), чтобы параллельные показы одного стикера не гнали
// toBlob по разу на каждый.
const saving = new Map<number, { w: number; h: number }>()

/** Кадр, сохранённый прошлым показом; undefined — кэша нет. */
export function getStickerThumb(mediaId: number): StickerThumb | undefined {
  return thumbs.get(mediaId)
}

/**
 * Уже есть (или сохраняется) кадр не меньше запрошенного размера — tweb
 * `isSavingLottiePreview`. Пересохранять меньший поверх большего смысла нет.
 */
export function isSavingStickerThumb(mediaId: number, w: number, h: number): boolean {
  const s = saving.get(mediaId)
  return !!s && s.w >= w && s.h >= h
}

/**
 * Сохранить кадр как превью стикера (tweb `saveLottiePreview`). Источник —
 * canvas плеера или ImageBitmap, выгруженный из воркера.
 */
export async function saveStickerThumb(
  mediaId: number,
  frame: HTMLCanvasElement | ImageBitmap,
): Promise<void> {
  const { width, height } = frame
  if (!width || !height) return
  if (isSavingStickerThumb(mediaId, width, height)) return

  const mark = { w: width, h: height }
  saving.set(mediaId, mark)

  const existing = thumbs.get(mediaId)
  if (existing && existing.w >= width && existing.h >= height) return

  let canvas: HTMLCanvasElement
  if (frame instanceof HTMLCanvasElement) {
    canvas = frame
  } else {
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(frame, 0, 0, width, height)
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve))
  // Кадр мог устареть, пока считался blob: свежее сохранение уже перебило метку.
  if (!blob || saving.get(mediaId) !== mark) return

  const previous = thumbs.get(mediaId)
  thumbs.set(mediaId, { url: URL.createObjectURL(blob), w: width, h: height })
  if (previous) URL.revokeObjectURL(previous.url)
}

/**
 * Снять первый кадр с плеера и сохранить (tweb `saveLottiePreviewFromPlayer`).
 * У offscreen-плеера пикселей на вкладке нет — кадр выгружается из воркера
 * (`exportFrame`), и гейт проверяется ДО выгрузки, чтобы зря не гонять bitmap.
 */
export async function saveStickerThumbFromPlayer(mediaId: number, player: LottiePlayer): Promise<void> {
  if (!player.offscreen) {
    const canvas = player.canvas[0]
    if (canvas) await saveStickerThumb(mediaId, canvas)
    return
  }

  if (isSavingStickerThumb(mediaId, player.width, player.height)) return

  try {
    // Плеер вендорен под @ts-nocheck, поэтому ответ воркера приезжает как unknown —
    // форма ответа зафиксирована портом (`exportFrame` в lib/lottie/lottieMessagePort).
    const { frame } = (await player.exportFrame()) as { frame: ImageBitmap }
    await saveStickerThumb(mediaId, frame)
    frame.close?.()
  } catch {
    // Деградируем до «превью нет» — ровно то же состояние, что и до первого
    // показа стикера; следующий показ попробует снова.
  }
}

/** Только для тестов: сбросить кэш между кейсами. */
export function resetStickerThumbs(): void {
  for (const t of thumbs.values()) URL.revokeObjectURL(t.url)
  thumbs.clear()
  saving.clear()
}
