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

/**
 * Значения 11 коррекций медиа-редактора (как в tweb adjustmentsConfig).
 * Диапазоны задаёт ADJUSTMENTS: `to100` → 0..100, иначе −50..50. 0 — без эффекта.
 */
export interface EnhanceValues {
  enhance: number
  brightness: number
  contrast: number
  saturation: number
  warmth: number
  fade: number
  highlights: number
  shadows: number
  vignette: number
  grain: number
  sharpen: number
}

export const ENHANCE_DEFAULTS: EnhanceValues = {
  enhance: 0, brightness: 0, contrast: 0, saturation: 0, warmth: 0,
  fade: 0, highlights: 0, shadows: 0, vignette: 0, grain: 0, sharpen: 0,
}

/**
 * Конфиг коррекций 1:1 с tweb `adjustmentsConfig`: ключ, имя uniform в шейдере,
 * лейбл (en; i18n добавит перевод при наличии) и `to100` — диапазон слайдера.
 */
export interface AdjustmentConfig {
  key: keyof EnhanceValues
  uniform: string
  label: string
  to100: boolean
}

export const ADJUSTMENTS: AdjustmentConfig[] = [
  { key: 'enhance', uniform: 'uEnhance', label: 'Enhance', to100: true },
  { key: 'brightness', uniform: 'uBrightness', label: 'Brightness', to100: false },
  { key: 'contrast', uniform: 'uContrast', label: 'Contrast', to100: false },
  { key: 'saturation', uniform: 'uSaturation', label: 'Saturation', to100: false },
  { key: 'warmth', uniform: 'uWarmth', label: 'Warmth', to100: false },
  { key: 'fade', uniform: 'uFade', label: 'Fade', to100: true },
  { key: 'highlights', uniform: 'uHighlights', label: 'Highlights', to100: false },
  { key: 'shadows', uniform: 'uShadows', label: 'Shadows', to100: false },
  { key: 'vignette', uniform: 'uVignette', label: 'Vignette', to100: true },
  { key: 'grain', uniform: 'uGrain', label: 'Grain', to100: true },
  { key: 'sharpen', uniform: 'uSharpen', label: 'Sharpen', to100: true },
]

/** Диапазон слайдера коррекции: to100 → [0,100], иначе [−50,50]. */
export const enhanceRange = (to100: boolean): [number, number] => (to100 ? [0, 100] : [-50, 50])

/** Значение слайдера → uniform шейдера (как в tweb imageCanvas): value/(to100?100:50). */
export const normalizeEnhance = (value: number, to100: boolean): number => value / (to100 ? 100 : 50)

/** Минимальная сторона crop-рамки в пикселях исходника. */
export const MIN_CROP = 64

/** Глубина undo-стека (как в tweb — ограничена, чтобы не копить память). */
export const HISTORY_LIMIT = 20

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const isDefaultEnhance = (v: EnhanceValues): boolean => ADJUSTMENTS.every((a) => !v[a.key])

// Число для filter-строки без экспоненциальной записи и float-шума.
const amt = (n: number) => String(Math.round(n * 1000) / 1000)

/**
 * CSS-фильтр для fallback-пути (когда WebGL недоступен): покрывает лишь ту часть
 * коррекций, что выражается ctx.filter — brightness/contrast/saturation. Значения
 * нормализуются как в шейдере (−50..50 → −1..1) и линейно кладутся в множители.
 * Тепло идёт отдельным оверлеем (warmthOverlay). Всё по нулям — 'none'.
 */
export function buildEnhanceFilter(v: EnhanceValues): string {
  const b = normalizeEnhance(v.brightness, false)
  const c = normalizeEnhance(v.contrast, false)
  const s = normalizeEnhance(v.saturation, false)
  if (!b && !c && !s) return 'none'
  return `brightness(${amt(Math.max(0, 1 + b * 0.5))}) contrast(${amt(Math.max(0, 1 + c * 0.5))}) saturate(${amt(Math.max(0, 1 + s))})`
}

/**
 * Оверлей «тепла» для fallback-пути: оранжевый при warmth>0, синий при warmth<0,
 * alpha растёт с модулем значения (максимум 0.25 — дальше картинка «горит»).
 */
export function warmthOverlay(warmth: number): { color: string; alpha: number } | null {
  if (!warmth) return null
  const alpha = Math.round(Math.min(1, Math.abs(warmth) / 50) * 0.25 * 1000) / 1000
  return { color: warmth > 0 ? '#ff8a00' : '#0a84ff', alpha }
}

// ── Crop ──────────────────────────────────────────────────────────────────

export type AspectPreset =
  | 'free' | 'original'
  | '1:1' | '3:2' | '2:3' | '4:3' | '3:4'
  | '5:4' | '4:5' | '7:5' | '5:7' | '16:9' | '9:16'

// Список и порядок 1:1 с tweb cropTab.
export const ASPECT_PRESETS: AspectPreset[] = [
  'free', 'original', '1:1', '3:2', '2:3', '4:3', '3:4',
  '5:4', '4:5', '7:5', '5:7', '16:9', '9:16',
]

const ASPECT_RATIOS: Record<Exclude<AspectPreset, 'free' | 'original'>, number> = {
  '1:1': 1, '3:2': 3 / 2, '2:3': 2 / 3, '4:3': 4 / 3, '3:4': 3 / 4,
  '5:4': 5 / 4, '4:5': 4 / 5, '7:5': 7 / 5, '5:7': 5 / 7, '16:9': 16 / 9, '9:16': 9 / 16,
}

/** Числовой аспект пресета для картинки w×h; null — свободная рамка. */
export function aspectOf(preset: AspectPreset, w: number, h: number): number | null {
  if (preset === 'free') return null
  if (preset === 'original') return w / h
  return ASPECT_RATIOS[preset]
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

// ── Свободный поворот и cover-scale ───────────────────────────────────────
// Единое координатное пространство сцены — центрированный исходник W×H.
// Изображение крутится/флипается/масштабируется целиком (base + штрихи +
// текст), crop вырезает осевую рамку в том же пространстве. Поэтому здесь —
// только математика точки и минимального масштаба покрытия.

/** Поворот точки вокруг начала координат на angle (рад), по часовой при y-вниз. */
export function rotatePoint(p: Point, angle: number): Point {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

/**
 * Минимальный масштаб изображения W×H (центрировано, начало — его центр),
 * при котором повёрнутое на angle изображение полностью покрывает crop-рамку.
 * crop задан в кадре [0,W]×[0,H] (то же пространство, что исходник при angle=0),
 * центр рамки может быть смещён относительно центра изображения. Порт идеи
 * getConvenientPositioning из tweb: все 4 угла рамки должны лежать внутри
 * повёрнутого прямоугольника изображения; проверяем их в локальной (обратно
 * повёрнутой) системе изображения. Никогда не меньше 1 — не ужимаем исходник.
 */
export function coverScale(crop: Rect, W: number, H: number, angle: number): number {
  if (W <= 0 || H <= 0) return 1
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const ox = crop.x + crop.w / 2 - W / 2
  const oy = crop.y + crop.h / 2 - H / 2
  const hw = crop.w / 2
  const hh = crop.h / 2
  let need = 1
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = ox + sx * hw
      const cy = oy + sy * hh
      // угол рамки в неповёрнутой системе изображения (обратный поворот)
      const lx = cx * cos + cy * sin
      const ly = -cx * sin + cy * cos
      need = Math.max(need, (2 * Math.abs(lx)) / W, (2 * Math.abs(ly)) / H)
    }
  }
  return need
}

// ── Кисти рисования — геометрия и цвет ──────────────────────────────────────
// Чистые (без DOM) хелперы для кистей: разбор hex-цвета и геометрия наконечника
// стрелки. Порт из tweb brushPainter (getArrowHeadLength/drawArrowHead) —
// вынесено сюда, чтобы тестировать без канваса.

/** Hex (#rgb или #rrggbb) → [r,g,b] 0..255. Не-hex → чёрный. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  if (full.length !== 6 || Number.isNaN(n)) return [0, 0, 0]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Длина лучей наконечника стрелки от толщины кисти (tweb getArrowHeadLength). */
export const arrowHeadLength = (size: number): number => Math.sqrt(size) + size * 2.5

/**
 * Две крайние точки лучей наконечника стрелки для штриха points толщины size.
 * Направление — по последним точкам (отступив назад минимум на size*0.5, чтобы
 * дрожание хвоста не ломало угол), лучи разведены на ±45°. null — точек < 2.
 * Порт tweb drawArrowHead (та же atan2(dx,dy)+π и sin/cos-конвенция).
 */
export function arrowHeadPoints(
  points: Point[], size: number, length = arrowHeadLength(size),
): [Point, Point] | null {
  if (points.length < 2) return null
  const i = points.length - 1
  const tip = points[i]
  let i2 = i
  for (; i2 > 0; i2--) {
    if (Math.hypot(tip.x - points[i2].x, tip.y - points[i2].y) > size * 0.5) break
  }
  const angle = Math.atan2(tip.x - points[i2].x, tip.y - points[i2].y) + Math.PI
  const a1 = angle + Math.PI / 4
  const a2 = angle - Math.PI / 4
  return [
    { x: tip.x + length * Math.sin(a1), y: tip.y + length * Math.cos(a1) },
    { x: tip.x + length * Math.sin(a2), y: tip.y + length * Math.cos(a2) },
  ]
}

// ── Undo-стек ─────────────────────────────────────────────────────────────

/** Push с ограничением глубины: старые записи вытесняются с начала. */
export function pushHistory<T>(stack: readonly T[], item: T, limit = HISTORY_LIMIT): T[] {
  const next = [...stack, item]
  return next.length > limit ? next.slice(next.length - limit) : next
}
