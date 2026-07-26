// src/core/dom/getVisibleRect.ts
export interface RectMin { top: number; right: number; bottom: number; left: number }

// Returns the clipped visible rect of `element` within `overflowElement`, or null
// if fully outside. Ported from tweb (simplified: no sticky/ignoreBoundaries).
export default function getVisibleRect(
  element: HTMLElement,
  overflowElement: HTMLElement,
  rect: RectMin = element.getBoundingClientRect(),
  overflowRect: RectMin = overflowElement.getBoundingClientRect(),
): { rect: RectMin } | null {
  const { top: oT, right: oR, bottom: oB, left: oL } = overflowRect
  if (rect.top >= oB || rect.bottom <= oT || rect.right <= oL || rect.left >= oR) {
    return null
  }
  return {
    rect: {
      top: Math.max(rect.top, oT),
      right: Math.min(rect.right, oR),
      bottom: Math.min(rect.bottom, oB),
      left: Math.max(rect.left, oL),
    },
  }
}
