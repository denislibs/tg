// Канвас-композиция медиа-редактора (canvas 2D, без React): базовое
// изображение, enhance-фильтры, оверлей «тепла», слой рисования, текст-блоки.
// Все координаты — в пикселях СЫРОГО исходника W×H; поворот/флип/масштаб
// покрытия применяются ко ВСЕЙ сцене одним трансформом (base + штрихи + текст
// согласованы автоматически). Внешний transform ctx (crop + масштаб превью)
// довершает отображение — один код рисует и live-превью, и экспорт.
import {
  arrowHeadPoints, buildEnhanceFilter, contrastColor, hexToRgb, warmthOverlay,
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
export type TextAlign = 'left' | 'center' | 'right'

/**
 * 8 шрифтов вкладки text (1:1 с tweb fontInfoMap): семейство/начертание для
 * `ctx.font`/CSS и baseline — доля высоты строки от её верха до алфавитной
 * базовой линии (у разных шрифтов метрики различаются, поэтому храним отдельно).
 */
export type FontKey = 'roboto' | 'suez' | 'bubbles' | 'playwrite' | 'chewy' | 'courier' | 'fugaz' | 'sedan'

export interface FontInfo {
  fontFamily: string
  fontWeight: number
  baseline: number
}

export const fontInfoMap: Record<FontKey, FontInfo> = {
  roboto: { fontFamily: "'Roboto'", fontWeight: 500, baseline: 0.75 },
  suez: { fontFamily: "'Suez One'", fontWeight: 400, baseline: 0.75 },
  bubbles: { fontFamily: "'Rubik Bubbles'", fontWeight: 400, baseline: 0.75 },
  playwrite: { fontFamily: "'Playwrite BE VLG'", fontWeight: 400, baseline: 0.85 },
  chewy: { fontFamily: "'Chewy'", fontWeight: 400, baseline: 0.75 },
  courier: { fontFamily: "'Courier Prime'", fontWeight: 700, baseline: 0.65 },
  fugaz: { fontFamily: "'Fugaz One'", fontWeight: 400, baseline: 0.75 },
  sedan: { fontFamily: "'Sedan'", fontWeight: 400, baseline: 0.75 },
}

/** Текст-блок; x/y — левый верхний угол бокса, size — в пикселях исходника. */
export interface TextBlock {
  id: number
  x: number
  y: number
  text: string
  color: string
  size: number
  style: TextStyle
  font: FontKey
  align: TextAlign
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

/** CSS/`ctx.font`-строка для шрифта font размера size (порт tweb). */
export const textFont = (font: FontKey, size: number): string => {
  const fi = fontInfoMap[font]
  return `${fi.fontWeight} ${size}px ${fi.fontFamily}, sans-serif`
}

// Межстрочный интервал текст-слоя — 1.33em (tweb .media-editor__text-layer).
const LINE_HEIGHT_EM = 1.33

/** Геометрия одной строки в координатах бокса (левый-верх бокса = 0,0). */
export interface TextLineLayout {
  text: string
  left: number
  right: number
  height: number
}

export interface TextLayout {
  lines: TextLineLayout[]
  width: number
  height: number
  lineHeight: number
  padX: number
  /** Смещение алфавитной базовой линии от верха строки. */
  baselineOffset: number
}

/**
 * Раскладка строк текст-блока — ЧИСТАЯ функция (без DOM), считает по заранее
 * измеренным ширинам строк. Горизонтальный паддинг у каждой строки (0.2em, для
 * background — 0.3em, как в tweb text-layer). Выравнивание сдвигает строки
 * внутри бокса шириной по самой широкой строке. left/right/height каждой строки
 * — в координатах бокса, что нужно и для скруглённой плашки, и для hit-теста.
 */
export function layoutText(
  lineWidths: number[], texts: string[], size: number, style: TextStyle, align: TextAlign, baseline: number,
): TextLayout {
  const padX = size * (style === 'background' ? 0.3 : 0.2)
  const lineHeight = size * LINE_HEIGHT_EM
  const renderWidths = lineWidths.map((w) => w + padX * 2)
  const width = renderWidths.length ? Math.max(...renderWidths) : 0
  const lines = renderWidths.map((rw, i) => {
    const left = align === 'center' ? (width - rw) / 2 : align === 'right' ? width - rw : 0
    return { text: texts[i], left, right: left + rw, height: lineHeight }
  })
  return { lines, width, height: lineHeight * lines.length, lineHeight, padX, baselineOffset: lineHeight * baseline }
}

// Измерение строк блока текущим шрифтом (устанавливает ctx.font на выходе).
function measureLayout(ctx: CanvasRenderingContext2D, b: TextBlock): TextLayout {
  ctx.font = textFont(b.font, b.size)
  const texts = b.text.split('\n')
  const widths = texts.map((t) => ctx.measureText(t).width)
  return layoutText(widths, texts, b.size, b.style, b.align, fontInfoMap[b.font].baseline)
}

/** Габарит блока (для hit-теста); левый-верх = b.x,b.y. */
export function measureTextBlock(ctx: CanvasRenderingContext2D, b: TextBlock): Rect {
  const l = measureLayout(ctx, b)
  return { x: b.x, y: b.y, w: l.width, h: l.height }
}

/**
 * Скруглённая плашка под многострочным текстом (порт tweb createTextBackgroundPath):
 * SVG-путь, огибающий правые и левые края строк со скруглениями на переходах.
 * Координаты — в системе бокса; вызывающий переносит на b.x,b.y.
 */
function textBackgroundPath(lines: TextLineLayout[]): string {
  const first = lines[0]
  const rounding = first.height * 0.3
  const arc = (r: number, s = 1): (string | number)[] => ['A', r, r, 0, 0, s]
  const path: (string | number)[] = []

  path.push('M', first.left, rounding)
  path.push(...arc(rounding), first.left + rounding, 0)
  path.push('L', first.right - rounding, 0)
  path.push(...arc(rounding), first.right, rounding)

  let prev = first
  let prevY = first.height
  for (let i = 1; i < lines.length; i++) {
    const pos = lines[i]
    const sign = pos.right > prev.right ? 1 : -1
    const diff = Math.min(Math.abs((pos.right - prev.right) / 2), rounding) * sign
    const cr = Math.abs(diff)
    path.push('L', prev.right, prevY - cr)
    path.push(...arc(cr, sign === 1 ? 0 : 1), prev.right + diff, prevY)
    path.push('L', pos.right - diff, prevY)
    path.push(...arc(cr, sign === 1 ? 1 : 0), pos.right, prevY + cr)
    prevY += pos.height
    prev = pos
  }

  path.push('L', prev.right, prevY - rounding)
  path.push(...arc(rounding), prev.right - rounding, prevY)
  path.push('L', prev.left + rounding, prevY)
  path.push(...arc(rounding), prev.left, prevY - rounding)

  const last = lines[lines.length - 1]
  prevY -= last.height
  for (let i = lines.length - 2; i >= 0; i--) {
    const pos = lines[i]
    const sign = pos.left > prev.left ? 1 : -1
    const diff = Math.min(Math.abs((pos.left - prev.left) / 2), rounding) * sign
    const cr = Math.abs(diff)
    path.push('L', prev.left, prevY + cr)
    path.push(...arc(cr, sign !== 1 ? 0 : 1), prev.left + diff, prevY)
    path.push('L', pos.left - diff, prevY)
    path.push(...arc(cr, sign !== 1 ? 1 : 0), pos.left, prevY - cr)
    prevY -= pos.height
    prev = pos
  }
  return path.join(' ')
}

/**
 * Отрисовка блока в координатах сцены. Стили (порт tweb):
 * normal — заливка цветом; outline — обводка strokeText шириной size*0.15 цветом
 * + заливка контрастным цветом; background — скруглённая плашка цветом + текст
 * контрастным цветом. Многострочный текст выравнивается по align.
 */
export function drawTextBlock(ctx: CanvasRenderingContext2D, b: TextBlock): void {
  if (!b.text) return
  const l = measureLayout(ctx, b)
  ctx.save()
  ctx.font = textFont(b.font, b.size)
  ctx.textBaseline = 'alphabetic'
  if (b.style === 'background') {
    ctx.save()
    ctx.translate(b.x, b.y)
    ctx.fillStyle = b.color
    ctx.fill(new Path2D(textBackgroundPath(l.lines)))
    ctx.restore()
  }
  const fill = b.style === 'normal' ? b.color : contrastColor(b.color)
  l.lines.forEach((line, i) => {
    const x = b.x + line.left + l.padX
    const y = b.y + i * l.lineHeight + l.baselineOffset
    if (b.style === 'outline') {
      ctx.lineWidth = b.size * 0.15
      ctx.strokeStyle = b.color
      ctx.lineJoin = 'round'
      ctx.strokeText(line.text, x, y)
    }
    ctx.fillStyle = fill
    ctx.fillText(line.text, x, y)
  })
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
