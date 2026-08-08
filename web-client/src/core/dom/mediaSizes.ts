// Размеры медиа в ленте — порт tweb `src/helpers/mediaSizes.ts:64-101` и
// `src/helpers/setAttachmentSize.ts:9-106`.
//
// Отличие от tweb: у него это класс с подпиской на resize и брейкпоинтами
// ScreenSize; у нас брейкпоинт один и тот же ($small-screen = 600px), поэтому
// набор выбирается функцией по текущей ширине окна — вызывающий код и так
// перерисовывается по resize (React), лишняя подписка не нужна.
import { calcImageInBox } from './calcImageInBox'

export interface Size { width: number; height: number }

export interface MediaTypeSizes {
  regular: Size
  webpage: Size
  album: Size
  animatedSticker: Size
  staticSticker: Size
  emojiSticker: Size
  poll: Size
  round: Size
  documentName: Size
  invoice: Size
  extendedInvoice: Size
  popupSticker: Size
}

const sz = (width: number, height = width): Size => ({ width, height })

// tweb mediaSizes.ts:66-83 (handhelds) и :84-101 (desktop) — 1:1.
export const HANDHELDS: MediaTypeSizes = {
  regular: sz(340, 340),
  webpage: sz(340, 200),
  album: sz(340, 0),
  animatedSticker: sz(180, 180),
  staticSticker: sz(180, 180),
  emojiSticker: sz(112, 112),
  poll: sz(240, 0),
  round: sz(240, 240),
  documentName: sz(200, 0),
  invoice: sz(340, 340),
  extendedInvoice: sz(340, 340),
  popupSticker: sz(68, 68),
}

export const DESKTOP: MediaTypeSizes = {
  regular: sz(420, 400),
  webpage: sz(420, 380),
  album: sz(420, 0),
  animatedSticker: sz(200, 200),
  staticSticker: sz(200, 200),
  emojiSticker: sz(112, 112),
  poll: sz(330, 0),
  round: sz(280, 280),
  documentName: sz(240, 0),
  invoice: sz(320, 320),
  extendedInvoice: sz(420, 400),
  popupSticker: sz(80, 80),
}

// tweb MOBILE_SIZE (= $small-screen в SCSS).
export const MOBILE_SIZE = 600

/** Активный набор размеров: handhelds ниже брейкпоинта, desktop выше. */
export function mediaSizes(width = typeof window === 'undefined' ? 1280 : window.innerWidth): MediaTypeSizes {
  return width <= MOBILE_SIZE ? HANDHELDS : DESKTOP
}

// tweb setAttachmentSize.ts:9-12.
export const EXPAND_TEXT_WIDTH = 320
export const MIN_IMAGE_WIDTH = 120
export const MIN_SIDE_SIZE = 200
export const MIN_VIDEO_SIDE_SIZE = 368

/** `size.aspect(box, fitted)` из tweb MediaSize — тот же calcImageInBox. */
function aspect(size: Size, box: Size, fitted: boolean): Size {
  return calcImageInBox(size.width, size.height, box.width, box.height, fitted)
}

/**
 * Итоговый бокс вложения — порт `setAttachmentSize` (tweb setAttachmentSize.ts:64-106).
 * Шаги ровно как в оригинале: вписать в бокс → если обе стороны меньше 200,
 * растянуть покрытием до 200 → если у сообщения есть текст/reply/webpage/фактчек,
 * расширить до 320 ради читаемости → добить минимальную ширину (120, а для видео
 * с плеером — 368).
 */
export function setAttachmentSize({
  width,
  height,
  boxWidth,
  boxHeight,
  noZoom = true,
  hasMessageBlock = false,
  isVideoWithPlayer = false,
  noMinSize = false,
}: {
  width: number
  height: number
  boxWidth: number
  boxHeight: number
  noZoom?: boolean
  /** у сообщения есть подпись / reply / webpage / фактчек — tweb расширяет бокс */
  hasMessageBlock?: boolean
  isVideoWithPlayer?: boolean
  noMinSize?: boolean
}): { size: Size; isFit: boolean } {
  const src: Size = { width: width || 100, height: height || 100 }
  let box = aspect(src, { width: boxWidth, height: boxHeight }, noZoom)
  let isFit = true

  if (!noMinSize) {
    if (box.width < MIN_SIDE_SIZE && box.height < MIN_SIDE_SIZE) {
      box = aspect(box, { width: MIN_SIDE_SIZE, height: MIN_SIDE_SIZE }, false)
    }

    if (hasMessageBlock && box.width < EXPAND_TEXT_WIDTH) {
      box = { width: EXPAND_TEXT_WIDTH, height: box.height }
      isFit = false
    }

    const minWidth = isVideoWithPlayer ? MIN_VIDEO_SIDE_SIZE : MIN_IMAGE_WIDTH
    if (box.width < minWidth) {
      box = { width: minWidth, height: box.height }
      isFit = false
    }
  }

  return { size: box, isFit }
}
