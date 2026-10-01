/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

// Порт tweb `src/helpers/positionMenu.ts`.
//
// Портировано:
//   • `positionMenu(e, elem, side?, additionalPadding?)` (:189-313) —
//     позиционирование меню ОТ ТОЧКИ СОБЫТИЯ (`pageX/pageY`) с фолбэком в
//     `center` при нехватке места и классом `transform-origin` в конце. Это
//     путь контекстного меню сообщения (docs/tweb/message-interactions.md §1.7);
//   • `positionMenuTrigger(...)` (:315-341) — от прямоугольника кнопки-триггера
//     (путь ButtonMenuToggle/autoPosition);
//   • константы `PADDING_* = 8` (:16-19);
//   • `positionFloatingMenu` (:63-144) с `canFitSide` (:34-50), константой
//     `DEFAULT_MENU_WINDOW_MARGIN` (:21) и типами `FloatingMenu*` (:23-32) —
//     подменю у пункта-триггера (`components/floatingButtonMenu.ts`, порт
//     вместе с `createSubmenuTrigger`, задача 2-2 волны 7).
//
// НЕ портировано: `getMenuTopPositionForStartDirection` (:147-154),
// `canMenuFitDirection` (:156-170), `getMenuLeftPositionForDirection`
// (:172-187) и `MenuHorizontalDirection` — их потребители в tweb (меню
// реакций и эмодзи-статуса) в проекте отсутствуют.
//
// Адаптации:
//   • `getAppWindow()` tweb (окно Document PiP) → `window` / `document`:
//     Document PiP у нас нет;
//   • ветка RTL (`I18n.getIsRTL()`, :218-219 и :304-307): оставлена только
//     LTR-половина. Флаг в langPack есть, но RTL включает лишь `ar`, которого
//     нет в списке языков сервера (то же отступление — `components/icon.ts`).

import mediaSizes from '@helpers/mediaSizes'
import clamp from '@helpers/number/clamp'

// tweb components/buttonMenuToggle.ts:60 (тип живёт там; вынесен сюда, чтобы
// vanilla-потребителю не тянуть весь toggle-модуль)
export type ButtonMenuDirection = 'bottom-left' | 'bottom-right' | 'bottom-center' | 'top-left' | 'top-right'

// tweb helpers/positionMenu.ts:9-14 (MenuPositionPadding)
export type MenuPositionPadding = {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

// tweb :16-19
const PADDING_TOP = 8
const PADDING_BOTTOM = PADDING_TOP
const PADDING_LEFT = 8
const PADDING_RIGHT = PADDING_LEFT

// tweb :21
export const DEFAULT_MENU_WINDOW_MARGIN = 16

// tweb :25-27
export type FloatingMenuSide = 'top' | 'left' | 'right' | 'bottom'
export type FloatingMenuAlignment = 'start' | 'center' | 'end'
export type FloatingMenuDirection = `${FloatingMenuSide}-${FloatingMenuAlignment}`

// tweb :29-34
const OPPOSITE_SIDE: Record<FloatingMenuSide, FloatingMenuSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

// tweb :36-52
function canFitSide(
  triggerBcr: DOMRect,
  menu: HTMLElement,
  side: FloatingMenuSide,
  mainOffset: number,
) {
  const margin = DEFAULT_MENU_WINDOW_MARGIN
  switch(side) {
    case 'right':
      return triggerBcr.right + mainOffset + menu.clientWidth + margin <= window.innerWidth
    case 'left':
      return triggerBcr.left - mainOffset - menu.clientWidth - margin >= 0
    case 'bottom':
      return triggerBcr.bottom + mainOffset + menu.clientHeight + margin <= window.innerHeight
    case 'top':
      return triggerBcr.top - mainOffset - menu.clientHeight - margin >= 0
  }
}

/**
 * tweb :54-144. Positions a floating menu next to a trigger element.
 * - `side` is the side of the trigger the menu opens on.
 * - `alignment` aligns the menu along the perpendicular axis.
 * - `offset` is `[x, y]`. The component along the main axis acts as a gap from the trigger,
 *   the perpendicular component nudges along the alignment axis.
 *
 * Sets `left`, `top`, and `transformOrigin` on `menu`. Returns the actually used direction
 * (the side may flip to the opposite if the menu doesn't fit).
 */
export function positionFloatingMenu(
  triggerBcr: DOMRect,
  menu: HTMLElement,
  direction: FloatingMenuDirection,
  offset: [number, number] = [0, 0],
): FloatingMenuDirection {
  const [requestedSide, alignment] = direction.split('-') as [FloatingMenuSide, FloatingMenuAlignment]

  const isHorizontalSide = requestedSide === 'left' || requestedSide === 'right'
  const mainOffset = isHorizontalSide ? offset[0] : offset[1]
  const crossOffset = isHorizontalSide ? offset[1] : offset[0]

  // Flip side if it doesn't fit and the opposite does (mirrors the original right/left logic).
  const opposite = OPPOSITE_SIDE[requestedSide]
  const side: FloatingMenuSide = canFitSide(triggerBcr, menu, requestedSide, mainOffset) ||
      !canFitSide(triggerBcr, menu, opposite, mainOffset) ?
    requestedSide :
    opposite

  const margin = DEFAULT_MENU_WINDOW_MARGIN
  const menuW = menu.clientWidth
  const menuH = menu.clientHeight

  // Main-axis position.
  let left: number
  let top: number

  if(side === 'right' || side === 'left') {
    if(side === 'right') {
      left = triggerBcr.right + mainOffset
    } else {
      left = triggerBcr.left - mainOffset - menuW
    }
    left = clamp(left, margin, window.innerWidth - menuW - margin)

    // Cross axis: vertical.
    if(alignment === 'start') {
      top = triggerBcr.top + crossOffset
    } else if(alignment === 'center') {
      top = triggerBcr.top + triggerBcr.height / 2 - menuH / 2 + crossOffset
    } else {
      top = triggerBcr.bottom - menuH - crossOffset
    }
    top = clamp(top, margin, window.innerHeight - menuH - margin)
  } else {
    if(side === 'bottom') {
      top = triggerBcr.bottom + mainOffset
    } else {
      top = triggerBcr.top - mainOffset - menuH
    }
    top = clamp(top, margin, window.innerHeight - menuH - margin)

    // Cross axis: horizontal.
    if(alignment === 'start') {
      left = triggerBcr.left + crossOffset
    } else if(alignment === 'center') {
      left = triggerBcr.left + triggerBcr.width / 2 - menuW / 2 + crossOffset
    } else {
      left = triggerBcr.right - menuW - crossOffset
    }
    left = clamp(left, margin, window.innerWidth - menuW - margin)
  }

  // Transform origin: corner/edge closest to the trigger.
  let originX: string
  let originY: string
  const alignmentToPercent = alignment === 'start' ? '0' : alignment === 'center' ? '50%' : '100%'

  if(side === 'right' || side === 'left') {
    originX = side === 'right' ? '0' : '100%'
    originY = alignmentToPercent
  } else {
    originY = side === 'bottom' ? '0' : '100%'
    originX = alignmentToPercent
  }

  menu.style.left = left + 'px'
  menu.style.top = top + 'px'
  menu.style.transformOrigin = `${originX} ${originY}`

  return `${side}-${alignment}` as FloatingMenuDirection
}

/**
 * tweb :189-313. Ставит `elem` у точки события и вешает класс
 * `transform-origin` (`bottom-left|bottom-right|bottom-center|center-*`).
 * `side` — сторона РАСКРЫТИЯ; как и в оригинале, аргумент тут же
 * перезаписывается по `mediaSizes.isMobile` (комментарий tweb `// * side mean
 * the OPEN side` относится к смыслу, а не к тому, что значение вызывающего
 * учитывается).
 */
export default function positionMenu(
  e: MouseEvent | Touch | TouchEvent,
  elem: HTMLElement,
  side?: 'left' | 'right' | 'center',
  additionalPadding?: MenuPositionPadding,
) {
  if((e as TouchEvent).touches) {
    e = (e as TouchEvent).touches[0]
  }

  const { pageX, pageY } = e as Touch

  const getScrollWidthFromElement = (Array.from(elem.children) as HTMLElement[]).find((element) => element.classList.contains('btn-menu-items') || (element.classList.contains('btn-menu-item') && !element.classList.contains('hide'))) || elem

  let { scrollWidth: menuWidth } = getScrollWidthFromElement
  const { scrollHeight: menuHeight } = elem
  const rect = document.body.getBoundingClientRect()
  const windowWidth = rect.width
  const windowHeight = rect.height

  menuWidth += getScrollWidthFromElement.offsetLeft * 2

  // `paddingTop` (tweb :227, :229) не перенесён вместе с `minTop`: кроме него
  // его никто не читает, то есть `additionalPadding.top` в `positionMenu` не
  // влияет ни на что и в самом tweb — работают только right/bottom/left.
  let paddingRight = PADDING_RIGHT, paddingBottom = PADDING_BOTTOM, paddingLeft = PADDING_LEFT
  if(additionalPadding) {
    if(additionalPadding.right) paddingRight += additionalPadding.right
    if(additionalPadding.bottom) paddingBottom += additionalPadding.bottom
    if(additionalPadding.left) paddingLeft += additionalPadding.left
  }

  side = mediaSizes.isMobile ? 'right' : 'left'
  let verticalSide: 'top' /* | 'bottom' */ | 'center' = 'top'

  const maxTop = windowHeight - menuHeight - paddingBottom
  const maxLeft = windowWidth - menuWidth - paddingRight
  // tweb :232 `const minTop = paddingTop` не перенесён: он читается только в
  // закомментированных там же `intermediateY`-черновиках (:243-244), а у нас
  // `noUnusedLocals` — ошибка компиляции.
  const minLeft = paddingLeft

  const getSides = () => {
    return {
      x: {
        left: pageX,
        right: Math.min(maxLeft, pageX - menuWidth),
      },
      intermediateX: side === 'right' ? minLeft : maxLeft,
      y: {
        top: pageY,
        bottom: pageY - menuHeight,
      },
      intermediateY: maxTop,
    }
  }

  const sides = getSides()

  const possibleSides = {
    x: {
      left: (sides.x.left + menuWidth + paddingRight) <= windowWidth,
      right: sides.x.right >= paddingLeft,
    },
    y: {
      top: (sides.y.top + menuHeight + paddingBottom) <= windowHeight,
      bottom: (sides.y.bottom - paddingBottom) >= paddingBottom,
    },
  }

  // Касты индекса — под наш строгий tsconfig: к моменту чтения `side` ещё
  // 'left'|'right', а 'center' присваивается уже в ветке-фолбэке (в tweb
  // `strict` выключен и TS7053 там не возникает). То же с `verticalSide`.
  {
    const s = side as 'left' | 'right'
    const left = possibleSides.x[s] ? sides.x[s] : (side = 'center', sides.intermediateX)

    elem.style.left = left + 'px'
  }

  {
    const v = verticalSide as 'top'
    const top = possibleSides.y[v] ? sides.y[v] : (verticalSide = 'center', sides.intermediateY)

    elem.style.top = top + 'px'
  }

  elem.className = elem.className.replace(/(top|center|bottom)-(left|center|right)/g, '')
  elem.classList.add(
    (verticalSide === 'center' ? verticalSide : 'bottom') +
    '-' +
    (side === 'center' ? side : (side === 'left' ? 'right' : 'left')))

  return {
    width: menuWidth,
    height: menuHeight,
  }
}

export function positionMenuTrigger(trigger: HTMLElement, menu: HTMLElement, direction: ButtonMenuDirection, additionalPadding?: MenuPositionPadding) {
  const triggerRect = trigger.getBoundingClientRect()

  const [directionX, directionY] = direction.split('-')

  if (directionX === 'bottom') {
    const top = triggerRect.top + triggerRect.height + (additionalPadding?.top ?? 0)
    menu.style.top = `${Math.max(top, additionalPadding?.top ?? 0)}px`
  } else {
    const bottom = window.innerHeight - triggerRect.top + (additionalPadding?.bottom ?? 0)
    menu.style.bottom = `${Math.max(bottom, additionalPadding?.bottom ?? 0)}px`
  }

  if (directionY === 'right' || directionY === 'center') {
    const left = triggerRect.left + (additionalPadding?.left ?? 0)
    menu.style.left = `${Math.max(left, additionalPadding?.left ?? 0)}px`
  } else {
    const right = window.innerWidth - triggerRect.left - triggerRect.width - (additionalPadding?.right ?? 0)
    menu.style.right = `${Math.max(right, additionalPadding?.right ?? 0)}px`
  }

  if (directionY === 'center') {
    menu.style.setProperty('--parent-half-width', (trigger.clientWidth / 2) + 'px')
  }
}
