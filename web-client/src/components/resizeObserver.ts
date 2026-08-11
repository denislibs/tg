// Порт tweb `components/resizeObserver.ts` — 1:1, без отличий (только формат
// под `.oxlintrc.json` этого репозитория: без `;`, чинится `oxlint --fix`;
// логика не менялась ни на строку). Утилита, не React-компонент — лежит в
// `components/` только чтобы совпасть с путём алиаса `@components/*` из tweb
// (см. комментарий про алиасы в `vite.config.ts`); тот же прецедент уже есть
// в `components/stickyIntersector.ts` (Задача 1 этого этапа).
//
// Довезено как зависимость `helpers/dom/scrollbarWidth.ts` (решение
// координатора по блокеру Задачи 2 — см. `task-2-report.md`).
//
// `ResizeObserver` конструируется безусловно на импорте модуля — в happy-dom
// (наши тесты) он есть глобально (проверено: `new Window().ResizeObserver`
// определён), так что, в отличие от `IntersectionObserver` из Задачи 1,
// защитный `typeof === 'undefined'`-гард здесь не нужен.

const resizeObserverMap: WeakMap<Element, Array<(entry: ResizeObserverEntry) => void>> = new WeakMap()
const resizeObserver = new ResizeObserver((entries) => {
  for(const entry of entries) {
    const callbacks = resizeObserverMap.get(entry.target)
    callbacks?.forEach((callback) => {
      try {
        callback(entry)
      } catch(e) {
        console.error('ResizeObserver callback error:', e)
      }
    })
  }
})

export function observeResize(element: Element, callback: (entry: ResizeObserverEntry) => void) {
  const callbacks = resizeObserverMap.get(element) ?? []

  callbacks.push(callback)

  resizeObserverMap.set(element, callbacks)

  if(callbacks.length === 1) {
    resizeObserver.observe(element)
  }

  return () => {
    unobserveResize(element, callback)
  }
}

/**
 * Removes a resize observer callback for the given element.
 * If no callback is provided, all callbacks for the element are removed.
 */
export function unobserveResize(element: Element, callback?: (entry: ResizeObserverEntry) => void) {
  const callbacks = resizeObserverMap.get(element)
  if(!callbacks) return

  if(callback) {
    const index = callbacks.indexOf(callback)
    if(index > -1) {
      callbacks.splice(index, 1)
    }
  } else {
    callbacks.splice(0, callbacks.length)
  }

  if(callbacks.length === 0) {
    resizeObserverMap.delete(element)
    resizeObserver.unobserve(element)
  }
}
