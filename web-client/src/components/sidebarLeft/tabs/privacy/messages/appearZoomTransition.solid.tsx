/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/privacy/messages/appearZoomTransition.tsx`
 * (812502980, 29 строк) — появление/исчезание узла масштабом 0 ↔ 1 за 80 мс.
 * У tweb живёт в каталоге вкладки «Сообщения», но зовут её и другие
 * (`saveButton.tsx`) — адрес оставлен оригинальный.
 *
 * Расхождение с оригиналом: `Transition` — наш вендор
 * `@vendor/solid-transition-group` (форк tweb того же пакета).
 */
import type { ParentComponent } from 'solid-js'
import { Transition } from '@vendor/solid-transition-group'

const animateEl = (backwards = false) => async(el: Element, done: () => void) => {
  const keyframes = ['scale(0)', 'scale(1)']
  if(backwards) keyframes.reverse()

  await el.animate(
    { transform: keyframes },
    { duration: 80 },
  ).finished

  done()
}

const AppearZoomTransition: ParentComponent = (props) => {
  return (
    <Transition
      onEnter={animateEl()}
      onExit={animateEl(true)}
    >
      {props.children}
    </Transition>
  )
}

export default AppearZoomTransition
