// Порт tweb `helpers/dom/getViewportSlice.ts` — 1:1 по логике; правки только
// под формат `.oxlintrc.json` этого репозитория (без `;`) и под отсутствующие
// у нас зависимости:
//   • `DOMRectMinified` в tweb — глобальный ambient-тип из `src/global.d.ts`;
//     тащить весь `global.d.ts` ради одного типа лишнее, объявлен локально
//     (тот же приём уже применён в `helpers/dom/getVisibleRect.ts`);
//   • под `strictNullChecks` `selector`/`elements` в оригинале взаимозаменяемы
//     без проверки (`querySelectorAll(selector)` при `selector === undefined`);
//     сигнатура сужена до объединения «либо selector, либо elements» — рантайм
//     не меняется, оба вызывающих в `bubbles.ts` передают `selector`.
import getVisibleRect from '@helpers/dom/getVisibleRect'

type DOMRectMinified = { top: number, right: number, bottom: number, left: number }

export type ViewportSlicePart = { element: HTMLElement, rect: DOMRect, visibleRect: ReturnType<typeof getVisibleRect> }[]

export default function getViewportSlice({
  overflowElement,
  overflowRect,
  selector,
  extraSize,
  extraMinLength,
  elements,
}: {
  overflowElement: HTMLElement,
  overflowRect?: DOMRectMinified,
  extraSize?: number,
  extraMinLength?: number,
  selector?: string,
  elements?: HTMLElement[]
}) {
  overflowRect ??= overflowElement.getBoundingClientRect()
  elements ??= Array.from(overflowElement.querySelectorAll<HTMLElement>(selector!))

  if(extraSize) {
    overflowRect = {
      top: overflowRect.top - extraSize,
      right: overflowRect.right + extraSize,
      bottom: overflowRect.bottom + extraSize,
      left: overflowRect.left - extraSize,
    }
  }

  const invisibleTop: ViewportSlicePart = [],
    visible: typeof invisibleTop = [],
    invisibleBottom: typeof invisibleTop = []
  let foundVisible = false
  for(const element of elements) {
    const rect = element.getBoundingClientRect()
    const visibleRect = getVisibleRect(element, overflowElement, false, rect, overflowRect)

    const isVisible = !!visibleRect
    let array: typeof invisibleTop
    if(isVisible) {
      foundVisible = true
      array = visible
    } else if(foundVisible) {
      array = invisibleBottom
    } else {
      array = invisibleTop
    }

    array.push({
      element,
      rect,
      visibleRect,
    })
  }

  if(extraMinLength) {
    visible.unshift(...invisibleTop.splice(Math.max(0, invisibleTop.length - extraMinLength), extraMinLength))
    visible.push(...invisibleBottom.splice(0, extraMinLength))
  }

  return { invisibleTop, visible, invisibleBottom }
}
