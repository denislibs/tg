// Порт tweb `src/helpers/dom/disableTransition.ts` (812502980) 1:1: класс
// `no-transition` на два кадра — переход колонок/инстансов чата не играет
// (жест «назад» мобильного Safari, `animate === false`).
import { doubleRaf } from '@helpers/schedulers'

export default function disableTransition(elements: HTMLElement[]) {
  elements.forEach((el) => el.classList.add('no-transition'))

  void doubleRaf().then(() => {
    elements.forEach((el) => el.classList.remove('no-transition'))
  })
}
