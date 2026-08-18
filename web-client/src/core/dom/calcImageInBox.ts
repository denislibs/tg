// Ported 1:1 from tweb (src/helpers/calcImageInBox.ts): fit an image of natural
// size (imageW × imageH) into a box (boxW × boxH) preserving aspect ratio, without
// upscaling when noZoom. Used to RESERVE a media bubble's exact dimensions before
// the bytes load, so the row height never changes (no scroll jitter).
//
// Zero/negative natural size has NO special branch here — same as the original.
// Callers guard it where the original does: setAttachmentSize substitutes 100×100
// (`width || 100`), the viewer falls back to the thumbnail rect before opening
// (openMediaViewer.ts), and refitMediaToViewport bails on `!w || !h`.
export function calcImageInBox(
  imageW: number,
  imageH: number,
  boxW: number,
  boxH: number,
  noZoom = true,
): { width: number; height: number } {
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
