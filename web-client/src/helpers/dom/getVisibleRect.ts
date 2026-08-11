// Порт tweb `helpers/dom/getVisibleRect.ts` — 1:1 по логике; правки только
// под формат `.oxlintrc.json` этого репозитория (без `;`, чинится
// `oxlint --fix`) и под отсутствующие у нас зависимости:
//   • `DOMRectMinified` в tweb — глобальный ambient-тип из `src/global.d.ts`
//     (там же куча несвязанного); тащить весь `global.d.ts` ради одного
//     типа — лишнее, объявлен локально в этом файле;
//   • импорт `@helpers/windowSize` оставлен как есть (путь совпадает) — под
//     ним теперь лежит наш минимальный шим, а не solid-реактивный оригинал
//     (решение координатора по блокеру Задачи 2, см. `task-2-report.md` и
//     шапку `helpers/windowSize.ts`); использование — `.width`/`.height`,
//     API идентично.
import windowSize from '@helpers/windowSize'

type DOMRectMinified = { top: number, right: number, bottom: number, left: number }

export default function getVisibleRect(
  element: HTMLElement,
  overflowElement: HTMLElement,
  lookForSticky?: boolean,
  rect: DOMRectMinified = element.getBoundingClientRect(),
  overflowRect: DOMRectMinified = overflowElement.getBoundingClientRect(),
  ignoreBoundaries?: boolean,
) {
  let { top: overflowTop, right: overflowRight, bottom: overflowBottom, left: overflowLeft } = overflowRect

  // * respect sticky headers
  if(lookForSticky) {
    const sticky = overflowElement.querySelector('.sticky')
    if(sticky) {
      const stickyRect = sticky.getBoundingClientRect()
      overflowTop = stickyRect.bottom
    }
  }

  if(rect.top >= overflowBottom ||
    rect.bottom <= overflowTop ||
    rect.right <= overflowLeft ||
    rect.left >= overflowRight) {
    return null
  }

  const overflow = {
    top: false,
    right: false,
    bottom: false,
    left: false,
    vertical: 0 as 0 | 1 | 2,
    horizontal: 0 as 0 | 1 | 2,
  }

  const windowWidth = windowSize.width
  const windowHeight = windowSize.height

  return {
    rect: {
      top: rect.top < overflowTop && (ignoreBoundaries || overflowTop !== 0) ? (overflow.top = true, ++overflow.vertical, overflowTop) : rect.top,
      right: rect.right > overflowRight && (ignoreBoundaries || overflowRight !== windowWidth) ? (overflow.right = true, ++overflow.horizontal, overflowRight) : rect.right,
      bottom: rect.bottom > overflowBottom && (ignoreBoundaries || overflowBottom !== windowHeight) ? (overflow.bottom = true, ++overflow.vertical, overflowBottom) : rect.bottom,
      left: rect.left < overflowLeft && (ignoreBoundaries || overflowLeft !== 0) ? (overflow.left = true, ++overflow.horizontal, overflowLeft) : rect.left,
    },
    overflow,
  }
}

(window as any).getVisibleRect = getVisibleRect
