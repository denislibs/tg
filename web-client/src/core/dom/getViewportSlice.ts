// src/core/dom/getViewportSlice.ts
//
// Задача 4: переведено на вендорный `@helpers/dom/getVisibleRect` (порт tweb 1:1,
// см. его шапку) — локальный `core/dom/getVisibleRect.ts` удалён вместе с этим
// переводом (второй, неэквивалентный getVisibleRect в дереве — старый ВСЕГДА
// клампил возвращаемый rect в границы overflowRect, вендорный подменяет край
// только при сработавшем гарде). Разницы для ЭТОГО файла нет: он использует
// только null/non-null результат (`!!getVisibleRect(...)`), а не координаты
// возвращаемого `rect` — их клампинг/неклампинг никак не влияет на исход.
//
// Сигнатура вендорного шире (добавился `lookForSticky` третьим параметром,
// `rect`/`overflowRect` сдвинулись на 4-й/5-й) — вызов ниже подправлен под это.
import getVisibleRect from '@helpers/dom/getVisibleRect'

type RectMin = { top: number; right: number; bottom: number; left: number }

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
    const isVisible = !!getVisibleRect(element, overflowElement, undefined, rect, overflowRect)
    const arr = isVisible ? (foundVisible = true, visible) : foundVisible ? invisibleBottom : invisibleTop
    arr.push({ element, rect })
  }

  if (extraMinLength) {
    visible.unshift(...invisibleTop.splice(Math.max(0, invisibleTop.length - extraMinLength), extraMinLength))
    visible.push(...invisibleBottom.splice(0, extraMinLength))
  }

  return { invisibleTop, visible, invisibleBottom }
}
