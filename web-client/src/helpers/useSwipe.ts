// Порт tweb `src/helpers/useSwipe.ts` (812502980) — директива `use:swipe`:
// перетаскивание указателем или пальцем с разницей координат от точки старта;
// `move` — не чаще раза в кадр. Слушатели движения и отпускания — на документе
// (`useGlobalDocumentEvent`), чтобы жест не терялся за пределами узла.
//
// Расхождения с оригиналом:
//  1. `globalCursor` — `Accessor<string>`, а не `StandardLonghandPropertiesHyphen
//     ['cursor']` из `csstype`: пакет у нас не прямая зависимость.
//  2. Сброс `initialX = initialY = undefined` — присвоение `NaN` под
//     `strictNullChecks` (у tweb `strict` выключен); до следующего `handleStart`
//     координаты не читаются.
//  3. `pointermove` подписан дважды (`:99-101` и `:107-109`) — как у оригинала:
//     второй вызов `handleMove` лишь переписывает тот же `callback` до кадра.
import type { Accessor } from 'solid-js'
import useGlobalDocumentEvent from '@helpers/useGlobalDocumentEvent'
import { requestRAF } from '@helpers/solid/requestRAF'
import { useIsCleaned } from '@helpers/solid/useIsCleaned'

export type SwipeDirectiveArgs = {
  globalCursor?: Accessor<string>
  onStart?: (e: PointerEvent | TouchEvent) => void
  onMove?: (xDiff: number, yDiff: number, e: PointerEvent | TouchEvent) => void
  onEnd?: (xDiff: number, yDiff: number, e: PointerEvent | TouchEvent) => void
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      swipe: SwipeDirectiveArgs
    }
  }
}

export default function swipe(element: HTMLElement, args: Accessor<SwipeDirectiveArgs>) {
  const isCleaned = useIsCleaned()

  let isDragging = false
  let initialX: number, initialY: number

  const getDiffPointer = (e: PointerEvent) => [
    e.clientX - initialX,
    e.clientY - initialY,
  ] as const

  const getDiffTouch = (e: TouchEvent) => [
    e.changedTouches[0].clientX - initialX,
    e.changedTouches[0].clientY - initialY,
  ] as const

  function handleStart(e: PointerEvent | TouchEvent, x: number, y: number) {
    if(isDragging) return
    isDragging = true
    initialX = x
    initialY = y

    const { onStart, globalCursor } = args()
    onStart?.(e)

    if(globalCursor) {
      element.ownerDocument.body.style.setProperty('cursor', globalCursor(), 'important')
      element.style.setProperty('cursor', globalCursor(), 'important')
    }
  }

  let isRAFing = false
  let callback: () => void

  function handleMove(e: PointerEvent | TouchEvent, diff: readonly [number, number]) {
    if(!isDragging) return

    callback = () => {
      const { onMove } = args()
      onMove?.(...diff, e)
    }

    if(isRAFing) return

    isRAFing = true
    requestRAF(() => {
      isRAFing = false
      if(!isDragging || isCleaned()) return

      callback()
    })
  }

  function handleEnd(e: PointerEvent | TouchEvent, diff: readonly [number, number]) {
    if(!isDragging) return

    const { onEnd, globalCursor } = args()
    onEnd?.(...diff, e)
    if(globalCursor) {
      element.ownerDocument.body.style.removeProperty('cursor')
      element.style.removeProperty('cursor')
    }

    isDragging = false
    isRAFing = false
    initialX = initialY = NaN
  }

  element.addEventListener('pointerdown', (e) => {
    handleStart(e, e.clientX, e.clientY)
  })

  element.addEventListener('touchstart', (e) => {
    handleStart(e, e.changedTouches[0].clientX, e.changedTouches[0].clientY)
  })

  useGlobalDocumentEvent('pointermove', (e) => {
    handleMove(e, getDiffPointer(e))
  })

  useGlobalDocumentEvent('touchmove', (e) => {
    handleMove(e, getDiffTouch(e))
  })

  useGlobalDocumentEvent('pointermove', (e) => {
    handleMove(e, getDiffPointer(e))
  })

  useGlobalDocumentEvent('pointerup', (e) => {
    handleEnd(e, getDiffPointer(e))
  })

  useGlobalDocumentEvent('touchend', (e) => {
    handleEnd(e, getDiffTouch(e))
  })
}
