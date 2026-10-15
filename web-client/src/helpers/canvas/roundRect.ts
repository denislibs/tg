// Порт tweb `src/helpers/canvas/roundRect.ts` (812502980) 1:1.
export default function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: { [k in 'tl' | 'tr' | 'br' | 'bl']?: number } | number,
  fill?: boolean,
  stroke?: boolean,
) {
  // `canvas.dpr` — самописное поле tweb (канвас, который сам считает масштаб)
  const dpr = (ctx.canvas as HTMLCanvasElement & { dpr?: number }).dpr
  if(dpr) {
    x *= dpr
    y *= dpr
    width *= dpr
    height *= dpr
  }

  let corners: Record<'tl' | 'tr' | 'br' | 'bl', number>
  if(typeof(radius) === 'number') {
    if(dpr) radius *= dpr
    corners = { tl: radius, tr: radius, br: radius, bl: radius }
  } else {
    corners = { tl: 0, tr: 0, br: 0, bl: 0 }
    for(const side of Object.keys(corners) as (keyof typeof corners)[]) {
      corners[side] = radius[side] ? (dpr ? radius[side] * dpr : radius[side]) : corners[side]
    }
  }

  ctx.beginPath()
  ctx.moveTo(x + corners.tl, y)
  ctx.lineTo(x + width - corners.tr, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + corners.tr)
  ctx.lineTo(x + width, y + height - corners.br)
  ctx.quadraticCurveTo(x + width, y + height, x + width - corners.br, y + height)
  ctx.lineTo(x + corners.bl, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - corners.bl)
  ctx.lineTo(x, y + corners.tl)
  ctx.quadraticCurveTo(x, y, x + corners.tl, y)
  ctx.closePath()

  if(fill) {
    ctx.fill()
  }

  if(stroke) {
    ctx.stroke()
  }
}
