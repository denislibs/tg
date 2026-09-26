/**
 * Активация label — по спецификации, а не по happy-dom. Браузер досылает click
 * в поле ПОСЛЕ всего диспатча и только если клик не отменён (activation
 * behavior); happy-dom делает это прямо на узле label по ходу всплытия
 * (`HTMLLabelElement.dispatchEvent`), то есть ДО делегированного обработчика
 * Solid на `document` — `cancelEvent` строки его уже не отменит, и «ровно один
 * раз» мерилось бы по поведению, которого в браузере нет. Шим снимает
 * активацию с узла и исполняет её слушателем на `window` — последней точке
 * всплытия, после `document`.
 *
 * Вынесен из теста пилота (`sidebarLeft/tabs/notifications.solid.test.tsx`,
 * итог задачи 6 плана 2D): он нужен каждой вкладке настроек, у которой строка —
 * `label` с полем внутри. Снимается `vi.restoreAllMocks()` (шпион) и
 * возвращённой функцией (слушатель).
 */
import { vi } from 'vitest'

export function installSpecLabelActivation() {
  const baseDispatch = Object.getPrototypeOf(HTMLLabelElement.prototype).dispatchEvent as EventTarget['dispatchEvent']
  vi.spyOn(HTMLLabelElement.prototype, 'dispatchEvent').mockImplementation(function(this: HTMLLabelElement, event: Event) {
    return baseDispatch.call(this, event)
  })
  const activate = (event: Event) => {
    if(event.defaultPrevented || !(event instanceof MouseEvent)) return
    const target = event.target as Element
    const control = target.closest?.('label')?.control
    if(control && control !== target) control.click()
  }
  window.addEventListener('click', activate)
  return () => window.removeEventListener('click', activate)
}
