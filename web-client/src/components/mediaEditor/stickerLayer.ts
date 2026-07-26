// Чистая геометрия слоёв-стикеров (порт tweb resizableLayers): hit-тест по
// повёрнутому боксу, трансформация угловой ручкой (одновременно поворот через
// atan2 и масштаб через отношение гипотенуз) и экранные координаты углов слоя
// для рамки выделения/ручек. Без React/DOM — тестируется отдельно.
import type { Point } from './editorMath'
import type { StickerLayer } from './sceneRender'

/** Знаки угла бокса: (-1,-1) — левый-верх, (1,1) — правый-низ. */
export interface Corner {
  cornerX: 1 | -1
  cornerY: 1 | -1
}

/** Повернуть вектор на угол (рад). */
function rotate(x: number, y: number, angle: number): Point {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

/**
 * Верхний (последний в массиве) слой, чей повёрнутый бокс size×size (size =
 * base*scale) накрывает точку p. Координаты — исходника (та же система, что
 * layer.x/y). Возврат null — промах.
 */
export function hitSticker(layers: StickerLayer[], p: Point, base: number): StickerLayer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i]
    const half = (base * L.scale) / 2
    // в локальную систему бокса: сдвиг к центру + обратный поворот
    const local = rotate(p.x - L.x, p.y - L.y, -L.rotation)
    if (Math.abs(local.x) <= half && Math.abs(local.y) <= half) return L
  }
  return null
}

/**
 * Экранные координаты 4 углов слоя (для рамки выделения и попадания по ручкам).
 * transform — матрица исходник → CSS-пиксели (buildMatrix в MediaEditor).
 */
export function stickerCorners(
  layer: StickerLayer, base: number, transform: DOMMatrix,
): { corner: Corner; point: Point }[] {
  const half = (base * layer.scale) / 2
  const out: { corner: Corner; point: Point }[] = []
  for (const cornerX of [-1, 1] as const) {
    for (const cornerY of [-1, 1] as const) {
      const r = rotate(cornerX * half, cornerY * half, layer.rotation)
      const p = transform.transformPoint(new DOMPoint(layer.x + r.x, layer.y + r.y))
      out.push({ corner: { cornerX, cornerY }, point: { x: p.x, y: p.y } })
    }
  }
  return out
}

export interface StickerResizeInput {
  corner: Corner
  /** Половина стороны бокса при scale=1, В ЭКРАННЫХ пикселях (base*srcScale/2). */
  half: number
  /** Центр слоя, экранные пиксели. */
  center: Point
  /** Позиция указателя, экранные пиксели. */
  pointer: Point
  /** Поворот сцены (медиа), рад — вычитается, т.к. поворот сцены накладывается поверх слоя. */
  sceneRotation: number
}

/**
 * Новые rotation+scale слоя при перетаскивании угловой ручки (порт tweb
 * useResizeHandles): initialVector — направление угла в НЕповёрнутом боксе при
 * scale=1; resizedVector — от указателя к центру. Разница atan2 даёт абсолютный
 * экранный угол (минус поворот сцены → собственный угол слоя), отношение
 * гипотенуз — абсолютный масштаб слоя.
 */
export function resizeSticker(input: StickerResizeInput): { rotation: number; scale: number } {
  const initial = [input.half * input.corner.cornerX, input.half * input.corner.cornerY]
  const resized = [input.center.x - input.pointer.x, input.center.y - input.pointer.y]
  const rotationFromHorizon =
    Math.atan2(resized[1], resized[0]) - Math.atan2(initial[1], initial[0]) + Math.PI
  const scale = Math.hypot(resized[0], resized[1]) / Math.hypot(initial[0], initial[1])
  return { rotation: rotationFromHorizon - input.sceneRotation, scale }
}
