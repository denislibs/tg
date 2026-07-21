// Чистая математика медиа-редактора (без DOM): фильтры enhance, геометрия
// crop-рамки, повороты/отражения координат, undo-стек. Вынесена отдельно,
// чтобы тестировать в vitest без канваса.

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Значения вкладки Enhance, каждое -100..100 (0 — без эффекта). */
export interface EnhanceValues {
  brightness: number
  contrast: number
  saturation: number
  warmth: number
}

export const ENHANCE_DEFAULTS: EnhanceValues = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 }

/** Минимальная сторона crop-рамки в пикселях исходника. */
export const MIN_CROP = 64

/** Глубина undo-стека (как в tweb — ограничена, чтобы не копить память). */
export const HISTORY_LIMIT = 20

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const isDefaultEnhance = (v: EnhanceValues): boolean =>
  !v.brightness && !v.contrast && !v.saturation && !v.warmth

// Число для filter-строки без экспоненциальной записи и float-шума.
const amt = (n: number) => String(Math.round(Math.max(0, 1 + n / 100) * 100) / 100)

/**
 * Строка ctx.filter из значений enhance: -100..100 линейно в 0..2 множителя.
 * Тепло (warmth) в CSS-фильтры не входит — оно накладывается отдельным
 * оверлеем (warmthOverlay). Всё по нулям — 'none', чтобы не платить за фильтр.
 */
export function buildEnhanceFilter(v: EnhanceValues): string {
  if (!v.brightness && !v.contrast && !v.saturation) return 'none'
  return `brightness(${amt(v.brightness)}) contrast(${amt(v.contrast)}) saturate(${amt(v.saturation)})`
}

/**
 * Оверлей «тепла»: оранжевый при warmth>0, синий при warmth<0, alpha растёт
 * с модулем значения (максимум 0.25 — дальше картинка уже «горит»).
 */
export function warmthOverlay(warmth: number): { color: string; alpha: number } | null {
  if (!warmth) return null
  const alpha = Math.round(Math.min(1, Math.abs(warmth) / 100) * 0.25 * 1000) / 1000
  return { color: warmth > 0 ? '#ff8a00' : '#0a84ff', alpha }
}

// ── Crop ──────────────────────────────────────────────────────────────────

export type AspectPreset = 'free' | 'original' | '1:1' | '4:3' | '16:9'

export const ASPECT_PRESETS: AspectPreset[] = ['free', 'original', '1:1', '4:3', '16:9']

/** Числовой аспект пресета для картинки w×h; null — свободная рамка. */
export function aspectOf(preset: AspectPreset, w: number, h: number): number | null {
  switch (preset) {
    case 'free': return null
    case 'original': return w / h
    case '1:1': return 1
    case '4:3': return 4 / 3
    case '16:9': return 16 / 9
  }
}

/** Максимальная рамка данного аспекта, отцентрованная в границах W×H. */
export function centeredAspectCrop(W: number, H: number, aspect: number | null): Rect {
  if (!aspect) return { x: 0, y: 0, w: W, h: H }
  let w = W
  let h = W / aspect
  if (h > H) { h = H; w = H * aspect }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

/** Вписать рамку в границы: размер в [min..границы], позиция внутри. */
export function clampCrop(r: Rect, W: number, H: number, min = MIN_CROP): Rect {
  const w = clamp(r.w, Math.min(min, W), W)
  const h = clamp(r.h, Math.min(min, H), H)
  return { w, h, x: clamp(r.x, 0, W - w), y: clamp(r.y, 0, H - h) }
}

/** Сдвиг рамки целиком, не выходя из границ. */
export function moveCrop(r: Rect, dx: number, dy: number, W: number, H: number): Rect {
  return { ...r, x: clamp(r.x + dx, 0, W - r.w), y: clamp(r.y + dy, 0, H - r.h) }
}

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const CROP_HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/**
 * Перетаскивание одной из 8 ручек: dx/dy — смещение указателя в координатах
 * исходника от НАЧАЛА жеста, r — рамка на начало жеста. С аспектом ведущая
 * ось — та, которую тянут; вторая приводится к аспекту с якорем в
 * противоположном крае (у срединных ручек — растёт от центра).
 */
export function resizeCrop(
  r: Rect, handle: CropHandle, dx: number, dy: number,
  W: number, H: number, aspect: number | null, min = MIN_CROP,
): Rect {
  let l = r.x
  let t = r.y
  let rr = r.x + r.w
  let b = r.y + r.h
  const west = handle.includes('w')
  const east = handle.includes('e')
  const north = handle.includes('n')
  const south = handle.includes('s')
  if (west) l = clamp(l + dx, 0, rr - min)
  if (east) rr = clamp(rr + dx, l + min, W)
  if (north) t = clamp(t + dy, 0, b - min)
  if (south) b = clamp(b + dy, t + min, H)
  if (!aspect) return { x: l, y: t, w: rr - l, h: b - t }

  let w = rr - l
  let h = b - t
  if (west || east) h = w / aspect
  else w = h * aspect

  // Доступное место с учётом якоря (противоположный край; у ручек-сторон
  // перпендикулярная ось растёт от центра исходной рамки).
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const maxW = east ? W - l : west ? rr : 2 * Math.min(cx, W - cx)
  const maxH = south ? H - t : north ? b : 2 * Math.min(cy, H - cy)

  const k = Math.min(1, maxW / w, maxH / h)
  w *= k
  h *= k
  if (w < min) { w = min; h = w / aspect }
  if (h < min) { h = min; w = h * aspect }
  w = Math.min(w, maxW)
  h = Math.min(h, maxH)

  const x = east ? l : west ? rr - w : cx - w / 2
  const y = south ? t : north ? b - h : cy - h / 2
  return { x, y, w, h }
}

// ── Масштаб превью ────────────────────────────────────────────────────────

/** Масштаб вписывания w×h в maxW×maxH без увеличения сверх 1:1. */
export function fitScale(w: number, h: number, maxW: number, maxH: number): number {
  if (w <= 0 || h <= 0 || maxW <= 0 || maxH <= 0) return 1
  return Math.min(maxW / w, maxH / h, 1)
}

// ── Поворот/отражение координат аннотаций ─────────────────────────────────
// Пространство «ориентированного исходника» W×H; поворот на 90° по часовой
// переводит его в H×W: (x, y) → (H - y, x).

export function rotatePointCW(p: Point, H: number): Point {
  return { x: H - p.y, y: p.x }
}

export function rotateRectCW(r: Rect, H: number): Rect {
  return { x: H - r.y - r.h, y: r.x, w: r.h, h: r.w }
}

export function flipPointH(p: Point, W: number): Point {
  return { x: W - p.x, y: p.y }
}

export function flipRectH(r: Rect, W: number): Rect {
  return { ...r, x: W - r.x - r.w }
}

// ── Undo-стек ─────────────────────────────────────────────────────────────

/** Push с ограничением глубины: старые записи вытесняются с начала. */
export function pushHistory<T>(stack: readonly T[], item: T, limit = HISTORY_LIMIT): T[] {
  const next = [...stack, item]
  return next.length > limit ? next.slice(next.length - limit) : next
}
