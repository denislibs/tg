// Порт tweb `components/messageSpoilerOverlay/drawImageFromSource.ts`.
// Канвас симуляции — тайл 240×120, а закрывать надо прямоугольники слов любого
// размера и в любом месте бабла. Функция раскладывает запрошенный участок на
// куски тайла и рисует каждый со своим сдвигом — получается бесшовный repeat,
// как `background-repeat`, но на канве.
//
// nMap — tweb `helpers/number/nMap` (линейная переразметка отрезка), инлайном:
// ради одной формулы отдельный модуль не нужен.
const nMap = (v: number, min: number, max: number, newMin: number, newMax: number) =>
  ((v - min) * (newMax - newMin)) / (max - min) + newMin

export function drawImageFromSource(
  ctx: OffscreenCanvasRenderingContext2D,
  sourceCanvas: OffscreenCanvas,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const sourceWidth = sourceCanvas.width
  const sourceHeight = sourceCanvas.height
  if (!sourceWidth || !sourceHeight || sw <= 0 || sh <= 0) return

  const startChunkX = Math.floor(sx / sourceWidth) * sourceWidth
  const startChunkY = Math.floor(sy / sourceHeight) * sourceHeight

  const lastChunkX = (Math.floor((sx + sw) / sourceWidth) + 1) * sourceWidth
  const lastChunkY = (Math.floor((sy + sh) / sourceHeight) + 1) * sourceHeight

  for (let cx = startChunkX; cx < lastChunkX; cx += sourceWidth) {
    for (let cy = startChunkY; cy < lastChunkY; cy += sourceHeight) {
      const rawX = Math.max(sx, cx)
      const rawY = Math.max(sy, cy)
      const x = rawX % sourceWidth
      const y = rawY % sourceHeight
      const w = Math.min(sourceWidth - x, sx + sw - rawX)
      const h = Math.min(sourceHeight - y, sy + sh - rawY)
      if (w <= 0 || h <= 0) continue

      ctx.drawImage(
        sourceCanvas,
        x,
        y,
        w,
        h,
        nMap(rawX, sx, sx + sw, dx, dx + dw),
        nMap(rawY, sy, sy + sh, dy, dy + dh),
        (w / sw) * dw,
        (h / sh) * dh,
      )
    }
  }
}
