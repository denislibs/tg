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
//   • константы `PADDING_* = 8` (:16-19).
//
// НЕ портировано: `positionFloatingMenu` (:63-144), `canFitSide` (:34-50),
// `getMenuTopPositionForStartDirection` (:147-154), `canMenuFitDirection`
// (:156-170), `getMenuLeftPositionForDirection` (:172-187), константа
// `DEFAULT_MENU_WINDOW_MARGIN` и типы `FloatingMenu*` — их единственные
// потребители в tweb (`components/floatingButtonMenu.ts`,
// `components/createSubmenuTrigger.ts`) в проекте отсутствуют; приедут вместе
// с портом подменю.
//
// Адаптации:
//   • `getAppWindow()` tweb (окно Document PiP) → `window` / `document`:
//     Document PiP у нас нет;
//   • ветка RTL (`I18n.getIsRTL()`, :218-219 и :304-307): langPack не
//     портирован и RTL-локалей у нас нет — оставлена только LTR-половина
//     (то же отступление задокументировано в `components/icon.ts`).

import mediaSizes from '@helpers/mediaSizes'

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
