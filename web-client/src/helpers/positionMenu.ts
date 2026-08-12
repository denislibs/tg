/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

// Порт tweb `src/helpers/positionMenu.ts` — ТОЛЬКО positionMenuTrigger
// (:315-341): позиционирование btn-menu, смонтированного в body
// (ButtonMenuToggle-путь autoPosition), от прямоугольника кнопки-триггера.
// Остальной файл (positionMenu — контекстные меню от точки клика/события,
// RTL-ветки, top-layer) не портирован: наши контекстные меню — React
// (shared/ui/Menu), позиционируются углом-классом внутри хоста-кнопки.
// getAppWindow() tweb (окно Document PiP) → window: Document PiP у нас нет.

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
