// Канвас-композиция медиа-редактора (canvas 2D, без React): базовое
// изображение с ориентацией и enhance-фильтрами, оверлей «тепла», слой
// рисования, текст-блоки. Все координаты — в пикселях ориентированного
// исходника; масштаб превью задаётся transform'ом контекста, поэтому один и
// тот же код рисует и live-превью, и экспорт в полном разрешении.
import {
  buildEnhanceFilter, warmthOverlay,
  type EnhanceValues, type Point, type Rect,
} from './editorMath'

export type SrcImage = ImageBitmap | HTMLImageElement

/** Ориентация: rot — число поворотов на 90° по часовой, flip — зеркало по X. */
export interface Orient {
  rot: 0 | 1 | 2 | 3
  flip: boolean
}

/** Штрих кисти; координаты и толщина — в пикселях исходника. */
export interface Stroke {
  color: string
  size: number
  points: Point[]
}

export type TextStyle = 'normal' | 'outline' | 'background'

/** Текст-блок; x/y — левый верхний угол, size — в пикселях исходника. */
export interface TextBlock {
  id: number
  x: number
  y: number
  text: string
  color: string
  size: number
  style: TextStyle
}

export const srcSize = (img: SrcImage): { w: number; h: number } =>
  img instanceof HTMLImageElement
    ? { w: img.naturalWidth, h: img.naturalHeight }
    : { w: img.width, h: img.height }

/** Размер ориентированного пространства (rot нечётный — оси меняются местами). */
export const orientedSize = (img: SrcImage, o: Orient): { w: number; h: number } => {
  const { w, h } = srcSize(img)
  return o.rot % 2 ? { w: h, h: w } : { w, h }
}

// Поворот по часовой в view-пространстве: rot+1. Отражение в view-пространстве
// при T = R(rot)∘F(flip): F∘R(rot) = R(-rot)∘F, поэтому rot → (4-rot)%4.
export const rotateOrientCW = (o: Orient): Orient => ({ rot: ((o.rot + 1) % 4) as Orient['rot'], flip: o.flip })
export const flipOrientH = (o: Orient): Orient => ({ rot: ((4 - o.rot) % 4) as Orient['rot'], flip: !o.flip })

/** Нарисовать исходник в ориентированное пространство ow×oh (в коорд. ctx). */
export function drawOriented(ctx: CanvasRenderingContext2D, img: SrcImage, o: Orient, ow: number, oh: number): void {
  ctx.save()
  ctx.translate(ow / 2, oh / 2)
  ctx.rotate((o.rot * Math.PI) / 2)
  if (o.flip) ctx.scale(-1, 1)
  // до поворота оси исходные: при нечётном rot ширина рисуется вдоль oh
  const w = o.rot % 2 ? oh : ow
  const h = o.rot % 2 ? ow : oh
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  ctx.restore()
}

/** Штрих со сглаживанием: квадратичные кривые через середины отрезков. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  const pts = s.points
  if (!pts.length) return
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineWidth = s.size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (pts.length < 3) {
    // точка/короткий тап — кружок
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, s.size / 2, 0, Math.PI * 2)
    ctx.fill()
    if (pts.length === 2) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      ctx.lineTo(pts[1].x, pts[1].y)
      ctx.stroke()
    }
  } else {
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2
      const my = (pts[i].y + pts[i + 1].y) / 2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
    ctx.stroke()
  }
  ctx.restore()
}

/** Перерисовать слой рисования (полное разрешение) из списка штрихов. */
export function rebuildDrawLayer(layer: HTMLCanvasElement, strokes: Stroke[]): void {
  const ctx = layer.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, layer.width, layer.height)
  for (const s of strokes) drawStroke(ctx, s)
}

export const textFont = (size: number) => `500 ${size}px Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif`

// Плашка (style: 'background') — скруглённый прямоугольник вручную:
// roundRect ещё не во всех браузерах/тайпингах.
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Габарит блока (для hit-теста и плашки); ctx нужен для measureText. */
export function measureTextBlock(ctx: CanvasRenderingContext2D, b: TextBlock): Rect {
  ctx.save()
  ctx.font = textFont(b.size)
  const w = ctx.measureText(b.text).width
  ctx.restore()
  const pad = b.style === 'background' ? b.size * 0.25 : 0
  return { x: b.x - pad, y: b.y - pad, w: w + pad * 2, h: b.size * 1.2 + pad * 2 }
}

/** Отрисовка блока: обычный / чёрная обводка / белая плашка (стили tweb). */
export function drawTextBlock(ctx: CanvasRenderingContext2D, b: TextBlock): void {
  if (!b.text) return
  ctx.save()
  ctx.font = textFont(b.size)
  ctx.textBaseline = 'top'
  if (b.style === 'background') {
    const r = measureTextBlock(ctx, b)
    ctx.fillStyle = '#ffffff'
    roundRectPath(ctx, r.x, r.y, r.w, r.h, b.size * 0.3)
    ctx.fill()
    // белый текст на белой плашке нечитаем — как в tweb, уводим в чёрный
    ctx.fillStyle = b.color.toLowerCase() === '#ffffff' ? '#000000' : b.color
    ctx.fillText(b.text, b.x, b.y + b.size * 0.1)
  } else {
    if (b.style === 'outline') {
      ctx.strokeStyle = '#000000'
      ctx.lineWidth = Math.max(2, b.size / 8)
      ctx.lineJoin = 'round'
      ctx.strokeText(b.text, b.x, b.y)
    }
    ctx.fillStyle = b.color
    ctx.fillText(b.text, b.x, b.y)
  }
  ctx.restore()
}

export interface Scene {
  img: SrcImage
  orient: Orient
  enhance: EnhanceValues
  drawLayer: HTMLCanvasElement | null
  texts: TextBlock[]
}

/**
 * Полная композиция сцены в ориентированных координатах исходника
 * (crop → на совести transform'а ctx): база с фильтрами → тепло → рисунок →
 * текст. hideTextId — блок, который сейчас редактируется input-оверлеем.
 */
export function composeScene(ctx: CanvasRenderingContext2D, sc: Scene, hideTextId?: number): void {
  const { w: ow, h: oh } = orientedSize(sc.img, sc.orient)
  ctx.filter = buildEnhanceFilter(sc.enhance)
  drawOriented(ctx, sc.img, sc.orient, ow, oh)
  ctx.filter = 'none'
  const warm = warmthOverlay(sc.enhance.warmth)
  if (warm) {
    ctx.save()
    ctx.globalCompositeOperation = 'soft-light'
    ctx.globalAlpha = warm.alpha
    ctx.fillStyle = warm.color
    ctx.fillRect(0, 0, ow, oh)
    ctx.restore()
  }
  if (sc.drawLayer) ctx.drawImage(sc.drawLayer, 0, 0)
  for (const t of sc.texts) {
    if (t.id !== hideTextId) drawTextBlock(ctx, t)
  }
}
