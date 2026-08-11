// Порт tweb `helpers/dom/scrollbarWidth.ts` — DOM-техника измерения (скрытый
// `div` с `overflow:scroll`, `offsetWidth - clientWidth`, все CSS-строки и
// пороги) перенесена дословно. Единственная замена — solid-js `createSignal`
// на обычную переменную в замыкании: solid-js не входит в зависимости этого
// проекта, программа сознательно отказалась его вводить (см. `helpers/
// mediaSizes.ts`, `helpers/solid/readValue.ts` — тот же приём под ту же
// причину; закреплено в `docs/superpowers/plans/2026-08-10-tweb-core-program.md`,
// решение координатора по блокеру Задачи 2 — см. `task-2-report.md`).
// Значение как и в оригинале мутируется извне (через `observeResize`) и
// читается через функцию-геттер `scrollbarWidth()` — вызывающему коду
// (`environment/overlayScrollSupport.ts`) без разницы, Solid-Accessor это
// или обычная функция: и то, и другое — `() => number`.
import { observeResize } from '@components/resizeObserver'

let _scrollbarWidth = 0

let initialized = false

function init() {
  initialized = true
  const outer = document.createElement('div')
  outer.id = 'scrollbar-width'
  outer.style.cssText = 'position:fixed;top:-200px;left:-200px;width:100px;height:100px;overflow:scroll;visibility:hidden;pointer-events:none;opacity:0;'
  const inner = document.createElement('div')
  inner.style.cssText = 'width:100%;height:200px;'
  outer.appendChild(inner)
  document.documentElement.appendChild(outer)

  function measure() {
    _scrollbarWidth = outer.offsetWidth - outer.clientWidth
  }

  measure()

  // When macOS switches scrollbar mode, inner div resizes → callback fires
  observeResize(inner, measure)
}

const scrollbarWidth = (): number => {
  if(!initialized) {
    init()
  }
  return _scrollbarWidth
}

export default scrollbarWidth
