// Канвас-композиция медиа-редактора (canvas 2D, без React): базовое
// изображение, enhance-фильтры, оверлей «тепла», слой рисования, текст-блоки.
// Все координаты — в пикселях СЫРОГО исходника W×H; поворот/флип/масштаб
// покрытия применяются ко ВСЕЙ сцене одним трансформом (base + штрихи + текст
// согласованы автоматически). Внешний transform ctx (crop + масштаб превью)
// довершает отображение — один код рисует и live-превью, и экспорт.
import {
  arrowHeadPoints, buildEnhanceFilter, hexToRgb, warmthOverlay,
  type EnhanceValues, type Point, type Rect,
} from './editorMath'

export type SrcImage = ImageBitmap | HTMLImageElement

/**
 * Тип кисти вкладки draw (порт tweb brushes):
 * pen — сплошная линия; arrow — линия + наконечник; marker — полупрозрачная
 * (rgba 0.4); neon — белая линия со свечением (shadowBlur); blur — «прорезает»
 * размытую копию базы вдоль штриха; eraser — стирает нарисованное.
 */
export type BrushType = 'pen' | 'arrow' | 'marker' | 'neon' | 'blur' | 'eraser'

/**
 * Трансформ сцены: центрированный исходник W×H → выходное пространство.
 * flipX/flipY — зеркала по осям (±1), rotation — свободный угол (рад),
 * scale — масштаб покрытия crop-рамки (coverScale).
 */
export interface SceneTransform {
  w: number
  h: number
  flipX: 1 | -1
  flipY: 1 | -1
  rotation: number
  scale: number
}

/** Штрих кисти; координаты и толщина — в пикселях исходника. */
export interface Stroke {
  brush: BrushType
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

/**
 * Путь штриха со сглаживанием квадратичными кривыми через середины отрезков
 * (порт tweb drawLinePath). Одна точка — кружок; strokeStyle/тени вызывающий
 * настроил заранее.
 */
function drawLinePath(ctx: CanvasRenderingContext2D, pts: Point[], size: number): void {
  if (!pts.length) return
  if (pts.length === 1) {
    ctx.fillStyle = ctx.strokeStyle
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, size / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.lineWidth = size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length - 2; i++) {
    const cx = (pts[i].x + pts[i + 1].x) / 2
    const cy = (pts[i].y + pts[i + 1].y) / 2
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, cx, cy)
  }
  const i = pts.length - 1
  ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y)
  ctx.stroke()
}

/**
 * Ресурсы для «тяжёлых» кистей: blurred — заранее размытая копия базы (W×H,
 * совмещена со слоем рисования 1:1), scratch — переиспользуемый холст-маска.
 */
export interface BrushAssets {
  blurred: HTMLCanvasElement | null
  scratch: HTMLCanvasElement | null
}

/** Штрих кистью s.brush; порт объекта brushes из tweb brushPainter. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, assets?: BrushAssets): void {
  const pts = s.points
  if (!pts.length) return
  ctx.save()
  switch (s.brush) {
    case 'pen':
      ctx.strokeStyle = s.color
      drawLinePath(ctx, pts, s.size)
      break
    case 'arrow': {
      ctx.strokeStyle = s.color
      drawLinePath(ctx, pts, s.size)
      const head = arrowHeadPoints(pts, s.size)
      if (head) {
        const tip = pts[pts.length - 1]
        ctx.lineWidth = s.size
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(tip.x, tip.y)
        ctx.lineTo(head[0].x, head[0].y)
        ctx.moveTo(tip.x, tip.y)
        ctx.lineTo(head[1].x, head[1].y)
        ctx.stroke()
      }
      break
    }
    case 'marker': {
      const [r, g, b] = hexToRgb(s.color)
      ctx.strokeStyle = `rgba(${r},${g},${b},0.4)`
      drawLinePath(ctx, pts, s.size)
      break
    }
    case 'neon':
      ctx.strokeStyle = '#ffffff'
      ctx.shadowBlur = s.size
      ctx.shadowColor = s.color
      drawLinePath(ctx, pts, s.size)
      break
    case 'blur': {
      // Размытую базу «прорезаем» формой штриха: рисуем белый путь на маске,
      // source-in оставляет от размытой копии только пиксели под штрихом, итог
      // кладём поверх резкой базы (порт blur-кисти tweb без кэша прошлых линий).
      const blurred = assets?.blurred
      const scratch = assets?.scratch
      const sctx = scratch?.getContext('2d')
      if (blurred && scratch && sctx) {
        sctx.save()
        sctx.clearRect(0, 0, scratch.width, scratch.height)
        sctx.strokeStyle = '#ffffff'
        drawLinePath(sctx, pts, s.size)
        sctx.globalCompositeOperation = 'source-in'
        sctx.drawImage(blurred, 0, 0)
        sctx.restore()
        ctx.drawImage(scratch, 0, 0)
      }
      break
    }
    case 'eraser':
      ctx.strokeStyle = '#ffffff'
      ctx.globalCompositeOperation = 'destination-out'
      drawLinePath(ctx, pts, s.size)
      break
  }
  ctx.restore()
}

/**
 * Перерисовать слой рисования (полное разрешение) из списка штрихов. blurred —
 * размытая копия базы для blur-кисти; если среди штрихов есть blur, заводим
 * один холст-маску на весь проход (переиспользуется всеми blur-штрихами).
 */
export function rebuildDrawLayer(
  layer: HTMLCanvasElement, strokes: Stroke[], blurred: HTMLCanvasElement | null = null,
): void {
  const ctx = layer.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, layer.width, layer.height)
  let scratch: HTMLCanvasElement | null = null
  if (blurred && strokes.some((s) => s.brush === 'blur')) {
    scratch = document.createElement('canvas')
    scratch.width = layer.width
    scratch.height = layer.height
  }
  const assets: BrushAssets = { blurred, scratch }
  for (const s of strokes) drawStroke(ctx, s, assets)
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

export interface Scene extends SceneTransform {
  img: SrcImage
  enhance: EnhanceValues
  /**
   * Медиа-слой после WebGL-коррекций (нативное разрешение исходника W×H). Если
   * задан — рисуется как медиа-база. Если null (WebGL недоступен) — fallback:
   * исходник + CSS-filter + оверлей тепла.
   */
  adjusted: HTMLCanvasElement | null
  drawLayer: HTMLCanvasElement | null
  texts: TextBlock[]
}

/**
 * Полная композиция сцены. Вызывающий уже настроил transform ctx так, что
 * центрированное выходное пространство отображается на канвас (с учётом crop и
 * масштаба превью). Здесь применяется трансформ изображения (scale покрытия →
 * поворот → флип → перенос в левый-верх исходника) и рисуется медиа-база →
 * рисунок → текст в координатах СЫРОГО исходника W×H. Поэтому штрихи и текст
 * поворачиваются/масштабируются/кадрируются вместе с картинкой и в превью, и в
 * экспорте. hideTextId — блок, который сейчас редактируется input-оверлеем.
 */
export function composeScene(ctx: CanvasRenderingContext2D, sc: Scene, hideTextId?: number): void {
  const { w, h } = sc
  ctx.save()
  ctx.scale(sc.scale, sc.scale)
  ctx.rotate(sc.rotation)
  ctx.scale(sc.flipX, sc.flipY)
  ctx.translate(-w / 2, -h / 2)
  if (sc.adjusted) {
    // WebGL уже применил 11 коррекций к пикселям — рисуем как есть.
    ctx.drawImage(sc.adjusted, 0, 0, w, h)
  } else {
    // Fallback: часть коррекций через CSS-filter + оверлей тепла.
    ctx.filter = buildEnhanceFilter(sc.enhance)
    ctx.drawImage(sc.img, 0, 0, w, h)
    ctx.filter = 'none'
    const warm = warmthOverlay(sc.enhance.warmth)
    if (warm) {
      ctx.save()
      ctx.globalCompositeOperation = 'soft-light'
      ctx.globalAlpha = warm.alpha
      ctx.fillStyle = warm.color
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
    }
  }
  if (sc.drawLayer) ctx.drawImage(sc.drawLayer, 0, 0)
  for (const t of sc.texts) {
    if (t.id !== hideTextId) drawTextBlock(ctx, t)
  }
  ctx.restore()
}
