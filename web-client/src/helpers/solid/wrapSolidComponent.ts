// Порт tweb `helpers/solid/wrapSolidComponent.ts:4-10` (812502980) — только
// `unwrapSolidElement`: результат Solid-компонента может быть функцией-аксессором
// (обёртка разработки/горячей замены — у нас так в vitest), а императивному
// вызывающему нужен сам узел. Первый вызывающий — `components/checkboxFields.solid.tsx`
// (строка строится в своём `createRoot` и отдаётся наружу для `append`, как у
// оригинала `:130-223`). `wrapSolidComponent`/`mountSolidComponent` (`:12-50`) —
// без вызывающих, не перенесены.
import type { JSX } from 'solid-js'

export function unwrapSolidElement(element: JSX.Element): JSX.Element {
  while(typeof element === 'function') {
    element = (element as () => JSX.Element)()
  }

  return element
}
