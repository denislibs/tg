// Порт tweb `helpers/dom/clickEvent.ts` — в объёме потребителей:
// `CLICK_EVENT_NAME` (на таче клик = mousedown, без 300мс-задержки),
// глобальный mousedown-трекер + `hasMouseMovedSinceDown` (подавление клика,
// «уехавшего» с места нажатия — drag не должен кликать) и `attachClickEvent`.
// Первый потребитель — ProgressivePreloader (`components/preloader.ts`, отмена
// загрузки по клику), дальше — медиавьювер (порт tweb `mediaViewer/base.ts`).
//
// Адаптации (поведение не менялось):
//   • ребиндинг mousedown-трекера на окно Document PiP (tweb
//     `bindMouseDownTracker`/`onAppWindowChange`) не портирован: хелпера
//     `appWindow` у нас нет — трекер висит на главном `document`, как в
//     апстримном tweb до pip-патча; вернуть вместе с PiP-работой вьювера
//   • `options.touchMouseDown = true` — мёртвая запись уже в tweb (читается
//     только внутри закомментированного touchend-черновика) — не перенесена,
//     как и сам черновик
//   • `simulateClickEvent` (tweb :100-102, поверх `helpers/dom/dispatchEvent.ts`
//     `simulateEvent`) — теперь есть потребитель: `components/popups/popupElement.ts`
//     (Enter подтверждает верхний попап кликом по `btnConfirmOnEnter`)
//   • строгий tsconfig: `add`/`remove` зовутся через узкие касты
//     (`EventListener`), в tweb там непроверяемые bind-обёртки + `@ts-ignore`
import type ListenerSetter from '@helpers/listenerSetter'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'

let lastMouseDownElement: HTMLElement
const onGlobalMouseDown = (e: MouseEvent) => {
  lastMouseDownElement = e.target as HTMLElement
  if(lastMouseDownElement?.closest('[cancel-mouse-down]')) {
    e.preventDefault()
  }
}

// Строка проводки: единственный глобальный трекер последнего mousedown —
// держит clickEvent.test.ts (preventDefault внутри [cancel-mouse-down]).
document.addEventListener('mousedown', onGlobalMouseDown)

export function hasMouseMovedSinceDown(e: Event) {
  if(e.isTrusted && e.type === 'click' && e.target !== lastMouseDownElement) {
    return true
  }
}

export const CLICK_EVENT_NAME: 'mousedown' | 'click' = IS_TOUCH_SUPPORTED ? 'mousedown' : 'click'
export type AttachClickOptions = AddEventListenerOptions & Partial<{
  listenerSetter: ListenerSetter,
  cancelMouseDown: boolean,
  ignoreMove: boolean
}>
export function attachClickEvent(elem: HTMLElement | Window, callback: (e: MouseEvent) => void, options: AttachClickOptions = {}) {
  const add = options.listenerSetter ?
    options.listenerSetter.add(elem as HTMLElement) :
    elem.addEventListener.bind(elem)
  const remove = options.listenerSetter ?
    options.listenerSetter.removeManual.bind(options.listenerSetter, elem as HTMLElement) :
    elem.removeEventListener.bind(elem)

  if(options.cancelMouseDown) {
    (elem as HTMLElement).setAttribute('cancel-mouse-down', '')
  }

  if(CLICK_EVENT_NAME === 'click' && !options.ignoreMove) {
    const cb = callback
    callback = (e) => {
      if(hasMouseMovedSinceDown(e)) {
        return
      }

      cb(e)
    }
  }

  add(CLICK_EVENT_NAME, callback as EventListener, options)

  return () => remove(CLICK_EVENT_NAME, callback as EventListener, options)
}

/** tweb :100-102 — синтетический клик на CLICK_EVENT_NAME (не буквальный
 *  'click': на тач-устройствах attachClickEvent слушает 'mousedown'). */
export function simulateClickEvent(elem: HTMLElement) {
  elem.dispatchEvent(new Event(CLICK_EVENT_NAME, { bubbles: true, cancelable: true }))
}
