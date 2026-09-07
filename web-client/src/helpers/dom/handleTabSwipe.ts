// Порт tweb `src/helpers/dom/handleTabSwipe.ts` — 1:1.
//
// Надстройка над `handleHorizontalSwipe`: жест доводится до потребителя только
// когда палец прошёл больше 50px по X, и тогда же гасится long-press-открытие
// контекстного меню (`cancelContextMenuOpening`) — иначе свайп по элементу
// вкладки закончится ещё и меню.
//
// Двойная инверсия диффов (здесь и в `handleHorizontalSwipe`) — оригинальная:
// внешний слой уже перевернул знаки, этот переворачивает обратно, а потребитель
// (`appSearchSuper.ts:503-504`) переворачивает в третий раз. Дословность важнее
// упрощения: знак решает, в какую сторону листается вкладка.
import { cancelContextMenuOpening } from '@helpers/dom/attachContextMenuListener'
import handleHorizontalSwipe, { type SwipeHandlerHorizontalOptions } from '@helpers/dom/handleHorizontalSwipe'

export default function handleTabSwipe(options: SwipeHandlerHorizontalOptions) {
  return handleHorizontalSwipe({
    ...options,
    onSwipe: (xDiff, yDiff, e) => {
      xDiff *= -1
      yDiff *= -1

      if(Math.abs(xDiff) > 50) {
        options.onSwipe(xDiff, yDiff, e)
        cancelContextMenuOpening()

        return true
      }
    },
  })
}
