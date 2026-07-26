// Ported 1:1 from tweb (src/helpers/calcImageInBox.ts): fit an image of natural
// size (imageW × imageH) into a box (boxW × boxH) preserving aspect ratio, without
// upscaling when noZoom. Used to RESERVE a media bubble's exact dimensions before
// the bytes load, so the row height never changes (no scroll jitter).
export function calcImageInBox(
  imageW: number,
  imageH: number,
  boxW: number,
  boxH: number,
  noZoom = true,
): { width: number; height: number } {
  if (imageW <= 0 || imageH <= 0) return { width: boxW, height: Math.round((boxW * 3) / 4) }

  if (imageW < boxW && imageH < boxH && noZoom) {
    return { width: imageW, height: imageH }
  }

  let w = boxW
  let h = boxH
  if (imageW / imageH > boxW / boxH) {
    h = (imageH * boxW / imageW) | 0
  } else {
    w = (imageW * boxH / imageH) | 0
    if (w > boxW) {
      h = (h * boxW / w) | 0
      w = boxW
    }
  }

  if (noZoom && w >= imageW && h >= imageH) {
    w = imageW
    h = imageH
  }

  return { width: w, height: h }
}
