/**
 * Порт tweb `src/helpers/solid/wrapSolidComponent.ts:1-22` (812502980) —
 * Solid-разметка как готовый узел для императивного кода: корень `createRoot`,
 * снятие — на `onClean` переданной миддлвари. `unwrapSolidElement` отдельно зовёт
 * `components/checkboxFields.solid.tsx`: результат Solid-компонента может быть
 * функцией-аксессором (обёртка разработки — у нас так в vitest), а императивному
 * вызывающему нужен сам узел.
 *
 * `mountSolidComponent` (`:24-50`) — корень со своей дочерней миддлварью и
 * `dispose` на случай, когда узел снимают раньше владельца (строки ссылок
 * редактора папки, `sidebarLeft/tabs/editFolder.solid.tsx`).
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

export function mountSolidComponent(
  component: (middleware: Middleware) => JSX.Element,
  parentMiddleware: Middleware,
): { element: HTMLElement, dispose: VoidFunction, middleware: Middleware } {
  const middlewareHelper = parentMiddleware.create()
  const middleware = middlewareHelper.get()
  let disposed = false
  const dispose = () => {
    if(disposed) {
      return
    }

    disposed = true
    middlewareHelper.destroy()
  }

  try {
    return {
      element: wrapSolidComponent(() => component(middleware), middleware),
      dispose,
      middleware,
    }
  } catch(err) {
    dispose()
    throw err
  }
}
