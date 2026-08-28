// Порт tweb `src/helpers/dom/handleHorizontalSwipe.ts` — 1:1 по логике.
// Обёртка над `SwipeHandler`, которая превращает произвольный жест в
// ГОРИЗОНТАЛЬНЫЙ: инвертирует диффы (тянем влево → положительный xDiff),
// один раз за жест фиксирует ось (`cancelY`) и гасит жест, если он оказался
// вертикальным, а `onReset` доводит до потребителя только те жесты, где
// движение реально было (`hadMove`).
//
// Адаптации (только импорты и строгий tsconfig, поведение не менялось):
//   • `@components/swipeHandler` у нас лежит в `@core/dom/swipeHandler`
//     (уже портирован 1:1);
//   • тип события жеста (`EE` в оригинале) из `swipeHandler.ts` не
//     экспортируется — берём его из сигнатуры `SwipeHandlerOptions`, чтобы не
//     заводить второй экземпляр того же типа;
//   • `as any as TouchEvent` / `as any as Event` в оригинале → `as unknown as`
//     (`any` в этом репозитории запрещён, рантайм тот же);
//   • закомментированный в tweb `xThreshold` (объявление в типе и две ветки
//     его использования) не переносится — мёртвый код.
import SwipeHandler, { type SwipeHandlerOptions } from '@core/dom/swipeHandler'
import cancelEvent from '@helpers/dom/cancelEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import isSwipingBackSafari from '@helpers/dom/isSwipingBackSafari'

/** Событие жеста в форме, которую отдаёт `SwipeHandler` (в tweb — тип `EE`). */
export type SwipeEvent = Parameters<SwipeHandlerOptions['onSwipe']>[2]

export type SwipeHandlerHorizontalOptions = SwipeHandlerOptions

export default function handleHorizontalSwipe(options: SwipeHandlerHorizontalOptions) {
  let cancelY = false, hadMove = false
  return new SwipeHandler({
    ...options,
    verifyTouchTarget: (e) => {
      return !findUpClassName(e.target, 'progress-line') &&
        !isSwipingBackSafari(e as unknown as TouchEvent) &&
        (options.verifyTouchTarget ? options.verifyTouchTarget(e) : true)
    },
    onSwipe: (xDiff, yDiff, e) => {
      xDiff *= -1
      yDiff *= -1

      if(!cancelY && Math.abs(yDiff) > 20) {
        return true
      }

      if(Math.abs(xDiff) > Math.abs(yDiff)) {
        cancelEvent(e as unknown as Event)
        cancelY = true
      } else if(!cancelY && Math.abs(yDiff) > Math.abs(xDiff)) {
        return true
      }

      hadMove = true
      return options.onSwipe(xDiff, yDiff, e)
    },
    onReset: () => {
      if(hadMove) options.onReset?.()
      cancelY = hadMove = false
    },
    // cannot use cancelEvent on Safari iOS because scroll will be canceled too
    cancelEvent: false,
  })
}
