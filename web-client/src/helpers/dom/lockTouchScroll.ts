// Порт tweb `src/helpers/dom/lockTouchScroll.ts` — 1:1.
//
// Зачем: во время анимации перехода между вкладками палец не должен доскроллить
// страницу — иначе вкладка приезжает уже на другой позиции, и восстановленный
// `scrollPosition` (`appSearchSuper.ts:697`) промахивается.
//
// Два «замка» на один вызов (`lockers = 2`) — не описка оригинала: снять
// блокировку должны ОБА события, и `touchend` пальца, и конец перехода вкладок
// (возвращённый колбэк зовёт `appSearchSuper` в `onTransitionEnd`,
// `appSearchSuper.ts:699-702`). Кто придёт вторым — тот и снимет слушателя.
import cancelEvent from '@helpers/dom/cancelEvent'

export default function lockTouchScroll(container: HTMLElement) {
  const onTouchMove = (e: TouchEvent) => {
    cancelEvent(e)
  }

  let lockers = 2
  const cb = () => {
    if(!--lockers) {
      container.removeEventListener('touchmove', onTouchMove, { capture: true })
    }
  }

  container.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
  container.addEventListener('touchend', cb, { once: true })

  return cb
}
