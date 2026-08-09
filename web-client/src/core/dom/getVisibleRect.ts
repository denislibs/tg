// src/core/dom/getVisibleRect.ts
export interface RectMin { top: number; right: number; bottom: number; left: number }

// Насколько элемент вылез за края скроллера (tweb getVisibleRect `overflow`):
// булевы флаги по сторонам + счётчики по осям (0..2).
export interface VisibleOverflow {
  top: boolean; right: boolean; bottom: boolean; left: boolean
  vertical: number; horizontal: number
}

// Returns the clipped visible rect of `element` within `overflowElement`, or null
// if fully outside. Ported from tweb (simplified: no sticky/ignoreBoundaries).
export default function getVisibleRect(
  element: HTMLElement,
  overflowElement: HTMLElement,
  rect: RectMin = element.getBoundingClientRect(),
  overflowRect: RectMin = overflowElement.getBoundingClientRect(),
): { rect: RectMin; overflow: VisibleOverflow } | null {
  const { top: oT, right: oR, bottom: oB, left: oL } = overflowRect
  if (rect.top >= oB || rect.bottom <= oT || rect.right <= oL || rect.left >= oR) {
    return null
  }
  // tweb помечает край переполненным только если сам скроллер не упирается в
  // границу окна (getVisibleRect.ts:42-47) — иначе это просто край экрана.
  const overflow: VisibleOverflow = { top: false, right: false, bottom: false, left: false, vertical: 0, horizontal: 0 }
  if (rect.top < oT && oT !== 0) { overflow.top = true; overflow.vertical++ }
  if (rect.bottom > oB && oB !== window.innerHeight) { overflow.bottom = true; overflow.vertical++ }
  if (rect.left < oL && oL !== 0) { overflow.left = true; overflow.horizontal++ }
  if (rect.right > oR && oR !== window.innerWidth) { overflow.right = true; overflow.horizontal++ }
  return {
    rect: {
      top: Math.max(rect.top, oT),
      right: Math.min(rect.right, oR),
      bottom: Math.min(rect.bottom, oB),
      left: Math.max(rect.left, oL),
    },
    overflow,
  }
}
