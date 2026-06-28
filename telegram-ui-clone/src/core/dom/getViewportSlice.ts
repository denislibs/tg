// src/core/dom/getViewportSlice.ts
import getVisibleRect, { type RectMin } from './getVisibleRect'

export type ViewportPart = { element: HTMLElement; rect: DOMRect }[]

// Categorizes elements into invisibleTop / visible / invisibleBottom relative to
// overflowElement, with an extraSize buffer and an extraMinLength keep-alive band.
// Ported from tweb src/helpers/dom/getViewportSlice.ts.
export default function getViewportSlice({
  overflowElement,
  elements,
  extraSize = 0,
  extraMinLength = 0,
}: {
  overflowElement: HTMLElement
  elements: HTMLElement[]
  extraSize?: number
  extraMinLength?: number
}): { invisibleTop: ViewportPart; visible: ViewportPart; invisibleBottom: ViewportPart } {
  let overflowRect: RectMin = overflowElement.getBoundingClientRect()
  if (extraSize) {
    overflowRect = {
      top: overflowRect.top - extraSize,
      right: overflowRect.right + extraSize,
      bottom: overflowRect.bottom + extraSize,
      left: overflowRect.left - extraSize,
    }
  }

  const invisibleTop: ViewportPart = []
  const visible: ViewportPart = []
  const invisibleBottom: ViewportPart = []
  let foundVisible = false
  for (const element of elements) {
    const rect = element.getBoundingClientRect()
    const isVisible = !!getVisibleRect(element, overflowElement, rect, overflowRect)
    const arr = isVisible ? (foundVisible = true, visible) : foundVisible ? invisibleBottom : invisibleTop
    arr.push({ element, rect })
  }

  if (extraMinLength) {
    visible.unshift(...invisibleTop.splice(Math.max(0, invisibleTop.length - extraMinLength), extraMinLength))
    visible.push(...invisibleBottom.splice(0, extraMinLength))
  }

  return { invisibleTop, visible, invisibleBottom }
}
