/**
 * Порт tweb `src/helpers/solid/wrapSolidComponent.ts` (812502980) в объёме
 * `unwrapSolidElement` + `wrapSolidComponent`: ванильный класс берёт узел
 * Solid-разметки (секцию, поле поиска селектора пиров) и отдаёт её корень
 * своему `middleware` — корень гаснет вместе с классом.
 *
 * `mountSolidComponent` (:24-48) не перенесён — вызывающих у нас нет.
 */
import { createRoot, type JSX } from 'solid-js'
import type { Middleware } from '@helpers/middleware'

export function unwrapSolidElement(element: JSX.Element): JSX.Element {
  while(typeof(element) === 'function') {
    element = (element as () => JSX.Element)()
  }

  return element
}

export function wrapSolidComponent(component: () => JSX.Element, middleware: Middleware): HTMLElement {
  let dispose!: VoidFunction
  const el = createRoot((dispose_) => {
    dispose = dispose_
    return unwrapSolidElement(component())
  })

  middleware.onClean(dispose)

  return el as HTMLElement
}
