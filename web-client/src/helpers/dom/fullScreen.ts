// Порт tweb `helpers/dom/fullScreen.ts` — целиком (Task 12 привёз
// isFullScreen/getFullScreenElement для гейтов вьювера, Task 15 —
// requestFullScreen/cancelFullScreen/addFullScreenListener для vanilla-плеера).
//
// Строгий tsconfig: вендор-префиксные поля объявлены узкими локальными типами
// вместо `@ts-ignore` tweb — рантайм тот же (`||`/`else if`-цепочки оригинала).
import type ListenerSetter from '@helpers/listenerSetter'

type FullScreenDocument = Document & {
  mozFullScreenElement?: Element | null
  webkitFullscreenElement?: Element | null
  msFullscreenElement?: Element | null
  cancelFullScreen?: () => void
  mozCancelFullScreen?: () => void
  webkitCancelFullScreen?: () => void
  msExitFullscreen?: () => void
}

type FullScreenElement = HTMLElement & {
  mozRequestFullScreen?: () => void
  webkitRequestFullscreen?: () => void
  msRequestFullscreen?: () => void
}

export function requestFullScreen(element: HTMLElement) {
  const el = element as FullScreenElement
  if (el.requestFullscreen) {
    void el.requestFullscreen()
  } else if (el.mozRequestFullScreen) {
    el.mozRequestFullScreen() // Firefox
  } else if (el.webkitRequestFullscreen) {
    el.webkitRequestFullscreen() // Chrome and Safari
  } else if (el.msRequestFullscreen) {
    el.msRequestFullscreen()
  }
}

export function cancelFullScreen() {
  const doc = document as FullScreenDocument
  if (doc.cancelFullScreen) {
    doc.cancelFullScreen()
  } else if (doc.mozCancelFullScreen) {
    doc.mozCancelFullScreen()
  } else if (doc.webkitCancelFullScreen) {
    doc.webkitCancelFullScreen()
  } else if (doc.msExitFullscreen) {
    doc.msExitFullscreen()
  }
}

export function addFullScreenListener(element: HTMLElement, callback: (e: Event) => void, listenerSetter?: ListenerSetter) {
  const addListener = listenerSetter ? listenerSetter.add(element) : element.addEventListener.bind(element)
  'webkitfullscreenchange mozfullscreenchange fullscreenchange MSFullscreenChange'.split(' ').forEach((eventName) => {
    addListener(eventName, callback, false)
  })
}

export function getFullScreenElement() {
  const doc = document as FullScreenDocument
  return doc.fullscreenElement || doc.mozFullScreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement
}

export function isFullScreen() {
  return !!getFullScreenElement()
}
