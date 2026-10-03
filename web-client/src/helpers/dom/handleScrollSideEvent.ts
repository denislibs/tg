// Порт tweb `src/helpers/dom/handleScrollSideEvent.ts` (812502980, 43 строки) — колбэк на
// жест прокрутки к стороне (`wheel` на десктопе, `touchmove` на сенсоре). Им плашка закрепа
// снимает «ожидание прокрутки вниз» после прыжка к закрепу (`chat/pinnedMessage.solid.tsx`).
// Порт 1:1.
import type ListenerSetter from '@helpers/listenerSetter'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'

export default function handleScrollSideEvent(elem: HTMLElement, side: 'top' | 'bottom', callback: () => void, listenerSetter: ListenerSetter) {
  if(IS_TOUCH_SUPPORTED) {
    let lastY: number
    const options = { passive: true }
    const onTouchMove = (e: TouchEvent) => {
      const clientY = e.touches[0].clientY

      const isDown = clientY < lastY
      if(side === 'bottom' && isDown) callback()
      else if(side === 'top' && !isDown) callback()
      lastY = clientY
    }

    const onTouchEnd = () => {
      listenerSetter.removeManual(elem, 'touchmove', onTouchMove, options)
      listenerSetter.removeManual(elem, 'touchend', onTouchEnd, options)
    }

    listenerSetter.add(elem)('touchstart', (e) => {
      if(e.touches.length > 1) {
        onTouchEnd()
        return
      }

      lastY = e.touches[0].clientY

      listenerSetter.add(elem)('touchmove', onTouchMove, options)
      listenerSetter.add(elem)('touchend', onTouchEnd, options)
    }, options)
  } else {
    listenerSetter.add(elem)('wheel', (e) => {
      const isDown = e.deltaY > 0
      if(side === 'bottom' && isDown) callback()
      else if(side === 'top' && !isDown) callback()
    }, { passive: true })
  }
}
