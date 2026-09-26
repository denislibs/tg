/**
 * Порт tweb `src/helpers/solid/wrapSolidComponent.ts:1-22` (812502980) —
 * Solid-разметка как готовый узел для императивного кода: корень `createRoot`,
 * снятие — на `onClean` переданной миддлвари.
 *
 * `mountSolidComponent` (`:24-50`) не портирован: потребителя у нас нет
 * (первый вызывающий — вкладки автозагрузки, им нужен только узел).
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
